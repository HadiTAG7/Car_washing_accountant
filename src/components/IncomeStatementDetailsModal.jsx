import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import ModalSurface from './ModalSurface';
import { useLanguage } from '../i18n/useLanguage';
import { translate } from '../i18n/locale';
import { formatCurrency } from '../data/initialData';

const TITLES = {
  grossRevenue: ['إيرادات المبيعات', 'Sales revenue'], salesReturns: ['مردودات وخصومات المبيعات', 'Sales returns and discounts'],
  otherRevenue: ['إيرادات أخرى', 'Other revenue'], netRevenue: ['صافي الإيرادات', 'Net revenue'],
  directCosts: ['التكاليف المباشرة والعمولات', 'Direct costs and commissions'],
  operatingExpenses: ['المصاريف التشغيلية', 'Operating expenses'], totalCosts: ['إجمالي التكاليف', 'Total costs'],
  grossProfit: ['مجمل الربح التشغيلي', 'Gross operating profit'], netProfitBeforeFees: ['صافي الربح قبل الرسوم', 'Profit before fees'],
  netProfit: ['صافي نتيجة الشركة بعد الرسوم', 'Net result after fees'],
};
const SOURCES = {
  payroll: ['مسير رواتب', 'Payroll'], payroll_reversal: ['عكس رواتب', 'Payroll reversal'], wash: ['غسلة', 'Wash'],
  variable: ['مصروف متغير', 'Variable expense'], expense: ['مصروف', 'Expense'], monthly: ['مصروف شهري', 'Monthly expense'],
  annual: ['مصروف سنوي', 'Annual expense'], voucher: ['سند مصروف', 'Expense voucher'],
  sweater_settlement: ['تسوية سويتر', 'Sweater settlement'], manual: ['قيد يدوي', 'Manual journal'],
  credit_note: ['إشعار دائن', 'Credit note'], adjustment: ['تسوية', 'Adjustment'],
};

