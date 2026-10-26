// Readings of Sweater's Metabase dashboards (Business Dashboard, its Tips tab,
// and Compensations) for one month, sent by the operations agent. Display and
// reconciliation only: nothing here is posted to the ledger. Pure, so the
// browser shows each number with the same unit and direction the server checks.

export const METRICS_CONTRACT = 'sweater-metrics-v1';
export const METRICS_COL = 'sweater_metric_snapshots';

// Sweater classes every Compensations line as a deduction except a customer
// cancellation, which it adds. Money in riyals; the rest are counts.
export const SWEATER_METRICS = Object.freeze({
  completedWashes: { unit: 'count' },
  tipsNet: { unit: 'sar' },
  violations: { unit: 'sar', direction: 'deduction' },
  damages: { unit: 'sar', direction: 'deduction' },
  compensations: { unit: 'sar', direction: 'deduction' },
  freeWashCompensation: { unit: 'count', direction: 'deduction' },
  cancelledByBiker: { unit: 'count', direction: 'deduction' },
  cancelledMaintenance: { unit: 'count', direction: 'deduction' },
  cancelledByCustomer: { unit: 'count', direction: 'addition' },
});

export class MetricsContractError extends Error {
  constructor(message) { super(message); this.name = 'MetricsContractError'; this.code = 'invalid-argument'; }
}
const fail = message => { throw new MetricsContractError(message); };
const object = x => Boolean(x && typeof x === 'object' && !Array.isArray(x));
const exactKeys = (x, allowed) => object(x) && Object.keys(x).length === allowed.length && allowed.every(k => k in x);
const docId = x => typeof x === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,159}$/.test(x);
const month = x => typeof x === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const instant = x => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
// The same source rule as the operations contract: Sweater's portal only, no credentials in the URL.
export const sspSourceUrl = x => {
  try { const u = new URL(x); return u.protocol === 'https:' && u.hostname === 'ssp-portal.sweater.sa'
    && !u.username && !u.password && !u.hash && ![...u.searchParams.keys()].some(k => /token|session|auth|cookie|secret/i.test(k)); }
  catch { return false; }
};
const halalas = v => Number(v.toFixed(2)) === v;

// Optional display-only attribution from the same Tips reading. Retain source
// precision; round the sum once, just as the monthly net metric is rounded.
export function validTipsByBiker(rows, total) {
  if (!Array.isArray(rows) || rows.length > 5000 || typeof total !== 'number' || !Number.isFinite(total)) return false;
  const ids = new Set(); let sum = 0;
  for (const row of rows) {
    if (!exactKeys(row, ['driverExternalId', 'netAmount']) || !docId(row.driverExternalId)
      || ids.has(row.driverExternalId) || typeof row.netAmount !== 'number' || !Number.isFinite(row.netAmount)
      || Math.abs(row.netAmount) > 1e9) return false;
    ids.add(row.driverExternalId); sum += row.netAmount;
  }
  return Math.round(sum * 100) === Math.round(total * 100);
}

// Optional source records for monetary deductions only. This is attribution
// for the dashboard, not approval, attendance evidence or a payroll deduction.
// Every included monetary metric must be fully reconciled in this SAME read.
export function validDeductionDetails(rows, metrics, periodKey) {
  if (!Array.isArray(rows) || rows.length > 5000 || !object(metrics) || !month(periodKey)) return false;
  const keys = Object.keys(metrics).filter(key => SWEATER_METRICS[key]?.unit === 'sar' && SWEATER_METRICS[key]?.direction === 'deduction');
  if (!keys.length) return false;
  const sums = Object.fromEntries(keys.map(key => [key, 0])), ids = new Set();
  for (const row of rows) {
    if (!exactKeys(row, ['metricKey', 'sourceId', 'driverExternalId', 'date', 'amount', 'category', 'sourceUrl', 'bookingId'])
      || !keys.includes(row.metricKey) || !docId(row.sourceId) || !docId(row.driverExternalId)
      || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date.slice(0, 7) !== periodKey
      || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date
      || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0 || row.amount > 1e9 || !halalas(row.amount)
      || typeof row.category !== 'string' || !row.category.trim() || row.category.length > 250
      || !sspSourceUrl(row.sourceUrl) || (row.bookingId !== null && !docId(row.bookingId))) return false;
    const identity = `${row.metricKey}:${row.sourceId}`;
    if (ids.has(identity)) return false;
    ids.add(identity); sums[row.metricKey] += Math.round(row.amount * 100);
  }
  return keys.every(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key]) && metrics[key] >= 0
    && halalas(metrics[key]) && sums[key] === Math.round(metrics[key] * 100));
}

