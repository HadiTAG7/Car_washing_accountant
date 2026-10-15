// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageContext } from '../../i18n/LanguageContext';
import BikerQualitySection from '../BikerQualitySection';
import BikerQualityMetric from '../BikerQualityMetric';

const state = vi.hoisted(() => ({ available: true, loading: false, error: null, reports: [] }));
const refetch = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/bikerQualityApi', () => ({ callBikerQuality: api }));
beforeEach(() => { state.available = true; state.loading = false; state.error = null; state.reports = []; api.mockReset(); refetch.mockReset(); });
afterEach(cleanup);
const props = { bikerUID: 'dummy', periodKey: '2026-10', today: '2026-10-15', get query() { return { ...state, data: { reports: state.reports }, refetch }; } };
const partial = () => ({ id: 'private-report', bikerUID: 'dummy', periodKey: '2026-10', from: '2026-10-01', to: '2026-10-13', sourceReadDate: '2026-10-14',
  rulesVersion: 'cqo-20261014-v1', status: 'incomplete', finalScore: null, duration: { n: 3, points: 8, averageMinutes: 60, over50: 2 },
  components: [{ key: 'duration', weight: 10, points: 8, n: 3, reason: 'partial-sample' },
    { key: 'productivity', weight: 10, points: null, n: null, reason: 'missing-evidence' }], improvement: 'Review 2 measured exceptions.' });
it('shows incomplete final assessment and sample-only points with evidence-based improvement', () => {
  state.reports = [partial()]; render(<BikerQualitySection {...props} />);
  expect(screen.getByText('التقييم النهائي غير مكتمل')).toBeTruthy();
  expect(screen.getAllByText('8 / 10')).toHaveLength(2);
  expect(screen.queryByText('80 / 100')).toBeNull();
  expect(screen.getByText('Review 2 measured exceptions.')).toBeTruthy();
  expect(screen.queryByText(/لا تُرفع نقاط العينة/)).toBeNull();
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
it('has an accessible English section name without a repeated visible heading or introduction', () => {
  state.reports = [partial()]; render(<LanguageContext.Provider value={{ language: 'en' }}><BikerQualitySection {...props} /></LanguageContext.Provider>);
  expect(screen.getByRole('region', { name: 'Composite quality assessment' })).toBeTruthy();
  expect(screen.getByText('Final assessment incomplete')).toBeTruthy();
  expect(screen.queryByText(/not customer stars/)).toBeNull();
});
it('explains each missing criterion separately and renders saved partial v2 totals and dated snapshots', () => {
  state.reports = [{ ...partial(), rulesVersion: 'cqo-20261015-v2', snapshotAt: '2026-10-15T09:00:00.000Z',
    availablePoints: 39.33, availableWeight: 60, components: [
      { key: 'washQuality', weight: 30, points: 18, n: 4, approximate: true, reason: 'partial-rounded-rating-sample' },
      { key: 'productivity', weight: 10, points: null, n: null, reason: 'missing-work-days' },
      { key: 'statusUpdates', weight: 10, points: null, n: null, reason: 'missing-explicit-status-review' },
      { key: 'complaints', weight: 10, points: null, n: 10, affected: 0, reason: 'awaiting-approved-rule' },
    ] }];
  render(<BikerQualitySection {...props} />);
  expect(screen.getAllByText('18 / 30')).toHaveLength(2);
  expect(screen.getByText('عينة نجوم مدوّرة · نتيجة تقريبية')).toBeTruthy();
  expect(screen.getByText('ينقص دليل أيام العمل المثبتة')).toBeTruthy();
  expect(screen.getByText('بانتظار المراجعة اليدوية؛ عدم الإدخال ليس مراجعة صفرية')).toBeTruthy();
  expect(screen.getByText('الأدلة محفوظة؛ بانتظار اعتماد قاعدة الخصم')).toBeTruthy();
  expect(screen.queryByText('39.33 / 100')).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it('never presents a partial 100-weight snapshot as a final /100 score', () => {
  const report={...partial(),periodKey:'2026-10',rulesVersion:'cqo-20261015-v3',snapshotAt:'2026-10-15T09:00:00.000Z',availablePoints:100,availableWeight:100,
    components:Object.entries({washQuality:30,behavior:20,productivity:10,complaints:10,cancellations:5,lateness:5,duration:10,statusUpdates:10})
      .map(([key,weight])=>({key,weight,points:weight,n:1,reason:'partial-sample'}))};
  state.reports=[report];
  render(<><BikerQualitySection {...props}/><BikerQualityMetric query={props.query} bikerUID="dummy" periodKey="2026-10" today="2026-10-15"/></>);
  expect(screen.queryByText('100 / 100')).toBeNull();
  expect(screen.getAllByText('90 / 90')).toHaveLength(2);
  expect(screen.queryByText('100 نقطة متاحة')).toBeNull();
});
it('keeps reports readable when canonical source is unavailable, not a verified zero', () => {
  state.reports=[partial()];
  render(<BikerQualitySection {...props} query={{...props.query,data:{reports:state.reports,source:{available:false,reason:'requires-pagination'}}}}/>);
  expect(screen.getAllByText('8 / 10')).toHaveLength(2);
  expect(screen.getByText('تعذّر تأكيد مصدر الغسلات؛ ليس صفراً.')).toBeTruthy();
  expect(screen.queryByRole('table',{name:'دليل الغسلات للشهر المحدد'})).toBeNull(); expect(api).not.toHaveBeenCalled();
});
it('renders unreadable SSP events as source gaps, never missing recorded timestamps', () => {
  state.reports=[{...partial(),rulesVersion:'cqo-20261015-v3',evidence:{updates:{reviews:[{
    washId:'dummy-wash',appointmentId:'S-DEMO',serviceDate:'2026-10-12',readStatus:'unreadable',reason:'Isolated unavailable detail',
    source:{reference:'Fixture only',hash:'a'.repeat(64),readDate:'2026-10-14'},
  }]}}}];
  render(<BikerQualitySection {...props}/>);
  expect(screen.getByText('تعذّرت قراءة المصدر:')).toBeTruthy(); expect(screen.queryByText('غير مسجّل')).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