export default function IncomeStatementDetailsModal({ statement, detailKey, onClose, onSelect, onPeriodSelect }) {
  const { language } = useLanguage();
  const english = language === 'en';
  const text = (ar, en) => english ? en : ar;
  const title = key => TITLES[key]?.[english ? 1 : 0]
    || translate(statement.fees.find(fee => `fee:${fee.key}` === key)?.label || key, language);
  const detail = statement.details?.[detailKey];
  if (!detail) return null;
  const transfers = detail.periodTransfers || [];
  const transferPeriods = [...new Set(transfers.map(item => item.periodKey))].map(periodKey => ({ periodKey,
    amount: Math.round(transfers.filter(item => item.periodKey === periodKey).reduce((sum, item) => sum + item.amount, 0) * 100) / 100 }));
  const groups = [...new Set(detail.items.map(item => item.accountCode))].map(code => ({ code,
    name: detail.items.find(item => item.accountCode === code).accountName,
    amount: Math.round(detail.items.filter(item => item.accountCode === code).reduce((sum, item) => sum + item.amount, 0) * 100) / 100 }));
  const issues = (statement.issues || []).filter(issue => ['grossRevenue', 'salesReturns', 'otherRevenue', 'netRevenue'].includes(detailKey)
    ? issue.reason !== 'unresolved_purchase_tax' : ['directCosts', 'operatingExpenses', 'totalCosts'].includes(detailKey)
      ? issue.reason === 'unresolved_purchase_tax' : true);

  return <ModalSurface onClose={onClose}>
    <div className="min-h-full flex items-start sm:items-center justify-center p-2 sm:p-6" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-4xl max-h-[94dvh] overflow-y-auto rounded-card bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl" dir={english ? 'ltr' : 'rtl'}>
        <header className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-4 flex justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-lg">{text('تفاصيل الحساب', 'Calculation details')} — {title(detailKey)}</h2>
            <p className="text-xs text-slate-500 mt-1" dir="ltr">{statement.periodKey} · {statement.from} → {statement.to}</p>
          </div>
          <button type="button" className="min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center" onClick={onClose} aria-label={text('إغلاق التفاصيل', 'Close details')}><X size={20} /></button>
        </header>
        <div className="p-4 sm:p-6 space-y-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">{text('هذه البنود هي مساهمات الحساب نفسه للفترة المختارة؛ المصدر المُرحّل يحل محل السجل غير المُرحّل ولا يُضاف إليه.', 'These are the contributions used by this calculation for the selected period. A posted source replaces its unposted record and is counted once.')}</p>
          <div className="rounded-control bg-slate-100 dark:bg-slate-800 p-4 flex flex-wrap justify-between gap-2 font-bold">
            <span>{text('المبلغ في القائمة', 'Statement amount')}</span><span className="tabular-nums" data-testid="statement-detail-amount">{formatCurrency(detail.amount)}</span>
          </div>
          {transferPeriods.some(period => period.amount !== 0) && <div className="border border-slate-200 dark:border-slate-700 rounded-control p-3 space-y-2 text-sm">
            <h3 className="font-bold">{text('رواتب تُحتسب في فترة أخرى', 'Salary expense in another period')}</h3>
            <p>{text('قيود الرواتب التالية بتاريخ هذه الفترة، لكن مصروفها في فترة الاستحقاق المبينة؛ ليست ضمن المبلغ أعلاه.', 'These salary journals are dated in this period, but their expense belongs to the accrual period below. They are excluded from the amount above.')}</p>
            {transferPeriods.filter(period => period.amount !== 0).map(period => <div key={period.periodKey} className="space-y-1">
              <button type="button" className="min-h-[44px] w-full flex justify-between gap-2 p-2 rounded-control border border-slate-200 dark:border-slate-700 underline text-primary-700 dark:text-primary-300" onClick={() => onPeriodSelect?.(period.periodKey, 'directCosts')}>
                <span>{text('فتح مصروف الرواتب في', 'Open salary expense in')} <bdi dir="ltr">{period.periodKey}</bdi></span><span className="tabular-nums">{formatCurrency(period.amount)}</span>
              </button>
              {transfers.filter(item => item.periodKey === period.periodKey).map((item, index) => <p key={index} className="text-xs text-slate-500">#{item.entryNumber ?? '—'} · <bdi dir="ltr">{item.paymentDate}</bdi> · {formatCurrency(item.amount)}</p>)}
            </div>)}
          </div>}
          {detail.components.length > 0 && <div className="space-y-2">
            <h3 className="font-bold text-sm">{text('طريقة التجميع', 'Calculation')}</h3>
            {detail.components.map(component => <button key={component.key} type="button" onClick={() => onSelect(component.key)} className="w-full flex justify-between gap-3 min-h-[44px] p-2 rounded-control border border-slate-200 dark:border-slate-700 text-sm">
              <span>{component.sign < 0 ? '−' : '+'} {title(component.key)}</span><span className="tabular-nums">{formatCurrency(component.amount)}</span>
            </button>)}
          </div>}
          {groups.length > 0 && <div className="space-y-2">
            <h3 className="font-bold text-sm">{text('التجميع حسب الحساب', 'By account')}</h3>
            {groups.map(group => <div key={group.code} className="flex justify-between gap-3 text-sm"><span>{group.code} {translate(group.name, language)}</span><span className="tabular-nums">{formatCurrency(group.amount)}</span></div>)}
          </div>}
          <div className="space-y-3">
            <h3 className="font-bold text-sm">{text('البنود ومصادرها', 'Items and sources')} ({detail.items.length})</h3>
            {!detail.items.length && <p className="text-sm text-slate-500">{text('لا توجد بنود لهذا المبلغ.', 'There are no items for this amount.')}</p>}
            {detail.items.map(item => <article key={item.id} className="p-3 sm:p-4 border border-slate-200 dark:border-slate-700 rounded-control space-y-2 break-words">
              <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-sm">{item.description || text('بند بلا وصف', 'Item without a description')}</p><strong className="tabular-nums">{formatCurrency(item.amount)}</strong></div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {item.date && <span>{text('تاريخ السجل / الدفع', 'Record / payment date')}: <span dir="ltr">{item.date}</span></span>}
                {item.accountCode && <span>{item.accountCode} {translate(item.accountName, language)}</span>}
                <span>{item.status === 'unposted' ? text('مسجل غير مُرحّل', 'Registered, unposted') : item.status === 'calculated' ? text('رسوم محسوبة', 'Calculated fee') : item.status === 'reversal' ? text('قيد عكس', 'Reversal journal') : item.status === 'reversed' ? text('قيد معكوس', 'Reversed journal') : text('قيد مُرحّل', 'Posted journal')}</span>
              </div>
              {item.source && <p className="text-xs break-all text-slate-500 dark:text-slate-400">{SOURCES[item.source.kind]?.[english ? 1 : 0] || item.source.kind} · {item.source.entryNumber != null ? `#${item.source.entryNumber} · ` : ''}{item.source.documentNumber || item.source.id || text('معرّف المصدر غير متاح', 'Source identifier unavailable')}</p>}
              {item.periodBasis?.startsWith('payroll') && <p className="text-xs text-primary-700 dark:text-primary-300">{text('فترة استحقاق الراتب', 'Salary accrual period')}: <bdi dir="ltr">{item.accountingPeriod}</bdi> · {text('مصدر الفترة', 'Period source')}: {item.periodBasis === 'payroll_snapshot' ? text('نسخة المسير المحفوظة بالقيد', 'Frozen payroll snapshot') : text('معرّف مسير الرواتب', 'Payroll run identifier')}</p>}
              {item.fee && <p className="text-sm">{text('الأساس', 'Base')}: {formatCurrency(item.fee.base)} · {text('النسبة', 'Rate')}: {item.fee.rate * 100}% · {item.fee.base <= 0 ? text('الأساس غير موجب؛ الرسوم صفر.', 'The base is not positive; the fee is zero.') : text('تُقرّب الرسوم إلى منزلتين عشريتين حسب قاعدة القائمة.', 'The fee is rounded to two decimals under the statement rule.')}</p>}
              {item.source && <SourceDisclosure source={item.source} text={text} language={language} />}
            </article>)}
          </div>
          {detail.adjustments.map((adjustment, index) => <p key={index} role={adjustment.kind === 'unexplained' ? 'alert' : undefined} className="text-sm rounded-control p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
            {adjustment.kind === 'rounding' ? text('فرق تقريب بين تجميع الحساب وتقريب كل بند', 'Rounding difference between account totals and individual items') : text('جزء غير مفسّر: البنود المتاحة لا تطابق كامل المبلغ؛ لا يُنسب الفرق إلى مصدر مفترض.', 'Unexplained amount: the available items do not explain the whole amount. No source is assumed for this difference.')} · {formatCurrency(adjustment.amount)}
          </p>)}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span>{text('مجموع البنود', 'Items total')}</span><span className="tabular-nums">{formatCurrency(detail.itemsTotal)}</span></div>
            <div className="flex justify-between gap-3 font-bold"><span>{text('الإجمالي بعد فروق المطابقة', 'Total including reconciliation differences')}</span><span className="tabular-nums">{formatCurrency(detail.reconciledTotal)}</span></div>
          </div>
          {issues.length > 0 && <div role="alert" className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <p>{text('سجلات لم تدخل في الرقم لأن بيانات الضريبة غير محسومة:', 'Records excluded from this amount because their tax data is unresolved:')}</p>
            {issues.map((issue, index) => <p key={`${issue.sourceId}:${index}`} className="break-all">{issue.sourceId} — {issue.reason === 'unresolved_purchase_tax' ? text('ضريبة مشتريات غير محسومة', 'Unresolved purchase tax') : issue.reason === 'missing_owner_tax_split' ? text('الفصل الضريبي لإقرار المالك غير متاح', 'Owner-confirmed tax split unavailable') : text('السياسة الضريبية لتاريخ السجل غير معروفة', 'Tax policy for the record date is unknown')}</p>)}
          </div>}
        </div>
      </section>
    </div>
  </ModalSurface>;
}

function SourceDisclosure({ source, text, language }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="text-sm">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="w-full inline-flex items-center gap-2 min-h-[44px] py-3 text-primary-700 dark:text-primary-300 underline">
      <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />
      <span>{source.entryId ? text('فتح القيد', 'Open journal') : text('فتح سجل المصدر', 'Open source record')}{source.entryNumber != null ? ` #${source.entryNumber}` : ''}</span>
    </button>
    {expanded && <SourceRecord source={source} text={text} language={language} />}
  </div>;
}

function SourceRecord({ source, text, language }) {
  const field = (label, value) => <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">{label}</dt><dd className="break-all">{value ?? text('غير متاح', 'Unavailable')}</dd></div>;
  return <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-control space-y-3">
    <p className="font-semibold">{text('سجل المصدر — للقراءة', 'Source record — read only')}</p>
    <dl className="text-xs space-y-2">
      {field(text('المصدر', 'Source'), SOURCES[source.kind]?.[language === 'en' ? 1 : 0] || source.kind)}
      {field(text('معرّف المصدر', 'Source ID'), source.id)}
      {source.entryId && field(text('معرّف القيد', 'Journal ID'), source.entryId)}
      {field(text('تاريخ السجل / الدفع', 'Record / payment date'), source.date)}
      {source.accountingPeriod && field(text('الفترة المحاسبية', 'Accounting period'), source.accountingPeriod)}
      {field(text('رقم المستند / الحجز', 'Document / booking number'), source.documentNumber)}
      {source.invoiceDate && field(text('تاريخ الفاتورة', 'Invoice date'), source.invoiceDate)}
      {source.supplier && field(text('المورّد', 'Supplier'), source.supplier)}
      {source.tax && <>
        {field(text('صافي المصدر قبل التجميع', 'Source net before aggregation'), source.tax.net != null ? formatCurrency(source.tax.net) : null)}
        {field(text('الضريبة المنفصلة عن الدخل / التكلفة', 'VAT excluded from income / cost'), source.tax.vat != null ? formatCurrency(source.tax.vat) : null)}
        {field(text('الإجمالي', 'Gross amount'), source.tax.gross != null ? formatCurrency(source.tax.gross) : null)}
        {source.tax.noInputVatReason && field(text('سبب عدم خصم ضريبة المدخلات', 'Why input VAT was not deducted'), ({
          'not-tax-invoice': text('ليست فاتورة ضريبية', 'Not a tax invoice'), 'not-deductible': text('ضريبة غير قابلة للخصم', 'Non-deductible VAT'),
          'incomplete-invoice': text('بيانات الفاتورة ناقصة', 'Incomplete invoice identity'), 'not-registered': text('غير مسجل ضريبيًا', 'Not VAT registered'),
          'zero-rated': text('الضريبة صفر', 'Zero VAT'),
        })[source.tax.noInputVatReason] || source.tax.noInputVatReason)}
      </>}
    </dl>
    {source.lines && <div className="overflow-x-auto"><table className="w-full text-xs min-w-[24rem]">
      <thead><tr><th className="text-start p-2">{text('الحساب والبيان', 'Account and description')}</th><th>{text('مدين', 'Debit')}</th><th>{text('دائن', 'Credit')}</th></tr></thead>
      <tbody>{source.lines.map((line, index) => <tr key={index}><td className="p-2">{line.accountCode} {line.description}</td><td className="text-center tabular-nums">{formatCurrency(line.debit)}</td><td className="text-center tabular-nums">{formatCurrency(line.credit)}</td></tr>)}</tbody>
    </table></div>}
  </div>;
}
