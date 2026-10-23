/* eslint-disable react-refresh/only-export-components */
const blocked = async () => { throw new Error('الحفظ معطل في المعاينة الاصطناعية'); };
const noop = () => {};
const rows = Array.from({ length: 113 }, (_, i) => ({ sspBookingId: `TEST-${i}`, serviceDate: '2026-10-03', normalizedStatus: i === 112 ? 'unknown' : 'payment_collection', rating: null }));
const review = rows.slice(0,112).map(row => ({ sspBookingId: row.sspBookingId, reasonCode: 'no_recognition_policy', reasonAr: 'لا سياسة اعتراف معرّفة لهذا التاريخ.' }));
const figures = { counts: { imported: 113, eligible: 0, needsReview: 112, unknownStatus: 1 }, services: { net: 0, vat: 0, gross: 0 }, netDue: 0, deductions: 0, compensations: 0, incentives: 0,
  lines: { review, unknown: [{ sspBookingId: 'TEST-112', reasonCode: 'unknown_status' }] } };
export const useSweaterSettlements = () => ({ settlements: [{ periodKey: '2026-10', status: 'calculated', calculatedAtIso: '2026-10-11T13:44:48Z', figures }], loading: false, error: null, calculate: blocked, approve: blocked, recordStatement: blocked, recordCollection: blocked, close: blocked });
export const useSweaterBookings = period => ({ bookings: period === '2026-10' ? rows : [], loading: false, error: null, refetch: noop });
export const useSweaterFirstPeriod = () => ({ firstPeriod: '2026-10', loading: false, error: null });
export const useSweaterAdjustments = () => ({ adjustments: [], loading: false, error: null, approve: blocked });
export const useSweaterVariances = () => ({ variances: [], loading: false, error: null, resolve: blocked });
export const useSweaterMetrics = () => ({ snapshot: { metrics: { completedWashes: 501, violations: 530, damages: 0, compensations: 0, freeWashCompensation: 9, cancelledByBiker: 13, cancelledMaintenance: 4, cancelledByCustomer: 10 }, metricSources: {} }, loading: false, error: null });
export const usePartnerView = () => ({ role: 'admin', canMutate: true });
export const describeBackendError = error => error.message;
export const maskedProjectRef = () => 'isolated';
export const isFirebaseConfigured = true;
export const missingEnvNames = [];
export const dataSource = 'isolated';
export default function TopBar() { return <h1 className="p-4 font-bold text-xl">معاينة تسويات سويتر</h1>; }
