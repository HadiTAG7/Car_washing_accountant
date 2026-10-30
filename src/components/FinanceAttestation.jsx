import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { callFinanceApi } from '../lib/financeApi';
import { ConfirmButton } from './founding/FoundingCommon';
import { when } from '../lib/founding/foundingFormat';

/**
 * «بلا إيصال، بإقرار المدير» على مستند فترة تأسيس لم يُرحّل: الخادم يحفظه على
 * نفس المستند (لا حذف ولا مستند جديد) باسم من أقرّ ووقته وسببه، ثم يمشي
 * الاعتماد والترحيل العاديان على 2300. الصفحة للإدارة وحدها.
 */
export default function FinanceAttestation({ kind, detail, dirty, busy, onDone, onMessage }) {
  const [reason, setReason] = useState(''), [working, setWorking] = useState(false), [error, setError] = useState('');
  const founding = detail?.founding, attestation = founding?.attestation;
  if (attestation) return <p className="fw-success" role="note" aria-label="بإقرار المدير">
    <BadgeCheck size={16} /> بلا إيصال، بإقرار المدير — أقرّه {attestation.byName || 'المدير'} <bdi>{when(attestation.atIso)}</bdi>: «{attestation.note || '—'}».
    غير ضريبي بلا ضريبة مدخلات، ودفعه هادي (2300).</p>;
  if (!founding?.attestable) return null;
  const off = busy || working || dirty;
  return <section className="fw-form-section" aria-label="بلا إيصال، بإقرار المدير">
    <h3 className="fw-form-section-title">بلا إيصال، بإقرار المدير</h3>
    <p>مستند فترة تأسيس لم يُرحّل. يسقط شرط رابط الإيصال (والمورد)، ويصير غير ضريبي بلا ضريبة مدخلات، ودفعه هادي من حسابه الجاري: مدين المصروف، دائن 2300.
      يُحفظ على نفس المستند باسمك ووقتك وسببك، ويظهر في «ملخص فترة التأسيس» ضمن «مصاريف بإقرار المدير». بعدها الاعتماد والترحيل العاديان. لا يُحذف المستند ولا يُنشأ غيره.</p>
    {dirty && <p className="fw-warning" role="note">احفظ تعديلاتك على المستند أو تراجع عنها أولًا.</p>}
    {error && <div className="fw-warning" role="alert">{error}</div>}
    <div className="fw-form"><label className="fw-wide">السبب<input value={reason} onChange={e => setReason(e.target.value)} disabled={off}
      placeholder="مثلًا: دفعته من حسابي ولم أحتفظ بالإيصال" /></label></div>
    <div className="fw-actions"><ConfirmButton label="بلا إيصال، بإقرار المدير" disabled={off || reason.trim().length < 5}
      confirmText="يحفظ المستند بإقرارك: بلا إيصال، غير ضريبي، دفعه هادي (2300). لا اعتماد ولا ترحيل."
      onConfirm={async () => {
        setWorking(true); setError('');
        try {
          await callFinanceApi('finance-workbench', { kind: 'founding', request: { action: 'attestDocument', kind, sourceId: detail.sourceId,
            sourceHash: detail.sourceHash, reason: reason.trim(), confirm: true } });
          setReason(''); onMessage?.('حُفظ المستند بإقرار المدير. الاعتماد والترحيل خطوتان منفصلتان.'); onDone(detail.sourceId);
        } catch (e) { setError(e.message); } finally { setWorking(false); }
      }} /></div>
  </section>;
}
