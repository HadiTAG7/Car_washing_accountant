import { describe, it, expect } from 'vitest';
import { sspIsoDay, sspEventTime, sspSourceRecord, collectSspWashes } from '../../scripts/ssp-cloud-collector.mjs';

describe('SSP source dates and execution evidence', () => {
  it('normalizes real calendar dates and rejects ambiguous or impossible dates', () => {
    expect(sspIsoDay('October 28, 2026')).toBe('2026-10-28');
    expect(sspIsoDay('Feb 29, 2028')).toBe('2028-02-29');
    for (const invalid of ['2026-02-30', 'Feb 29, 2026', '28/10/26', 'next Monday']) expect(sspIsoDay(invalid)).toBeNull();
  });
  it('retains Riyadh midnight, noon and year-crossing event dates without manufacturing missing events', () => {
    expect(sspEventTime('Oct 28, 12:05 AM', '2026-10-28')).toBe('2026-10-28T00:05:00+03:00');
    expect(sspEventTime('Oct 28, 12:05 PM', '2026-10-28')).toBe('2026-10-28T12:05:00+03:00');
    expect(sspEventTime('Jan 1, 12:05 AM', '2026-12-31')).toBe('2027-01-01T00:05:00+03:00');
    for (const value of ['', null, 'Not yet', 'Oct 28, 13:05 PM', 'Oct 28, 10:65 PM']) expect(sspEventTime(value, '2026-10-28')).toBeNull();
  });
  it('projects only source wash facts and names the owner classification and minute precision', () => {
    const record = sspSourceRecord({ ID:'S-990001', Biker:'Synthetic (2001)', 'Booking Date':'Oct 28, 2026', Status:'Collecting Payment',
      Customer:'PRIVATE CUSTOMER', Mobile:'PRIVATE PHONE' }, { 'Start Service':'Oct 28, 06:58 PM', 'End Service':'Oct 28, 07:11 PM', 'Net Amount':'999 SAR' },
    'individual', 'https://ssp-portal.sweater.sa/bookings');
    expect(record).toMatchObject({ driverExternalId:'2001', startedAt:'2026-10-28T18:58:00+03:00', completedAt:'2026-10-28T19:11:00+03:00', serviceType:'interior_exterior_wash' });
    expect(record.platformAmount).toBeUndefined();
    expect(JSON.stringify(record)).not.toMatch(/PRIVATE|999/);
    expect(record.notes).toContain('minute precision');
    expect(record.notes).toContain('owner rule');
  });
});

const headers = ['ID','Biker','Booking Date','Status'];
function sourcePage({ duplicate=false, wrongDate=false, wrongZone=false } = {}) {
  let current, selected=0;
  const row = id => ({ ID:id, Biker:'Synthetic (2001)', 'Booking Date': wrongDate ? 'Oct 27, 2026' : 'Oct 28, 2026', Status:'Collecting Payment' });
  const locator = () => ({ nth(i) { selected=i; return this; }, locator() { return this; }, click:async()=>{}, waitFor:async()=>{} });
  return { goto:async url=>{current=new URL(url);}, getByRole:()=>({waitFor:async()=>{}}), waitForFunction:async()=>{}, locator,
    keyboard:{press:async()=>{}}, evaluate:async fn=>{
      const text=fn.toString();
      if (text.includes('resolvedOptions')) return wrongZone ? 'UTC' : 'Asia/Riyadh';
      if (text.includes('headers =')) {
        const corporate=current.pathname==='/b2b-bookings', number=+(current.searchParams.get('page') || 1);
        return {headers, rows:corporate?[]:[row(duplicate?'S-990001':`S-99000${number}`)], emptyText:corporate?'No B2B bookings found.':null,
          page:number,pages:corporate?0:2,url:current.href};
      }
      expect(selected).toBe(0);
      return {'Start Service':'Oct 28, 06:58 PM','End Service':'Oct 28, 07:11 PM'};
    } };
}
describe('complete source page coverage', () => {
  it('counts every page and verifies the corporate empty state', async () => {
    const result=await collectSspWashes(sourcePage(),{rangeFrom:'2026-10-28',rangeTo:'2026-10-28'});
    expect(result.records).toHaveLength(2);
    expect(result.coverage).toMatchObject({pageCount:3,pagesFetched:3,isComplete:true,modules:{individual:'complete',corporate:'complete'},gaps:[]});
  });
  it.each([{duplicate:true},{wrongDate:true},{wrongZone:true}])('refuses an untrustworthy source result: %j', async fault => {
    await expect(collectSspWashes(sourcePage(fault),{rangeFrom:'2026-10-28',rangeTo:'2026-10-28'})).rejects.toThrow();
  });
});
