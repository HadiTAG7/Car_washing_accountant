// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { usePartnerStatement } from '../usePartnerStatement';
const call = vi.hoisted(() => vi.fn());
vi.mock('../../lib/firebaseClient', () => ({ isFirebaseConfigured: true, callPartnerAllocationReport: call }));
afterEach(() => { cleanup(); call.mockReset(); });
describe('تقرير الشريك لا يتسرب عند تبديل المحاكاة', () => {
  it('صفحة الرحلة تطلب التفاصيل بينما قائمة الدخل لا تحمل مصادر إضافية', async () => {
    call.mockResolvedValue({ partnerId: 'a', statements: [], capitalJourney: { version: 1 } });
    const { result, rerender } = renderHook(({ includeCapitalJourney }) => usePartnerStatement({ partnerId: 'a', includeCapitalJourney }),
      { initialProps: { includeCapitalJourney: false } });
    await waitFor(() => expect(result.current.report).toBeTruthy());
    expect(call).toHaveBeenLastCalledWith({ partnerId: 'a' });
    rerender({ includeCapitalJourney: true });
    await waitFor(() => expect(call).toHaveBeenLastCalledWith({ partnerId: 'a', includeCapitalJourney: true }));
  });
  it('رحلة ناقصة من خادم قديم تظهر خطأ لا رصيداً مؤكداً', async () => {
    call.mockResolvedValue({ partnerId: 'a', statements: [] });
    const { result } = renderHook(() => usePartnerStatement({ partnerId: 'a', includeCapitalJourney: true }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.report).toBeNull();
    expect(result.current.error.message).toContain('تفاصيل رحلة رأس المال');
  });
  it('يحجب استجابة الشريك السابق المتأخرة حتى تصل استجابة الحالي', async () => {
    let resolveA, resolveB;
    call.mockImplementationOnce(() => new Promise(r => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise(r => { resolveB = r; }));
    const { result, rerender } = renderHook(({ partnerId }) => usePartnerStatement({ partnerId }), { initialProps: { partnerId: 'a' } });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    rerender({ partnerId: 'b' });
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    await act(async () => resolveA({ partnerId: 'a', statements: [{ founding: { remaining: 99999 } }] }));
    expect(result.current.report).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => resolveB({ partnerId: 'b', statements: [] }));
    expect(result.current.report.partnerId).toBe('b');
    expect(result.current.loading).toBe(false);
  });
  it('خادم قديم لا يرجع المصروفات يرفض بدلاً من عرض أصفار', async () => {
    call.mockResolvedValue({ partnerId: 'a', months: [] });
    const { result } = renderHook(() => usePartnerStatement({ partnerId: 'a' }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.report).toBeNull();
  });
});
