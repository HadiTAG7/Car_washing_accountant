import {describe,it,expect} from 'vitest';
import {financeFixture} from '../../../server/__tests__/financeFixtures';
import {financeReportNotes,financeReportHeading,financeReportSummary,financeSentence,financeSnapshotRows,readableFinanceText,financeOwnerDecisions} from '../financeReportPresentation';
const metric=(id,value,basis='ledger')=>({id,label:id,value,basis,unit:'ريال',coverage:'لقطة محفوظة',asOf:'2026-10-19T09:00:00+03:00'});
describe('read-only finance report presentation',()=>{
  it('shows a timed review with its date once and keeps the saved title',()=>{
    const report=financeFixture({dateRiyadh:'2026-10-26',title:'مراجعة 26 أكتوبر 09:00'}), before=JSON.stringify(report);
    expect(financeReportHeading(report)).toBe('26 أكتوبر: 09:00');
    expect(JSON.stringify(report)).toBe(before);
  });
  it('does not repeat the report date in nested heading prefixes or change the saved title',()=>{
    const report=financeFixture({dateRiyadh:'2026-10-27',title:'27 أكتوبر: مراجعة 27 أكتوبر: القيود مطابقة'});
    expect(financeReportHeading(report)).toBe('27 أكتوبر: القيود مطابقة');
    expect(report.title).toBe('27 أكتوبر: مراجعة 27 أكتوبر: القيود مطابقة');
  });
  it('never invents historical figures or converts tax input balance/text into tax due',()=>{
    const p=financeFixture({summary:'الإيراد 9999 والمصروف 1000',metrics:[metric('bank-ledger',500),metric('input-vat',53785)]}),copy=structuredClone(p);
    const rows=financeSnapshotRows(p);expect(rows).toHaveLength(6);expect(rows.find(r=>r.id==='revenue').value).toBeNull();expect(rows.find(r=>r.id==='vat-due').value).toBeNull();
    expect(rows.find(r=>r.id==='bank-ledger').value).toBe(500);expect(p).toEqual(copy);
  });
  it('compares saved like-for-like values only and keeps zero distinct from missing',()=>{
    const p=financeFixture({metrics:[metric('revenue',0,'operational'),metric('bank-ledger',500)]});
    const old={...p,cutAtRiyadh:'2026-10-18T09:00:00+03:00',metrics:[{...metric('revenue',100,'operational'),asOf:'2026-10-18T09:00:00+03:00'},metric('bank-ledger',400)]};
    expect(financeSnapshotRows(p,old).map(r=>r.delta)).toEqual([-100,null,null,100,null,null]);
    expect(financeSnapshotRows(p,{...old,sourceRole:3})[0].delta).toBeNull();
    old.metrics[0].asOf='2026-09-18T09:00:00+03:00';expect(financeSnapshotRows(p,old)[0].delta).toBeNull();
    old.metrics[0].asOf='2026-10-18T09:00:00+03:00';old.metrics[0].basis='ledger';expect(financeSnapshotRows(p,old)[0].delta).toBeNull();
  });
  it('orders cash/capital before large amounts, uses distinct severity, and keeps small invoices out of the summary',()=>{
    const p=financeFixture({metrics:[metric('cash-ledger',-422957.12)],visibleWarnings:[
      {id:'small',severity:'open',text:'المستند14 بمبلغ140 يحتاج فاتورة.'},
      {id:'coverage',severity:'limitation',text:'تغطية الجولة جزئية، والأدوات لم تعمل.'},
      {id:'big',severity:'open',text:'مصروف بمبلغ 2000 ريال يحتاج مراجعة.'},
      {id:'small-other',severity:'open',text:'مطابقة بمبلغ 600 ريال معلقة.'},
      {id:'capital',severity:'open',text:'رأس المال يحتاج مطابقة.'}]});
    const notes=financeReportNotes(p);expect(notes.map(n=>n.id)).toEqual(['cash-ledger','capital','big','small-other']);
    expect(notes.map(n=>n.severity)).toEqual(['critical','critical','critical','warning']);
    expect(financeReportHeading(p)).toContain('الصندوق ما زال سالبًا');expect(financeReportSummary(p).join(' ')).not.toContain('140');
  });
  it('fixes presentation spacing and links, bounds sentences, and does not alter the source',()=>{
    const source='المستند14،579غسلة؛راجع https://sweater-hadi-alghanim.vercel.app/?page=finance';
    expect(readableFinanceText(source)).toContain('المستند 14، 579 غسلة');expect(readableFinanceText(source)).toContain('app.hadialghanim.com');
    expect(source).toContain('المستند14');expect(financeSentence('CFO-HISTORY-123 '+Array(30).fill('كلمة').join(' ')).split(/\s+/)).toHaveLength(20);
  });
  it('does not infer an owner decision from internal blocked tasks',()=>{
    const p=financeFixture();expect(financeOwnerDecisions(p)).toEqual([]);
    p.cases[0].status='awaiting_owner';p.cases[0].next='هل توافق على المطابقة؟';expect(financeOwnerDecisions(p)[0].text).toBe('هل توافق على المطابقة');
  });
});
