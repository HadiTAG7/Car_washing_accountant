// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { ExecutiveReportView,ExecutiveReportsAdmin } from '../ExecutiveReportsPage';
import { executiveFixture } from '../../../server/__tests__/executiveFixture';
afterEach(cleanup);
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
const emptyQuery=input=>({data:input?.action==='list'?{items:[],nextBefore:null}:null,loading:false,error:null});
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
  await screen.findByRole('alert');expect(screen.getByText(report.title)).toBeTruthy();expect(request).not.toHaveBeenCalled();
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
