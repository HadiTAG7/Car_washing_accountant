// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { ExecutiveReportView,ExecutiveReportsAdmin } from '../ExecutiveReportsPage';
import { executiveFixture } from '../../../server/__tests__/executiveFixture';
import { LanguageContext } from '../../i18n/LanguageContext';
afterEach(cleanup);
it('preserves reviewed Arabic report wording even when the surrounding application is English',()=>{
  const report=executiveFixture({summary:'غير متاح'});
  render(<LanguageContext.Provider value={{language:'en'}}><ExecutiveReportView report={report}/></LanguageContext.Provider>);
  expect(screen.getByText('غير متاح')).toBeTruthy();expect(screen.getByRole('tab',{name:'ملخص اليوم'})).toBeTruthy();
});
it('keeps source limits and owner action visible across three tabs; no invented weekly or zeros',()=>{
  const report=executiveFixture();report.metrics[0].value=null;
  render(<ExecutiveReportView report={report}/>);
  expect(screen.getByText('تغطية وهمية غير إنتاجية')).toBeTruthy();expect(screen.getByText('غير متاح')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'المراجعة الأسبوعية'}));
  expect(screen.getByRole('tabpanel').textContent).toContain('غير مستحقة');expect(screen.getByText('تغطية وهمية غير إنتاجية')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'متابعة القرارات'}));
  expect(screen.getByText(/وصول التكليف لا يعني تنفيذه/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('الحالة'),{target:{value:'verified_closed'}});
  expect(screen.queryByText('CASE-TEST')).toBeNull();expect(screen.getByText('لا توجد حالات ضمن الفلاتر المختارة.')).toBeTruthy();
});
it('filters decisions by owner, opens evidence and navigates tabs by keyboard without losing filters',()=>{
  const report=executiveFixture();report.decisions.push({...report.decisions[0],caseId:'SECOND-TEST',ownerRole:1});
  render(<ExecutiveReportView report={report}/>);
  const daily=screen.getByRole('tab',{name:'ملخص اليوم'});daily.focus();fireEvent.keyDown(daily,{key:'ArrowLeft'});
  expect(document.activeElement).toBe(screen.getByRole('tab',{name:'متابعة القرارات'}));
  fireEvent.change(screen.getByLabelText('المدير'),{target:{value:'11'}});
  expect(screen.getByText('CASE-TEST')).toBeTruthy();expect(screen.queryByText('SECOND-TEST')).toBeNull();
  fireEvent.click(screen.getByText('الدليل وسجل التغير'));
  expect(screen.getByText(/لم يُرفق سجل تغير/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'ملخص اليوم'}));fireEvent.click(screen.getByRole('tab',{name:'متابعة القرارات'}));
  expect(screen.getByLabelText('المدير').value).toBe('11');
});
it('does not render report text as HTML and explicitly labels older revisions',()=>{
  const report=executiveFixture({summary:'<img src=x onerror=alert(1)>'});
  const {container}=render(<ExecutiveReportView report={report} currentRevision={2}/>);
  expect(container.querySelector('img')).toBeNull();expect(screen.getByText(/تعرض نسخة قديمة/)).toBeTruthy();
  expect(container.textContent).not.toMatch(/[٠-٩]/);
});
it('moves focus to the decisions tab when a disappearing summary counter opens the filtered view',()=>{
  render(<ExecutiveReportView report={executiveFixture()}/>);
  const counter=screen.getByRole('button',{name:'0 مغلق بدليل'});counter.focus();fireEvent.click(counter);
  const tab=screen.getByRole('tab',{name:'متابعة القرارات'});
  expect(document.activeElement).toBe(tab);expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('status').textContent).toContain('0 من 1');
  expect(screen.getByText('لا توجد حالات ضمن الفلاتر المختارة.')).toBeTruthy();
});
const emptyQuery=input=>({data:input?.action==='list'?{items:[],nextBefore:null}:null,loading:false,error:null});
it('keeps the chosen section when switching synthetic archived revisions and dates without writing',()=>{
  const first=executiveFixture(),second=executiveFixture({revision:2,correctionReason:'تصحيح اختباري'});
  const older=executiveFixture({reportId:'ceo-digest-2026-10-16',dateRiyadh:'2026-10-16',cutAtRiyadh:'2026-10-16T23:00:00+03:00'});
  const request=vi.fn(),query=input=>({loading:false,error:null,data:input?.action==='list'?{items:[first,older]}:input?{
    report:input.reportId===older.reportId?older:input.revision===2?second:first,currentRevision:2,
    history:[{revision:1,reason:'أولى اصطناعية'},{revision:2,reason:'ثانية اصطناعية'}]}:null});
  render(<ExecutiveReportsAdmin useQuery={query} request={request}/>);
  fireEvent.click(screen.getByRole('tab',{name:'المراجعة الأسبوعية'}));
  fireEvent.change(screen.getByLabelText('نسخة التقرير'),{target:{value:'2'}});
  expect(screen.getByRole('tab',{name:'المراجعة الأسبوعية'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('نسخة التقرير').value).toBe('2');
  fireEvent.change(screen.getByLabelText('أرشيف التقارير'),{target:{value:older.reportId}});
  expect(screen.getByRole('tab',{name:'المراجعة الأسبوعية'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('أرشيف التقارير').value).toBe(older.reportId);expect(request).not.toHaveBeenCalled();
});
it('previews an uploaded validated file without saving, then saves only on explicit action',async()=>{
  const request=vi.fn().mockResolvedValue({reportId:'ceo-digest-2026-10-18',revision:1,duplicate:false});
  render(<ExecutiveReportsAdmin useQuery={emptyQuery} request={request}/>);
  fireEvent.click(screen.getByText('إدخال تقرير إداري مراجع — للأدمن'));
  fireEvent.change(screen.getByLabelText('ملف التقرير'),{target:{files:[{size:3000,text:async()=>JSON.stringify(executiveFixture())}]}});
  await screen.findByText('معاينة غير محفوظة — راجع التاريخ والمحتوى قبل الحفظ.');expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'حفظ التقرير الإداري'}));
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0][0]).toMatchObject({action:'save',expectedRevision:0});
  expect((await screen.findByRole('status')).textContent).toContain('حُفظت النسخة.');
});
it('invalid or oversized file never writes or replaces the existing report',async()=>{
  const request=vi.fn(),report=executiveFixture();
  const query=input=>({data:input?.action==='list'?{items:[report]}:input?{report,currentRevision:1,history:[{revision:1,reason:'الأولى'}]}:null});
  render(<ExecutiveReportsAdmin useQuery={query} request={request}/>);
  fireEvent.change(screen.getByLabelText('ملف التقرير'),{target:{files:[{size:5,text:async()=>'{bad'}]}});
  expect((await screen.findByRole('alert')).textContent).toBe('ملف JSON غير صالح. اختر ملف تقرير صحيحًا.');expect(screen.getByText(report.title)).toBeTruthy();expect(request).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'حفظ التقرير الإداري'})).toBeNull();
  const text=vi.fn();fireEvent.change(screen.getByLabelText('ملف التقرير'),{target:{files:[{size:64001,text}]}});
  await screen.findByText('الملف يتجاوز 64KB.');expect(text).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});
