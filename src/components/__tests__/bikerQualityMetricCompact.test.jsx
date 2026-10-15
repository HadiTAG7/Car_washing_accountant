// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualityMetric from '../BikerQualityMetric';
afterEach(cleanup);
const report = () => ({ id: 'compact-demo', bikerUID: 'worker-a', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-14',
  sourceReadDate: '2026-10-15', rulesVersion: 'cqo-20261015-v3', finalScore: null, status: 'incomplete',
  coverage: { canonicalCompleted: 59 }, components: [
    { key: 'washQuality', weight: 30, points: 23.28, n: 16, approximate: true }, { key: 'behavior', weight: 20, points: 18, n: 16 },
    { key: 'productivity', weight: 10, points: 6.04, n: 12 }, { key: 'complaints', weight: 10, points: 8.19, n: 58 },
    { key: 'cancellations', weight: 5, points: 4.17, n: 60 }, { key: 'duration', weight: 10, points: 8.73, n: 58 },
    { key: 'statusUpdates', weight: 10, points: 10, n: 58 },
  ] });
const props = () => ({ query: { available: true, data: { reports: [report()] } }, bikerUID: 'worker-a', periodKey: '2026-10', today: '2026-10-15' });
it.each([['ar', 'تقييم الجودة المركّب'], ['en', 'Composite quality assessment']])('renders only the title and unchanged score in %s', (language, title) => {
  render(<LanguageContext.Provider value={{ language }}><BikerQualityMetric {...props()} /></LanguageContext.Provider>);
  const card = screen.getByRole('group', { name: title });
  expect([...card.children].map(e => e.textContent)).toEqual([title, '68.41 / 85']);
  expect(within(card).queryByRole('button')).toBeNull();
  expect(card.querySelector('small')).toBeNull();
  expect(card.textContent).not.toContain('58 / 59');
  expect(card.textContent).not.toContain('/ 100');
});
it.each(['loading', 'error', 'missing'])('uses a dash rather than zero or stale data when %s', mode => {
  const p = props(); p.query = { ...p.query, available: mode !== 'missing', loading: mode === 'loading', error: mode === 'error' ? new Error('Synthetic') : null };
  render(<BikerQualityMetric {...p} />);
  const card = screen.getByRole('group', { name: 'تقييم الجودة المركّب' });
  expect(card.querySelector('strong').textContent).toBe('—');
  expect(card.children).toHaveLength(2);
});
it('preserves an evidenced zero with its actual denominator', () => {
  const p = props(); p.query.data.reports = [{ ...report(), components: [{ key: 'cancellations', weight: 5, points: 0, n: 1 }] }];
  render(<BikerQualityMetric {...p} />);
  expect(screen.getByText('0 / 5')).toBeTruthy();
});
