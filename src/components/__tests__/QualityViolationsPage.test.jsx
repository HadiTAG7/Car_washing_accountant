// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ view: { role: 'admin', isPartnerView: false }, read: vi.fn(), save: vi.fn() }));
vi.mock('../../contexts/PartnerViewContext', () => ({ usePartnerView: () => mocks.view }));
vi.mock('../../hooks/useQualityViolations', () => ({ useQualityViolations: (...args) => mocks.read(...args) }));
vi.mock('../../hooks/useOverviewBikerQuality', () => ({ useOverviewBikerQuality: () => ({ available: false }) }));
vi.mock('../../lib/bikerProfile', () => ({ riyadhToday: () => '2026-10-26' }));
vi.mock('../TopBar', () => ({ default: () => null }));
vi.mock('../SweaterFreshnessBar', () => ({ default: () => <p>Freshness fixture</p> }));
vi.mock('../../lib/firebaseClient', () => ({ auth: null, isFirebaseConfigured: false }));
vi.mock('../ChangePasswordModal', () => ({ default: () => null }));
vi.mock('../BikerProfileMonthPicker', () => ({ default: ({ value, onChange }) => <select aria-label="شهر الاختبار" value={value} onChange={e => onChange(e.target.value)}><option>2026-10</option><option>2026-09</option></select> }));
import QualityViolationsPage from '../QualityViolationsPage';
import Sidebar from '../Sidebar';
import { usePageNavigation } from '../../hooks/usePageNavigation';
import { visibleGroupsFor } from '../../lib/navGroups';
import { LanguageContext } from '../../i18n/LanguageContext';
import { loadEnglish } from '../../i18n/locale';
const row = { metricKey: 'cancelledByCustomer', sourceId: 'source-a', bookingId: '5572978', date: '2026-10-20', time: '19:10', driverExternalId: '2007', reason: 'إلغاء من العميل', quantity: 1, amount: null, sourceUrl: 'https://ssp-portal.sweater.sa/test' };
const state = () => ({ current: { snapshot: { metrics: { cancelledByCustomer: 1 }, metricSources: { cancelledByCustomer: { snapshotId: 'reading', extractedAtIso: '2026-10-26T19:00:00+03:00' } }, eventGroups: { cancelledByCustomer: { rows: [row], totalRows: 1, complete: true } } } },
  previous: {}, workers: { bikers: [{ id: 'worker', name: 'بايكر اختبار', driverExternalId: '2007' }] }, objections: { data: [] }, settings: { data: null },
  save: mocks.save, saveSettings: vi.fn(), previewDeduction: vi.fn(), saveDeduction: vi.fn(), refresh: vi.fn() });
