// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualitySection from '../BikerQualitySection';
import BikerQualityManual from '../BikerQualityManual';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: api }));
afterEach(() => { cleanup(); api.mockReset(); });
const manual = () => ({ policy: 'manual-status-20261015-v1', bikerUID: 'demo-worker', periodKey: '2026-10',
  from: '2026-10-01', to: '2026-10-14', sourceAvailable: true, confirmed: false, revision: 0, pendingWashes: 1,
  eligible: [{ washId: 'demo-wash', sspBookingId: 'S-DEMO', serviceDate: '2026-10-12' }],
  notes: [], history: [], component: { key: 'statusUpdates', points: null, weight: 10, n: null, reason: 'awaiting-manual-status-review' } });
it.each(['ar', 'en'])('removes only requested explanatory UI, retaining data and unconfirmed review controls (%s)', language => {
  const ar = language === 'ar';
  const saved = { id: 'demo-report', bikerUID: 'demo-worker', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
    sourceReadDate: '2026-10-15', rulesVersion: 'cqo-20261015-v3', status: 'incomplete', finalScore: null,
    duration: { n: 58, averageMinutes: 52.43, over50: 32 }, coverage: { canonicalCompleted: 59, durationMissing: 1 },
    components: [{ key: 'duration', weight: 10, points: 8.73, n: 58 }, { key: 'statusUpdates', points: 10, weight: 10, n: 59 }],
    evidence: { gaps: [{ reason: 'Stored source evidence must remain intact' }] }, improvement: 'Stored improvement must remain intact' };
  const review = manual(); const before = JSON.stringify({ saved, review });
  render(<LanguageContext.Provider value={{ language }}><BikerQualitySection bikerUID="demo-worker" periodKey="2026-10" today="2026-10-15"
    query={{ available: true, data: { reports: [saved], manual: review }, refetch: vi.fn() }} /></LanguageContext.Provider>);
  for (const text of ar ? ['تفاصيل مصدر التقييم', 'طريقة حساب المدة', 'خطوة التحسين', 'نطاق الغسلات المؤهل', 'غسلات خارج التغطية المؤكدة تحتاج مراجعة']
    : ['Assessment source details', 'Duration calculation', 'Improvement step', 'Eligible wash scope', 'Washes outside confirmed coverage requiring review']) {
    expect(screen.queryByText(text, { exact: false })).toBeNull();
  }
  expect(screen.queryByText(saved.improvement)).toBeNull();
  expect(screen.queryByText('Stored source evidence must remain intact')).toBeNull();
  const region = screen.getByRole('region', { name: ar ? 'عدم تحديث الحالة — مراجعة يدوية' : 'Missing status updates — manual review', exact: true });
  expect(within(region).queryByRole('heading', { name: ar ? 'عدم تحديث الحالة — مراجعة يدوية' : 'Missing status updates — manual review' })).toBeNull();
  expect(region.textContent).not.toContain(ar ? 'يسجل الأدمن الملاحظات فقط' : 'Only admin-entered notes count');
  expect(region.textContent).not.toContain(ar ? 'بانتظار المراجعة اليدوية' : 'Awaiting manual review');
  expect(region.textContent).not.toContain(ar ? '1 أكتوبر 2026' : '1 October 2026');
  expect(within(region).getByRole('button', { name: ar ? 'تأكيد المراجعة اليدوية' : 'Confirm manual review' }).disabled).toBe(true);
  fireEvent.click(within(region).getByText(ar ? 'تسجيل عدم تحديث' : 'Record a missing status update'));
  expect(within(region).getByRole('button', { name: ar ? 'حفظ ملاحظة عدم التحديث' : 'Save missing-update note' }).disabled).toBe(true);
  expect(within(region).getByText(ar ? 'سجل تدقيق المراجعة اليدوية' : 'Manual review audit trail')).toBeTruthy();
  const row = screen.getByRole('rowheader', { name: ar ? 'عدم تحديث الحالة — مراجعة يدوية' : 'Missing status updates — manual review' }).closest('tr');
  expect(row.textContent).toContain(ar ? 'غير مكتمل' : 'Incomplete');
  expect(row.textContent).not.toContain('10 / 10');
  expect(document.querySelectorAll('.sw-biker-quality__report')).toHaveLength(1);
  expect(screen.getAllByText('8.73 / 10')).toHaveLength(2);
  expect(JSON.stringify({ saved, review })).toBe(before); expect(api).not.toHaveBeenCalled();
});
it('keeps audited correction and scope guards after removing the introductory display', () => {
  const review = { ...manual(), unlinkedWashes: 1, notes: [{ washId: 'demo-wash', appointmentId: 'S-DEMO', serviceDate: '2026-10-12',
    stages: ['arrival'], note: 'Synthetic original note', at: '2026-10-15T09:00:00Z' }],
    history: [{ requestId: 'demo-history', operation: 'manual-correct', correctionReason: 'Synthetic audit reason', at: '2026-10-15T09:00:00Z' }] };
  const before = JSON.stringify(review);
  render(<BikerQualityManual manual={review} language="en" onReload={vi.fn()} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByText('Correct this note'));
  fireEvent.click(screen.getByRole('button', { name: 'Load this note into the correction form above' }));
  expect(screen.getByLabelText('Optional note').value).toBe('Synthetic original note');
  expect(screen.getByLabelText('Wash linked to this worker and period').disabled).toBe(true);
  expect(screen.getByLabelText(/Correction reason/).required).toBe(true);
  fireEvent.click(screen.getByLabelText('I reviewed the scope and the recorded manual cases'));
  expect(screen.getByRole('button', { name: 'Confirm manual review' }).disabled).toBe(true);
  fireEvent.click(screen.getByText('Manual review audit trail'));
  expect(screen.getByText('Synthetic audit reason')).toBeTruthy();
  expect(JSON.stringify(review)).toBe(before); expect(api).not.toHaveBeenCalled();
});
