// Overview-only assumptions. These never change accounting, pricing or payroll.
export const OVERVIEW_SETTINGS = Object.freeze({
  washNetPrice: 20,
  // A biker's daily capacity: utilization and the break-even «فوق الطاقة» flag.
  dailyAppointmentsPerBiker: 8,
  // Break-even per biker: days off a month (prorated for a partial month), and
  // how costs with no biker on record are shared ('equal' per eligible day).
  monthlyDaysOff: 2,
  fixedCostAllocation: 'equal',
  // Who carries the month's full cost in break-even per biker: 'washers' (on the
  // payroll with a wash on a completed day of the month) or 'payroll' (everyone paid).
  bikerBreakEvenBasis: 'washers',
  // A biker whose status is one of these (alone or followed by more words, as in
  // «هرب مع الشريحة») has left; with no end date on record, the overview lists them.
  departedStatuses: ['هرب', 'مشيناه'],
  idleStoppedDays: 3,
  shortWashMinutes: 10,
  documentWarningDays: 30,
  forecastWindowDays: 7,
  statementDay: 5,
  // On returning to the overview, refresh only if its reading is this old.
  refreshOnReturnAfterMs: 5 * 60 * 1000,
});
