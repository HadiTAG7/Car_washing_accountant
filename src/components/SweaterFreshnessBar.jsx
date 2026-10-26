import { usePartnerView } from '../contexts/PartnerViewContext';
import { useLanguage } from '../i18n/useLanguage';
import { useSweaterFreshness } from '../hooks/useSweaterFreshness';
import { importStamp } from '../lib/sweaterFreshness';
import { OPERATIONS_SETTINGS } from '../config/operationsSettings';
import './SweaterFreshnessBar.css';

export function FreshnessBarView({ value, loading, error }) {
  const { language } = useLanguage();
  const t = (ar, en) => language === 'en' ? en : ar;
  return <section aria-label={t('حداثة بيانات سويتر', 'Sweater data freshness')} className="sw-freshness" data-tone={loading ? 'loading' : error ? 'red' : value?.tone || 'red'}>
    <strong>{t('آخر استيراد من سويتر', 'Last Sweater import')}: <bdi>{loading ? '…' : importStamp(value?.savedAt, language)}</bdi> {t('(الرياض)', '(Riyadh)')}</strong>
    {error ? <p role="alert">{t('تعذّرت قراءة وقت الاستيراد؛ الحداثة غير مؤكدة.', 'Import time could not be read; freshness is unconfirmed.')}</p>
      : !loading && !value?.savedAt ? <p>{t('ما فيه استيراد ناجح موثق؛ لا يمكن تأكيد حداثة البيانات.', 'No documented successful import; data freshness cannot be confirmed.')}</p>
        : value?.savedAt && <p>{t('قراءة المصدر', 'Source read')}: <bdi>{importStamp(value.observedAt, language)}</bdi> · {t('عمر البيانات', 'Data age')}: <bdi>{value.ageHours?.toLocaleString(language === 'en' ? 'en-GB' : 'ar-SA', { numberingSystem: 'latn', maximumFractionDigits: 1 })}</bdi> {t('ساعة', 'hours')}</p>}
    {value?.sourceTimeUncertain && <p>{t('وقت قراءة المصدر غير مؤكد؛ لا نعتمد حداثته.', 'Source reading time is unconfirmed.')}</p>}
    {value?.coverage && <p>{t('نطاق آخر استيراد', 'Latest import scope')}: <bdi>{value.coverage.rangeFrom || '—'} — {value.coverage.rangeTo || '—'}</bdi> · {value.coverage.isComplete === true ? t('مكتمل حسب سجل الاستيراد', 'Complete according to the import record') : t('تغطية جزئية؛ لا تثبت اكتمال اليوم أو الشركة', 'Partial coverage; does not establish completeness for the day or company')}</p>}
  </section>;
}

function FreshnessReader({ attention = false, onNavigate }) {
  const read = useSweaterFreshness(), { language } = useLanguage();
  if (!attention) return <FreshnessBarView {...read} />;
  if (read.loading) return null;
  const f = read.value;
  if (!read.error && f.savedAt && f.savedAgeHours <= OPERATIONS_SETTINGS.freshnessCriticalHours) return null;
  return <div className="sw-freshness" data-tone="red" role="alert">
    <p>{language === 'en' ? (read.error ? 'Import freshness could not be confirmed.' : f.savedAt ? `No successful Sweater import for more than ${OPERATIONS_SETTINGS.freshnessCriticalHours} hours.` : 'No successful Sweater import is documented.')
      : read.error ? 'تعذّر تأكيد حداثة الاستيراد.' : f.savedAt ? `ما فيه استيراد ناجح من سويتر منذ أكثر من ${OPERATIONS_SETTINGS.freshnessCriticalHours} ساعة.` : 'ما فيه استيراد ناجح موثق من سويتر.'}</p>
    {f.savedAt && <small>{importStamp(f.savedAt, language)} {language === 'en' ? '(Riyadh)' : '(الرياض)'}</small>}
    <button type="button" className="sw-button sw-button--secondary sw-button--sm" onClick={() => onNavigate?.('sweater_integration')}>{language === 'en' ? 'Open Sweater integration' : 'فتح تكامل سويتر'}</button>
  </div>;
}

export default function SweaterFreshnessBar(props) {
  const { role, isPartnerView } = usePartnerView();
  if (isPartnerView || !['admin', 'accountant', 'operator', 'supervisor'].includes(role)) return null;
  return <FreshnessReader {...props} />;
}
