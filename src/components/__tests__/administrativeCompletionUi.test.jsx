// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { completionFixture, missingStartCompletionFixture } from '../../../functions/test/administrativeCompletionFixture.js';
const state = vi.hoisted(() => ({ preview:vi.fn(),save:vi.fn(),oldPreview:vi.fn(),oldSave:vi.fn() }));
vi.mock('../../lib/firebaseClient', () => ({ callSweaterAdministrativeCompletionPreview:state.preview,callSweaterAdministrativeCompletionSave:state.save,
  callSweaterImportPreview:state.oldPreview,callSweaterOwnerHandoffSave:state.oldSave,describeBackendError:e=>e.message }));
import SweaterHandoffPreview from '../SweaterHandoffPreview';
afterEach(()=>{cleanup();Object.values(state).forEach(f=>f.mockReset());});
it('shows current readback facts for a saved run and offers no second save or invented commission payment status', async () => {
  const p = completionFixture();
  state.preview.mockResolvedValue({ canSave: false, saved: false, replay: true, previousRun: { sameRecords: true },
    administrativeDecision: p.decision, counts: { new: 4 }, rows: [], verification: { status: 'mismatch', matched: 0, total: 1,
      rows: [{ sspBookingId: 'C-990001', washCount: 1, claimCount: 1, verified: false, issues: ['TEST current mismatch'], commission: { amountPerWash: 4.5, paid: null } }] } });
  render(<SweaterHandoffPreview />);
  fireEvent.change(screen.getByLabelText('بيانات التسليم'), { target: { value: JSON.stringify(p) } });
  fireEvent.click(screen.getByRole('button', { name: 'راجع الملف محليًا' })); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'معاينة dryRun على الخادم' }));
  expect(await screen.findByRole('region', { name: 'مطابقة الحفظ الحالية' })).toBeTruthy();
  expect(screen.getByRole('table', { name: 'نتيجة مطابقة الحفظ' }).textContent).toContain('غير متاح');
  expect(screen.queryByRole('button', { name: 'حفظ قرار الاكتمال دون تحصيل' })).toBeNull(); expect(state.save).not.toHaveBeenCalled();
});
it.each([completionFixture,missingStartCompletionFixture])('uses the separate admin path, shows source facts, requires both reviews, binds both hashes and never invokes collection handoff', async fixture=>{
  const p=fixture(), result={canSave:true,reviewedPayloadHash:'file-hash',previewStateHash:'state-hash',administrativeDecision:p.decision,
    rows:p.records.map(r=>({...r,outcome:'new',bikerName:'Synthetic worker',collectionStatus:'pending'})),counts:{new:p.records.length,modified:0,duplicate:0,rejected:0,needsReview:0}};
  state.preview.mockResolvedValue(result);state.save.mockResolvedValue({...result,saved:true});
  render(<SweaterHandoffPreview/>);
  fireEvent.change(screen.getByLabelText('بيانات التسليم'),{target:{value:JSON.stringify(p)}});
  fireEvent.click(screen.getByRole('button',{name:'راجع الملف محليًا'}));fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'معاينة dryRun على الخادم'}));
  const save=await screen.findByRole('button',{name:'حفظ قرار الاكتمال دون تحصيل'});
  expect(save.disabled).toBe(true);expect(screen.getByLabelText('قرار الاكتمال الإداري دون تحصيل').textContent).toContain(p.records[0].rawStatus);
  fireEvent.click(screen.getByLabelText('راجعت الحجوزات المشمولة والمستثناة ومرجع قرار هادي، دون إثبات تحصيل'));expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('أحفظ القرار والغسلات المحددة فقط دون قيد أو قبض أو صرف'));fireEvent.click(save);
  await screen.findByText('حُفظ قرار الاكتمال والغسلات دون تحصيل أو ترحيل أو صرف عمولة');
  expect(state.save).toHaveBeenCalledWith({payload:p,reviewedPayloadHash:'file-hash',previewStateHash:'state-hash'});
  expect(state.oldSave).not.toHaveBeenCalled();expect(state.oldPreview).not.toHaveBeenCalled();
});
it('editing the reviewed file invalidates the server preview and prevents saving',async()=>{
  const p=completionFixture();state.preview.mockResolvedValue({canSave:true,administrativeDecision:p.decision,rows:[],counts:{new:4},reviewedPayloadHash:'old',previewStateHash:'old'});
  render(<SweaterHandoffPreview/>);fireEvent.change(screen.getByLabelText('بيانات التسليم'),{target:{value:JSON.stringify(p)}});
  fireEvent.click(screen.getByRole('button',{name:'راجع الملف محليًا'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'معاينة dryRun على الخادم'}));
  await screen.findByRole('button',{name:'حفظ قرار الاكتمال دون تحصيل'});
  fireEvent.change(screen.getByLabelText('بيانات التسليم'),{target:{value:JSON.stringify({...p,importRunId:'changed'})}});
  expect(screen.queryByRole('button',{name:'حفظ قرار الاكتمال دون تحصيل'})).toBeNull();expect(state.save).not.toHaveBeenCalled();
});
