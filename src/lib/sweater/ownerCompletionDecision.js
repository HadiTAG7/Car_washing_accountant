// A single, explicitly authorized exception. This is not a cancellation policy.
export const OWNER_COMPLETION_TARGET = Object.freeze({
  sspBookingId: 'C-5584720', bookingNumber: '5584720', serviceDate: '2026-10-06',
  driverExternalId: '1984', rawStatus: 'Cancelled by Admin',
});
export const OWNER_COMPLETION_WORKER_ID = '2N4FP4rQAxXQ7rpuBrla';
const FIELDS = new Set(['source', 'ownerName', 'statement', 'approved', 'decision', ...Object.keys(OWNER_COMPLETION_TARGET)]);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;

export function ownerCompletionDecisionProblems(input) {
  const decision = input.ownerCompletionDecision;
  if (decision === undefined) return [];
  const record = input.records?.[0];
  const tax = input.ownerConfirmation;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)
    || Object.keys(decision).some(key => !FIELDS.has(key))
    || decision.source !== 'owner_statement' || decision.approved !== true
    || decision.decision !== 'record_as_completed_wash' || !text(decision.ownerName) || !text(decision.statement)
    || !text(tax?.ownerName) || decision.ownerName.trim() !== tax.ownerName.trim()
    || !Array.isArray(input.records) || input.records.length !== 1
    || Object.entries(OWNER_COMPLETION_TARGET).some(([key, value]) => decision[key] !== value
      || (key !== 'bookingNumber' && record?.[key] !== value))
    || input.workerLinks?.['1984'] !== OWNER_COMPLETION_WORKER_ID
    || tax?.priceMode !== 'exclusive' || tax?.unitAmount !== 20 || tax?.totalAmount !== 20
    || tax?.vatAmount !== 3 || tax?.totalVatAmount !== 3 || tax?.grossAmount !== 23 || tax?.totalGrossAmount !== 23) {
    return ['قرار إكمال المالك مطلوب صراحة للحجز C-5584720 وحده، بنفس حالة SSP والعامل والتاريخ والصافي 20 والضريبة 3 والإجمالي 23.'];
  }
  return [];
}

export const hasOwnerCompletionDecision = input => input.ownerCompletionDecision !== undefined
  && ownerCompletionDecisionProblems(input).length === 0;