it('does not retry an uncertain save until an explicit successful read and never resends automatically',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error('نتيجة غير مؤكدة')).mockResolvedValueOnce({report:null,history:[]});
  render(<ExecutiveReportsAdmin useQuery={emptyQuery} request={request}/>);
  fireEvent.change(screen.getByLabelText('ملف التقرير'),{target:{files:[{size:3000,text:async()=>JSON.stringify(executiveFixture())}]}});
  const save=await screen.findByRole('button',{name:'حفظ التقرير الإداري'});fireEvent.click(save);
  await screen.findByText('نتيجة غير مؤكدة');expect(save.disabled).toBe(true);expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'قراءة النسخة قبل إعادة الحفظ'}));
  await waitFor(()=>expect(save.disabled).toBe(false));expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toMatchObject({action:'read',reportId:'ceo-digest-2026-10-18'});
});
it('renders a supplied Saturday weekly review with its actual period and details',()=>{
  const report=executiveFixture({dateRiyadh:'2026-10-17',reportId:'ceo-digest-2026-10-17',cutAtRiyadh:'2026-10-17T23:00:00+03:00',
    weekly:{status:'included',text:'ملخص أسبوعي وهمي',from:'2026-10-11',to:'2026-10-17',details:[{title:'مقارنة أسبوعية وهمية',text:'دليل معزول'}]}});
  render(<ExecutiveReportView report={report}/>);fireEvent.click(screen.getByRole('tab',{name:'المراجعة الأسبوعية'}));
  expect(screen.getByText('ملخص أسبوعي وهمي')).toBeTruthy();expect(screen.getByText('مقارنة أسبوعية وهمية')).toBeTruthy();
});
it('blocks saving an otherwise valid draft while the archive read is unavailable',async()=>{
  const request=vi.fn(),query=()=>({data:null,error:'نفاد الحصة',loading:false});
  render(<ExecutiveReportsAdmin useQuery={query} request={request}/>);
  fireEvent.change(screen.getByLabelText('ملف التقرير'),{target:{files:[{size:3000,text:async()=>JSON.stringify(executiveFixture())}]}});
  const button=await screen.findByRole('button',{name:'حفظ التقرير الإداري'});expect(button.disabled).toBe(true);expect(request).not.toHaveBeenCalled();
});
