import { useState } from 'react';
import { Card, SectionHeader, SecondaryButton } from './UI';
import { callSweaterOwnerWashTaxPreview, callSweaterOwnerWashTaxSave, describeBackendError } from '../lib/firebaseClient';
import { formatCurrency } from '../data/initialData';

export default function SweaterOwnerWashTaxCorrection() {
  const [result, setResult] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const act = async save => {
    if (busy) return;
    setBusy(true); setError('');
    try { setResult(save ? await callSweaterOwnerWashTaxSave(result.previewHash) : await callSweaterOwnerWashTaxPreview()); }
    catch (e) { setError(describeBackendError(e)); setResult(null); }
    finally { setBusy(false); }
  };
  return <Card className="p-4 sm:p-5 space-y-3">
    <SectionHeader title="توضيح ضريبة الغسلات المسجلة" subtitle="إفادة هادي: 20 صافي + 3 ضريبة = 23 إجمالي لكل غسلة" />
    <p className="text-sm">التصحيح للغسلات الاثنتي عشرة في 3 و4 أكتوبر فقط، دون إعادة استيراد أو ترحيل أو تغيير التحصيل.</p>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {!result?.saved && <SecondaryButton disabled={busy} onClick={() => act(false)}>معاينة تصحيح الضريبة</SecondaryButton>}
    {result && <div className="space-y-2 text-sm">
      <p className="font-semibold">{result.saved ? 'تم توثيق الفصل الضريبي للغسلات' : 'معاينة فقط؛ لم تتغير البيانات'}</p>
      <p>{result.count} غسلة · صافي {formatCurrency(result.totals.net)} · ضريبة {formatCurrency(result.totals.vat)} · إجمالي {formatCurrency(result.totals.gross)}</p>
      <details><summary>الحجوزات المشمولة بالتصحيح</summary><ul>{result.rows.map(row => <li key={row.sspBookingId} dir="ltr">{row.sspBookingId} · {row.serviceDate}</li>)}</ul></details>
      {!result.saved && result.canSave && <SecondaryButton disabled={busy} onClick={() => act(true)}>تطبيق التصحيح المراجع على الاثنتي عشرة غسلة</SecondaryButton>}
    </div>}
  </Card>;
}
