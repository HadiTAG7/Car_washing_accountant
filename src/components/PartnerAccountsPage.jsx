import { useState } from 'react';
import { Bot, Ban, Pencil, Eye } from 'lucide-react';
import TopBar from './TopBar';
import { Card } from './UI';
import ErrorState from './ErrorState';
import LoadingState from './LoadingState';
import EditPartnerModal from './EditPartnerModal';
import SweaterActionDialog from './SweaterActionDialog';
import { usePartnerView } from '../contexts/PartnerViewContext';
import { useAuth } from '../hooks/useAuth';
import { usePartners } from '../hooks/usePartners';
import { usePartnerMcpKeys, activeKeyFor } from '../hooks/usePartnerMcpKeys';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { fetchRows } from '../lib/firestoreCrud';

export default function PartnerAccountsPage() {
  const { role, isPartnerView } = usePartnerView();
  if (role !== 'admin' || isPartnerView) return <p className="p-6">هذه الصفحة للمدير فقط.</p>;
  return <AccountsContent />;
}

function AccountsContent() {
  const { user } = useAuth();
  const partners = usePartners();
  const mcp = usePartnerMcpKeys({ scope: 'all' });
  const directory = useFirestoreQuery(() => fetchRows('users'), { cacheKey: 'partnerAccountDirectory', cacheTags: ['users'], queryKey: user?.id || null, enabled: Boolean(user?.id), fallback: [] });
  const { setActingAsPartnerId } = usePartnerView();
  const [editing, setEditing] = useState(null);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState('');
  const loading = partners.loading || directory.loading || mcp.loading;
  const error = partners.error || directory.error || mcp.error;
  const linked = partner => Boolean(partner.userId && directory.data?.some(user => user.id === partner.userId && user.role === 'partner'));
  const count = partners.partners.filter(linked).length;
  async function revoke({ reason }) {
    setBusy(true); setActionError(null);
    try { await mcp.revokeKey(target.key.keyId, reason); setTarget(null); setNotice('تم إيقاف رابط المساعد.'); }
    catch (failure) { setActionError(failure.message); }
    finally { setBusy(false); }
  }
  return <><TopBar title="الحسابات والمساعد الذكي" subtitle="حسابات دخول الشركاء وروابط مساعدهم" />
    <main className="p-4 sm:p-6 lg:p-8 space-y-6">
      {notice && <p role="status">{notice}</p>}
      {loading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={() => { partners.refetch(); directory.refetch(); mcp.refetch(); }} /> : <>
        <Card className="p-5"><h2 className="font-bold">حسابات دخول مفعّلة</h2><strong className="block text-3xl mt-3">{count} / {partners.partners.length}</strong>
          <p className="text-sm mt-3 text-slate-500 dark:text-slate-400">العدد يبيّن الشركاء المرتبطين بحساب دخول في دليل التطبيق. لا يعبّر عن النشاط التجاري أو آخر دخول.</p></Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">تاريخ آخر دخول غير متاح من مصدر التطبيق الحالي. تاريخ استخدام المساعد ليس تاريخ تسجيل الدخول.</p>
        <p className="text-sm">يفعّل الشريك المساعد من «المساعد الذكي» في بوابته. يستطيع المدير مراجعة الحالة وإيقاف الرابط الحالي.</p>
        <Card className="p-4 overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><caption className="text-right font-bold mb-4">حسابات الشركاء</caption>
          <thead><tr>{['الشريك', 'حساب الدخول', 'آخر دخول', 'المساعد الذكي', 'خيارات'].map(label => <th className="p-3 text-right" key={label}>{label}</th>)}</tr></thead>
          <tbody>{partners.partners.map(partner => {
            const key = activeKeyFor(mcp.keys, partner.id);
            return <tr key={partner.id} className="border-t border-slate-200 dark:border-slate-700">
              <th className="p-3 text-right">{partner.partnerName}</th><td className="p-3">{linked(partner) ? 'مفعّل — حساب مرتبط' : partner.userId ? 'الربط يحتاج مراجعة' : 'غير مفعّل — غير مرتبط'}</td>
              <td className="p-3">غير متاح</td><td className="p-3">{key ? <span className="inline-flex items-center gap-1 text-emerald-600"><Bot size={15} />مفعّل</span> : 'غير مفعّل'}</td>
              <td className="p-3"><div className="flex gap-2 flex-wrap">
                <button className="sw-button sw-button--secondary sw-button--sm" onClick={() => setEditing(partner)} aria-label={`تعديل حساب ${partner.partnerName}`}><Pencil size={14} />حساب الدخول</button>
                <button className="sw-button sw-button--secondary sw-button--sm" onClick={() => setActingAsPartnerId(partner.id)} aria-label={`معاينة بوابة ${partner.partnerName}`}><Eye size={14} />معاينة</button>
                {key && <button className="sw-button sw-button--secondary sw-button--sm" onClick={() => { setActionError(null); setTarget({ partner, key }); }} aria-label={`إيقاف مساعد ${partner.partnerName}`}><Ban size={14} />إيقاف المساعد</button>}
              </div></td>
            </tr>;
          })}</tbody></table></Card>
      </>}
    </main>
    <EditPartnerModal accountOnly isOpen={Boolean(editing)} partner={editing} onClose={() => setEditing(null)}
      onSave={async (id, patch) => { await partners.updatePartner(id, patch); directory.refetch(); setNotice('تم حفظ ربط الحساب.'); }} showToast={message => setNotice(message)} />
    <SweaterActionDialog open={Boolean(target)} title={`إيقاف رابط ${target?.partner.partnerName || ''}`} subtitle="يستطيع الشريك إنشاء رابط جديد من بوابته."
      icon={Ban} tone="danger" fields={[{ name: 'reason', label: 'السبب', type: 'textarea', placeholder: 'اختياري' }]}
      confirmLabel="أوقف الرابط" busyLabel="جارٍ الإيقاف…" busy={busy} error={actionError} onConfirm={revoke} onClose={() => setTarget(null)} />
  </>;
}
