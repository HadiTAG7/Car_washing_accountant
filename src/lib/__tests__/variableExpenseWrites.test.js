import { describe, it, expect, vi, beforeEach } from 'vitest';
const sdk = vi.hoisted(() => ({
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), getDoc: vi.fn(),
  writeBatch: vi.fn(), commit: vi.fn(), set: vi.fn(), update: vi.fn(), delete: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ ...sdk, collection: (_db, path) => path,
  doc: (_db, path, id) => ({ path, id }), getDocs: vi.fn(), query: vi.fn(),
  deleteDoc: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}));
vi.mock('../firebaseClient', () => ({ db: {} }));
import { insertRow, updateRow, runBatch } from '../firestoreCrud';
const existing = { logged_date: '2026-09-04', invoice_date: null, expense_name: 'مواد' };
beforeEach(() => {
  vi.clearAllMocks();
  sdk.getDoc.mockResolvedValue({ exists: () => true, data: () => existing });
  sdk.addDoc.mockResolvedValue({ id: 'new' });
  sdk.writeBatch.mockReturnValue({ commit: sdk.commit, set: sdk.set, update: sdk.update, delete: sdk.delete });
});
describe('بوابة كتابة المصروفات المتغيرة', () => {
  it.each(['', '2026-2-31', '2026-13-01', '2026-09-04garbage', '04/09/2026'])('ترفض إضافة تاريخ غير صحيح (%s) قبل أي كتابة', async logged_date => {
    await expect(insertRow('variable_expenses', { logged_date })).rejects.toThrow();
    expect(sdk.addDoc).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });
  it('توحّد التاريخ الحقيقي فقط', async () => {
    await insertRow('variable_expenses', { logged_date: '2026-9-4', invoice_date: '2026-8-31' });
    expect(sdk.addDoc).toHaveBeenCalledWith('variable_expenses', expect.objectContaining({ logged_date: '2026-09-04', invoice_date: '2026-08-31' }));
  });
  it('ترفض تاريخ فاتورة غير صالح حتى بدون علم ضريبي', async () => {
    await expect(insertRow('variable_expenses', { ...existing, invoice_date: '—', is_tax_invoice: false })).rejects.toThrow();
    expect(sdk.addDoc).not.toHaveBeenCalled();
  });
  it('تتحقق من التحديث الجزئي مع السجل القائم', async () => {
    await expect(updateRow('variable_expenses', 'v1', { logged_date: null })).rejects.toThrow();
    expect(sdk.updateDoc).not.toHaveBeenCalled();
    await updateRow('variable_expenses', 'v1', { expense_name: 'اسم جديد' });
    expect(sdk.updateDoc).toHaveBeenCalledWith({ path: 'variable_expenses', id: 'v1' }, { expense_name: 'اسم جديد' });
  });
  it('ترفض الدفعة كلها قبل إرسال أي كتابة إن احتوت تاريخاً غير صالح', async () => {
    await expect(runBatch([
      { type: 'set', path: 'other', id: 'ok', data: { value: 1 } },
      { type: 'set', path: 'variable_expenses', id: 'bad', data: { logged_date: '2026-02-31' } },
    ])).rejects.toThrow();
    expect(sdk.commit).not.toHaveBeenCalled();
  });
  it('تعالج إنشاء ثم تحديث السجل في الدفعة نفسها دون قراءة سجل غير موجود', async () => {
    await runBatch([
      { type: 'set', path: 'variable_expenses', id: 'new', data: { logged_date: '2026-9-4' } },
      { type: 'update', path: 'variable_expenses', id: 'new', data: { expense_name: 'مواد' } },
    ]);
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.commit).toHaveBeenCalledTimes(1);
    expect(sdk.set).toHaveBeenCalledWith({ path: 'variable_expenses', id: 'new' }, { logged_date: '2026-09-04' });
  });
  it('لا يتيح تحديث سجل مفقود أو متابعة كتابة بعد حذفه في الدفعة نفسها', async () => {
    await expect(runBatch([
      { type: 'delete', path: 'variable_expenses', id: 'gone' },
      { type: 'update', path: 'variable_expenses', id: 'gone', data: { logged_date: '2026-09-04' } },
    ])).rejects.toThrow();
    expect(sdk.commit).not.toHaveBeenCalled();
  });
});
