import { OVERVIEW_SETTINGS as settings } from '../config/overviewSettings';
import { overviewBusinessMetrics, overviewSettlements, overviewSweaterMetrics } from '../lib/overviewInsights';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';

export default function OverviewBusinessInsights({ data, periodKey, washReady, language, onNavigate, breakEven = {} }) {
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
  // Each metric keeps the time of its own last actual source reading.
  const sweaterRead = data.sweaterMetrics;
  const sweater = overviewSweaterMetrics(sweaterRead?.snapshot, ops);
  const noSweater = sweaterRead?.error ? text('تعذّرت قراءة أرقام سويتر', 'Sweater numbers could not be read')
    : sweaterRead?.loading && !sweaterRead.snapshot ? '…' : text('ما وصلت بيانات سويتر', 'No Sweater data received');
  const fromSweater = (value, format) => value === null || value === undefined ? noSweater : format(value);
  const updated = keys => {
    const dates = [...new Set(keys.map(key => sweater?.updatedAtByMetric[key]).filter(date => date && Number.isFinite(Date.parse(date))))]
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (!dates.length) return null;
    const format = date => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
      { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(date));
    return <> {dates.length === 1 ? text('آخر تحديث من سويتر', 'Last updated from Sweater') : text('أوقات القراءات من سويتر — لكل بند وقته', 'Sweater reading times — each item retains its time')}: <bdi>{format(dates[0])}{dates.length > 1 && <> — {format(dates.at(-1))}</>}</bdi> {text('(بتوقيت الرياض)', '(Riyadh time)')}</>;
  };
  const metricLabels = { violations: text('المخالفات', 'Violations'), damages: text('الأضرار', 'Damages'), compensations: text('التعويضات', 'Compensations'),
    freeWashCompensation: text('غسلات مجانية تعويض', 'Free compensation washes'), cancelledByBiker: text('إلغاء من البايكر', 'Cancelled by the biker'),
    cancelledMaintenance: text('إلغاء بسبب الصيانة', 'Cancelled for maintenance'), cancelledByCustomer: text('إلغاء من العميل', 'Cancelled by the customer') };
  const mixedCompensationTimes = new Set(Object.keys(metricLabels).map(key => sweater?.updatedAtByMetric[key]).filter(Boolean)).size > 1;
  const metricItem = ({ key, unit, value }) => <li key={key}><span>{metricLabels[key]}{mixedCompensationTimes && <small>{updated([key])}</small>}</span><bdi>{fromSweater(value, unit === 'sar' ? currency : num)}</bdi></li>;
  const sourceGap = !st ? text('المصاريف غير مؤكدة بعد.', 'Costs are not confirmed yet.') : !ops ? text('الغسلات غير مؤكدة بعد.', 'Washes are not confirmed yet.') : '';
  const estimated = m?.estimated ? text('تقديري · الرواتب لم تُعتمد نهائيًا.', 'Estimated · payroll is not final.') : '';
  const partial = m?.partialCosts ? text('التكلفة جزئية: توجد سجلات ضريبية مستبعدة.', 'Partial costs: unresolved tax records are excluded.') : '';
  const link = (label, tab) => <button className="sw-overview__link" type="button" onClick={() => onNavigate?.(tab)}>{label}</button>;
  // Break-even boxes: breakEven.js through the page (daily: the chart's line; perBiker: the bikers page's columns).
  const { daily, days, perBiker } = breakEven;
  const dailyReached = daily && days?.averageActual != null ? days.averageActual >= daily.required : null;
  const bikerReached = perBiker?.averageCoverage != null ? perBiker.averageCoverage >= 1 : null;
  const status = reached => reached !== null && <p className="sw-overview-insight__status">{reached ? text('وصل نقطة التعادل', 'At or above break-even') : text('تحت نقطة التعادل', 'Below break-even')}</p>;
  return <div className="sw-overview__insights">
    <div className="sw-overview__financial-grid sw-overview__insight-grid">
      <Insight title={text('نقطة التعادل', 'Break-even')} value={m?.monthlyRequired == null ? unavailable : `${num(m.monthlyRequired)} ${text('غسلة / شهر', 'washes / month')}`}>
        <p>{text('المتبقي للوصول', 'Washes to break even')}: <bdi>{num(m?.remainingWashes)}</bdi></p>
      </Insight>
      <Insight title={text('نقطة التعادل اليومية', 'Daily break-even')} tone={dailyReached} value={daily ? `${num(daily.required)} ${text('غسلة / يوم', 'washes / day')}` : unavailable}>
        {status(dailyReached)}
      </Insight>
      <Insight title={text('نقطة التعادل لكل بايكر', 'Break-even per biker')} tone={bikerReached}
        value={perBiker?.averageRequiredDaily == null ? unavailable : `${num(perBiker.averageRequiredDaily)} ${text('غسلة / يوم', 'washes / day')}`}>
        {status(bikerReached)}
        {link(text('تفاصيل كل بايكر', 'Per-biker details'), 'bikers')}
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
      <Insight title={text('الخصومات والتعويضات', 'Deductions and compensation')} value={sweater ? fromSweater(sweater.deductionMoney, currency) : noSweater}>
        {sweater && <>
          <p className="sw-overview-insight__group">{text('الخصومات', 'Deductions')}</p>
          <ul className="sw-overview-insight__items">{sweater.deductions.map(metricItem)}</ul>
          <p className="sw-overview-insight__group">{text('الإضافات', 'Additions')}</p>
          <ul className="sw-overview-insight__items">{sweater.additions.map(metricItem)}</ul>
        </>}
        <small>{text('من لوحة Compensations في سويتر: المخالفات والأضرار والتعويضات بالريال، ومجموعها أعلاه؛ والباقي أعداد. سويتر يعدّ إلغاء العميل إضافة، والباقي خصمًا.', 'From Sweater’s Compensations dashboard: violations, damages and compensations in riyals, totalled above; the rest are counts. Sweater adds customer cancellations and deducts the rest.')}{updated(Object.keys(metricLabels))}</small>
        <p>{text('المعتمد في الدفتر', 'Approved in the ledger')}: <bdi>{!aReady || !ops || settlement.malformed ? unavailable
          : !settlement.deductionRecordCount ? text('غير مسجلة', 'Not recorded')
            : settlement.deductionTotal === null ? text('لا خصومات معتمدة', 'No approved deductions') : currency(settlement.deductionTotal)}</bdi></p>
        {!aReady ? <small>{text('تعذّرت قراءة تسويات الخصم أو ما زالت تُحمّل.', 'Deduction adjustments are unavailable or still loading.')}</small>
          : settlement?.malformed && <small>{text('تسويات ذات تاريخ أو مبلغ غير صالح؛ راجع التفاصيل.', 'Adjustments contain invalid dates or amounts; review details.')}</small>}
        {aReady && settlement?.pending.length > 0 && <p>{text('خصومات معلّقة، غير داخلة في الإجمالي', 'Pending deductions, excluded from total')}: <bdi>{currency(settlement.pendingTotal)}</bdi></p>}
        {link(text('تفاصيل تسويات سويتر', 'Sweater settlement details'), 'sweater_settlements')}
      </Insight>
      <Insight title={text('البقشيش', 'Tips')} value={fromSweater(sweater?.tipsNet, currency)}>
        <p>{text('صافي البقشيش بعد الرسوم، من تبويب Tips في Business Dashboard.', 'Net tips after fees, from the Tips tab of the Business Dashboard.')}</p>
        <small>{text('منفصل عن الإيراد ولا يدخل قائمة الدخل.', 'Kept apart from revenue; not in the income statement.')}{updated(['tipsNet'])}</small>
      </Insight>
    </div>
    <div className="sw-overview__financial-grid sw-overview__insight-grid">
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
        {link(text('فتح صندوق العمل المالي', 'Open financial workbench'), 'finance_workbench')}
      </Insight>
    </div>
    <section className="sw-overview__reconciliation" aria-label={text('مطابقة الغسلات مع سويتر', 'Sweater wash reconciliation')}>
      <h3>{text('عدد غسلات الشهر حسب سويتر — Metabase', 'Monthly wash count in Sweater — Metabase')}</h3>
      <strong className="tabular-nums"><bdi>{fromSweater(sweater?.completedWashes, num)}</bdi></strong>
      {sweater?.washDifference != null && <p className={sweater.washDifference ? 'sw-overview__reconciliation-warning' : ''} role="status">
        {`${text('الفرق: سويتر − المسجّل', 'Difference: Sweater − recorded')}: ${sweater.washDifference > 0 ? '+' : ''}${num(sweater.washDifference)} · ${sweater.washDifference ? text('يوجد فرق يحتاج مطابقة', 'Mismatch to reconcile') : text('متطابق', 'Matched')}`}
      </p>}
      <small>{periodKey} · {text('من Business Dashboard في سويتر، يصل تلقائيًا مع تكامل التشغيل.', 'From Sweater’s Business Dashboard, sent automatically by the operations integration.')}{updated(['completedWashes'])}</small>
    </section>
  </div>;
}

// tone: true (reached, green), false (below, red), or none.
function Insight({ title, value, tone = null, children }) {
  return <section className={`sw-overview-metric sw-overview-insight${tone === true ? ' sw-overview-insight--good' : tone === false ? ' sw-overview-insight--bad' : ''}`}>
    <h3>{title}</h3><strong className="tabular-nums"><bdi>{value}</bdi></strong>{children}</section>;
}
