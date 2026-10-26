import { useState } from 'react';
import { OVERVIEW_SETTINGS as settings } from '../config/overviewSettings';
import { overviewBusinessMetrics, overviewSettlements, overviewSweaterMetrics } from '../lib/overviewInsights';
import { formatCurrencyPrecise, formatNumber } from '../data/initialData';
import OverviewBikerDetails from './OverviewBikerDetails';
import OverviewDeductionsDetails from './OverviewDeductionsDetails';

export default function OverviewBusinessInsights({ data, periodKey, washReady, language, onNavigate, breakEven = {} }) {
  const text = (ar, en) => language === 'en' ? en : ar;
  const [detail, setDetail] = useState(null);
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
  const sweater = overviewSweaterMetrics(sweaterRead?.snapshot?.periodKey === periodKey ? sweaterRead.snapshot : null, ops);
  const noSweater = sweaterRead?.error ? text('تعذّرت قراءة أرقام سويتر', 'Sweater numbers could not be read')
    : sweaterRead?.loading && !sweaterRead.snapshot ? '…' : text('ما وصلت بيانات سويتر', 'No Sweater data received');
  const fromSweater = (value, format) => value === null || value === undefined ? noSweater : format(value);
  const updated = keys => {
    const dates = [...new Set(keys.map(key => sweater?.updatedAtByMetric[key]).filter(date => date && Number.isFinite(Date.parse(date))))]
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (!dates.length) return null;
    const format = date => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory',
      { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh', numberingSystem: 'latn' }).format(new Date(date));
    return `${dates.length === 1 ? text('آخر تحديث من سويتر', 'Last updated from Sweater') : text('أوقات القراءات من سويتر — لكل بند وقته', 'Sweater reading times — each item retains its time')}: ${format(dates[0])}${dates.length > 1 ? ` — ${format(dates.at(-1))}` : ''} ${text('(بتوقيت الرياض)', '(Riyadh time)')}`;
  };
  const metricLabels = { violations: text('المخالفات', 'Violations'), damages: text('الأضرار', 'Damages'), compensations: text('التعويضات', 'Compensations'),
    freeWashCompensation: text('غسلات مجانية تعويض', 'Free compensation washes'), cancelledByBiker: text('إلغاء من البايكر', 'Cancelled by the biker'),
    cancelledMaintenance: text('إلغاء بسبب الصيانة', 'Cancelled for maintenance'), cancelledByCustomer: text('إلغاء من العميل', 'Cancelled by the customer') };
  const mixedCompensationTimes = new Set(Object.keys(metricLabels).map(key => sweater?.updatedAtByMetric[key]).filter(Boolean)).size > 1;
  const metricItem = ({ key, unit, value }) => <li key={key}><span>{metricLabels[key]}{mixedCompensationTimes && <small>{updated([key])}</small>}</span><bdi>{fromSweater(value, unit === 'sar' ? currency : num)}</bdi></li>;
  const sourceGap = !st ? text('المصاريف غير مؤكدة بعد.', 'Costs are not confirmed yet.') : !ops ? text('الغسلات غير مؤكدة بعد.', 'Washes are not confirmed yet.') : '';
  const partial = m?.partialCosts ? text('التكلفة جزئية: توجد سجلات ضريبية مستبعدة.', 'Partial costs: unresolved tax records are excluded.') : '';
  const link = (label, tab) => <button className="sw-overview__link" type="button" onClick={() => onNavigate?.(tab)}>{label}</button>;
  // Break-even boxes: breakEven.js through the page (daily: the chart's line; perBiker: the bikers page's columns).
  const { daily, days, perBiker } = breakEven;
  // Owner-approved, display-only service estimate. Not settlement net due:
  // do not guess VAT or monetary rates for count-based deductions/additions.
  const provisional = sReady && !settlement?.ambiguous && ops && !ops.conflicts?.length
    && (settlement?.unresolvedZero || settlement?.expected == null)
    && Number.isFinite(ops.quantity) && ops.quantity >= 0;
  const serviceEstimate = provisional ? Math.round(ops.quantity * settings.washNetPrice * 100) / 100 : null;
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
        {(sourceGap || partial) && <small>{sourceGap || partial}</small>}
      </Insight>
      <Insight title={text('الإنتاج مقارنة بالطاقة اليومية', 'Output vs daily capacity')} moreLabel={text('عرض التفاصيل', 'View details')} onOpen={() => setDetail('capacity')} value={m?.capacityUtilization == null ? unavailable : `${num(m.capacityUtilization)}%`}>
        <p>{text('الطاقة المفترضة لكل بايكر', 'Assumed capacity per biker')}: <bdi>{num(settings.dailyAppointmentsPerBiker)}</bdi> {text('غسلات / يوم', 'washes / day')}</p>
        {m?.capacityUtilization == null && <small>{text('لا يوجد متوسط بايكر مؤكّد لأيام مكتملة، أو ربط الغسلات ناقص.', 'No confirmed biker average for completed days, or wash identities are incomplete.')}</small>}
      </Insight>
      <Insight title={ops?.completeMonth ? text('نتيجة الشهر الفعلية', 'Actual month result') : text('توقع نهاية الشهر', 'Month-end forecast')}
        value={m?.forecastQuantity == null ? unavailable : `${ops?.completeMonth ? '' : '≈ '}${num(Math.round(m.forecastQuantity))} ${text('غسلة', 'washes')}`}>
        <p>{text('الإيراد قبل الضريبة', 'Revenue excluding VAT')}: <bdi>{currency(m?.forecastRevenue)}</bdi></p>
        {!ops?.completeMonth && <p>{text('متوسط آخر أيام مكتملة', 'Recent completed-day average')}: <bdi>{num(m?.recentAverage)}</bdi> · <bdi>{num(m?.sampleDays)}</bdi> {text('أيام', 'days')}</p>}
      </Insight>
      <Insight title={text('الخصومات والتعويضات', 'Deductions and compensation')} titleHint={updated(Object.keys(metricLabels))}
        moreLabel={text('عرض تفاصيل الخصومات', 'View deduction details')} onOpen={() => setDetail('deductions')} value={sweater ? fromSweater(sweater.deductionMoney, currency) : noSweater}>
        <p>{text('المعتمد في الدفتر', 'Approved in the ledger')}: <bdi>{!aReady || !ops || settlement.malformed ? unavailable
          : !settlement.deductionRecordCount ? text('غير مسجلة', 'Not recorded')
            : settlement.deductionTotal === null ? text('لا خصومات معتمدة', 'No approved deductions') : currency(settlement.deductionTotal)}</bdi></p>
        {!aReady ? <small>{text('تعذّرت قراءة تسويات الخصم أو ما زالت تُحمّل.', 'Deduction adjustments are unavailable or still loading.')}</small>
          : settlement?.malformed && <small>{text('تسويات ذات تاريخ أو مبلغ غير صالح؛ راجع التفاصيل.', 'Adjustments contain invalid dates or amounts; review details.')}</small>}
        {aReady && settlement?.pending.length > 0 && <p>{text('خصومات معلّقة، غير داخلة في الإجمالي', 'Pending deductions, excluded from total')}: <bdi>{currency(settlement.pendingTotal)}</bdi></p>}
      </Insight>
      <Insight title={text('البقشيش', 'Tips')} titleHint={updated(['tipsNet'])} moreLabel={text('عرض البايكرية والمبالغ', 'View bikers and amounts')} onOpen={() => setDetail('tips')} value={fromSweater(sweater?.tipsNet, currency)} />
      <Insight title={text('الدفعة المتوقعة من سويتر', 'Expected Sweater payment')} value={provisional ? currency(serviceEstimate) : sReady && settlement?.unresolvedZero ? text('تحتاج مراجعة', 'Needs review') : currency(sReady && ops ? settlement.expected : null)}>
        {provisional && <><p>{text('تقدير غير معتمد · قبل الضريبة والخصومات والإضافات', 'Unapproved estimate · before VAT, deductions and additions')}</p>
          <p><bdi>{num(ops.quantity)} × {currency(settings.washNetPrice)}</bdi> · <bdi dir="ltr">{ops.from} — {ops.to}</bdi></p></>}
        <small>{provisional ? text('من الغسلات المسجلة وسعر النظرة العامة. ليس صافي دفعة نهائيًا؛ قد يتغير بعد المطابقة والمراجعة.', 'From recorded washes and the overview price. Not final net payment; reconciliation and review may change it.')
          : !sReady ? text('قراءة التسوية غير متاحة بعد.', 'Settlement read is not available yet.') : settlement?.ambiguous ? text('أكثر من تسوية للشهر؛ يلزم حسم المصدر.', 'Multiple settlements exist for the month; the source needs review.')
          : !settlement?.settlement ? text('لم تُسجّل تسوية محسوبة لهذا الشهر.', 'No calculated settlement is recorded for this month.')
            : settlement?.unresolvedZero ? text('الحساب المحفوظ لم يحتسب خدمات بسبب حجوزات تحتاج مراجعة؛ لا يعني أن المستحق صفر.', 'The saved calculation excluded services requiring review; this does not establish a zero amount due.')
            : settlement?.expected === null ? text('التسوية موجودة، لكن صافي المستحق لم يُحسب أو يُحفظ بعد.', 'A settlement exists, but net due has not been calculated or saved yet.')
              : text('صافي المستحق من آخر حساب محفوظ للتسوية، وليس إثبات تحويل. قد يتغير بعد المراجعة.', 'Net due from the last saved settlement calculation, not proof of transfer. It may change after review.')}</small>
        {!provisional && sReady && settlement?.collected !== null && settlement?.collected !== undefined && <p>{text('المحصّل المسجل', 'Recorded collected')}: <bdi>{currency(settlement.collected)}</bdi> · {text('المتبقي', 'Remaining')}: <bdi>{currency(settlement.remaining)}</bdi></p>}
        {link(text('مطابقة الدفعة', 'Reconcile payment'), 'sweater_settlements')}
      </Insight>
    </div>
    {detail === 'deductions' && <OverviewDeductionsDetails key={`${periodKey}:deductions`} sweater={sweater} renderItem={metricItem}
      sourceTime={updated(Object.keys(metricLabels))}
      records={settlement?.malformed ? [] : settlement?.violations || []} recordsUnavailable={!aReady || !ops || settlement?.malformed}
      bikers={data.workers?.error || data.workers?.loading ? [] : data.workers?.bikers || []}
      periodKey={periodKey} language={language} noSweater={noSweater} onNavigate={onNavigate} onClose={() => setDetail(null)} />}
    {detail && detail !== 'deductions' && <OverviewBikerDetails key={`${periodKey}:${detail}`} kind={detail} ops={ops} bikers={data.workers?.error || data.workers?.loading ? [] : data.workers?.bikers || []}
      snapshot={sweaterRead?.snapshot} periodKey={periodKey} language={language} onClose={() => setDetail(null)} />}
  </div>;
}

// tone: true (reached, green), false (below, red), or none.
function Insight({ title, titleHint, value, tone = null, moreLabel, onOpen, children }) {
  return <section className={`sw-overview-metric sw-overview-insight${tone === true ? ' sw-overview-insight--good' : tone === false ? ' sw-overview-insight--bad' : ''}`}>
    <h3 title={titleHint || undefined}>{onOpen ? <button type="button" className="sw-overview-insight__opener" onClick={onOpen} aria-haspopup="dialog">{title}</button> : title}</h3><strong className="tabular-nums"><bdi>{value}</bdi></strong>{children}
    {onOpen && moreLabel && <span className="sw-overview-insight__more" aria-hidden="true">{moreLabel}</span>}</section>;
}
