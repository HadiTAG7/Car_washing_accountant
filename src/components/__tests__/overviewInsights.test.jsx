// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import OverviewBusinessInsights from '../OverviewBusinessInsights';
import OverviewOperationalAttention from '../OverviewOperationalAttention';
import { overviewOperations } from '../../lib/overviewDashboard';

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
it('supports month-keyed saved counts, explicit zero and warning differences without database writes', () => {
  const d = data(); const navigate = vi.fn();
  const { rerender } = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" onNavigate={navigate} />);
  const input = screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase');
  expect(screen.getByRole('status').textContent).toContain('الحقل الفارغ لا يعني صفرًا');
  fireEvent.change(input, { target: { value: '٣' } });
  expect(screen.getByRole('status').textContent).toContain('+2'); expect(screen.getByRole('status').className).toContain('warning');
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-09" washReady language="ar" />);
  expect(input.value).toBe('');
  rerender(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" onNavigate={navigate} />);
  expect(input.value).toBe('٣'); fireEvent.change(input, { target: { value: '1' } });
  expect(screen.getByRole('status').textContent).toContain('متطابق');
  fireEvent.change(input, { target: { value: '0' } }); expect(screen.getByRole('status').textContent).toContain('-1');
  fireEvent.change(input, { target: { value: '-1' } }); expect(input.getAttribute('aria-invalid')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'تفاصيل تسويات سويتر' })); expect(navigate).toHaveBeenCalledWith('sweater_settlements');
});
it('shows missing fields honestly, separates tips and marks estimated payroll', () => {
  render(<OverviewBusinessInsights data={data()} periodKey="2026-10" washReady language="ar" />);
  expect(card('استغلال الطاقة').textContent).toContain('10%'); expect(card('البقشيش').textContent).toContain('غير متاح');
  expect(card('استغلال الطاقة').textContent).toContain('تقريبي · على أيام الغسيل، مو الحضور');
  expect(card('رصيد صندوق العمل المالي').textContent).toContain('ليس حسابًا نقديًا');
  expect(card('تكلفة الغسلة').textContent).toContain('تقديري');
  expect(card('الدفعة المتوقعة من سويتر').textContent).toContain('لم تُسجّل تسوية');
  expect(card('الخصومات والتعويضات').textContent).toContain('غير مسجلة');
  expect(card('الخصومات والتعويضات').textContent).not.toContain('0.00');
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
it('restores the correct month after remount and does not persist invalid edits over a saved valid number', () => {
  const d = data();
  let view = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  fireEvent.change(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase'), { target: { value: '٣٨٢' } });
  view.unmount();
  view = render(<OverviewBusinessInsights data={d} periodKey="2026-09" washReady language="ar" />);
  expect(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase').value).toBe('');
  fireEvent.change(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase'), { target: { value: '25' } });
  view.unmount();
  view = render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase').value).toBe('382');
  fireEvent.change(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase'), { target: { value: '-1' } });
  view.unmount();
  render(<OverviewBusinessInsights data={d} periodKey="2026-10" washReady language="ar" />);
  expect(screen.getByLabelText('عدد غسلات الشهر حسب سويتر — Metabase').value).toBe('382');
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
