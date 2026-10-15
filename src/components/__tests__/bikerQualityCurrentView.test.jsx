// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualitySection from '../BikerQualitySection';
import BikerQualityMetric from '../BikerQualityMetric';
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: vi.fn() }));
afterEach(cleanup);
const context = { bikerUID: 'demo-worker', periodKey: '2026-10', today: '2026-10-15' };
const report = changes => ({ id: 'current', ...context, from: '2026-10-01', to: '2026-10-14',
  sourceReadDate: '2026-10-15', snapshotAt: '2026-10-15T12:00:00Z', rulesVersion: 'cqo-20261015-v3',
  duration: { n: 58, averageMinutes: 52.43, over50: 32 }, status: 'incomplete', finalScore: null,
  coverage: { canonicalCompleted: 59, durationMissing: 1, excludedSourceRecords: 0, criteria: {} },
  components: [{ key: 'washQuality', weight: 30, points: 23.28, n: 16 }, { key: 'behavior', weight: 20, points: 18, n: 16 },
    { key: 'productivity', weight: 10, points: 6.04, n: 12 }, { key: 'complaints', weight: 10, points: 8.19, n: 58 },
    { key: 'cancellations', weight: 5, points: 4.17, n: 60 }, { key: 'duration', weight: 10, points: 8.73, n: 58 }],
  evidence: { gaps: [{ washId: 'demo-gap', reason: 'Preserved source gap' }] },
  improvement: 'Current improvement only.', ...changes });
function show(reports, language = 'ar') {
  const query = { available: true, data: { reports }, refetch: vi.fn() };
  return render(<LanguageContext.Provider value={{ language }}><BikerQualityMetric query={query} {...context}/>
    <BikerQualitySection query={query} {...context}/></LanguageContext.Provider>);
}
it.each(['ar', 'en'])('omits source details from the UI and retains accessible current section and saved evidence (%s)', language => {
  const saved = report(); const before = JSON.stringify(saved);
  show([saved], language);
  const ar = language === 'ar';
  const title = ar ? 'تقييم الجودة المركّب' : 'Composite quality assessment';
  expect(screen.queryByRole('heading', { name: title, level: 3 })).toBeNull();
  const section = screen.getByRole('region', { name: title, exact: true });
  expect(section.textContent).not.toContain(ar ? 'تقييم مستقل من 100' : 'Separate assessment out of 100');
  expect(screen.getByRole('group', { name: title }).textContent).toContain('68.41 / 85');
  const article = section.querySelector('.sw-biker-quality__report');
  const front = Array.from(article.children).filter(e => e.tagName !== 'DETAILS').map(e => e.textContent).join(' ');
  for (const phrase of ar ? ['نسخة القاعدة', 'وقت اللقطة', 'تغطية جزئية: المدة', 'غسلات لم تكتمل أدلة مدتها', 'طوابع سويتر دليل تاريخي']
    : ['Rule version', 'Snapshot time', 'Partial coverage: duration', 'Washes without complete duration evidence', 'Sweater timestamps are historical evidence']) {
    expect(front).not.toContain(phrase);
  }
  expect(within(article).getByText(ar ? 'التقييم النهائي غير مكتمل' : 'Final assessment incomplete')).toBeTruthy();
  expect(within(article).getByText('58 / 59')).toBeTruthy();
  expect(within(article).getAllByText('52.43').length).toBeGreaterThan(0);
  expect(within(article).getByText('32')).toBeTruthy();
  expect(within(article).queryByText(ar ? 'تفاصيل مصدر التقييم' : 'Assessment source details')).toBeNull();
  expect(section.textContent).not.toContain('Preserved source gap');
  expect(JSON.stringify(saved)).toBe(before);
});
it.each(['ar', 'en'])('selects only the correct latest approved current report from an unordered mixed set (%s)', language => {
  const rows = [report({ id: 'old-date', to: '2026-10-13', improvement: 'Old date must not render.' }),
    report({ id: 'wrong-worker', bikerUID: 'other-worker', to: '2026-10-15', improvement: 'Other worker must not render.' }),
    report({ id: 'old-snapshot', snapshotAt: '2026-10-15T09:00:00Z', improvement: 'Older snapshot must not render.' }),
    report({ id: 'wrong-month', periodKey: '2026-09', from: '2026-09-01', to: '2026-09-30', improvement: 'Other month must not render.' }),
    report({ id: 'future', to: '2026-10-16', improvement: 'Future report must not render.' }),
    report({ id: 'unapproved', rulesVersion: 'unapproved', to: '2026-10-15', improvement: 'Unapproved must not render.' }),
    report({ duration: { n: 57, averageMinutes: 51.23, over50: 31 } })];
  const before = JSON.stringify(rows);
  show(rows, language);
  expect(document.querySelectorAll('.sw-biker-quality__report')).toHaveLength(1);
  // A visible metric unique to the selected snapshot proves selection independently of hidden free text.
  expect(document.querySelector('.sw-biker-quality__metrics').textContent).toContain('51.23');
  expect(document.querySelector('.sw-biker-quality__metrics').textContent).not.toContain('52.43');
  for (const r of rows) expect(screen.queryByText(r.improvement)).toBeNull();
  expect(screen.queryByText(language === 'ar' ? 'لقطة تاريخية محفوظة — ليست درجة المراجعة اليدوية الحالية' : 'Saved historical snapshot — not the current manual-review score')).toBeNull();
  expect(JSON.stringify(rows)).toBe(before);
});
it('does not replace a current unmeasured report with a previous measured one', () => {
  show([report({ id: 'older', snapshotAt: '2026-10-15T09:00:00Z', improvement: 'Old measured report.' }),
    report({ components: [{ key: 'duration', weight: 10, points: null, n: 0 }], duration: { n: 0, averageMinutes: null, over50: 0 } })]);
  expect(document.querySelectorAll('.sw-biker-quality__report')).toHaveLength(1);
  expect(screen.queryByText('Old measured report.')).toBeNull();
  expect(document.querySelector('.sw-biker-quality__metrics').textContent).not.toContain('58 / 59');
  expect(screen.getByRole('group', { name: 'تقييم الجودة المركّب' }).textContent).toContain('—');
});
