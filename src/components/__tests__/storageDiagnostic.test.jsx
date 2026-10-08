// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ inspect: vi.fn(), seed: vi.fn() }));
vi.mock('../../lib/storageDiagnostic', () => ({ inspectStorage: calls.inspect, seedStorage: calls.seed }));
vi.mock('../LanguageSwitcher', () => ({ default: () => null }));
import StorageDiagnostic from '../StorageDiagnostic';
const current = { version: 1, readAt: '2026-10-08T04:40:00.000Z', localStorage: { readable: true, writable: true, marker: 'absent' }, indexedDB: { readable: true, writable: true, marker: 'absent' } };
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('reads before explicit planting and keeps pre-planting evidence visible afterwards', async () => {
  calls.inspect.mockResolvedValue({ current, history: [] });
  calls.seed.mockResolvedValue({ current, history: [current], evidenceSaved: true, seeded: { localStorage: true, indexedDB: true } });
  render(<StorageDiagnostic />); await screen.findByText('لا توجد قراءات محفوظة بعد.'); expect(calls.seed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الدليل ثم زرع المؤشرات' }));
  await screen.findByText('حُفظ دليل ما قبل الزرع أولًا، ثم تمت محاولة زرع المؤشرات.');
  expect(calls.seed).toHaveBeenCalledTimes(1); expect(screen.getAllByText('غير موجود').length).toBeGreaterThanOrEqual(2);
  fireEvent.click(screen.getByRole('button', { name: 'قراءة المؤشرات دون إعادة زرع' }));
  await screen.findByText('لا توجد قراءات محفوظة بعد.'); expect(calls.seed).toHaveBeenCalledTimes(1);
});
it('shows evidence-save failure without implying that planting succeeded', async () => {
  calls.inspect.mockResolvedValue({ current, history: [] });
  calls.seed.mockResolvedValue({ current, history: [current], evidenceSaved: false, seeded: { localStorage: false, indexedDB: false } });
  render(<StorageDiagnostic />); await screen.findByText('لا توجد قراءات محفوظة بعد.');
  fireEvent.click(screen.getByRole('button', { name: 'حفظ الدليل ثم زرع المؤشرات' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'لم يمكن حفظ الدليل؛ لم تُزرع أي مؤشرات. نزّل النتائج للاحتفاظ بها.');
});
