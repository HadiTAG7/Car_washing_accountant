// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SweaterOpenBookings from '../SweaterOpenBookings';
afterEach(cleanup);

const status = {
  required: { rangeFrom: '2026-10-30', rangeTo: '2026-11-01', days: 3 },
  lastSync: { runId: 'ops-20261101-hour00-0004-v1', rangeFrom: '2026-11-01', rangeTo: '2026-11-01', days: 1, extractedAtIso: '2026-10-31T21:04:24.668Z' },
  open: [{ bookingNumber: '5676193' }, { bookingNumber: '5690001' }],
  notReread: [{ bookingNumber: '5676193', serviceDate: '2026-10-30', rawStatus: 'On the Way', observedAtIso: '2026-10-30T13:01:11.186Z', hoursSinceRead: 32.1 }],
};
const rows = [
  { number: '5676193', serviceDate: '2026-10-30', current: { rawStatus: 'On the Way' }, stored: { rawStatus: 'Collecting Payment', extractedAtIso: '2026-10-30T14:03:47.303Z' },
    outcome: 'modified', recordsWash: true, reassignment: { executionWorkerBasis: 'source_observed_before_execution' } },
  { number: '5680148', serviceDate: '2026-10-30', current: { rawStatus: 'Washing Started' }, stored: { rawStatus: 'Collecting Payment', extractedAtIso: '2026-10-30T15:01:11.475Z' },
    outcome: 'modified', recordsWash: true, reassignment: null },
];

describe('«الحجوزات المفتوحة في سويتر»', () => {
  it('warns when the last sync read fewer than 3 days, and lists what it did not re-read', () => {
    render(<SweaterOpenBookings status={status} />);
    expect(screen.getByLabelText('آخر مزامنة').textContent).toContain('(1 يوم)');
    expect(screen.getByRole('alert').textContent).toContain('آخر مزامنة قرأت أقل من 3 أيام');
    expect(screen.getByText(/مفتوحة الآن/).textContent.replace(/\s+/g, ' ')).toContain('مفتوحة الآن: 2 · لم تُعِد آخر مزامنة قراءتها: 1');
    const table = screen.getByRole('table', { name: 'حجوزات مفتوحة لم يُعَد قراءتها' });
    expect(within(table).getByText('5676193')).toBeTruthy();
    expect(table.textContent).toContain('32.1');
    // Staff who may only read do not see the replay.
    expect(screen.queryByRole('region', { name: 'قراءات سويتر المحفوظة' })).toBeNull();
  });

  it('applies the stored readings only after a preview, a reason and a confirmation', async () => {
    const onPreview = vi.fn().mockResolvedValueOnce({ previewHash: 'p1', rows, lastApplied: null }).mockResolvedValue({ previewHash: 'p2', rows: [],
      lastApplied: { appliedAtIso: '2026-11-01T09:00:00Z', appliedByName: 'هادي', reason: 'بعد التوحيد' } });
    const onApply = vi.fn().mockResolvedValue({ applied: 2, washesCreated: 2 });
    render(<SweaterOpenBookings status={{ ...status, lastSync: { ...status.lastSync, days: 3 } }} canApply onPreview={onPreview} onApply={onApply} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'معاينة القراءات المحفوظة' }));
    const table = await screen.findByRole('table', { name: 'القراءات المحفوظة' });
    expect(table.textContent).toContain('تُسجَّل الغسلة · تغيّر البايكر قبل التنفيذ (ظهر البايكر الجديد في الطريق قبل البدء): تُحسب لمن نفّذها');
    expect(screen.getByText('تُسجَّل 2 غسلة من 2 حجزًا.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'طبّق القراءات المحفوظة' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('سبب التطبيق'), { target: { value: 'بعد التوحيد' } });
    fireEvent.click(screen.getByRole('button', { name: 'طبّق القراءات المحفوظة' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'تأكيد تطبيق القراءات' })).getByRole('button', { name: 'تأكيد' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ reason: 'بعد التوحيد', previewHash: 'p1' }));
    expect(await screen.findByText('طُبّقت 2 قراءة باسمك وسُجّلت 2 غسلة.')).toBeTruthy();
    expect(screen.getByText('لا قراءة محفوظة تنتظر التطبيق.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('بواسطة هادي');
  });
});
