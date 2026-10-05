// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
const saveCall = vi.hoisted(() => vi.fn());
vi.mock('../../lib/firebaseClient', () => ({ callSweaterImportPreview: call, callSweaterOwnerHandoffSave: saveCall, describeBackendError: e => e.message }));
import SweaterHandoffPreview from '../SweaterHandoffPreview';
import { formatCurrency } from '../../data/initialData';
import { ACCOUNT_BOOKINGS_SCOPE_WARNING } from '../../lib/sweater/handoff';
const body = () => ({ importRunId: 'ui-review', records: [{ sspBookingId: 'S-1', serviceType: 'verified-service', serviceDate: '2026-10-04', rawStatus: 'Collecting Payment' }],
  coverage: { rangeFrom: '2026-10-04', rangeTo: '2026-10-04', extractedAt: '2026-10-04T10:00:00Z', pageCount: 1, pagesFetched: 1, recordCount: 1, isComplete: true } });
afterEach(() => { cleanup(); call.mockReset(); saveCall.mockReset(); });
const fill = value => { fireEvent.change(screen.getByLabelText('بيانات التسليم'), { target: { value: JSON.stringify(value) } }); fireEvent.click(screen.getByRole('button', { name: 'راجع الملف محليًا' })); };
describe('مراجعة SSP في الواجهة', () => {
  it('يبقي تحذير نطاق الشركة ظاهراً في المراجعة والمعاينة ونتيجة الحفظ', async () => {
    const value = body(); value.records[0].driverExternalId = 'worker-1'; value.workerLinks = { 'worker-1': 'biker-1' };
    value.ownerConfirmation = { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Synthetic confirmation', unitAmount: 20, totalAmount: 20, vatAmount: null };
    value.coverage = { ...value.coverage, scope: 'accountBookings', scopeComplete: true, isComplete: false, sourceRecordCount: 4, excludedCancelled: 3, imported: 1 };
    const result = { canSave: true, counts: { new: 1, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 }, rows: [],
      reviewWarnings: [ACCOUNT_BOOKINGS_SCOPE_WARNING], coverage: value.coverage, ownerConfirmation: value.ownerConfirmation,
      reviewedPayloadHash: 'hash', previewStateHash: 'hash' };
    call.mockResolvedValue(result); saveCall.mockResolvedValue({ ...result, saved: true });
    render(<SweaterHandoffPreview />); fill(value);
    expect(screen.getAllByText(ACCOUNT_BOOKINGS_SCOPE_WARNING)).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }));
    await screen.findByRole('button', { name: 'حفظ الغسلات بإقرار المالك' });
    expect(screen.getAllByText(ACCOUNT_BOOKINGS_SCOPE_WARNING)).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي'));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الغسلات بإقرار المالك' }));
    await screen.findByText('تم حفظ الغسلات وإقرار المالك دون ترحيل أو صرف عمولة');
    expect(screen.getAllByText(ACCOUNT_BOOKINGS_SCOPE_WARNING)).toHaveLength(2);
    expect(saveCall.mock.calls[0][0].payload.coverage.isComplete).toBe(false);
  });
  it('لا يرسل عينة بلا نوع خدمة أو ملف يحمل أسراراً', () => {
    render(<SweaterHandoffPreview />); const value = body(); delete value.records[0].serviceType;
    fill(value); expect(screen.getByText('الملف غير جاهز؛ ما راح ينرسل')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }).disabled).toBe(true);
    expect(call).not.toHaveBeenCalled();
    fill({ ...body(), token: 'forbidden' }); expect(call).not.toHaveBeenCalled();
  });
  it('يطلب مراجعة المصدر ويجبر dryRun ثم يبطل المعاينة عند تغيير الملف', async () => {
    call.mockResolvedValue({ counts: { new: 1, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 }, rows: [{ sspBookingId: 'S-1', outcome: 'new' }], reviewedPayloadHash: 'hash' });
    render(<SweaterHandoffPreview />); fill(body());
    const button = screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }); expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][0]).toMatchObject({ dryRun: true, mode: 'import' });
    expect(await screen.findByText('معاينة فقط — ما تم استيراد أو ترحيل')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('بيانات التسليم'), { target: { value: '{}' } });
    expect(screen.queryByLabelText('نتيجة dryRun')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('الفشل لا يعيد الإرسال تلقائياً ولا يخفي الملف للمراجع', async () => {
    call.mockRejectedValue(new Error('تسجيل الدخول مطلوب.'));
    render(<SweaterHandoffPreview />); fill(body()); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'تسجيل الدخول مطلوب.');
    expect(call).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('بيانات التسليم').value).toContain('S-1');
  });
  it('يحفظ بعد المعاينة والتأكيد مرة واحدة ثم يعطل الزر؛ تعديل الملف يبطل التأكيد', async () => {
    const value = body(); value.records[0].driverExternalId = 'worker-1'; value.workerLinks = { 'worker-1': 'biker-1' };
    value.ownerConfirmation = { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Synthetic confirmation', unitAmount: 20, totalAmount: 20, vatAmount: null };
    const result = { canSave: true, counts: { new: 1, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 },
      rows: [{ sspBookingId: 'S-1', outcome: 'new', washId: 'ssp__S-1', bikerId: 'biker-1', bikerName: 'Worker',
        serviceDate: '2026-10-04', assertedAmount: 20, collectionStatus: 'confirmed_by_owner', workerCommission: 4.5 }],
      ownerConfirmation: value.ownerConfirmation, reviewedPayloadHash: 'file-hash', previewStateHash: 'state-hash' };
    call.mockResolvedValue(result); saveCall.mockResolvedValue({ ...result, saved: true });
    render(<SweaterHandoffPreview />); fill(value); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }));
    const button = await screen.findByRole('button', { name: 'حفظ الغسلات بإقرار المالك' });
    expect(button.disabled).toBe(true); expect(saveCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي'));
    fireEvent.click(button);
    expect(await screen.findByText('تم حفظ الغسلات وإقرار المالك دون ترحيل أو صرف عمولة')).toBeTruthy();
    expect(saveCall).toHaveBeenCalledTimes(1);
    expect(saveCall.mock.calls[0][0]).toMatchObject({ payload: { dryRun: true, ownerConfirmation: value.ownerConfirmation }, reviewedPayloadHash: 'file-hash', previewStateHash: 'state-hash' });
    expect(screen.queryByRole('button', { name: 'حفظ الغسلات بإقرار المالك' })).toBeNull();
    fill(value); expect(screen.queryByRole('button', { name: 'حفظ الغسلات بإقرار المالك' })).toBeNull();
  });
  it('فشل الحفظ يبطل المعاينة ولا يعيد الحفظ تلقائياً', async () => {
    const value = body(); value.records[0].driverExternalId = 'worker-1'; value.workerLinks = { 'worker-1': 'biker-1' };
    value.ownerConfirmation = { source: 'owner_statement', ownerName: 'Synthetic owner', statement: 'Synthetic confirmation', unitAmount: 20, totalAmount: 20, vatAmount: null };
    call.mockResolvedValue({ canSave: true, counts: { new: 1 }, rows: [], ownerConfirmation: value.ownerConfirmation, reviewedPayloadHash: 'hash', previewStateHash: 'hash' });
    saveCall.mockRejectedValue(new Error('Data changed; preview again.'));
    render(<SweaterHandoffPreview />); fill(value); fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }));
    fireEvent.click(await screen.findByLabelText('راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي'));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الغسلات بإقرار المالك' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Data changed; preview again.');
    expect(saveCall).toHaveBeenCalledTimes(1); expect(screen.queryByLabelText('نتيجة dryRun')).toBeNull();
  });
});

