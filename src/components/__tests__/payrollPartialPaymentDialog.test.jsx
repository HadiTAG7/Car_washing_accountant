// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../DateField', () => ({ default: ({ ariaLabel, value, onChange }) => <input type="date" aria-label={ariaLabel} value={value} onChange={onChange} /> }));
import PayrollPartialPaymentDialog from '../PayrollPartialPaymentDialog';
afterEach(cleanup);
const items = [{ bikerId: 'a', name: 'Worker A', status: 'draft', netDue: 870 }, { bikerId: 'b', name: 'Worker B', status: 'draft', netDue: 870 }, { bikerId: 'paid', name: 'Paid worker', status: 'paid', netDue: 870 }];
const apiFor = (matches = true) => ({ previewPartialPayment: vi.fn(async () => ({ previewHash: 'synthetic-preview', selectedCount: 1, remainingCount: 1,
  gross: 870, lines: [{ bikerId: 'a', name: 'Worker A', gross: 870, deduction: 0, advanceDeduction: 0, netDue: 870 }], totals: { advances: 0, net: 870 }, matchesRecordedAmount: matches })), recordPartialPayment: vi.fn(async () => ({ status: 'partially_paid' })) });
function fill() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'تحديد Worker A' }));
  fireEvent.change(screen.getByLabelText('طريقة السداد الفعلية'), { target: { value: 'cash' } });
  fireEvent.change(screen.getByLabelText('تاريخ السداد الفعلي'), { target: { value: '2026-10-05' } });
  fireEvent.change(screen.getByLabelText('صافي المبلغ المدفوع فعلاً'), { target: { value: '870' } });
  fireEvent.change(screen.getByLabelText('بيان الدفعة'), { target: { value: 'Actual external payment' } });
}
it('has no default cash/bank/date, excludes paid workers and only records IDs after preview and explicit confirmation', async () => {
  const api = apiFor(); const recorded = vi.fn();
  render(<PayrollPartialPaymentDialog run={{ runId: 'run' }} items={items} api={api} onClose={vi.fn()} onRecorded={recorded} />);
  expect(screen.getByLabelText('طريقة السداد الفعلية').value).toBe(''); expect(screen.getByLabelText('تاريخ السداد الفعلي').value).toBe('');
  expect(screen.getByRole('checkbox', { name: 'تحديد Paid worker' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'تسجيل السداد الخارجي المحدد' }).disabled).toBe(true);
  fill(); fireEvent.click(screen.getByRole('button', { name: 'معاينة الدفعة المحددة' }));
  await screen.findByRole('table', { name: 'مكونات الدفعة المحددة' });
  expect(api.previewPartialPayment).toHaveBeenCalledWith({ runId: 'run', bikerIds: ['a'], paymentMethod: 'cash', payDate: '2026-10-05', recordedNetAmount: 870, reason: 'Actual external payment', paymentReference: '' });
  expect(api.recordPartialPayment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /أؤكد أن السداد/ }));
  fireEvent.click(screen.getByRole('button', { name: 'تسجيل السداد الخارجي المحدد' }));
  await waitFor(() => expect(recorded).toHaveBeenCalledWith({ status: 'partially_paid' }));
  expect(api.recordPartialPayment).toHaveBeenCalledWith(expect.objectContaining({ bikerIds: ['a'], previewHash: 'synthetic-preview', recordedExternally: true }));
});
it('mismatched actual net cannot be confirmed or saved; changing input invalidates preview', async () => {
  const api = apiFor(false);
  render(<PayrollPartialPaymentDialog run={{ runId: 'run' }} items={items} api={api} onClose={vi.fn()} onRecorded={vi.fn()} />);
  fill(); fireEvent.click(screen.getByRole('button', { name: 'معاينة الدفعة المحددة' }));
  expect((await screen.findByRole('alert')).textContent).toContain('لا يطابق');
  expect(screen.getByRole('checkbox', { name: /أؤكد أن السداد/ }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'تسجيل السداد الخارجي المحدد' }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('تاريخ السداد الفعلي'), { target: { value: '2026-10-04' } });
  expect(screen.queryByRole('table', { name: 'مكونات الدفعة المحددة' })).toBeNull(); expect(api.recordPartialPayment).not.toHaveBeenCalled();
});
it('shows a genuine backend refusal and closing the dialog never pays', async () => {
  const api = apiFor(); api.previewPartialPayment.mockRejectedValueOnce(new Error('Period closed')); const close = vi.fn();
  render(<PayrollPartialPaymentDialog run={{ runId: 'run' }} items={items} api={api} onClose={close} onRecorded={vi.fn()} />);
  fill(); fireEvent.click(screen.getByRole('button', { name: 'معاينة الدفعة المحددة' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Period closed');
  fireEvent.click(screen.getByRole('button', { name: 'إلغاء' })); expect(close).toHaveBeenCalled(); expect(api.recordPartialPayment).not.toHaveBeenCalled();
});
it('historical payment evidence disables recording even when the claimed amount matches', async () => {
  const api=apiFor();const original=api.previewPartialPayment;
  api.previewPartialPayment=vi.fn(async p=>({...await original(p),canRecord:false,historicalPayments:[{collection:'monthly_expenses',id:'legacy-5',description:'Previous salary group',amount:4350}]}));
  render(<PayrollPartialPaymentDialog run={{runId:'run'}} items={items} api={api} onClose={vi.fn()} onRecorded={vi.fn()}/>);
  fill();fireEvent.click(screen.getByRole('button',{name:'معاينة الدفعة المحددة'}));
  expect((await screen.findByRole('alert')).textContent).toContain('أدلة سداد سابقة');
  expect(screen.getByRole('button',{name:'تسجيل السداد الخارجي المحدد'}).disabled).toBe(true);
  expect(screen.getByRole('checkbox',{name:/أؤكد أن السداد/}).disabled).toBe(true);expect(api.recordPartialPayment).not.toHaveBeenCalled();
});
it('requires explicit recovered-advance ID, worker assignment and no-cash-refund attestation before re-preview and recording',async()=>{
 const api=apiFor(false);api.previewPartialPayment=vi.fn(async p=>{const adjusted=Boolean(p.reconciledAdvances?.length);return{previewHash:adjusted?'reviewed':'original',selectedCount:1,remainingCount:1,gross:870,lines:[{bikerId:'a',name:'Worker A',gross:870,deduction:0,advanceDeduction:adjusted?90:0,netDue:adjusted?780:870}],totals:{advances:adjusted?90:0,net:adjusted?780:870},matchesRecordedAmount:adjusted,canRecord:adjusted,recoveryCandidates:[{advanceId:'loan-a',title:'Synthetic recovered advance',amount:90,bikerId:null,recoveredDate:'2026-10-03',eligible:true}]};});
 render(<PayrollPartialPaymentDialog run={{runId:'run'}} items={items} api={api} onClose={vi.fn()} onRecorded={vi.fn()}/>);fill();
 fireEvent.change(screen.getByLabelText('صافي المبلغ المدفوع فعلاً'),{target:{value:'780'}});fireEvent.change(screen.getByLabelText('تاريخ السداد الفعلي'),{target:{value:'2026-10-04'}});
 fireEvent.click(screen.getByRole('button',{name:'معاينة الدفعة المحددة'}));await screen.findByRole('checkbox',{name:'مطابقة سلفة loan-a'});
 fireEvent.click(screen.getByRole('checkbox',{name:'مطابقة سلفة loan-a'}));expect(screen.getByRole('button',{name:'معاينة الدفعة المحددة'}).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('عامل السلفة loan-a'),{target:{value:'a'}});expect(screen.getByRole('button',{name:'معاينة الدفعة المحددة'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:/أقر أن السلف المحددة/}));fireEvent.click(screen.getByRole('button',{name:'معاينة الدفعة المحددة'}));
 await screen.findByRole('table',{name:'مكونات الدفعة المحددة'});expect(api.previewPartialPayment.mock.calls[1][0]).toMatchObject({reconciledAdvances:[{advanceId:'loan-a',bikerId:'a'}],payDate:'2026-10-04',recordedNetAmount:780});
 fireEvent.click(screen.getByRole('checkbox',{name:/أؤكد أن السداد/}));fireEvent.click(screen.getByRole('button',{name:'تسجيل السداد الخارجي المحدد'}));
 await waitFor(()=>expect(api.recordPartialPayment).toHaveBeenCalledWith(expect.objectContaining({previewHash:'reviewed',reconciledAdvances:[{advanceId:'loan-a',bikerId:'a'}],confirmAdvanceReconciliation:true,payDate:'2026-10-04'})));
});
