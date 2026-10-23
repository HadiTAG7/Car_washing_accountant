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
const sspSourceUrl = x => {
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

/** One month's reading: known metrics only, counts as whole numbers, money to the halala. */
export function validateMetricsSnapshot(payload) {
  const fields = ['contractVersion', 'importRunId', 'periodKey', 'extractedAt', 'sourceUrl', 'metrics'];
  if (object(payload) && Object.hasOwn(payload, 'tipsByBiker')) fields.push('tipsByBiker');
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
  return payload;
}
