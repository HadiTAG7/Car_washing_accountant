// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SweaterBookingCleanup from '../SweaterBookingCleanup';
vi.mock('../../data/initialData', async (load) => ({ ...(await load()), todayISO: () => '2026-10-31' }));
afterEach(cleanup);

const summary = { numbers: 898, folded: 69, renamed: 829, duplicatesRemoved: 69, decisions: 7, pending: 59, validated: 832, conflicts: 0,
  variancesSuperseded: 761, variancesOpened: 7, skipped: [{ number: '990006', why: 'financially_locked' }],
  decisionsByReason: { execution_without_wash: 4, missing_execution_evidence: 1, unknown_status: 2 } };
const rows = [{ number: '5676193', action: 'fold', copies: ['B-5676193', 'S-5676193'], latest: { sspBookingId: 'S-5676193', rawStatus: 'Collecting Payment' },
  held: false, processingStatus: 'needs_review', reasonCode: 'execution_without_wash', conflictFields: [], variancesSuperseded: 2, varianceOpened: true }];
const props = (over = {}) => ({
  onPreview: vi.fn().mockResolvedValueOnce({ previewHash: 'h1', summary, rows, lastApplied: null })
    .mockResolvedValue({ previewHash: 'h2', summary: { ...summary, numbers: 0 }, rows: [],
      lastApplied: { appliedAtIso: '2026-10-31T12:00:00Z', appliedBy: 'هادي', reason: 'توحيد بعد المراجعة' } }),
  onApply: vi.fn().mockResolvedValue({ applied: 898 }),
  onFillPreview: vi.fn().mockResolvedValue({ periodKey: '2026-10', previewHash: 'f1', rows: [
    { number: '5600001', hasWash: true, processingStatus: 'validated' }, { number: '5600002', hasWash: false, processingStatus: 'needs_review' }] }),
  onFillApply: vi.fn().mockResolvedValue({ filled: 2 }), ...over,
});

describe('«توحيد الحجوزات ونوع الخدمة»', () => {
  it('previews what changes and what still needs a decision, and applies only with a reason and a confirmation', async () => {
    const p = props();
    render(<SweaterBookingCleanup {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'معاينة التوحيد' }));
    const changes = await screen.findByRole('list', { name: 'ما سيتغيّر' });
    expect(changes.textContent).toContain('نسخ مكررة تُدمج: 69 (في 69 حجزًا)');
    expect(changes.textContent).toContain('تحتاج قرارك بعد التوحيد: 7');
    expect(changes.textContent).toContain('فروق قديمة تُغلق: 761');
    expect(screen.getByRole('list', { name: 'أسباب القرارات الباقية' }).textContent).toContain('غسلة مثبتة في سويتر بلا غسلة مسجلة عندنا: 4');
    expect(screen.getByRole('list', { name: 'ما لن يُمس' }).textContent).toContain('مرحّل أو في تسوية');
    expect(within(screen.getByRole('table', { name: 'تفاصيل التوحيد' })).getByText('B-5676193 · S-5676193')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تطبيق التوحيد' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('سبب التوحيد'), { target: { value: 'توحيد بعد المراجعة' } });
    fireEvent.click(screen.getByRole('button', { name: 'تطبيق التوحيد' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'تأكيد التوحيد' })).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(p.onApply).toHaveBeenCalledWith({ reason: 'توحيد بعد المراجعة', previewHash: 'h1' }));
    expect(await screen.findByText('وُحّد 898 حجزًا باسمك.')).toBeTruthy();
    expect(screen.getByText('كل الحجوزات موحّدة برقمها؛ لا شيء يتغيّر.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('بواسطة هادي · السبب: توحيد بعد المراجعة');
  });

  it('fills the service type for a month from Sweater\'s report, after a reason and a confirmation', async () => {
    const p = props();
    render(<SweaterBookingCleanup {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'معاينة التعبئة' }));
    await waitFor(() => expect(p.onFillPreview).toHaveBeenCalledWith({ periodKey: '2026-10' }));
    expect((await screen.findByText(/حجزًا مكتملًا بلا نوع خدمة/)).textContent).toContain('2 حجزًا مكتملًا بلا نوع خدمة · منها 1 لها غسلة مسجلة · يبقى بعدها 1 يحتاج قرارك');
    fireEvent.change(screen.getByLabelText('سبب التعبئة'), { target: { value: 'كل المكتمل Full Wash' } });
    fireEvent.click(screen.getByRole('button', { name: 'تعبئة نوع الخدمة' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'تأكيد التعبئة' })).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(p.onFillApply).toHaveBeenCalledWith({ periodKey: '2026-10', reason: 'كل المكتمل Full Wash', previewHash: 'f1' }));
    expect(await screen.findByText('عُبّئ نوع الخدمة في 2 حجزًا باسمك.')).toBeTruthy();
  });

  it('shows the server\'s refusal', async () => {
    render(<SweaterBookingCleanup {...props({ onFillPreview: vi.fn().mockRejectedValue(new Error('وحّد الحجوزات برقمها أولًا، ثم عبّئ نوع الخدمة.')) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'معاينة التعبئة' }));
    expect((await screen.findByRole('alert')).textContent).toContain('وحّد الحجوزات برقمها أولًا');
  });
});
