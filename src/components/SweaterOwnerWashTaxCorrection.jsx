import { useEffect, useRef, useState } from 'react';
import { Card, SectionHeader, SecondaryButton } from './UI';
import { callSweaterOwnerWashTaxPreview, callSweaterOwnerWashTaxSave, describeBackendError } from '../lib/firebaseClient';
import { formatCurrency } from '../data/initialData';

export default function SweaterOwnerWashTaxCorrection() {
  const [result, setResult] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(() => {
    let alive = true; const request = ++sequence.current;
    // Supported read-only preview verifies all twelve saved splits; never save on mount.
    callSweaterOwnerWashTaxPreview().then(value => { if (alive && request === sequence.current) setResult(value); })
      .catch(e => { if (alive && request === sequence.current) setError(describeBackendError(e)); });
    return () => { alive = false; };
  }, []);
  const completed = result?.saved || (result?.count === 12 && result?.rows?.length === 12 && result.rows.every(row => row.already === true));
  const act = async save => {
    if (busy) return;
    const request = ++sequence.current;
    setBusy(true); setError('');
    try { const value = save ? await callSweaterOwnerWashTaxSave(result.previewHash) : await callSweaterOwnerWashTaxPreview(); if (request === sequence.current) setResult(value); }
    catch (e) { if (request === sequence.current) { setError(describeBackendError(e)); setResult(null); } }
    finally { setBusy(false); }
  };
  const content = <Card className="p-4 sm:p-5 space-y-3">
    <SectionHeader title="توضيح ضريبة الغسلات المسجلة" subtitle="إفادة هادي: 20 صافي + 3 ضريبة = 23 إجمالي لكل غسلة" />
    <p className="text-sm">التصحيح للغسلات الاثنتي عشرة في 3 و4 أكتوبر فقط، دون إعادة استيراد أو ترحيل أو تغيير التحصيل.</p>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {!completed && <SecondaryButton disabled={busy} onClick={() => act(false)}>معاينة تصحيح الضريبة</SecondaryButton>}
    {result && <div className="space-y-2 text-sm">
      <p className="font-semibold">{completed ? 'تم توثيق الفصل الضريبي للغسلات' : 'معاينة فقط؛ لم تتغير البيانات'}</p>
      <p>{result.count} غسلة · صافي {formatCurrency(result.totals.net)} · ضريبة {formatCurrency(result.totals.vat)} · إجمالي {formatCurrency(result.totals.gross)}</p>
      <details><summary>الحجوزات المشمولة بالتصحيح</summary><ul>{result.rows.map(row => <li key={row.sspBookingId} dir="ltr">{row.sspBookingId} · {row.serviceDate}</li>)}</ul></details>
      {!completed && result.canSave && <SecondaryButton disabled={busy} onClick={() => act(true)}>تطبيق التصحيح المراجع على الاثنتي عشرة غسلة</SecondaryButton>}
    </div>}
  </Card>;
  return completed ? <details className="sw-past-tasks"><summary>مهام سابقة · توضيح ضريبة الغسلات مكتمل</summary>{content}</details> : content;
}
