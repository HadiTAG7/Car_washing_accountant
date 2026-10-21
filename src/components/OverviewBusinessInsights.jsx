import { useState } from 'react';
import { OVERVIEW_SETTINGS as settings } from '../config/overviewSettings';
import { overviewBusinessMetrics, overviewSettlements, parseMetabaseCount } from '../lib/overviewInsights';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import { readOverviewMetabase, saveOverviewMetabase } from '../lib/overviewMetabaseStorage';

export default function OverviewBusinessInsights({ data, periodKey, washReady, language, onNavigate }) {
  const [counts, setCounts] = useState(() => ({ [periodKey]: readOverviewMetabase(periodKey) }));
  const text = (ar, en) => language === 'en' ? en : ar;
  const unavailable = text('غير متاح', 'Unavailable');
  const num = value => value == null ? unavailable : formatNumber(Math.round(value * 100) / 100);
  const currency = value => value == null ? unavailable : formatCurrencyPrecise(value);
  const ops = washReady ? data.operations : null;
  const st = data.finance.statement;
  const m = overviewBusinessMetrics(ops, st);
  const aReady = data.adjustments && !data.adjustments.loading && !data.adjustments.error;
  const sReady = data.settlements && !data.settlements.loading && !data.settlements.error;
  const settlement = ops ? overviewSettlements({ adjustments: aReady ? data.adjustments.items : [],
    settlements: sReady ? data.settlements.items : [], periodKey, to: ops.to }) : null;
  const storedCount = counts[periodKey] ?? readOverviewMetabase(periodKey);
  const entered = storedCount.value;
  const metabase = parseMetabaseCount(entered);
  const difference = ops && metabase !== null ? metabase - ops.quantity : null;
  const sourceGap = !st ? text('المصاريف غير مؤكدة بعد.', 'Costs are not confirmed yet.') : !ops ? text('الغسلات غير مؤكدة بعد.', 'Washes are not confirmed yet.') : '';
  const estimated = m?.estimated ? text('تقديري · الرواتب لم تُعتمد نهائيًا.', 'Estimated · payroll is not final.') : '';
  const partial = m?.partialCosts ? text('التكلفة جزئية: توجد سجلات ضريبية مستبعدة.', 'Partial costs: unresolved tax records are excluded.') : '';
  const link = (label, tab) => <button className="sw-overview__link" type="button" onClick={() => onNavigate?.(tab)}>{label}</button>;
  return <div className="sw-overview__insights">
    <div className="sw-overview__financial-grid sw-overview__insight-grid">
      <Insight title={text('نقطة التعادل', 'Break-even')} value={m?.monthlyRequired == null ? unavailable : `${num(m.monthlyRequired)} ${text('غسلة / شهر', 'washes / month')}`}>
        <p>{text('المطلوب يوميًا', 'Required daily')}: <bdi>{num(m?.dailyRequired)}</bdi> · {text('المعدل الحالي', 'Current daily rate')}: <bdi>{num(m?.currentDailyRate)}</bdi></p>
        <p>{text('المتبقي للوصول', 'Washes to break even')}: <bdi>{num(m?.remainingWashes)}</bdi></p>
        <small>{sourceGap || text('مصاريف التشغيل ÷ سعر الغسلة قبل الضريبة؛ دون التأسيس. المعدل على الأيام المكتملة، بما فيها الأيام بلا غسلات مسجلة.', 'Operating costs ÷ net wash price; setup excluded. Pace uses completed calendar days, including days with no recorded washes.')} {estimated} {partial}</small>
      </Insight>
      <Insight title={text('تكلفة الغسلة', 'Cost per wash')} value={currency(m?.costPerWash)}>
        <p>{text('سعر الغسلة قبل الضريبة', 'Net wash price')}: <bdi>{currency(settings.washNetPrice)}</bdi></p>
        <small>{sourceGap || (ops?.quantity ? text('مصاريف الشهر ÷ الغسلات المكتملة المسجلة.', 'Monthly costs ÷ recorded completed washes.') : text('لا توجد غسلات مكتملة للقسمة عليها.', 'No completed washes to divide by.'))} {estimated} {partial}</small>
      </Insight>
      <Insight title={text('استغلال الطاقة', 'Capacity utilization')} value={m?.capacityUtilization == null ? unavailable : `${num(m.capacityUtilization)}%`}>
        <p>{text('المواعيد اليومية لكل بايكر', 'Daily appointments per biker')}: <bdi>{num(settings.dailyAppointmentsPerBiker)}</bdi></p>
        <small>{text('تقريبي · على أيام الغسيل، مو الحضور', 'Approximate · based on wash days, not attendance')}</small>
        {m?.capacityUtilization == null && <small>{text('لا يوجد متوسط بايكر مؤكّد لأيام مكتملة، أو ربط الغسلات ناقص.', 'No confirmed biker average for completed days, or wash identities are incomplete.')}</small>}
      </Insight>
      <Insight title={ops?.completeMonth ? text('نتيجة الشهر الفعلية', 'Actual month result') : text('توقع نهاية الشهر', 'Month-end forecast')}
        value={m?.forecastQuantity == null ? unavailable : `${ops?.completeMonth ? '' : '≈ '}${num(Math.round(m.forecastQuantity))} ${text('غسلة', 'washes')}`}>
        <p>{text('الإيراد قبل الضريبة', 'Revenue excluding VAT')}: <bdi>{currency(m?.forecastRevenue)}</bdi></p>
        {!ops?.completeMonth && <p>{text('متوسط آخر أيام مكتملة', 'Recent completed-day average')}: <bdi>{num(m?.recentAverage)}</bdi> · <bdi>{num(m?.sampleDays)}</bdi> {text('أيام', 'days')}</p>}
        <small>{!ops ? sourceGap : ops.completeMonth ? text('الغسلات الفعلية وإيراد قائمة الدخل؛ لا توقع لشهر انتهى.', 'Actual washes and statement revenue; no forecast for a closed month.')
          : m?.sampleDays ? text(`آخر ${settings.forecastWindowDays} أيام مكتملة كحد أقصى، على المسجل فقط. اليوم غير مكتمل، ولا تُحتسب غسلاته مرتين؛ ليست دفعة مضمونة من سويتر.`, `Up to ${settings.forecastWindowDays} completed days, recorded data only. Today is incomplete, with no double counting; not a guaranteed Sweater payment.`)
            : text('لا توجد أيام مكتملة في الشهر لبناء توقع.', 'No completed days in this month to forecast from.')}</small>
        {!ops?.completeMonth && m && <small>{text('الأيام غير المكتملة المتبقية، تشمل اليوم', 'Remaining unfinished days, including today')}: <bdi>{num(m.remainingDays)}</bdi></small>}
      </Insight>
      <Insight title={text('الخصومات والتعويضات', 'Deductions and compensation')} value={!aReady || !ops || settlement.malformed ? unavailable
        : !settlement.deductionRecordCount ? text('غير مسجلة', 'Not recorded')
          : settlement.deductionTotal === null ? text('لا خصومات معتمدة', 'No approved deductions') : currency(settlement.deductionTotal)}>
        <small>{!aReady ? text('تعذّرت قراءة تسويات الخصم أو ما زالت تُحمّل.', 'Deduction adjustments are unavailable or still loading.')
          : settlement?.malformed ? text('تسويات ذات تاريخ أو مبلغ غير صالح؛ راجع التفاصيل.', 'Adjustments contain invalid dates or amounts; review details.')
            : text('الخصومات المعتمدة فقط، تشمل تعويض العميل والمخالفات. التعويض المستحق لنا إضافة وليس خصمًا. لا نكرر المبلغ من ملخص التسوية.', 'Approved deductions only, including customer compensation and violations. Compensation owed to us is a credit. Settlement summaries are not counted again.')}</small>
        {aReady && settlement?.pending.length > 0 && <p>{text('خصومات معلّقة، غير داخلة في الإجمالي', 'Pending deductions, excluded from total')}: <bdi>{currency(settlement.pendingTotal)}</bdi></p>}
        {link(text('تفاصيل تسويات سويتر', 'Sweater settlement details'), 'sweater_settlements')}
      </Insight>
      <Insight title={text('البقشيش', 'Tips')} value={unavailable}>
        <small>{text('لا يوجد حقل مستقل للبقشيش بعد اعتماد الفاتورة. لا نعتبر الحوافز أو فروق التحصيل بقشيشًا، ولا نضمّه للإيراد الأساسي.', 'No separate post-invoice tips field exists. Incentives or collection differences are not tips; tips stay separate from base revenue.')}</small>
      </Insight>
    </div>
    <div className="sw-overview__financial-grid sw-overview__insight-grid">
      <Insight title={text('رصيد صندوق العمل المالي', 'Financial workbench balance')} value={unavailable}>
        <small>{text('صندوق العمل المالي مسار مراجعة مستندات، وليس حسابًا نقديًا له رصيد. رصيد الصندوق المحاسبي مختلف ولا نستبدله به.', 'The financial workbench reviews documents; it is not a cash account. Ledger cash is different and is not substituted here.')}</small>
        {link(text('فتح صندوق العمل المالي', 'Open financial workbench'), 'finance_workbench')}
      </Insight>
      <Insight title={text('الدفعة المتوقعة من سويتر', 'Expected Sweater payment')} value={currency(sReady && ops ? settlement.expected : null)}>
        <small>{!sReady ? text('قراءة التسوية غير متاحة بعد.', 'Settlement read is not available yet.') : settlement?.ambiguous ? text('أكثر من تسوية للشهر؛ يلزم حسم المصدر.', 'Multiple settlements exist for the month; the source needs review.')
          : !settlement?.settlement ? text('لم تُسجّل تسوية محسوبة لهذا الشهر.', 'No calculated settlement is recorded for this month.')
            : settlement?.expected === null ? text('التسوية موجودة، لكن صافي المستحق لم يُحسب أو يُحفظ بعد.', 'A settlement exists, but net due has not been calculated or saved yet.')
              : text('صافي المستحق من آخر حساب محفوظ للتسوية، وليس إثبات تحويل. قد يتغير بعد المراجعة.', 'Net due from the last saved settlement calculation, not proof of transfer. It may change after review.')}</small>
        {sReady && settlement?.collected !== null && settlement?.collected !== undefined && <p>{text('المحصّل المسجل', 'Recorded collected')}: <bdi>{currency(settlement.collected)}</bdi> · {text('المتبقي', 'Remaining')}: <bdi>{currency(settlement.remaining)}</bdi></p>}
        {link(text('مطابقة الدفعة', 'Reconcile payment'), 'sweater_settlements')}
      </Insight>
      <Insight title={text('الفلوس والمواعيد', 'Money and dates')} value={m ? m.lastDay : unavailable}>
        <p>{text('تاريخ الفاتورة: آخر يوم في الشهر المختار.', 'Invoice date: the selected month’s last day.')}</p>
        <p>{text(`تذكير كشف حساب الشهر: يوم ${settings.statementDay} من الشهر التالي`, `Month’s statement reminder: day ${settings.statementDay} of the following month`)}{m && <> · <bdi>{m.statementDate}</bdi></>}</p>
        <small>{text('تذكيرات فقط؛ لا تثبت وصول الكشف أو إصدار الفاتورة أو موعد تحويل مضمون.', 'Reminders only, not evidence of statement receipt, invoice issuance or a guaranteed transfer date.')}</small>
      </Insight>
    </div>
    <section className="sw-overview__reconciliation" aria-label={text('مطابقة الغسلات مع سويتر', 'Sweater wash reconciliation')}>
      <label htmlFor="overview-metabase-count">{text('عدد غسلات الشهر حسب سويتر — Metabase', 'Monthly wash count in Sweater — Metabase')}</label>
      <input id="overview-metabase-count" type="text" inputMode="numeric" value={entered} placeholder={text('أدخل العدد', 'Enter count')}
        onChange={event => {
          const next = saveOverviewMetabase(periodKey, event.target.value);
          setCounts(previous => ({ ...previous, [periodKey]: next }));
        }} aria-invalid={entered !== '' && metabase === null} />
      <p className={difference ? 'sw-overview__reconciliation-warning' : ''} role="status">
        {entered !== '' && metabase === null ? text('أدخل عددًا صحيحًا غير سالب.', 'Enter a non-negative whole number.') : difference === null
          ? text('أدخل عدد سويتر لإظهار الفرق؛ الحقل الفارغ لا يعني صفرًا.', 'Enter Sweater’s count to compare; an empty field is not zero.')
          : `${text('الفرق: سويتر − المسجّل', 'Difference: Sweater − recorded')}: ${difference > 0 ? '+' : ''}${num(difference)} · ${difference ? text('يوجد فرق يحتاج مطابقة', 'Mismatch to reconcile') : text('متطابق', 'Matched')}`}
      </p>
      <small>{periodKey} · {text('الأعداد الصحيحة تُحفظ لكل شهر على هذا المتصفح فقط، وليس في قاعدة البيانات أو بين الأجهزة. مسح الحقل يحذف العدد المحفوظ لهذا الشهر.', 'Valid counts are saved per month in this browser only, not in the database or across devices. Clearing the field removes this month’s saved count.')}</small>
      {storedCount.storageError && <p role="alert">{text('تعذّر الحفظ المحلي؛ الرقم مؤقت حتى تسمح إعدادات المتصفح بالتخزين.', 'Local storage is unavailable; the count is temporary until browser storage is allowed.')}</p>}
    </section>
  </div>;
}

function Insight({ title, value, children }) {
  return <section className="sw-overview-metric sw-overview-insight"><h3>{title}</h3><strong className="tabular-nums"><bdi>{value}</bdi></strong>{children}</section>;
}
