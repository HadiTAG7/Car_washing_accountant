// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualitySection from '../BikerQualitySection';

const state = vi.hoisted(() => ({ available: true, loading: false, error: null, reports: [] }));
const refetch = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: api }));
beforeEach(() => { state.available = true; state.loading = false; state.error = null; state.reports = []; api.mockReset(); refetch.mockReset(); });
afterEach(cleanup);
const props = { get query() { return { ...state, data: { reports: state.reports }, refetch }; } };
const partial = () => ({ id: 'private-report', bikerUID: 'dummy', from: '2026-10-01', to: '2026-10-13', sourceReadDate: '2026-10-14',
  rulesVersion: 'cqo-20261014-v1', status: 'incomplete', finalScore: null, duration: { n: 3, points: 8, averageMinutes: 60, over50: 2 },
  components: [{ key: 'duration', weight: 10, points: 8, n: 3, reason: 'partial-sample' },
    { key: 'productivity', weight: 10, points: null, n: null, reason: 'missing-evidence' }], improvement: 'Review 2 measured exceptions.' });
it('shows incomplete final assessment and sample-only points with evidence-based improvement', () => {
  state.reports = [partial()]; render(<BikerQualitySection {...props} />);
  expect(screen.getByText('التقييم النهائي غير مكتمل')).toBeTruthy();
  expect(screen.getByText('8 / 10')).toBeTruthy();
  expect(screen.queryByText('80 / 100')).toBeNull();
  expect(screen.getByText('Review 2 measured exceptions.')).toBeTruthy();
  expect(screen.getByText(/لا تُرفع نقاط العينة/)).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});
it('shows a read failure, not missing report or zero score', () => {
  state.available = false; state.error = new Error('Denied'); render(<BikerQualitySection {...props} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('لا يوجد تقرير جودة محفوظ لهذا الشهر.')).toBeNull();
});
it('publishes only on explicit admin submit, then reloads persisted results', async () => {
  api.mockResolvedValue({ created: 1, unchanged: 0 }); render(<BikerQualitySection {...props} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"reports":[]}' } });
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'حفظ التقارير المعتمدة' }));
  await waitFor(() => expect(refetch).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith('save', { reports: [] });
});
it('has English headings and makes clear this is not customer stars', () => {
  state.reports = [partial()]; render(<LanguageContext.Provider value={{ language: 'en' }}><BikerQualitySection {...props} /></LanguageContext.Provider>);
  expect(screen.getByText('Composite quality assessment')).toBeTruthy();
  expect(screen.getByText('Final assessment incomplete')).toBeTruthy();
  expect(screen.getByText(/not customer stars/)).toBeTruthy();
});
