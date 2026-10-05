// Payroll expense belongs to the earned month. Cash and advance movements
// keep their actual journal dates; this projection is only used by the P&L.
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));

export function payrollExpensePeriod(entry, entriesById) {
  const original = entriesById.get(entry.reversesEntryId || entry.reversalOf);
  const source = original || entry;
  if (![source.sourceType, source.sourceKind].some(kind => ['payroll', 'payroll_reversal'].includes(kind))) return null;
  const snapshot = source.payrollSnapshot?.periodKey;
  if (validMonth(snapshot)) return { periodKey: snapshot, basis: 'payroll_snapshot' };
  const match = /^(\d{4}-(?:0[1-9]|1[0-2]))__r[1-9]\d*$/.exec(String(source.sourceId || ''));
  return match ? { periodKey: match[1], basis: 'payroll_run_id' } : null;
}

export function payrollRecognitionDate(periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  return `${periodKey}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
}
