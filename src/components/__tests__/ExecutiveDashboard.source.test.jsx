// @vitest-environment jsdom
// Explicit local acceptance file only; never fetch or commit the CEO's report.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutiveReportView } from '../ExecutiveReportsPage';
import { parseExecutiveReport } from '../../lib/executiveReportContract';
afterEach(cleanup);
const file = process.env.SWEATER_REVIEWED_EXECUTIVE_REPORT;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
describe.skipIf(!file)('approved CEO snapshot — display-only acceptance', () => {
  const source = () => {
    const bytes = readFileSync(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('363f5931112159d8c62b11e177329044e6470532c79b22fb918881c40d7b9f74');
    return freeze(parseExecutiveReport(JSON.parse(bytes.toString('utf8'))));
  };
  it('preserves the exact historical metrics, units, caveats and immutable input across all three views', () => {
    const report = source(), original = JSON.stringify(report); render(<ExecutiveReportView report={report} />);
    expect(report.metrics.map(m => m.value)).toEqual([333, 6660, 36]);
    for (const metric of report.metrics) {
      const card = screen.getByRole('region', { name: metric.label });
      expect(card.textContent).toContain(metric.unit); expect(card.textContent).toContain(metric.coverage);
    }
    for (const tab of ['ملخص اليوم', 'متابعة القرارات', 'المراجعة الأسبوعية']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      for (const warning of report.visibleWarnings) expect(screen.getByText(warning.text)).toBeTruthy();
      expect(screen.getByText(report.ownerAction.text)).toBeTruthy();
    }
    expect(screen.getByRole('tabpanel').textContent).toContain('الأسبوعية غير مستحقة');
    expect(JSON.stringify(report)).toBe(original); expect(report.revision).toBe(1);
  });
  it('derives six cases with five unverified and one in progress; zero closed remains truthful', () => {
    render(<ExecutiveReportView report={source()} />);
    const counts = screen.getByRole('region', { name: 'حالات التقرير عند القطع' });
    expect(within(counts).getByRole('button', { name: '6 كل الحالات' })).toBeTruthy();
    expect(within(counts).getByRole('button', { name: '5 مفتوح — النتيجة غير متحققة' })).toBeTruthy();
    expect(within(counts).getByRole('button', { name: '1 قيد التنفيذ' })).toBeTruthy();
    fireEvent.click(within(counts).getByRole('button', { name: '0 مغلق بدليل' }));
    expect(screen.getByRole('status').textContent).toContain('0 من 6');
    expect(screen.getByText('لا توجد حالات ضمن الفلاتر المختارة.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'عرض كل الحالات' })); expect(screen.getByRole('status').textContent).toContain('6 من 6');
  });
  it('intersects owner and search, reveals original evidence, resets without losing the chosen section', () => {
    const report = source(); render(<ExecutiveReportView report={report} />);
    fireEvent.click(screen.getByRole('tab', { name: 'متابعة القرارات' }));
    fireEvent.change(screen.getByLabelText('المدير'), { target: { value: '11' } }); expect(screen.getByRole('status').textContent).toContain('2 من 6');
    fireEvent.change(screen.getByLabelText('البحث في القرارات'), { target: { value: 'اكتمال' } }); expect(screen.getByRole('status').textContent).toContain('1 من 6');
    const headline = report.decisions[0].decision.split(/[؛.!؟]/u)[0];
    const summary = screen.getByLabelText(`تفاصيل القرار: ${headline}`); fireEvent.click(summary);
    expect(summary.closest('details').open).toBe(true); expect(screen.getByText(report.decisions[0].caseId)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'المراجعة الأسبوعية' })); fireEvent.click(screen.getByRole('tab', { name: 'متابعة القرارات' }));
    expect(screen.getByLabelText('المدير').value).toBe('11'); expect(screen.getByLabelText('البحث في القرارات').value).toBe('اكتمال');
    fireEvent.click(screen.getByRole('button', { name: 'مسح التصفية' })); expect(screen.getByRole('status').textContent).toContain('6 من 6');
    expect(screen.getByRole('tab', { name: 'متابعة القرارات' }).getAttribute('aria-selected')).toBe('true');
  });
});
