import { AuthError, callerRole } from '../functions/src/handlers.js';
import { previewPayrollMonths } from '../functions/src/payroll.js';
import { mapWash } from '../src/lib/mappers.js';
import { monthsBetween } from '../src/lib/accounting/incomeStatementScope.js';
import { washDailySummary } from '../src/lib/washDailySummary.js';
import { growthDay, growthMetrics, shiftGrowthDay } from '../src/lib/growthMetrics.js';
import { growthRoster } from './growthRoster.js';

const fail = (message, code = 'invalid-argument') => { throw new AuthError(message, { code }); };
const row = doc => ({ id: doc.id, ...doc.data() });
export function validateGrowthRequest(input, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(now);
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['from', 'to'].includes(k))
    || !growthDay(input.from) || !growthDay(input.to) || input.from > input.to || input.to >= today
    || Date.parse(input.to) - Date.parse(input.from) > 92 * 86400000) fail('اختر فترة مكتملة لا تتجاوز 93 يومًا.');
  return { ...input, lookback: shiftGrowthDay(input.from, -7) };
}

/** The current site register is the numerator. Source snapshots supply zones
 * only, never population, completion eligibility or an analytical exclusion.
 * Preserve orphan/ended workers' registered services in explicit rows. */
export function projectGrowth({ workers = [], washes = [], payroll = [], from, to, lookback, roster = growthRoster }) {
  const mapped = washes.map(mapWash).filter(w => growthDay(w.washDate) && w.washDate >= lookback && w.washDate <= to);
  const completed = mapped.filter(w => w.status === 'مكتملة');
  const current = completed.filter(w => w.washDate >= from);
  const registerTotal = washDailySummary(current).completed;
  const registry = new Map(workers.map(w => [w.id, w]));
  const eligibility = new Map();
  for (const preview of payroll) {
    if (preview.error || !Array.isArray(preview.lines)) fail('تعذرت قراءة المسير؛ لا يمكن تأكيد قائمة البايكرية النشطين.', 'failed-precondition');
    for (const l of preview.lines) {
      if (!(Number(l.daysEntitled) > 0) || !l.bikerId) continue;
      const list = eligibility.get(l.bikerId) || [];
      if (list.some(p => p.periodKey === preview.periodKey)) fail('تكرر البايكر في مسير الشهر؛ راجع المصدر.', 'failed-precondition');
      list.push({ periodKey: preview.periodKey, startDate: l.eligibleStart || l.startDate || null,
        endDate: l.eligibleEnd || l.endDate || null, daysEntitled: Number(l.daysEntitled) });
      eligibility.set(l.bikerId, list);
    }
  }
  const keyOf = w => w.bikerId && registry.has(w.bikerId) ? w.bikerId : w.bikerId ? `missing:${w.bikerId}` : '__unlinked__';
  const wanted = new Set(current.map(keyOf));
  for (const w of workers) if (!w.end_date && !/هرب|مشيناه/.test(String(w.current_status || ''))
    && eligibility.get(w.id)?.some(p => p.periodKey >= from.slice(0, 7) && p.periodKey <= to.slice(0, 7))) wanted.add(w.id);
  const dates = [];
  for (let d = lookback; d <= to; d = shiftGrowthDay(d, 1)) dates.push(d);
  const result = [...wanted].map(id => {
    const w = registry.get(id), code = String(w?.driver_external_id || '').trim();
    const zone = code && workers.filter(v => String(v.driver_external_id || '').trim() === code).length === 1
      ? roster.rows.find(r => r.code === code)?.region : null;
    const own = completed.filter(wash => keyOf(wash) === id);
    return { id, code: code || '—', name: w?.name_ar || w?.name || w?.name_en || 'غير مربوط ببايكر',
      nameEnglish: w?.name_en || w?.name || 'Unlinked biker', region: zone || 'غير محددة',
      startDate: w?.start_date || null, endDate: w?.end_date || null,
      availability: eligibility.get(id) || [], linked: Boolean(w),
      days: dates.map(date => { const quantity = own.filter(wash => wash.washDate === date).reduce((n, wash) => n + wash.quantity, 0);
        return { date, count: quantity, recordedCount: quantity, coverage: 'registered' }; }) };
  });
  const warnings = [];
  const unlinked = current.filter(w => !w.bikerId || !registry.has(w.bikerId));
  if (unlinked.length) warnings.push({ code: 'unlinked', count: unlinked.reduce((n, w) => n + w.quantity, 0) });
  if (result.some(w => w.region === 'غير محددة')) warnings.push({ code: 'unknown-zone', count: result.filter(w => w.region === 'غير محددة').length });
  if (result.some(w => !w.availability.length)) warnings.push({ code: 'availability', count: result.filter(w => !w.availability.length).length });
  // Includes corporate, manual, administrative completions and batch quantity,
  // exactly like WashesPage. No source record is changed or reclassified.
  const projected = result.reduce((n, w) => n + w.days.filter(d => d.date >= from).reduce((s, d) => s + d.count, 0), 0);
  if (projected !== registerTotal) fail('إجمالي النمو لا يطابق سجل الغسلات؛ تعذّر تأكيد العرض.', 'failed-precondition');
  return { version: 2, workers: result, roster: { at: roster.at || null }, warnings, registerTotal,
    exclusions: [], gaps: [], from, to, lookback, readAt: new Date().toISOString(), scope: 'site-wash-register' };
}

export async function readGrowthPerformance(db, auth, input, { preview = previewPayrollMonths } = {}) {
  if (await callerRole(db, auth) !== 'admin') fail('هذه الصفحة متاحة للأدمن فقط.', 'permission-denied');
  const { from, to, lookback } = validateGrowthRequest(input);
  const months = monthsBetween(lookback.slice(0, 7), to.slice(0, 7));
  const [workersSnap, washesSnap, payroll] = await Promise.all([
    db.collection('bikers').select('driver_external_id', 'name', 'name_ar', 'name_en', 'start_date', 'end_date', 'current_status').limit(501).get(),
    db.collection('washes').where('wash_date', '>=', lookback).where('wash_date', '<', shiftGrowthDay(to, 1))
      .select('biker_id', 'biker_name', 'wash_date', 'status', 'quantity', 'ssp_booking_id').limit(10001).get(),
    preview(db, months),
  ]);
  if (workersSnap.size >= 501 || washesSnap.size >= 10001) fail('الفترة تتجاوز حد القراءة؛ اختر فترة أقصر.', 'failed-precondition');
  const projection = projectGrowth({ workers: workersSnap.docs.map(row), washes: washesSnap.docs.map(row), payroll, from, to, lookback });
  growthMetrics({ workers: projection.workers, from, to, measurementDay: to });
  return projection;
}