// Optional event evidence for these three COUNT metrics only. A partial read
// stays partial: quantity is source units, never converted to money. Nullable
// fields mean unavailable, not zero, responsibility, approval or payroll.
export const COUNT_DETAIL_KEYS = Object.freeze(['freeWashCompensation', 'cancelledByBiker', 'cancelledMaintenance']);
export function validCountDetails(rows, metrics, periodKey) {
  if (!Array.isArray(rows) || rows.length > 5000 || !object(metrics) || !month(periodKey)) return false;
  const keys = COUNT_DETAIL_KEYS.filter(key => Object.hasOwn(metrics, key));
  if (!keys.length || keys.some(key => !Number.isSafeInteger(metrics[key]) || metrics[key] < 0)) return false;
  const sums = Object.fromEntries(keys.map(key => [key, 0])), ids = new Set(), bookings = new Set();
  for (const row of rows) {
    if (!exactKeys(row, ['metricKey', 'sourceId', 'driverExternalId', 'date', 'quantity', 'amount', 'reason', 'sourceUrl', 'bookingId'])
      || !keys.includes(row.metricKey) || !docId(row.sourceId)
      || (row.driverExternalId !== null && !docId(row.driverExternalId))
      || (row.date !== null && (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
        || row.date.slice(0, 7) !== periodKey || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))
        || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date))
      || !Number.isSafeInteger(row.quantity) || row.quantity < 1
      || (row.metricKey !== 'freeWashCompensation' && row.quantity !== 1)
      || (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount)
        || row.amount < 0 || row.amount > 1e9 || !halalas(row.amount)))
      || (row.reason !== null && (typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 250))
      || !sspSourceUrl(row.sourceUrl) || (row.bookingId !== null && !docId(row.bookingId))) return false;
    const identity = `${row.metricKey}:${row.sourceId}`, booking = `${row.metricKey}:${row.bookingId}`;
    if (ids.has(identity) || (row.bookingId !== null && bookings.has(booking))) return false;
    ids.add(identity); if (row.bookingId !== null) bookings.add(booking);
    sums[row.metricKey] += row.quantity;
  }
  return keys.every(key => Number.isSafeInteger(sums[key]) && sums[key] <= metrics[key]);
}

export const COMPENSATION_KEYS = Object.freeze(['violations','damages','compensations','freeWashCompensation','cancelledByBiker','cancelledMaintenance','cancelledByCustomer']);

/** Source table coverage is distinct from field availability. A missing time,
 * worker, reason or amount stays null; a count is never converted into money.
 * A complete table must reconcile with this same signed reading. */
export function validEventDetails(rows, coverage, metrics, periodKey) {
  if (!Array.isArray(rows) || rows.length > 5000 || !Array.isArray(coverage) || !coverage.length || coverage.length > 7 || !month(periodKey) || !object(metrics)) return false;
  const groups = new Map(), ids = new Set();
  for (const c of coverage) {
    if (!exactKeys(c,['metricKey','totalRows','complete']) || !COMPENSATION_KEYS.includes(c.metricKey) || !Object.hasOwn(metrics,c.metricKey)
      || groups.has(c.metricKey) || typeof c.complete !== 'boolean' || (c.totalRows !== null && (!Number.isSafeInteger(c.totalRows) || c.totalRows < 0 || c.totalRows > 100000))) return false;
    groups.set(c.metricKey,{...c,rows:[],sum:0,known:true});
  }
  for (const r of rows) {
    const g = groups.get(r?.metricKey);
    if (!g || !exactKeys(r,['metricKey','sourceId','bookingId','date','time','driverExternalId','reason','quantity','amount','sourceUrl']) || !docId(r.sourceId)
      || (r.bookingId !== null && !docId(r.bookingId)) || (r.driverExternalId !== null && !docId(r.driverExternalId))
      || (r.date !== null && (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date.slice(0,7) !== periodKey || !Number.isFinite(Date.parse(`${r.date}T00:00:00Z`)) || new Date(`${r.date}T00:00:00Z`).toISOString().slice(0,10) !== r.date))
      || (r.time !== null && (!r.date || typeof r.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(r.time)))
      || (r.reason !== null && (typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 500))
      || !Number.isSafeInteger(r.quantity) || r.quantity < 1 || (r.metricKey !== 'freeWashCompensation' && r.quantity !== 1)
      || (r.amount !== null && (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount < 0 || r.amount > 1e9 || !halalas(r.amount))) || !sspSourceUrl(r.sourceUrl)) return false;
    const key = `${r.metricKey}:${r.sourceId}`;
    if (ids.has(key)) return false;
    ids.add(key);g.rows.push(r);
    if (SWEATER_METRICS[r.metricKey].unit === 'count') g.sum += r.quantity;
    else if (r.amount === null) g.known = false;
    else g.sum += Math.round(r.amount*100);
  }
  return [...groups.values()].every(g => {
    const total = metrics[g.metricKey], expected = SWEATER_METRICS[g.metricKey].unit === 'count' ? total : Math.round(total*100);
    return Number.isFinite(total) && total >= 0 && g.sum <= expected && (g.totalRows === null || g.rows.length <= g.totalRows)
      && (!g.complete || (g.totalRows === g.rows.length && g.known && g.sum === expected));
  });
}

