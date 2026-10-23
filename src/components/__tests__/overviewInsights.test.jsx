// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import OverviewBusinessInsights from '../OverviewBusinessInsights';
import OverviewOperationalAttention from '../OverviewOperationalAttention';
import { overviewOperations } from '../../lib/overviewDashboard';
import { bikerBreakEven, dailyBreakEven, dailyBreakEvenDays } from '../../lib/breakEven';
import { composeSweaterMetricReadings } from '../../lib/sweaterMetricReadings';

afterEach(cleanup);
beforeEach(() => localStorage.clear());
const biker = { id: 'b1', name: 'عامل اختبار', driverExternalId: '1984', currentStatus: 'working', iqamaExpiry: '2026-11-01' };
const rows = [{ id: 'wash', sspBookingId: 'SSP', status: 'مكتملة', quantity: 1, bikerId: 'b1', bikerName: biker.name, washDate: '2026-10-20' }];
const data = () => ({ operations: overviewOperations({ washes: rows, bikers: [biker], periodKey: '2026-10', today: '2026-10-21' }),
  finance: { statement: { totalCosts: 100, netRevenue: 20, salaryAccrual: { estimated: true } } },
  adjustments: { items: [], loading: false, error: null }, settlements: { items: [], loading: false, error: null },
  bookings: { items: [{ record: { sspBookingId: 'SSP', serviceDate: '2026-10-20', driverExternalId: '1984', startedAt: '2026-10-20T09:00:00+03:00', completedAt: '2026-10-20T09:09:00+03:00' } }], loading: false, error: null },
  workers: { bikers: [biker] },
});
const card = title => screen.getByRole('heading', { name: title, exact: true }).closest('section');
it('shows the daily and per-biker break-even boxes from breakEven.js, red below and green at or above', () => {
  const d = data(); const navigate = vi.fn();
  // Costs 100: 100 ÷ 20 ÷ 31 = 0.16 a day; one wash on the 20th of 20 completed days = 0.05 a day.
  const daily = dailyBreakEven({ statement: d.finance.statement, periodKey: '2026-10', completeMonth: false });
  const days = dailyBreakEvenDays(d.operations.daily, daily.required);
  // b1 washed (1 on one day) and carries the month: 100 ÷ 20 ÷ 29 work days = 0.17 a day; coverage 580%.
  const perBiker = bikerBreakEven({ statement: d.finance.statement, washes: d.operations.rows, bikers: [biker], periodKey: '2026-10', today: '2026-10-21',
    payrollLines: [{ bikerId: 'b1', name: biker.name, basicDue: 50, bonus: 0, deduction: 0, daysEntitled: 31, monthDays: 31 }] });
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" onNavigate={navigate} breakEven={{ daily, days, perBiker }} />);
  const box = title => screen.getByRole('heading', { name: title, exact: true }).closest('section');
  const first = box('نقطة التعادل اليومية');
  expect(first.querySelector('strong').textContent).toBe('0.16 غسلة / يوم');
  expect(first.textContent).not.toMatch(/المتوسط الفعلي|الفرق|وصلها/);
  expect(first.querySelector('small')).toBeNull();
  expect(first.textContent).toContain('تحت نقطة التعادل'); expect(first.className).toContain('sw-overview-insight--bad');
  const second = box('نقطة التعادل لكل بايكر');
  expect(second.querySelector('strong').textContent).toBe('0.17 غسلة / يوم');
  expect(second.textContent).not.toMatch(/متوسط الفعلي لكل بايكر|التغطية|البايكرية المحسوبون/);
  expect(second.querySelector('small')).toBeNull();
  expect(second.textContent).toContain('وصل نقطة التعادل'); expect(second.className).toContain('sw-overview-insight--good');
  fireEvent.click(within(second).getByRole('button', { name: 'تفاصيل كل بايكر' })); expect(navigate).toHaveBeenCalledWith('bikers');
});

