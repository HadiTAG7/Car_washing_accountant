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
  // One wash / (20 completed days × 29/31): the same 31% company coverage.
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
  expect(second.textContent).not.toMatch(/البايكرية المحسوبون/);
  expect(second.querySelector('small').textContent).toContain('للمعلومة فقط');
  expect(second.textContent).toContain('تحت نقطة التعادل'); expect(second.className).toContain('sw-overview-insight--bad');
  expect(second.textContent).toContain('التغطية: 31%');
  expect(second.textContent).toContain('متوسط الغسلات في أيام الغسيل: 1');
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
it.each(['ar', 'en'])('keeps separate source times after partial snapshots and does not stamp older tips/washes as fresh (%s)', language => {
  const d = data();
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([
    { ...october, extractedAtIso: '2026-10-23T06:00:00Z', metrics: { completedWashes: 480, tipsNet: 68 } },
    { ...october, extractedAtIso: '2026-10-23T07:00:00Z', metrics: { violations: 530, damages: 0, compensations: 0 } },
  ], '2026-10'), loading: false, error: null };
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  const tips = card(language === 'ar' ? 'البقشيش' : 'Tips');
  const deductions = card(language === 'ar' ? 'الخصومات والتعويضات' : 'Deductions and compensation');
  expect(tips.querySelector('h3').title).toMatch(/9:00|09:00/);
  expect(tips.querySelector('h3').title).not.toContain('10:00');
  expect(deductions.querySelector('h3').title).toContain('10:00');
  expect(deductions.querySelector('h3').title).not.toMatch(/9:00|09:00/);
  expect(deductions.querySelector('strong').textContent).toContain('530.00');
  expect(tips.querySelector('strong').textContent).toContain('68.00');
  expect(screen.queryByRole('region', { name: language === 'ar' ? 'مطابقة الغسلات مع سويتر' : 'Sweater wash reconciliation' })).toBeNull();
});
it('dates each compensation item when that group contains readings taken at different times', () => {
  const d = data();
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([
    october,
    { ...october, extractedAtIso: '2026-10-23T07:00:00Z', metrics: { violations: 535 } },
  ], '2026-10'), loading: false, error: null };
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="en" />);
  fireEvent.click(within(card('Deductions and compensation')).getByRole('button', { name: 'Deductions and compensation' }));
  const items = within(screen.getByRole('dialog')).getAllByRole('listitem');
  expect(items.find(item => item.textContent.includes('Violations')).textContent).toContain('10:00');
  expect(items.find(item => item.textContent.includes('Damages')).textContent).toContain('08:00');
  expect(card('Deductions and compensation').querySelector('h3').title).toContain('each item retains its time');
});
it('keeps the stored numbers while removing wash reconciliation and opening itemized money details', () => {
  const d = data(); d.sweaterMetrics = { snapshot: october, loading: false, error: null }; const navigate = vi.fn();
  const before = JSON.stringify(d);
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" onNavigate={navigate} />);
  expect(screen.queryByRole('region', { name: 'مطابقة الغسلات مع سويتر' })).toBeNull();
  expect(screen.queryByText(/Metabase/)).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  const tips = card('البقشيش');
  expect(tips.querySelector('strong').textContent).toContain('68.00'); expect(tips.textContent).not.toContain('منفصل عن الإيراد');
  expect(tips.querySelector('h3').title).toContain('آخر تحديث من سويتر');
  const deductions = card('الخصومات والتعويضات');
  expect(deductions.querySelector('strong').textContent).toContain('530.00');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(within(deductions).getByRole('button', { name: 'الخصومات والتعويضات' }));
  const dialog = screen.getByRole('dialog');
  const [taken, added] = within(dialog).getAllByRole('list');
  expect([...taken.children].map(li => (li.querySelector('summary')?.textContent.replace('عرض التفاصيل', '') || li.textContent).replace(/\s+/g, ' ').replace(/[\u200e\u200f]/g, '')))
    .toEqual(['المخالفات530.00 ر.س', 'الأضرار0.00 ر.س', 'التعويضات0.00 ر.س', 'غسلات مجانية تعويض8', 'إلغاء من البايكر13', 'إلغاء بسبب الصيانة4']);
  expect(added.textContent).toBe('إلغاء من العميل10');
  expect(deductions.textContent).toContain('المعتمد في الدفتر: غير مسجلة');
  expect(dialog.textContent).toContain('دون أسماء أو حجوزات');
  expect(dialog.textContent).not.toContain('عامل اختبار');
  fireEvent.click(within(dialog).getByRole('button', { name: 'تفاصيل تسويات سويتر' })); expect(navigate).toHaveBeenCalledWith('sweater_settlements');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.stringify(d)).toBe(before);
  expect(screen.queryByRole('heading', { name: 'رصيد صندوق العمل المالي' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'الفلوس والمواعيد' })).toBeNull();
  expect(deductions.textContent).not.toContain('من لوحة Compensations');
});
it('without Sweater data says so instead of zero, item by item', () => {
  const d = data(); d.sweaterMetrics = { snapshot: null, loading: false, error: null };
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  for (const box of [card('البقشيش'), card('الخصومات والتعويضات')]) expect(box.querySelector('strong').textContent).toBe('ما وصلت بيانات سويتر');
  expect(screen.queryByRole('region', { name: 'مطابقة الغسلات مع سويتر' })).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  d.sweaterMetrics = { snapshot: { ...october, metrics: { completedWashes: 480 } }, loading: false, error: null };
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('البقشيش').querySelector('strong').textContent).toBe('ما وصلت بيانات سويتر');
  fireEvent.click(within(card('الخصومات والتعويضات')).getByRole('button', { name: 'الخصومات والتعويضات' }));
  expect(within(screen.getByRole('dialog')).getAllByRole('listitem').every(li => li.textContent.includes('ما وصلت بيانات سويتر'))).toBe(true);
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
  d.sweaterMetrics = { snapshot: null, loading: false, error: new Error('denied') };
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(card('البقشيش').querySelector('strong').textContent).toBe('تعذّرت قراءة أرقام سويتر');
});
it('removes the selected explanations without changing the displayed calculations', () => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language="ar" />);
  expect(card('الإنتاج مقارنة بالطاقة اليومية').textContent).toContain('0.67%'); expect(card('البقشيش').textContent).toContain('ما وصلت بيانات سويتر');
  expect(card('الإنتاج مقارنة بالطاقة اليومية').textContent).not.toContain('تقريبي · على أيام الغسيل، مو الحضور');
  expect(card('تكلفة الغسلة').querySelector('small')).toBeNull();
  expect(card('تكلفة الغسلة').textContent).not.toContain('تقديري');
  expect(card('توقع نهاية الشهر').querySelector('small')).toBeNull();
  expect(card('توقع نهاية الشهر').textContent).not.toContain('الأيام غير المكتملة المتبقية');
  expect(screen.queryByRole('heading', { name: 'الفلوس والمواعيد' })).toBeNull();
  expect(card('الدفعة المتوقعة من سويتر').textContent).toContain('تقدير غير معتمد');
  expect(card('الخصومات والتعويضات').textContent).toContain('غير مسجلة');
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
});
it.each(['ar', 'en'])('labels daily capacity clearly and displays eight assumed washes per biker (%s)', language => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language={language} />);
  const box = card(language === 'ar' ? 'الإنتاج مقارنة بالطاقة اليومية' : 'Output vs daily capacity');
  expect(box.querySelector('strong').textContent).toBe('0.67%');
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
  expect(dialog.textContent).toContain('1984'); expect(dialog.textContent).toContain('0.67%');
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
it.each(['ar', 'en'])('shows tip recipients and source precision without turning rounded rows into a new total (%s)', language => {
  const d = data();
  const allocations = [{ driverExternalId: '1984', netAmount: 4.875 }, { driverExternalId: '1986', netAmount: 39 },
    { driverExternalId: '1989', netAmount: 19.5 }, { driverExternalId: '1998', netAmount: 34.125 },
    { driverExternalId: '2009', netAmount: 14.625 }, { driverExternalId: '2007', netAmount: 0 }];
  d.sweaterMetrics = { snapshot: { ...october, metrics: { tipsNet: 112.13 }, tipsByBiker: allocations }, loading: false };
  d.workers.bikers = [biker, { id: 'b2', name: 'عامل ثان', driverExternalId: '1986' }];
  const before = JSON.stringify(d);
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  const opener = screen.getByRole('button', { name: language === 'ar' ? 'البقشيش' : 'Tips', exact: true });
  expect(card(language === 'ar' ? 'البقشيش' : 'Tips').textContent).toContain(language === 'ar' ? 'عرض البايكرية والمبالغ' : 'View bikers and amounts');
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole('dialog'), table = within(dialog).getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(6);
  expect(table.textContent).toContain('4.875'); expect(table.textContent).toContain('34.125'); expect(table.textContent).toContain('14.625');
  expect(table.textContent).toContain('عامل اختبار'); expect(table.textContent).toContain('عامل ثان');
  expect(table.textContent).not.toContain('2007'); // Zero is stored, but not a recipient.
  expect(dialog.textContent).toContain('112.13'); expect(dialog.textContent).not.toContain('112.14');
  expect(dialog.textContent).toContain(language === 'ar' ? 'لا يعني صرفه' : 'not proof of payment');
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
  expect(JSON.stringify(d)).toBe(before);
});
it('does not guess a tip recipient from duplicate mappings or mismatched source totals', () => {
  const d = data(); d.workers.bikers = [biker, { ...biker, id: 'other', name: 'عامل آخر' }];
  d.sweaterMetrics = { snapshot: { ...october, metrics: { tipsNet: 68 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 68 }] } };
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  fireEvent.click(screen.getByRole('button', { name: 'البقشيش', exact: true }));
  expect(screen.getByRole('dialog').textContent).toContain('الاسم غير مربوط');
  expect(screen.getByRole('dialog').textContent).not.toContain('عامل اختبار');
  d.sweaterMetrics.snapshot.tipsByBiker[0].netAmount = 67;
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(within(screen.getByRole('dialog')).queryByRole('table')).toBeNull();
  expect(screen.getByRole('dialog').textContent).toContain('المحفوظ إجمالي فقط');
});
it('separates named internal records from aggregate Sweater deductions and pending approvals', () => {
  const d = data(); d.sweaterMetrics = { snapshot: october };
  d.adjustments.items = [{ id: 'approved', periodKey: '2026-10', effectiveDate: '2026-10-19', kind: 'deduction', typeKey: 'operational_or_traffic_violation',
    driverExternalId: '1984', amount: 25, approvalStatus: 'approved', sspBookingId: 'S-123' },
  { id: 'pending', periodKey: '2026-10', effectiveDate: '2026-10-20', kind: 'deduction', typeKey: 'proven_damage', amount: 50, approvalStatus: 'pending_review' },
  { id: 'different-month', periodKey: '2026-09', effectiveDate: '2026-09-20', kind: 'deduction', typeKey: 'proven_damage', amount: 99, approvalStatus: 'approved', driverName: 'شهر آخر' }];
  const before = JSON.stringify(d);
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  fireEvent.click(screen.getByRole('button', { name: 'الخصومات والتعويضات', exact: true }));
  const dialog = screen.getByRole('dialog'), table = within(dialog).getByRole('table');
  expect(dialog.textContent).toContain('530.00');
  expect(table.textContent).toContain('عامل اختبار'); expect(table.textContent).toContain('S-123'); expect(table.textContent).toContain('25.00');
  expect(table.textContent).toContain('50.00'); expect(table.textContent).toContain('بانتظار المراجعة');
  expect(table.textContent).toContain('البايكر غير محدد في السجل'); expect(table.textContent).not.toContain('شهر آخر');
  expect(dialog.textContent).toContain('لا ننسب المبلغ لبايكر بالتخمين');
  expect(JSON.stringify(d)).toBe(before);
});
it.each(['ar', 'en'])('does not present an unresolved saved settlement as a confirmed zero payment (%s)', language => {
  const d = data(); const row = { id: 's', periodKey: '2026-10', status: 'calculated', figures: { netDue: 0, counts: { eligible: 0, needsReview: 2, unknownStatus: 1 } } };
  d.settlements.items = [row];
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  const box = card(language === 'ar' ? 'الدفعة المتوقعة من سويتر' : 'Expected Sweater payment');
  expect(box.querySelector('strong').textContent).toContain('20.00');
  expect(box.textContent).toContain(language === 'ar' ? 'تقدير غير معتمد' : 'Unapproved estimate');
  expect(box.textContent).toContain(language === 'ar' ? 'قبل الضريبة والخصومات والإضافات' : 'before VAT, deductions and additions');
  expect(row.figures.netDue).toBe(0); // No recalculation or saved-record mutation.
  d.settlements.items = [{ ...row, figures: { netDue: 0, counts: { eligible: 1, needsReview: 0, unknownStatus: 0 } } }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  expect(box.querySelector('strong').textContent).toContain('0.00');
});
it('places the provisional payment beside tips and deductions, without mixing count adjustments into money', () => {
  const d = data();
  d.sweaterMetrics = { snapshot: october, loading: false, error: null };
  const before = JSON.stringify(d);
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  const payment = card('الدفعة المتوقعة من سويتر');
  expect(payment.parentElement).toBe(card('البقشيش').parentElement);
  expect(payment.parentElement).toBe(card('الخصومات والتعويضات').parentElement);
  expect(payment.querySelector('strong').textContent).toContain('20.00');
  expect(payment.textContent).toContain('2026-10-01 — 2026-10-21');
  expect(JSON.stringify(d)).toBe(before);
  d.settlements.items = [{ periodKey: '2026-10', figures: { netDue: 17 } }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(payment.querySelector('strong').textContent).toContain('17.00');
  expect(payment.textContent).not.toContain('تقدير غير معتمد');
});
it('does not invent an estimate during wash failure, settlement failure or conflicting settlement sources', () => {
  const d = data();
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady={false} language="ar" />);
  const payment = card('الدفعة المتوقعة من سويتر');
  expect(payment.querySelector('strong').textContent).toBe('غير متاح');
  d.settlements.error = new Error('failed');
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(payment.querySelector('strong').textContent).toBe('غير متاح');
  d.settlements.error = null;
  d.settlements.items = [{ periodKey: '2026-10' }, { periodKey: '2026-10' }];
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(payment.querySelector('strong').textContent).toBe('غير متاح');
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
it.each(['ar', 'en'])('shows reconciled source cases by biker with reasons and original links (%s)', language => {
  const d = data();
  const cases = [
    { sourceId: 'case-a', driverExternalId: '1984', amount: 150 },
    { sourceId: 'case-b', driverExternalId: '1984', amount: 50 },
    { sourceId: 'case-c', driverExternalId: 'TEST-B', amount: 30 },
  ].map(row => ({ metricKey: 'violations', date: '2026-10-20', category: 'Damaged Motorcycle Stickers', bookingId: null,
    sourceUrl: `https://ssp-portal.sweater.sa/violations/${row.sourceId}`, ...row }));
  d.workers.bikers.push({ id: 'b2', driverExternalId: 'TEST-B', name: 'عامل ثان', nameEnglish: 'Second worker' });
  d.sweaterMetrics = { snapshot: composeSweaterMetricReadings([{ ...october, metrics: { violations: 230 }, deductionDetails: cases }], '2026-10') };
  const before = JSON.stringify(d);
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language={language} />);
  fireEvent.click(within(card(language === 'ar' ? 'الخصومات والتعويضات' : 'Deductions and compensation')).getByRole('button'));
  const dialog = screen.getByRole('dialog');
  const table = within(dialog).getByRole('table', { name: language === 'ar' ? 'الخصومات حسب البايكر' : 'Deductions by biker' });
  expect(table.textContent).toContain('200.00'); expect(table.textContent).toContain('30.00');
  expect(table.textContent).toContain('1984'); expect(table.textContent).toContain('TEST-B');
  expect(within(dialog).getByText(language === 'ar' ? 'عرض كل مخالفة وسببها' : 'View each violation and its reason')).toBeTruthy();
  const links = dialog.querySelectorAll('a[target="_blank"]');
  expect(links).toHaveLength(3); expect(links[0].getAttribute('href')).toMatch(/^https:\/\/ssp-portal.sweater.sa\/violations\/case-/);
  expect(dialog.textContent).toContain(language === 'ar' ? 'هذا ليس خصمًا معتمدًا من الراتب' : 'This is not an approved payroll deduction');
  expect(JSON.stringify(d)).toBe(before);
});
