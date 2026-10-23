// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BreakEvenCells, BreakEvenReconciliation, IdleSalariesCard } from '../BikerBreakEven';
import { bikerBreakEven } from '../../lib/breakEven';
import { formatCurrencyPrecise as sar } from '../../data/initialData';

afterEach(cleanup);
const line = (bikerId, basicDue, daysEntitled = 31) => ({ bikerId, name: bikerId, basicDue, bonus: 0, deduction: 0, daysEntitled, monthDays: 31 });
const bikers = [{ id: 'a', name: 'غاسل' }, { id: 'b', name: 'بلا غسلات' }, { id: 'c', name: 'متأخر' }];
// a washed; b and c are paid with no wash (c for 8 days). Washers basis, the default.
const state = (washes = [{ bikerId: 'a', washDate: '2026-10-01', quantity: 5 }]) => ({ status: 'ready', value: bikerBreakEven({
  statement: { totalCosts: 3000 }, payrollLines: [line('a', 900), line('b', 900), line('c', 232.26, 8)], washes, bikers, periodKey: '2026-10', today: '2026-10-23' }) });
const cells = (s, bikerId) => {
  render(<table><tbody><tr><BreakEvenCells state={s} bikerId={bikerId} /></tr></tbody></table>);
  return [...document.querySelectorAll('td')];
};

it('the card counts the salaries paid without a wash and the daily break-even without them', () => {
  render(<IdleSalariesCard state={state()} monthLabel="أكتوبر 2026" />);
  const card = screen.getByRole('region', { name: 'رواتب بايكرية بلا غسلات' });
  expect(card.textContent).toMatch(/العدد\s*2/);
  expect(card.textContent).toContain(sar(1132.26));
  // 3000 ÷ 20 ÷ 31, and (3000 − 1132.26) ÷ 20 ÷ 31.
  expect(card.textContent).toContain('4.84'); expect(card.textContent).toContain('3.01');
  expect(card.textContent).toContain('بلا غسلات'); expect(card.textContent).toContain('8 يومًا');
});

it('no card when everyone paid has washed, or before the figures are ready', () => {
  const all = ['a', 'b', 'c'].map(bikerId => ({ bikerId, washDate: '2026-10-02', quantity: 1 }));
  const { container } = render(<IdleSalariesCard state={state(all)} monthLabel="أكتوبر 2026" />);
  expect(container.textContent).toBe('');
  render(<IdleSalariesCard state={{ status: 'loading' }} monthLabel="أكتوبر 2026" />);
  expect(screen.queryByRole('region', { name: 'رواتب بايكرية بلا غسلات' })).toBeNull();
});

it('a washer carries the month; a biker paid without a wash shows no figures of their own', () => {
  const s = state();
  // a: 900 direct + 2100 shared = 3000 → 150 a month ÷ 29 work days = 5.17; actual 5 → 97%.
  const a = cells(s, 'a');
  expect(a.map(td => td.textContent)).toEqual([sar(900), sar(2100), '150', '5.17', '5', '97%']);
  cleanup();
  const b = cells(s, 'b');
  expect(b.map(td => td.textContent)).toEqual(['—', '—', '—', '—', 'لا غسلات', '—']);
  expect(b[0].title).toContain('ضمن التكاليف المشتركة على من غسلوا');
  cleanup();
  expect(cells(s, 'z')[0].title).toContain('غير مدرج في مسير الشهر');
});

it('the reconciliation names the carriers and the salaries without washes inside the shared costs', () => {
  render(<BreakEvenReconciliation state={state()} monthLabel="أكتوبر 2026" />);
  const box = screen.getByRole('region', { name: 'مطابقة نقطة التعادل' });
  expect(box.textContent).toContain('من غسلوا (1)'); expect(box.textContent).toContain('= إجمالي مصروفات الشهر');
  expect(box.textContent).toContain(`(منها رواتب بلا غسلات ${sar(1132.26)})`);
  expect(box.textContent).toContain('«حسب المسير» خيار في الإعدادات');
  expect(screen.queryByRole('alert')).toBeNull();
});