it.each(['ar', 'en'])('keeps the monthly target and remaining washes without the selected explanatory details (%s)', language => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language={language} />);
  const monthly = card(language === 'ar' ? 'نقطة التعادل' : 'Break-even');
  expect(monthly.querySelector('strong').textContent).toBe(language === 'ar' ? '5 غسلة / شهر' : '5 washes / month');
  expect(monthly.querySelector('p').textContent).toBe(language === 'ar' ? 'المتبقي للوصول: 4' : 'Washes to break even: 4');
  expect(monthly.querySelectorAll('p')).toHaveLength(1);
  expect(monthly.querySelector('small')).toBeNull();
});

it('break-even boxes stay neutral and unavailable without confirmed figures', () => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language="ar" />);
  for (const title of ['نقطة التعادل اليومية', 'نقطة التعادل لكل بايكر']) {
    const section = screen.getByRole('heading', { name: title, exact: true }).closest('section');
    expect(section.querySelector('strong').textContent).toBe('غير متاح');
    expect(section.className).not.toMatch(/--good|--bad/);
  }
});

const october = { periodKey: '2026-10', extractedAtIso: '2026-10-23T05:00:00.000Z', metrics: { completedWashes: 480, tipsNet: 68, violations: 530,
  damages: 0, compensations: 0, freeWashCompensation: 8, cancelledByCustomer: 10, cancelledByBiker: 13, cancelledMaintenance: 4 } };
