import { isRealCalendarDate } from './vatFields.js';

// Legacy imports contain YYYY-M-D. Only pad an unambiguous, real calendar
// date: never parse a locale date, roll an impossible day, or substitute today.
export function normalizeExpenseDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value ?? ''));
  if (!match) return value;
  const canonical = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return isRealCalendarDate(canonical) ? canonical : value;
}

export function variableExpenseDateProblems({ loggedDate, invoiceDate } = {}) {
  const problems = [];
  const valid = value => {
    const date = normalizeExpenseDate(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) && isRealCalendarDate(date);
  };
  if (!valid(loggedDate)) {
    problems.push({ field: 'loggedDate', message: 'اختر تاريخ صرف صحيحاً؛ لا يمكن حفظ المصروف دون تاريخ موجود في التقويم.' });
  }
  // A stored invoice date still governs recognition even when VAT is off.
  if (invoiceDate && !valid(invoiceDate)) {
    problems.push({ field: 'invoiceDate', message: 'تاريخ الفاتورة المحفوظ غير صالح؛ صحّحه من المستند قبل الحفظ.' });
  }
  return problems;
}

export function checkedVariableExpenseDates(row) {
  const problems = variableExpenseDateProblems({ loggedDate: row.logged_date, invoiceDate: row.invoice_date });
  if (problems.length) throw new Error(problems.map(p => p.message).join(' '));
  return { ...row, logged_date: normalizeExpenseDate(row.logged_date),
    ...(row.invoice_date !== undefined ? { invoice_date: normalizeExpenseDate(row.invoice_date) } : {}) };
}
