/* eslint-disable react-refresh/only-export-components -- read-only isolated visual harness */
import reviewed from '@reviewed-executive-report';
import { parseExecutiveReport } from '../../src/lib/executiveReportContract';
const report = parseExecutiveReport(reviewed);
export const auth = null;
export const isFirebaseConfigured = false;
export const useAuth = () => ({ session: { user: { id: 'LOCAL-READ-ONLY', email: 'local-preview@example.test' } } });
export const usePartners = () => ({ partners: [], loading: false, error: null });
export const usePartnerView = () => ({ role: 'admin', isPartnerView: false, isAdmin: true, actingAsPartnerId: null, setActingAsPartnerId() {} });
export const requestExecutiveReport = async () => { throw new Error('Local preview is read-only: no network request or save is allowed.'); };
export function useExecutiveReportQuery(input) {
  const params = new URLSearchParams(window.location.search);
  if (params.has('error')) return { loading: false, data: null, error: 'تعذر قراءة التقرير — اختبار محلي' };
  if (!input) return { loading: false, data: null, error: null };
  return { loading: false, error: null, data: input.action === 'list' ? { items: params.has('empty') ? [] : [{ reportId: report.reportId, dateRiyadh: report.dateRiyadh, title: report.title }], nextBefore: null }
    : { report, currentRevision: report.revision, history: [{ revision: report.revision, reason: 'النسخة الأصلية المحفوظة' }] } };
}
export default function NoPasswordModal() { return null; }