const region = name => screen.getByRole('region', { name });
it.each(['ar', 'en'])('keeps separate source times after partial snapshots and does not stamp older tips/washes as fresh (%s)', language => {
  const d = data();
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([
    { ...october, extractedAtIso: '2026-10-23T06:00:00Z', metrics: { completedWashes: 480, tipsNet: 68 } },
    { ...october, extractedAtIso: '2026-10-23T07:00:00Z', metrics: { violations: 530, damages: 0, compensations: 0 } },
  ], '2026-10'), loading: false, error: null };
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  const tips = card(language === 'ar' ? 'البقشيش' : 'Tips');
  const deductions = card(language === 'ar' ? 'الخصومات والتعويضات' : 'Deductions and compensation');
  const washes = region(language === 'ar' ? 'مطابقة الغسلات مع سويتر' : 'Sweater wash reconciliation');
  expect(tips.querySelector('h3').title).toMatch(/9:00|09:00/);
  expect(tips.querySelector('h3').title).not.toContain('10:00');
  expect(washes.textContent).toMatch(/9:00|09:00/);
  expect(washes.textContent).not.toContain('10:00');
  expect(deductions.querySelector('h3').title).toContain('10:00');
  expect(deductions.querySelector('h3').title).not.toMatch(/9:00|09:00/);
  expect(deductions.querySelector('strong').textContent).toContain('530.00');
  expect(tips.querySelector('strong').textContent).toContain('68.00');
  expect(washes.querySelector('strong').textContent).toBe('480');
});
it('dates each compensation item when that group contains readings taken at different times', () => {
  const d = data();
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([
    october,
    { ...october, extractedAtIso: '2026-10-23T07:00:00Z', metrics: { violations: 535 } },
  ], '2026-10'), loading: false, error: null };
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="en" />);
  fireEvent.click(within(card('Deductions and compensation')).getByText('Deduction and addition details'));
  const items = within(card('Deductions and compensation')).getAllByRole('listitem');
  expect(items.find(item => item.textContent.includes('Violations')).textContent).toContain('10:00');
  expect(items.find(item => item.textContent.includes('Damages')).textContent).toContain('08:00');
  expect(card('Deductions and compensation').querySelector('h3').title).toContain('each item retains its time');
});
it('fills Sweater’s count, tips and itemized deductions from the latest reading, each with its time', () => {
  const d = data(); d.sweaterMetrics = { snapshot: october, loading: false, error: null }; const navigate = vi.fn();
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" onNavigate={navigate} />);
  const count = region('مطابقة الغسلات مع سويتر');
  expect(count.querySelector('strong').textContent).toBe('480');
  // One recorded wash in the fixture: Sweater − recorded = +479, flagged for reconciliation.
  expect(screen.getByRole('status').textContent).toContain('+479'); expect(screen.getByRole('status').className).toContain('warning');
  expect(count.textContent).toContain('آخر تحديث من سويتر'); expect(screen.queryByRole('textbox')).toBeNull();
  const tips = card('البقشيش');
  expect(tips.querySelector('strong').textContent).toContain('68.00'); expect(tips.textContent).not.toContain('منفصل عن الإيراد');
  expect(tips.querySelector('h3').title).toContain('آخر تحديث من سويتر');
  const deductions = card('الخصومات والتعويضات');
  expect(deductions.querySelector('strong').textContent).toContain('530.00');
  const disclosure = deductions.querySelector('details');
  expect(disclosure.open).toBe(false);
  fireEvent.click(within(deductions).getByText('تفاصيل الخصومات والإضافات'));
  expect(disclosure.open).toBe(true);
  const [taken, added] = within(deductions).getAllByRole('list');
  expect([...taken.querySelectorAll('li')].map(li => li.textContent.replace(/\s+/g, ' ').replace(/[\u200e\u200f]/g, '')))
    .toEqual(['المخالفات530.00 ر.س', 'الأضرار0.00 ر.س', 'التعويضات0.00 ر.س', 'غسلات مجانية تعويض8', 'إلغاء من البايكر13', 'إلغاء بسبب الصيانة4']);
  expect(added.textContent).toBe('إلغاء من العميل10');
  expect(deductions.textContent).toContain('المعتمد في الدفتر: غير مسجلة');
  fireEvent.click(within(deductions).getByRole('button', { name: 'تفاصيل تسويات سويتر' })); expect(navigate).toHaveBeenCalledWith('sweater_settlements');
  fireEvent.click(within(deductions).getByText('تفاصيل الخصومات والإضافات'));
  expect(disclosure.open).toBe(false);
  expect(screen.queryByRole('heading', { name: 'رصيد صندوق العمل المالي' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'الفلوس والمواعيد' })).toBeNull();
  expect(deductions.textContent).not.toContain('من لوحة Compensations');
});
it('without Sweater data says so instead of zero, item by item', () => {
  const d = data(); d.sweaterMetrics = { snapshot: null, loading: false, error: null };
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  for (const box of [card('البقشيش'), card('الخصومات والتعويضات')]) expect(box.querySelector('strong').textContent).toBe('ما وصلت بيانات سويتر');
  expect(region('مطابقة الغسلات مع سويتر').querySelector('strong').textContent).toBe('ما وصلت بيانات سويتر');
  expect(screen.queryByRole('status')).toBeNull();
  d.sweaterMetrics = { snapshot: { ...october, metrics: { completedWashes: 480 } }, loading: false, error: null };
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('البقشيش').querySelector('strong').textContent).toBe('ما وصلت بيانات سويتر');
  fireEvent.click(within(card('الخصومات والتعويضات')).getByText('تفاصيل الخصومات والإضافات'));
  expect(within(card('الخصومات والتعويضات')).getAllByRole('listitem').every(li => li.textContent.includes('ما وصلت بيانات سويتر'))).toBe(true);
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
  d.sweaterMetrics = { snapshot: null, loading: false, error: new Error('denied') };
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('البقشيش').querySelector('strong').textContent).toBe('تعذّرت قراءة أرقام سويتر');
});
it('removes the selected explanations without changing the displayed calculations', () => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language="ar" />);
  expect(card('الإنتاج مقارنة بالطاقة اليومية').textContent).toContain('12.5%'); expect(card('البقشيش').textContent).toContain('ما وصلت بيانات سويتر');
  expect(card('الإنتاج مقارنة بالطاقة اليومية').textContent).not.toContain('تقريبي · على أيام الغسيل، مو الحضور');
  expect(card('تكلفة الغسلة').querySelector('small')).toBeNull();
  expect(card('تكلفة الغسلة').textContent).not.toContain('تقديري');
  expect(card('توقع نهاية الشهر').querySelector('small')).toBeNull();
  expect(card('توقع نهاية الشهر').textContent).not.toContain('الأيام غير المكتملة المتبقية');
  expect(screen.queryByRole('heading', { name: 'الفلوس والمواعيد' })).toBeNull();
  expect(card('الدفعة المتوقعة من سويتر').textContent).toContain('لم تُسجّل تسوية');
  expect(card('الخصومات والتعويضات').textContent).toContain('غير مسجلة');
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
});
it.each(['ar', 'en'])('labels daily capacity clearly and displays eight assumed washes per biker (%s)', language => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language={language} />);
  const box = card(language === 'ar' ? 'الإنتاج مقارنة بالطاقة اليومية' : 'Output vs daily capacity');
  expect(box.querySelector('strong').textContent).toBe('12.5%');
  expect(box.querySelector('p bdi').textContent).toBe('8');
  expect(box.textContent).toContain(language === 'ar' ? 'غسلات / يوم' : 'washes / day');
  expect(screen.queryByRole('heading', { name: language === 'ar' ? 'استغلال الطاقة' : 'Capacity utilization' })).toBeNull();
});
it.each(['ar', 'en'])('opens capacity and tips details without navigation or record writes (%s)', language => {
  const d = data(); const navigate = vi.fn();
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([{ ...october, metrics: { tipsNet: 73.13 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 73.125 }] }], '2026-10'), loading: false };
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: language === 'ar' ? 'الإنتاج مقارنة بالطاقة اليومية' : 'Output vs daily capacity' }));
  let dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('1984'); expect(dialog.textContent).toContain('12.5%');
  expect(within(dialog).getByRole('table')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: language === 'ar' ? 'إغلاق التفاصيل' : 'Close details' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: language === 'ar' ? 'البقشيش' : 'Tips', exact: true }));
  dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('1984'); expect(dialog.textContent).toContain('عامل اختبار'); expect(dialog.textContent).toContain('73.13');
  expect(navigate).not.toHaveBeenCalled();
  expect(card(language === 'ar' ? 'البقشيش' : 'Tips').querySelector('p')).toBeNull();
});
it('does not attribute an aggregate-only or wrong-month tips snapshot to a biker', () => {
  const d = data(); d.sweaterMetrics = { snapshot: october, loading: false };
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  fireEvent.click(screen.getByRole('button', { name: 'البقشيش', exact: true }));
  expect(screen.getByRole('dialog').textContent).toContain('المحفوظ إجمالي فقط');
  expect(screen.getByRole('dialog').textContent).not.toContain('1984');
  d.sweaterMetrics.snapshot = { ...october, tipsByBiker: [{ driverExternalId: '1984', netAmount: 68 }] };
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-09" washReady language="ar" />);
  expect(screen.getByRole('dialog').textContent).not.toContain('1984');
});
it.each(['ar', 'en'])('does not present an unresolved saved settlement as a confirmed zero payment (%s)', language => {
  const d = data(); const row = { id: 's', periodKey: '2026-10', status: 'calculated', figures: { netDue: 0, counts: { eligible: 0, needsReview: 2, unknownStatus: 1 } } };
  d.settlements.items = [row];
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  const box = card(language === 'ar' ? 'الدفعة المتوقعة من سويتر' : 'Expected Sweater payment');
  expect(box.querySelector('strong').textContent).toBe(language === 'ar' ? 'تحتاج مراجعة' : 'Needs review');
  expect(row.figures.netDue).toBe(0); // No recalculation or saved-record mutation.
  d.settlements.items = [{ ...row, figures: { netDue: 0, counts: { eligible: 1, needsReview: 0, unknownStatus: 0 } } }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  expect(box.querySelector('strong').textContent).toContain('0.00');
});
it('distinguishes no records, explicit approved zero, pending deductions and credit-only records', () => {
  const d = data();
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('الخصومات والتعويضات').textContent).toContain('غير مسجلة');
  const row = { id: 'zero', periodKey: '2026-10', effectiveDate: '2026-10-20', kind: 'deduction', typeKey: 'customer_compensation', approvalStatus: 'approved', amount: 0 };
  d.adjustments.items = [row];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('الخصومات والتعويضات').textContent).toContain('0.00');
  d.adjustments.items = [{ ...row, amount: 25, approvalStatus: 'pending_review' }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('الخصومات والتعويضات').textContent).toContain('لا خصومات معتمدة');
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
  d.adjustments.items = [{ ...row, kind: 'compensation', amount: 25 }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('الخصومات والتعويضات').textContent).toContain('غير مسجلة');
});
it('does not display failed adjustment reads as zero, while operational forecasts still work', () => {
  const d = data(); d.adjustments.error = new Error('denied'); d.finance.statement = null;
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="en" />);
  expect(card('Deductions and compensation').textContent).toContain('Unavailable');
  expect(card('Cost per wash').textContent).toContain('Unavailable');
  expect(card('Month-end forecast').textContent).not.toContain('Unavailable');
});
it('shows only evidence-backed attention items and does not attribute an unfinished day to absence', () => {
  // b1 washed yesterday; b2 is active with no wash yesterday. Today is never listed.
  const d = data(); d.workers.bikers = [biker, { ...biker, id: 'b2', name: 'عامل ثان', driverExternalId: '2077' }];
  render(<OverviewOperationalAttention data={d} periodKey="2026-10" today="2026-10-21" washReady workerReady language="ar" />);
  expect(card('غسلات أقل من 10 دقائق').textContent).toContain('SSP'); expect(card('غسلات أقل من 10 دقائق').textContent).toContain('1984');
  expect(card('غسلات أقل من 10 دقائق').textContent).toContain('9');
  const idle = card('بايكر بلا غسلات مسجلة أمس');
  expect(idle.textContent).toContain('ليس إثبات غياب'); expect(idle.textContent).toContain('2077');
  expect(idle.textContent).toContain('2026-10-20'); expect(idle.textContent).not.toContain('1984');
  expect(idle.textContent).not.toContain('2026-10-21'); expect(idle.textContent).not.toContain('لم يكتمل');
  expect(card('إقامات تنتهي خلال 30 يومًا').textContent).toContain('2026-11-01');
});
it('lists departed bikers with no end date for review only, and links to the register', () => {
  const d = data(); const onNavigate = vi.fn();
  d.workers.bikers = [biker, { ...biker, id: 'r1', name: 'هارب بلا تاريخ', driverExternalId: '3001', currentStatus: 'هرب مع الشريحة', startDate: '2026-09-01' },
    { ...biker, id: 'r2', name: 'منتهي بتاريخ', driverExternalId: '3002', currentStatus: 'مشيناه', endDate: '2026-10-05' }];
  render(<OverviewOperationalAttention data={d} periodKey="2026-10" today="2026-10-21" washReady workerReady language="ar" onNavigate={onNavigate} />);
  const list = card('يحتاج تاريخ نهاية');
  expect(list.textContent).toContain('هارب بلا تاريخ'); expect(list.textContent).toContain('هرب مع الشريحة');
  expect(list.textContent).toContain('2026-09-01'); expect(list.textContent).toContain('لا يُعدَّل شيء');
  expect(list.textContent).not.toContain('منتهي بتاريخ'); expect(list.textContent).not.toContain('عامل اختبار');
  fireEvent.click(within(list).getByRole('button', { name: 'فتح سجل البايكر' }));
  expect(onNavigate).toHaveBeenCalledWith('bikers');
});
it('omits alerts when timestamps/expiry are missing rather than inferring a short wash or expired document', () => {
  const d = data(); d.bookings.items[0].record.startedAt = null; d.workers.bikers = [{ ...biker, iqamaExpiry: '' }];
  render(<OverviewOperationalAttention data={d} periodKey="2026-10" today="2026-10-21" washReady workerReady language="ar" />);
  expect(screen.queryByRole('heading', { name: 'غسلات أقل من 10 دقائق' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'إقامات تنتهي خلال 30 يومًا' })).toBeNull();
  fireEvent.click(screen.getByText('تغطية التنبيهات والبيانات الناقصة'));
  expect(screen.getByText(/sweater_bookings.record.startedAt/)).toBeTruthy();
});
it('does not mix pending deduction notices into approved totals', () => {
  const d = data(); d.adjustments.items = [{ id: 'v1', periodKey: '2026-10', effectiveDate: '2026-10-19', kind: 'deduction', typeKey: 'operational_or_traffic_violation', amount: 25, approvalStatus: 'pending_review', driverName: biker.name }];
  render(<OverviewOperationalAttention data={d} periodKey="2026-10" today="2026-10-21" washReady workerReady language="en" />);
  expect(within(card('Monthly violations and compensation')).getByText(/Pending \/ disputed/)).toBeTruthy();
});
