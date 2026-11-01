// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompensationReviewWorkspace } from '../CompensationReviewWorkspace';
import { reviewSource } from '../../../functions/test/compensationReviewFixture.js';
afterEach(cleanup);
const record = () => ({ ticketId:'TEST-900001',revision:1,source:reviewSource(),sourceHash:'hash',reviewStatus:'pending',
  updatedAtIso:'2026-11-01T12:00:00Z',draft:{text:'مسودة غير مرسلة',revision:1},submission:{status:'draft'},
  decisions:[],sourceHistory:[],objectionHistory:[] });
const read = (patch={}) => ({allowed:true,data:{cases:[record()],queue:{activeTicketId:'TEST-900001',revision:1},canDecide:true},refresh:vi.fn(),...patch});
it('renders a private source and separate missing amount without any write on mount',()=>{
  const call=vi.fn();render(<CompensationReviewWorkspace read={read()} call={call}/>);
  expect(call).not.toHaveBeenCalled();expect(screen.getAllByText('مسودة غير مرسلة')).toHaveLength(2);
  expect(screen.getAllByText(/غير متاح/).length).toBeGreaterThan(0);
  expect(screen.getByRole('link',{name:'فتح المرفق في مصدره الخاص'}).getAttribute('rel')).toContain('noreferrer');
  expect(screen.getByText(/لا يرسل الموقع اعتراضًا/)).toBeTruthy();
});
it('requires a separate explicit confirmation with exact read-only submission text',async()=>{
  const row=record(),r=read(),call=vi.fn(async input=>input.op==='read'
    ? {cases:[row],queue:r.data.queue} : {record:row});
  render(<CompensationReviewWorkspace read={r} call={call}/>);
  fireEvent.click(screen.getByRole('button',{name:'طلب رفع هذا التكت بالنص المحدد'}));
  expect(call).not.toHaveBeenCalled();
  const text=screen.getByLabelText('نص القرار أو المسودة');expect(text.readOnly).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button',{name:'تأكيد وحفظ'}).closest('form'));
  await waitFor(()=>expect(call).toHaveBeenCalledTimes(2));
  expect(call.mock.calls[0][0]).toMatchObject({op:'owner',data:{action:'request_submission',text:row.draft.text,ticketId:row.ticketId,expectedRevision:1,expectedQueueRevision:1,confirmed:true}});
});
it('blocks further mutation after an ambiguous save until the record is re-read',async()=>{
  const r=read(),call=vi.fn().mockRejectedValue(Error('unknown save result'));
  render(<CompensationReviewWorkspace read={r} call={call}/>);
  fireEvent.click(screen.getByRole('button',{name:'تركها دون اعتراض'}));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button',{name:'تأكيد وحفظ'}).closest('form'));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('unknown save result'));
  expect(screen.getByRole('button',{name:'طلب رفع هذا التكت بالنص المحدد'}).disabled).toBe(true);
});
it('accepts a complete identical readback whose object keys were reordered by JSONB',async()=>{
  const row=record();row.submission={status:'queued',text:row.draft.text,requestId:'synthetic-request',draftRevision:1};
  const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])])):value;
  const r=read(),call=vi.fn(async input=>input.op==='read'?{cases:[reorder(row)]}:{record:row});
  render(<CompensationReviewWorkspace read={r} call={call}/>);
  fireEvent.click(screen.getByRole('button',{name:'طلب رفع هذا التكت بالنص المحدد'}));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button',{name:'تأكيد وحفظ'}).closest('form'));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('حُفظ السجل وطابقته إعادة القراءة'));
  expect(r.refresh).toHaveBeenCalledTimes(1);
});
it('keeps the ambiguous-write gate when the returned decision text really differs',async()=>{
  const row=record();row.submission={status:'queued',text:row.draft.text,requestId:'synthetic-request'};
  const changed={...row,submission:{...row.submission,text:'Different actual text'}};
  const r=read(),call=vi.fn(async input=>input.op==='read'?{cases:[changed]}:{record:row});
  render(<CompensationReviewWorkspace read={r} call={call}/>);
  fireEvent.click(screen.getByRole('button',{name:'طلب رفع هذا التكت بالنص المحدد'}));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('button',{name:'تأكيد وحفظ'}).closest('form'));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('الحفظ غير محسوم'));
  expect(r.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'حفظ مسودة'}).disabled).toBe(true);
});
it('denies partner preview, without exposing the import form or an owner action',()=>{
  const call=vi.fn();render(<CompensationReviewWorkspace read={read({allowed:false,data:null})} call={call}/>);
  expect(screen.queryByRole('button')).toBeNull();expect(call).not.toHaveBeenCalled();
});
it('can display an excluded archive record without changing the queue or making it active',()=>{
  const row=record();row.reviewStatus='historical_excluded';row.source.queueDisposition='historical_excluded';row.source.historicalReference='Synthetic leave decision';
  const r=read({data:{cases:[row],queue:{activeTicketId:null,revision:1},canDecide:false}}),call=vi.fn();
  render(<CompensationReviewWorkspace read={r} call={call}/>);
  fireEvent.change(screen.getByLabelText('العرض'),{target:{value:'archive'}});
  fireEvent.click(screen.getByRole('button',{name:'عرض التفاصيل'}));
  expect(screen.getByRole('heading',{name:'عرض السجل · تكت TEST-900001'})).toBeTruthy();
  expect(call).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'طلب رفع هذا التكت بالنص المحدد'})).toBeNull();
});

