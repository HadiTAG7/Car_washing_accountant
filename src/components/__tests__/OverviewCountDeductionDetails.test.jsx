// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OverviewCountDeductionDetails from '../OverviewCountDeductionDetails';
import { overviewSweaterMetrics } from '../../lib/overviewInsights';
import { composeSweaterMetricReadings } from '../../lib/sweaterMetricReadings';

afterEach(cleanup);
const row = (extra = {}) => ({ metricKey: 'freeWashCompensation', sourceId: 'TEST-ticket', bookingId: 'TEST-booking', driverExternalId: 'TEST-A',
  date: '2026-10-20', quantity: 2, amount: null, reason: 'Verified source reason', sourceUrl: 'https://ssp-portal.sweater.sa/tickets/TEST-ticket', ...extra });
const bikers = [{ id: 'a', driverExternalId: 'TEST-A', name: 'بايكر اختبار', nameEnglish: 'Test biker' }];

it.each(['ar', 'en'])('opens source event details with real quantities, missing money, source links and financial separation (%s)', language => {
  const rows = [row()]; const before = JSON.stringify(rows);
  const { container } = render(<OverviewCountDeductionDetails item={{ key: 'freeWashCompensation', value: 9 }} label="TEST category" rows={rows}
    sourceTime="TEST original cut 26 October 00:28 Riyadh" bikers={bikers} periodKey="2026-10" language={language} />);
  const disclosure = container.querySelector('details'); expect(disclosure.open).toBe(false);
  fireEvent.click(container.querySelector('summary')); expect(disclosure.open).toBe(true);
  expect(disclosure.textContent).toContain('TEST original cut');
  expect(disclosure.textContent).toContain(language === 'ar' ? 'المفصل من العدد: 2 / 9' : 'Itemized units: 2 / 9');
  expect(disclosure.textContent).toContain(language === 'ar' ? 'بلا تفاصيل: 7' : 'Without details: 7');
  expect(disclosure.textContent).toContain(language === 'ar' ? 'بايكر اختبار' : 'Test biker');
  expect(disclosure.textContent).toContain('TEST-A'); expect(disclosure.textContent).toContain('TEST-booking');
  expect(disclosure.textContent).toContain('Verified source reason');
  expect(disclosure.textContent).toContain(language === 'ar' ? 'المبلغ المبيّن في سويتر: غير متاح' : 'Amount shown in Sweater: Unavailable');
  expect(disclosure.textContent).not.toContain('0.00');
  expect(disclosure.textContent).toContain(language === 'ar' ? 'لا تثبت اعتمادًا في الدفتر، أو خصم راتب' : 'does not establish ledger approval, a payroll deduction');
  expect(screen.getByRole('link').getAttribute('href')).toBe(rows[0].sourceUrl);
  expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer');
  expect(JSON.stringify(rows)).toBe(before);
});

it.each(['freeWashCompensation', 'cancelledByBiker', 'cancelledMaintenance'])('explains old aggregate-only readings without inventing event evidence (%s)', key => {
  const snapshot = { id: 'old', periodKey: '2026-10', extractedAtIso: '2026-10-26T00:28:00+03:00', metrics: { [key]: 9 } };
  const source = overviewSweaterMetrics(composeSweaterMetricReadings([snapshot], snapshot.periodKey));
  const { container } = render(<OverviewCountDeductionDetails item={{ key, value: 9 }} label={key} rows={source.countDetails[key]} language="ar" periodKey="2026-10" />);
  fireEvent.click(container.querySelector('summary'));
  expect(screen.getByRole('status').textContent).toContain('ما وصلت تفاصيل مرتبطة بهذه القراءة');
  expect(container.textContent).toContain('0 / 9'); expect(container.textContent).toContain('بلا تفاصيل: 9');
  expect(screen.queryByRole('link')).toBeNull(); expect(container.querySelector('ol')).toBeNull();
});

it('keeps explicit zero money distinct from unknown money, date, biker and reason', () => {
  const rows = [row({ driverExternalId: null, date: null, bookingId: null, amount: 0, reason: null })];
  const { container } = render(<OverviewCountDeductionDetails item={{ key: 'freeWashCompensation', value: 2 }} label="TEST" rows={rows} bikers={bikers} periodKey="2026-10" language="ar" />);
  expect(container.textContent).toContain('0.00'); expect(container.textContent).toContain('اسم البايكر غير متاح');
  expect(container.textContent).toContain('تاريخ الواقعة: غير متاح'); expect(container.textContent).toContain('السبب في المصدر: غير متاح');
  expect(container.textContent).not.toContain('بايكر اختبار'); expect(container.textContent).not.toContain('تفاصيل جزئية');
});

it('does not guess a biker name when registry IDs conflict', () => {
  const { container } = render(<OverviewCountDeductionDetails item={{ key: 'freeWashCompensation', value: 2 }} label="TEST" rows={[row()]}
    bikers={[...bikers, { ...bikers[0], id: 'b', name: 'another' }]} periodKey="2026-10" language="ar" />);
  expect(container.textContent).toContain('اسم البايكر غير متاح'); expect(container.textContent).not.toContain('بايكر اختبار');
});
