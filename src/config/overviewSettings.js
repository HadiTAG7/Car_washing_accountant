// Overview-only assumptions. These never change accounting, pricing or payroll.
export const OVERVIEW_SETTINGS = Object.freeze({
  washNetPrice: 20,
  // A biker's daily capacity: utilization and the break-even «فوق الطاقة» flag.
  dailyAppointmentsPerBiker: 10,
  // Break-even per biker: days off a month (prorated for a partial month), and
  // how costs with no biker on record are shared ('equal' per eligible day).
  monthlyDaysOff: 2,
  fixedCostAllocation: 'equal',
  shortWashMinutes: 10,
  documentWarningDays: 30,
  forecastWindowDays: 7,
  statementDay: 5,
  metabaseStoragePrefix: 'sweater:overview:metabase:v1:',
});
