// Overview-only assumptions. These never change accounting, pricing or payroll.
export const OVERVIEW_SETTINGS = Object.freeze({
  washNetPrice: 20,
  dailyAppointmentsPerBiker: 10,
  shortWashMinutes: 10,
  documentWarningDays: 30,
  forecastWindowDays: 7,
  statementDay: 5,
  metabaseStoragePrefix: 'sweater:overview:metabase:v1:',
});