it('يعرض80/12/92 بإقرار المالك ويعيد المعاينة بنفس الدفعة بعد استجابة حفظ مفقودة دون إعادة تلقائية',async()=>{
  const value=body();value.records=Array.from({length:4},(_,i)=>({sspBookingId:`S-${830001+i}`,serviceDate:'2026-10-04',rawStatus:'CollectingPayment',rawPaymentStatus:'Pending',driverExternalId:'worker-1'}));
  value.coverage.recordCount=4;value.workerLinks={'worker-1':'biker-1'};
  value.ownerConfirmation={source:'owner_statement',ownerName:'Synthetic owner',statement:'Explicit owner net/VAT/gross assertion; type not visible',unitAmount:20,totalAmount:80,vatAmount:3,priceMode:'exclusive',grossAmount:23,totalVatAmount:12,totalGrossAmount:92};
  const rows=value.records.map(row=>({...row,outcome:'new',washId:`ssp__${row.sspBookingId}`,bikerId:'biker-1',bikerName:'Synthetic worker',assertedAmount:20,netAmount:20,vatAmount:3,grossAmount:23,collectionStatus:'confirmed_by_owner',workerCommission:4.5,ownerTaxSnapshot:{source:'owner_statement',currency:'SAR',clarificationId:`owner-handoff:${row.sspBookingId}`,priceMode:'exclusive',quantity:1,net:20,vat:3,gross:23}}));
  const result={canSave:true,counts:{new:4,modified:0,duplicate:0,rejected:0,needsReview:0},rows,ownerConfirmation:value.ownerConfirmation,reviewedPayloadHash:'body-hash',previewStateHash:'first-state'};
  call.mockResolvedValueOnce(result).mockResolvedValueOnce({...result,counts:{...result.counts,new:0,duplicate:4},previousRun:{sameRecords:true},previewStateHash:'committed-state'});
  saveCall.mockRejectedValueOnce(new Error('Synthetic response lost')).mockResolvedValueOnce({...result,saved:true,replay:true});
  render(<SweaterHandoffPreview/>);fill(value);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'معاينة dryRun على الخادم'}));
  const split=await screen.findByLabelText('فصل الضريبة بإقرار المالك');
  for(const amount of [80,12,92])expect(split.textContent).toContain(formatCurrency(amount));
  fireEvent.click(screen.getByLabelText('راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي'));fireEvent.click(screen.getByRole('button',{name:'حفظ الغسلات بإقرار المالك'}));
  await screen.findByText('Synthetic response lost');expect(saveCall).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('بيانات التسليم').value).toContain(value.importRunId);
  fireEvent.click(screen.getByRole('button',{name:'معاينة dryRun على الخادم'}));await screen.findByText('المعرّف مستخدم سابقًا بنفس السجلات؛ هذه قراءة فقط، مو إعادة استيراد.');
  expect(screen.getByRole('button',{name:'حفظ الغسلات بإقرار المالك'}).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('راجعت الحجوزات والعامل والإجمالي وإقرار المالك؛ أحفظ دون قيد مالي'));fireEvent.click(screen.getByRole('button',{name:'حفظ الغسلات بإقرار المالك'}));
  await screen.findByText('تم حفظ الغسلات وإقرار المالك دون ترحيل أو صرف عمولة');
  expect(saveCall).toHaveBeenCalledTimes(2);expect(saveCall.mock.calls[1][0]).toMatchObject({payload:{importRunId:value.importRunId,ownerConfirmation:value.ownerConfirmation},previewStateHash:'committed-state'});
  expect(call.mock.calls[0][0]).toEqual(call.mock.calls[1][0]);
});
