import { Card, SectionHeader } from './UI';
import { formatCurrency, formatNumber } from '../data/initialData';
import { reviewGroups } from '../lib/sweater/settlementDisplay';

export default function SettlementPreviewPanel({ state, periodKey }) {
  const { data, loading, error, refetch } = state;
  // A response for an earlier period must never be labelled with the new one.
  const figures = data?.dryRun === true && data?.periodKey === periodKey ? data.figures : null;
  const groups = reviewGroups(figures);
  return <Card className="p-4 sm:p-6 settlement-preview" role="region" aria-label="معاينة التسوية الحالية">
    <SectionHeader title="معاينة الشهر الحالية — غير محفوظة" subtitle={`${periodKey} · من الحجوزات والسياسة والأسعار الموجودة، دون اعتماد أو ترحيل`}
      action={<button type="button" className="sw-button sw-button--secondary sw-button--sm" disabled={loading} onClick={refetch}>تحديث المعاينة</button>} />
    {loading ? <p role="status">جارٍ قراءة معاينة الشهر…</p> : error ? <p role="alert">تعذّرت معاينة الشهر. لم يُحفظ أو يُحتسب شيء بدلًا عنها.</p>
      : !figures ? <p>لم تتوفر معاينة متحققة لهذا الشهر؛ الشرطات لا تعني أن المستحق صفر.</p> : <>
        <div className="settlement-preview__figures">
          <div><span>الخدمات المؤهلة وفق السياسة الحالية</span><strong>{formatNumber(figures.counts.eligible)}</strong><small>من {formatNumber(figures.counts.imported)} حجزًا مستوردًا</small></div>
          <div><span>إيراد الخدمات المؤهلة قبل الضريبة</span><strong>{formatCurrency(figures.services.net)}</strong><small>ضريبتها {formatCurrency(figures.services.vat)}</small></div>
          <div><span>حجوزات تحتاج مراجعة</span><strong>{formatNumber(figures.counts.needsReview + figures.counts.unknownStatus)}</strong><small>لا تدخل إيراد المعاينة حتى تستوفي الشروط</small></div>
        </div>
        {groups.length > 0 && <div role="note"><p>البيانات وصلت، لكن هذه الأسباب تمنع احتساب بعض الحجوزات:</p>
          <ul>{groups.map(group => <li key={group.key}>{group.reason} · {formatNumber(group.rows.length)} حجزًا{' '}<a className="text-primary-600 dark:text-primary-400 underline" href={group.href}>التفاصيل والإعدادات</a></li>)}</ul>
        </div>}
        <p className="text-xs text-slate-500">هذه معاينة للخدمات المؤهلة فقط، وليست كشف سويتر أو صافيًا معتمدًا. الأرقام المحفوظة أدناه تبقى بتاريخ آخر احتساب.</p>
        {data.readAtIso && <small>وقت قراءة المعاينة: <time dateTime={data.readAtIso}>{new Date(data.readAtIso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}</time> (الرياض) · تبقى هذه القراءة حتى التحديث أو تغيّر مصادرها.</small>}
      </>}
  </Card>;
}