const choose = name => fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));
const openRow = () => { choose('إلغاء العميل'); const trigger = screen.getByText('5572978').closest('summary'); fireEvent.click(trigger); return trigger.closest('details'); };
beforeEach(() => { window.history.replaceState(null, '', '/?page=quality_violations'); mocks.view = { role: 'admin', isPartnerView: false }; mocks.read.mockReturnValue(state()); mocks.save.mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('does not mount protected reads for other roles or a partner simulation', () => {
  for (const role of ['accountant', 'operator', 'partner', 'supervisor']) {
    mocks.view.role = role; const view = render(<QualityViolationsPage />); expect(mocks.read).not.toHaveBeenCalled(); view.unmount();
  }
  mocks.view = { role: 'admin', isPartnerView: true }; render(<QualityViolationsPage />); expect(mocks.read).not.toHaveBeenCalled();
});
it('offers seven named tabs and distinguishes unavailable details from zero', () => {
  render(<QualityViolationsPage />);
  expect(screen.getAllByRole('tab')).toHaveLength(7);
  for (const label of ['مخالفات', 'أضرار', 'تعويضات', 'غسلات مجانية', 'إلغاء البايكر', 'إلغاء الصيانة', 'إلغاء العميل']) expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy();
  expect(screen.getByRole('tab', { name: /مخالفات/ }).textContent).toContain('غير متاح');
  expect(within(screen.getByRole('tabpanel')).getByText('ما وصلت تفاصيل سويتر')).toBeTruthy();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(document.querySelectorAll('.qv-secondary')).toHaveLength(3);
  expect([...document.querySelectorAll('.qv-secondary')].every(d => !d.open)).toBe(true);
});
it('keeps the same summary and case-list shell for every tab, including empty damages and ticket details', () => {
  render(<QualityViolationsPage />);
  for (const tab of screen.getAllByRole('tab')) {
    fireEvent.click(tab);
    const panel = screen.getByRole('tabpanel');
    expect(panel.querySelectorAll('.qv-type-summary')).toHaveLength(1);
    expect(panel.querySelectorAll('.qv-type-totals > div')).toHaveLength(3);
    expect(panel.querySelectorAll('.qv-cases')).toHaveLength(1);
    expect(within(panel).getByRole('heading', { name: 'تفاصيل الحالات' })).toBeTruthy();
  }
  expect(mocks.save).not.toHaveBeenCalled();
});
it('shows saved ticket count and individual documented amounts independently from an old zero dashboard value', () => {
  const data = state(); data.current.snapshot.metrics.compensations = 0;
  data.current.snapshot.metricSources.compensations = { snapshotId: 'old-dashboard', extractedAtIso: '2026-10-20T12:00:00Z' };
  data.sourceDetails = { reviews: { data: { cases: Array.from({ length: 17 }, (_, i) => ({
    recordType: 'ssp_ticket_review_v1', ticketId: `SYNTHETIC-${i}`, reviewStatus: 'historical_excluded',
    source: { facts: { ticketDate: '2026-10-20', biker: { externalId: '2007', name: 'Source worker' }, complaint: 'Synthetic source text', washIds: [], comments: [] },
      source: { readAt: '2026-10-27T12:00:00Z', coverage: { limitations: [], filters: 'Synthetic only' } },
      amounts: [{ kind: 'compensation', value: 20, unit: 'SAR', sourceRef: 'One compensation section' }, { kind: 'customer_code', value: 60, unit: 'SAR', sourceRef: 'Separate promo' }] }
  })) } }, bookings: { data: [] }, observations: { data: [] } };
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage />); choose('تعويضات');
  expect(document.querySelector('#qv-tab-compensations strong').textContent).toBe('17 تكت');
  const panel = screen.getByRole('tabpanel');
  expect(panel.querySelector('.qv-context-note').textContent).toContain('0 ر.س. ليست إجمالي قيم التكتات');
  expect(panel.querySelector('.qv-type-summary').textContent).toContain('تكتات بمبلغ موثق: 17');
  const summary = panel.querySelector('.qv-source-event > summary');
  expect(summary.textContent).toContain('تعويض موثق: 20 ر.س');
  expect(summary.textContent).toContain('كود أو محفظة العميل: 60 ر.س');
  expect(panel.querySelectorAll('.qv-source-event')).toHaveLength(17);
  expect(panel.textContent).not.toContain('340'); expect(panel.textContent).not.toContain('1360');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('uses actual source money including zero, and separately labels a twenty-riyal fallback for only missing values', () => {
  const data = state(), key = 'cancelledByBiker';
  data.current.snapshot.metrics[key] = 3;
  data.current.snapshot.metricSources[key] = { snapshotId: 'synthetic', extractedAtIso: '2026-10-26T12:00:00Z' };
  data.current.snapshot.eventGroups[key] = { complete: true, totalRows: 3, rows: [129.95, 0, null].map((amount, i) => ({ ...row, metricKey: key, sourceId: `VALUE-${i}`, bookingId: `VALUE-${i}`, amount })) };
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage />); choose('إلغاء البايكر');
  const summaries = [...screen.getByRole('tabpanel').querySelectorAll('.qv-event > summary')];
  expect(summaries[0].textContent).toContain('مبلغ سويتر المحفوظ: 129.95');
  expect(summaries[1].textContent).toContain('مبلغ سويتر المحفوظ: 0');
  expect(summaries[1].textContent).not.toContain('تقدير داخلي');
  expect(summaries[2].textContent).toContain('تقدير داخلي بقرار هادي: 20');
  const overview = screen.getByRole('tabpanel').querySelector('.qv-type-summary').textContent;
  expect(overview).toContain('129.95'); expect(overview).toContain('تقدير داخلي بقرار هادي: 20');
  expect(overview).not.toContain('149.95'); expect(mocks.save).not.toHaveBeenCalled();
});
it('does not replace an unread source with a monetary fallback', () => {
  const data = state(); data.current.snapshot.metrics.freeWashCompensation = 12;
  data.sourceDetails = { reviews: { error: Error('unread') }, bookings: { data: [] }, observations: { data: [] } };
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage />); choose('غسلات مجانية');
  const summary = screen.getByRole('tabpanel').querySelector('.qv-type-summary');
  expect(summary.textContent).not.toContain('240');
  expect(summary.textContent).toContain('تعذّرت قراءة المصدر؛ لم نفترض قيمة بديلة.');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('uses English for composed coverage and partial labels, preserving source reason text',async()=>{
  await loadEnglish();
  const data=state(); data.current.snapshot.eventGroups.cancelledByCustomer.complete=false; mocks.read.mockReturnValue(data);
  data.current.snapshot.eventGroups.cancelledByCustomer.rows=[{...row,reason:'غير متاح'}];
  render(<LanguageContext.Provider value={{language:'en'}}><QualityViolationsPage/></LanguageContext.Provider>);
  const tab=document.querySelector('#qv-tab-cancelledByCustomer');expect(tab.textContent).toContain('partial'); fireEvent.click(tab);
  expect(screen.getByRole('tabpanel').textContent).toContain('1 row received of 1 · Partial details');
  expect(screen.getByRole('tabpanel').textContent).toContain('غير متاح');
});
it('supports RTL arrows, Home and End without saving or requiring a biker-table selection', () => {
  render(<QualityViolationsPage />);
  fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: /أضرار/ }));
  fireEvent.keyDown(document.activeElement, { key: 'End' });
  expect(screen.getByRole('tabpanel').id).toBe('qv-panel-cancelledByCustomer');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: /إلغاء العميل/ }));
  fireEvent.keyDown(document.activeElement, { key: 'Home' });
  expect(screen.getByRole('tab', { name: /مخالفات/ }).getAttribute('aria-selected')).toBe('true');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('opens source details directly and saves only an explicit metadata submission', async () => {
  render(<QualityViolationsPage />); const details = openRow();
  expect(details.textContent).toContain('19:10'); expect(details.textContent).toContain('بايكر اختبار');
  expect(within(details).getByRole('link', { name: 'عرض المصدر' }).getAttribute('href')).toBe(row.sourceUrl);
  fireEvent.change(within(details).getByLabelText('حالة المتابعة الداخلية'), { target: { value: 'submitted' } });
  fireEvent.change(within(details).getByLabelText('ملاحظة'), { target: { value: 'أرسلنا الدليل' } });
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(within(details).getByRole('button', { name: 'حفظ المتابعة' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ periodKey: '2026-10', metricKey: row.metricKey, sourceId: row.sourceId, snapshotId: 'reading', expectedRevision: 0, status: 'submitted', note: 'أرسلنا الدليل' }));
});
it('preserves drafts across tabs, search, month, loading and updated revisions without adopting a newer write revision', () => {
  const data = state(); mocks.read.mockReturnValue(data); const view = render(<QualityViolationsPage />);
  let details = openRow(); fireEvent.change(within(details).getByLabelText('ملاحظة'), { target: { value: 'مسودة محلية' } });
  choose('مخالفات'); choose('إلغاء العميل');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'لا يوجد' } });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('شهر الاختبار'), { target: { value: '2026-09' } });
  fireEvent.change(screen.getByLabelText('شهر الاختبار'), { target: { value: '2026-10' } });
  data.current.loading = true; view.rerender(<QualityViolationsPage />); data.current.loading = false;
  data.objections.data = [{ metricKey: row.metricKey, sourceId: row.sourceId, revision: 5, note: 'تعديل آخر', status: 'accepted' }];
  view.rerender(<QualityViolationsPage />); details = openRow();
  expect(within(details).getByLabelText('ملاحظة').value).toBe('مسودة محلية');
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(within(details).getByRole('button', { name: 'حفظ المتابعة' }));
  expect(mocks.save.mock.calls[0][0].expectedRevision).toBe(0);
});
it('keeps a failed save draft and warns before following the existing ticket-review route', async () => {
  mocks.save.mockRejectedValue(Error('conflict')); render(<QualityViolationsPage />); const details = openRow();
  fireEvent.change(within(details).getByLabelText('ملاحظة'), { target: { value: 'لا تضيع' } });
  fireEvent.click(within(details).getByRole('button', { name: 'حفظ المتابعة' }));
  await waitFor(() => expect(within(details).getByRole('status').textContent).toBe('conflict'));
  expect(within(details).getByLabelText('ملاحظة').value).toBe('لا تضيع');
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const link = screen.getByRole('link', { name: 'مراجعة التكتات والاعتراضات' });
  expect(link.getAttribute('href')).toBe('?page=compensation_review');
  expect(fireEvent.click(link)).toBe(false); expect(window.confirm).toHaveBeenCalledOnce();
});
it('shows partial details, keeps money and quantity distinct, and retains unknown and duplicate links', () => {
  const data = state(), snapshot = data.current.snapshot;
  snapshot.metrics.violations = 50;
  snapshot.metricSources.violations = { snapshotId: 'v-reading', extractedAtIso: '2026-10-25T12:00:00+03:00' };
  snapshot.eventGroups.violations = { complete: false, totalRows: 8, rows: [
    { ...row, metricKey: 'violations', sourceId: 'unknown', bookingId: 'UNKNOWN-BOOK', driverExternalId: null, amount: 15 },
    { ...row, metricKey: 'violations', sourceId: 'duplicate', bookingId: 'DUP-BOOK', driverExternalId: '3000', amount: 35 },
  ] };
  data.workers.bikers.push({ id: 'dup-a', driverExternalId: '3000' }, { id: 'dup-b', driverExternalId: '3000' });
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage />);
  const panel = screen.getByRole('tabpanel');
  expect(panel.textContent).toContain('2 صف مستلم من 8 · تفاصيل جزئية');
  expect(panel.textContent).toContain('50');
  expect(panel.textContent).toContain('بدون بايكر في المصدر'); expect(panel.textContent).toContain('ربط سويتر مكرر؛ يحتاج مراجعة');
  expect(within(panel).getByText('UNKNOWN-BOOK')).toBeTruthy(); expect(within(panel).getByText('DUP-BOOK')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'DUP-BOOK' } });
  expect(panel.textContent).toContain('نتائج البحث: 1 من 2');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('distinguishes complete empty, partial empty and read failure', () => {
  const data = state(); data.current.snapshot.eventGroups.violations = { rows: [], totalRows: 0, complete: true };
  data.current.snapshot.metrics.violations = 0; mocks.read.mockReturnValue(data);
  const view = render(<QualityViolationsPage />); expect(screen.getByText('لا حالات في التفاصيل المكتملة لهذا النوع.')).toBeTruthy();
  data.current.snapshot.eventGroups.violations.complete = false; view.rerender(<QualityViolationsPage />);
  expect(screen.getByText('لا صفوف مستلمة بعد؛ التفاصيل جزئية وليست صفر حالات.')).toBeTruthy();
  data.current.error = Error('offline'); view.rerender(<QualityViolationsPage />);
  expect(screen.getByRole('alert').textContent).toContain('تعذّرت قراءة لقطة المجاميع'); expect(screen.getByRole('tabpanel').textContent).toContain('غير متاح');
});
it('disables saving when current follow-up cannot be read and returns focus when details close', () => {
  const data = state(); data.objections.error = Error('unavailable'); mocks.read.mockReturnValue(data);
  render(<QualityViolationsPage />); const details = openRow();
  expect(within(details).getByRole('button', { name: 'حفظ المتابعة' }).disabled).toBe(true);
  const trigger = details.querySelector('summary');
  fireEvent.click(within(details).getByRole('button', { name: 'إغلاق التفاصيل' }));
  expect(details.open).toBe(false); expect(document.activeElement).toBe(trigger);
});
it('retains deadline and internal-tool drafts across filters, without invoking their write paths', () => {
  const data = state(); data.settings.data = { revision: 1, deadlineDays: 7 }; mocks.read.mockReturnValue(data);
  const view = render(<QualityViolationsPage />);
  fireEvent.click(screen.getByText('مهلة الاعتراض').closest('summary'));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '14' } });
  fireEvent.click(screen.getByText('إسناد خصومات البايكر — أدوات المتابعة الداخلية').closest('summary'));
  fireEvent.click(screen.getByText('معاينة واقعة موثقة أو تصحيحها').closest('summary'));
  fireEvent.change(screen.getByLabelText('ملف واقعة الخصم'), { target: { value: '{"periodKey":"2026-10"}' } });
  fireEvent.change(screen.getByLabelText('شهر الاختبار'), { target: { value: '2026-09' } }); choose('إلغاء العميل');
  data.settings.data = { revision: 5, deadlineDays: 10 }; view.rerender(<QualityViolationsPage />);
  expect(screen.getByRole('spinbutton').value).toBe('14');
  expect(screen.getByLabelText('ملف واقعة الخصم').value).toBe('{"periodKey":"2026-10"}');
  expect(data.saveSettings).not.toHaveBeenCalled(); expect(data.previewDeduction).not.toHaveBeenCalled(); expect(data.saveDeduction).not.toHaveBeenCalled();
  const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ المهلة' }));
  expect(data.saveSettings).toHaveBeenCalledWith({ deadlineDays: 14, expectedRevision: 1 });
});
it('warns on the real Sidebar navigation path and lets cancellation retain the page and draft', () => {
  function Harness() {
    const [page, select] = usePageNavigation('quality_violations');
    return <><Sidebar groups={visibleGroupsFor({ role: 'admin' })} activeTab={page} onSelectTab={select} />
      {page === 'quality_violations' ? <QualityViolationsPage /> : <h1>Finance destination</h1>}</>;
  }
  render(<Harness />); const details = openRow();
  fireEvent.change(within(details).getByLabelText('ملاحظة'), { target: { value: 'مسودة قبل مغادرة القائمة' } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'ملخص المالية' }));
  expect(confirm).toHaveBeenCalledOnce(); expect(window.location.search).toBe('?page=quality_violations');
  expect(within(details).getByLabelText('ملاحظة').value).toBe('مسودة قبل مغادرة القائمة');
  expect(screen.queryByText('Finance destination')).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
  window.history.pushState(null, '', '/?page=finance'); fireEvent.popState(window);
  expect(window.location.search).toBe('?page=quality_violations');
  expect(within(details).getByLabelText('ملاحظة').value).toBe('مسودة قبل مغادرة القائمة');
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'ملخص المالية' }));
  expect(screen.getByText('Finance destination')).toBeTruthy(); expect(mocks.save).not.toHaveBeenCalled();
});
it('links stored ticket facts independently of a missing aggregate, preserving wallet amounts and the archived review', () => {
  const data = state(); data.current.error = Error('aggregate unavailable');
  data.sourceDetails = { reviews: { data: { cases: [{ recordType:'ssp_ticket_review_v1', ticketId:'TEST-TICKET', reviewStatus:'historical_excluded',
    objectionHistory:[{id:'OBJ-TEST-A',status:'Accepted'},{id:'OBJ-TEST-B',status:'Rejected'}], source:{
      facts:{ ticketDate:'2026-10-20', biker:{name:'Source name',externalId:'2007'}, complaint:'Synthetic wallet compensation', washIds:['TEST-WASH'], comments:[], supportResponse:'Recorded support response' },
      source:{url:'https://ssp-portal.sweater.sa/tickets/TEST-TICKET',readAt:'2026-10-27T12:00:00Z',coverage:{complete:false,limitations:['Synthetic partial coverage'],filters:'October tickets'}},
      amounts:[{kind:'compensation',value:20,unit:'SAR',sourceRef:'Compensation section'},{kind:'customer_code',value:60,unit:'SAR',sourceRef:'Customer promo code'},
        {kind:'compensation',value:1,unit:'count',sourceRef:'Wash in Wallet'}] } }] } }, bookings:{data:[]},observations:{data:[]} };
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage />); choose('تعويضات');
  let panel=screen.getByRole('tabpanel'); expect(panel.textContent).toContain('صفوف مرتبطة: 1');
  const detail=within(panel).getByText('TEST-TICKET').closest('details'); fireEvent.click(detail.querySelector('summary'));
  expect(detail.textContent).toContain('بايكر اختبار'); expect(detail.textContent).toContain('OBJ-TEST-A'); expect(detail.textContent).toContain('OBJ-TEST-B');
  expect(within(detail).getByRole('cell',{name:'20'})).toBeTruthy(); expect(within(detail).getByRole('cell',{name:'60'})).toBeTruthy();
  expect(within(detail).getByRole('link',{name:'فتح سجل التكت القائم'}).getAttribute('href')).toBe('?page=compensation_review&ticket=TEST-TICKET');
  choose('غسلات مجانية'); panel=screen.getByRole('tabpanel'); expect(panel.textContent).not.toContain('TEST-TICKET');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps cancellation classifications separate from an admin status and displays unknown rows for review', () => {
  const data=state(); const booking=(id,reason)=>({updatedAtIso:'2026-10-27T12:00:00Z',observedAtIso:'2026-10-27T12:00:00Z',record:{sspBookingId:id,serviceDate:'2026-10-20',driverExternalId:'2007',rawStatus:'Cancelled by Admin',
    notes:reason?'Cancellation Reason\nReason\n'+reason:'',sourceUrl:'https://ssp-portal.sweater.sa/bookings/TEST'}});
  data.sourceDetails={reviews:{data:{cases:[]}},bookings:{data:[booking('TEST-BIKER','Biker illness'),booking('TEST-UNKNOWN',null)]},observations:{data:[]}};
  mocks.read.mockReturnValue(data);render(<QualityViolationsPage/>);choose('إلغاء البايكر');
  expect(screen.getByRole('tabpanel').textContent).toContain('TEST-BIKER');expect(screen.getByRole('tabpanel').textContent).not.toContain('TEST-UNKNOWN');
  expect(screen.getByText('حجوزات إلغاء غير مصنفة (1)')).toBeTruthy();expect(mocks.save).not.toHaveBeenCalled();
});
it('does not display one resolved invoice deduction for conflicting same-time invoice notes',()=>{
  const data=state(), at='2026-10-27T12:00:00Z';
  const record={sspBookingId:'C-123',serviceDate:'2026-10-20',rawStatus:'Cancelled by Admin',driverExternalId:'2007',
    sourceUrl:'https://ssp-portal.sweater.sa/bookings/TEST',notes:'Cancellation Reason\nReason\nBiker illness'};
  data.sourceDetails={reviews:{data:{cases:[]}},bookings:{data:[{record,observedAtIso:'2026-10-26T12:00:00Z'}]},observations:{data:[10,20].map((amount,i)=>({
    id:String(i),sspBookingId:'C-123',sourceReadAtIso:at,fetchedAtIso:at,rawPayload:{...record,notes:record.notes+'\nSSP_INVOICE_DEDUCTION_V1='+JSON.stringify({signedDeductionSAR:-amount})}}))}};
  mocks.read.mockReturnValue(data); render(<QualityViolationsPage/>);
  const section=screen.getByText('حجوزات إلغاء غير مصنفة (1)').closest('details');fireEvent.click(section.querySelector('summary'));
  const row=within(section).getByText('C-123').closest('details');fireEvent.click(row.querySelector('summary'));
  expect(row.textContent).toContain('قراءات متعارضة');expect(row.textContent).not.toContain('خصم فاتورة الحجز كما ورد:');
  expect(row.textContent).toContain('"signedDeductionSAR":-10'); expect(row.textContent).toContain('"signedDeductionSAR":-20');
  expect(mocks.save).not.toHaveBeenCalled();
});
