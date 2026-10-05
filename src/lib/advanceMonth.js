import { isRealCalendarDate } from './vatFields.js';
export const isAssignmentMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
// Legacy assignment follows the real payment date. Invalid explicit values
// do not silently move a debt into another payroll period.
export function advanceAssignmentMonth(row) {
  const explicit = row.assignment_month ?? row.assignmentMonth;
  if (explicit != null && explicit !== '') return isAssignmentMonth(explicit) ? explicit : null;
  const date = row.spent_date ?? row.spentDate;
  return isRealCalendarDate(date) ? date.slice(0, 7) : null;
}
export const OWNER_ADVANCE_MONTH_PLAN = Object.freeze({
  mode: 'owner_october_to_september', assignmentMonth: '2026-09',
  reason: 'إفادة هادي: كل السلف المسجلة بأكتوبر تخص سبتمبر، ولا توجد سلفة تخص أكتوبر.',
  rows: [
    ['l3QuiTnhigV9sThOOs7s', 200, '2026-10-02', 'recovered'],
    ['5QLaS8OyjOcSwUC4j4KS', 33, '2026-10-01', 'pending'],
    ['7haST3GOcmlSIo8ghW2T', 50, '2026-10-01', 'pending'],
    ['9898NXCTKOH581DzGjpT', 50, '2026-10-01', 'pending'],
    ['ClzUWhOEoaSfR0zIZ8vv', 50, '2026-10-01', 'pending'],
    ['HVv6iLGXM3syQ4zMkXSu', 50, '2026-10-01', 'pending'],
    ['Rj7b9N5p8c5boDObhe7J', 50, '2026-10-01', 'pending'],
    ['UjXalDqpn5U8xSaDjgZM', 33, '2026-10-01', 'pending'],
    ['eQ71YjGImxmtlrL7ogFq', 50, '2026-10-01', 'pending'],
    ['gNy4TzIUzzQdgM0tPVtC', 33, '2026-10-01', 'pending'],
  ],
});