/** One month's reading: known metrics only, counts as whole numbers, money to the halala. */
export function validateMetricsSnapshot(payload) {
  const fields = ['contractVersion', 'importRunId', 'periodKey', 'extractedAt', 'sourceUrl', 'metrics'];
  if (object(payload) && Object.hasOwn(payload, 'tipsByBiker')) fields.push('tipsByBiker');
  if (object(payload) && Object.hasOwn(payload, 'deductionDetails')) fields.push('deductionDetails');
  if (object(payload) && Object.hasOwn(payload, 'countDetails')) fields.push('countDetails');
  if (object(payload) && Object.hasOwn(payload, 'eventDetails')) fields.push('eventDetails');
  if (object(payload) && Object.hasOwn(payload, 'eventCoverage')) fields.push('eventCoverage');
  if (!exactKeys(payload, fields)
    || payload.contractVersion !== METRICS_CONTRACT || !docId(payload.importRunId) || !month(payload.periodKey)
    || !instant(payload.extractedAt) || !sspSourceUrl(payload.sourceUrl)) fail('عقد لقطة أرقام سويتر أو معرّفها أو شهرها أو وقتها أو رابطها غير صالح.');
  // A reading of a month's dashboard is taken on or after its first day (Riyadh).
  if (Date.parse(payload.extractedAt) < Date.parse(`${payload.periodKey}-01T00:00:00+03:00`)) fail('وقت القراءة قبل بداية الشهر المقروء.');
  const entries = object(payload.metrics) ? Object.entries(payload.metrics) : [];
  if (!entries.length || entries.some(([key]) => !Object.hasOwn(SWEATER_METRICS, key))) fail('أرقام اللقطة فارغة أو فيها بند غير معروف.');
  for (const [key, value] of entries) {
    const { unit } = SWEATER_METRICS[key];
    const valid = typeof value === 'number' && Number.isFinite(value) && (unit === 'count'
      ? Number.isInteger(value) && value >= 0
      // Net tips after fees may fall below zero; the other amounts never do.
      : halalas(value) && (key === 'tipsNet' || value >= 0));
    if (!valid) fail(`قيمة ${key} غير صالحة: ${unit === 'count' ? 'عدد صحيح غير سالب' : 'مبلغ بالريال لا يتجاوز هللتين'}.`);
  }
  if (Object.hasOwn(payload, 'tipsByBiker') && !validTipsByBiker(payload.tipsByBiker, payload.metrics.tipsNet)) {
    fail('تفاصيل البقشيش تحتاج معرفات بايكر فريدة ومبالغ فعلية يطابق مجموعها صافي اللقطة نفسها.');
  }
  if (Object.hasOwn(payload, 'deductionDetails') && !validDeductionDetails(payload.deductionDetails, payload.metrics, payload.periodKey)) {
    fail('تفاصيل الخصومات تحتاج سجلات مصدر فريدة للشهر نفسه، ومعرف بايكر ومبلغ وسبب ورابط، ومجموعًا مطابقًا للقطة.');
  }
  if (Object.hasOwn(payload, 'countDetails') && !validCountDetails(payload.countDetails, payload.metrics, payload.periodKey)) {
    fail('تفاصيل الأعداد تحتاج وقائع مصدر فريدة من الشهر والقراءة نفسهما، وكمية لا تتجاوز العدد؛ المبلغ المفقود يبقى غير متاح.');
  }
  if ((Object.hasOwn(payload,'eventDetails') || Object.hasOwn(payload,'eventCoverage')) && !validEventDetails(payload.eventDetails,payload.eventCoverage,payload.metrics,payload.periodKey)) {
    fail('تفاصيل التعويضات أو تغطيتها لا تطابق القراءة؛ احتفظ بالناقص غير متاح ولا تفترض صفرًا.');
  }
  return payload;
}
