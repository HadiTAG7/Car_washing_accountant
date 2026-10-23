import { useState } from 'react';
import { Card, SectionHeader } from './UI';
import DateField from './DateField';
import { useFirestoreQuery } from '../hooks/useFirestoreQuery';
import { useAccountingSettings } from '../hooks/useAccountingSettings';
import { fetchSellerProfile, issueInvoiceForSettlement } from '../lib/accounting/firestoreInvoicing';
import { sellerIssuanceProblems, invoiceCustomerProblems, settlementInvoiceProblems, SWEATER_BUYER_NAME } from '../../functions/src/invoiceReadiness.js';
import { formatCurrencyPrecise } from '../data/initialData';
const inputClass = 'w-full min-h-touch px-3 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100';

export default function SettlementInvoicePanel({ settlement, periodKey, busy, onIssue }) {
  const profile = useFirestoreQuery(fetchSellerProfile, { enabled: true, preserveResult: true, fallback: null });
  const policy = useAccountingSettings();
  const [issueDate, setIssueDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }));
  const [address, setAddress] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const customer = { name: SWEATER_BUYER_NAME, address, vatNumber };
  const gaps = [...sellerIssuanceProblems(profile.data, policy.policyAt(issueDate), {
    pending: profile.loading || policy.loading, error: Boolean(profile.error || policy.error), configured: policy.policyConfigured,
  }), ...settlementInvoiceProblems(settlement), ...invoiceCustomerProblems('standard', customer)];
  if (!issueDate) gaps.push('تاريخ الإصدار مطلوب.');
  if (issueDate < `${periodKey}-${new Date(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)), 0).getDate()}`) {
    gaps.push('فاتورة الشهر لا تصدر قبل نهاية شهر الخدمات.');
  }
  const documentId = settlement?.invoiceDocumentId;
  return <Card className="p-4 sm:p-5">
    <SectionHeader title="فاتورة سويتر الشهرية" subtitle="فاتورة ضريبية مرتبطة بقيد الشهر المعتمد، بلا قيد إيراد ثانٍ" />
    {documentId ? <a className="text-primary-600 dark:text-primary-400 underline" href={`?page=documents&document=${encodeURIComponent(documentId)}`}>افتح الفاتورة {settlement.invoiceNumber}</a> : <>
      <p className="text-sm mb-3">العميل: {SWEATER_BUYER_NAME}</p>
      <p className="text-sm mb-3">قيمة فاتورة الخدمات: {settlement?.figures?.services?.gross == null ? 'غير متاحة' : formatCurrencyPrecise(settlement.figures.services.gross)}. الخصومات والحوافز لها قيود تسوية منفصلة؛ ليست إيرادًا ثانيًا.</p>
      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <label className="text-sm">تاريخ إصدار فاتورة سويتر<DateField value={issueDate} onChange={e => setIssueDate(e.target.value)} ariaLabel="تاريخ إصدار فاتورة سويتر" /></label>
        <label className="text-sm" htmlFor="sweater-invoice-address">عنوان سويتر
          <input id="sweater-invoice-address" required value={address} onChange={e => setAddress(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm" htmlFor="sweater-invoice-vat">الرقم الضريبي لسويتر
          <input id="sweater-invoice-vat" required dir="ltr" inputMode="numeric" maxLength={15} value={vatNumber} onChange={e => setVatNumber(e.target.value.replace(/\D/g, ''))} className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-slate-500 mb-3">العنوان والرقم من فاتورة أو عقد سويتر؛ لم نفترضهما. لا يُحفظ شيء قبل الإصدار.</p>
      <button type="button" className="sw-button sw-button--primary" disabled={busy || gaps.length > 0} aria-describedby="settlement-invoice-gaps"
        onClick={() => { if (!gaps.length) onIssue(() => issueInvoiceForSettlement(periodKey, { issueDate, customer })); }}>
        إصدار فاتورة سويتر الشهرية
      </button>
      <div id="settlement-invoice-gaps" className="mt-3 text-sm leading-relaxed">
        {gaps.length > 0 && <><strong>الناقص قبل الإصدار:</strong><ul className="list-disc ps-5 space-y-1">{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></>}
      </div>
    </>}
  </Card>;
}
