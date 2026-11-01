import { invalidateAllReads } from './readCache';

// Only the exact boolean selects the existing server's non-saving branch.
const READ_ONLY_OPERATIONS = new Set([
  'payrollPreview', 'payrollPreviews', 'payrollPreapproval', 'payrollReadStatus', 'payrollPreviewAdvanceMonth',
  'payrollPreviewPartialPayment', 'expenseCorrectionOptions', 'expensePreviewCorrection', 'sweaterPreviewAdministrativeCompletion',
  'supervisorOverview', 'supervisorRecords', 'partnerEligibilityGet', 'partnerInsights',
  'partnerProfile', 'sweaterPreviewImport', 'sweaterPreviewOwnerWashTax', 'sweaterBookingCleanupPreview', 'sweaterServiceTypeFillPreview',
  'sweaterListIntegrationKeys', 'sweaterServiceTypes', 'authBootstrapStatus',
]);
export function invalidateAfterServerCall(name, payload) {
  if (!READ_ONLY_OPERATIONS.has(name) && !(name === 'sweaterCalculateSettlement' && payload?.dryRun === true)) invalidateAllReads();
}
