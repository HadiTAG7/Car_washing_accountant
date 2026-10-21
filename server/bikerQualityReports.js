import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthError, callerRole } from '../functions/src/handlers.js';
import { completedCommissionWash } from '../functions/src/washCommission.js';
import { QUALITY_V2, normalizeQualityV2, validateV2Worker, v2WashReferences } from './bikerQualityV2.js';
import { QUALITY_V3, normalizeQualityV3, readCanonicalQualitySource, finalizeQualityV3, canonicalQualitySourceFromRows } from './bikerQualityV3.js';
import { readManualReview, manualReviewId, manualReviewProjection } from './bikerQualityManual.js';

export const QUALITY_COLLECTION = 'biker_quality_reports';
export const QUALITY_RULES_VERSION = 'cqo-20261014-v1';
export const QUALITY_WEIGHTS = { washQuality: 30, behavior: 20, productivity: 10,
  complaints: 10, cancellations: 5, lateness: 5, duration: 10, statusUpdates: 10 };
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
});
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const timestamp = z.string().datetime({ offset: true });
const inputSchema = z.object({ bikerUID: identity, periodKey: month, from: day, to: day,
  rulesVersion: z.literal(QUALITY_RULES_VERSION), sourceReadDate: day,
  samples: z.array(z.object({ washId: identity, serviceDate: day, start: timestamp, end: timestamp,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(500),
  improvement: z.string().trim().min(1).max(1500),
}).strict();
const bad = message => { throw new AuthError(message, { code: 'invalid-argument' }); };
const round = number => Math.round(number * 100) / 100;
function normalizeQualityV1(input) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) bad('تقرير الجودة غير صالح أو يحتوي حقولاً غير معتمدة.');
  const report = parsed.data;
  if (report.from > report.to || report.from.slice(0, 7) !== report.periodKey
    || report.to.slice(0, 7) !== report.periodKey || report.sourceReadDate < report.to) bad('الفترة غير صالحة.');
  const seen = new Set();
  const samples = report.samples.map(sample => {
    const minutes = (Date.parse(sample.end) - Date.parse(sample.start)) / 60000;
    const startDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date(sample.start));
    if (seen.has(sample.washId) || sample.serviceDate < report.from || sample.serviceDate > report.to
      || startDay !== sample.serviceDate || minutes <= 0 || minutes > 1440) bad('دليل المدة مكرر أو خارج الفترة أو غير صالح.');
    seen.add(sample.washId);
    return { ...sample, minutes, points: Math.max(0, 10 - .2 * Math.max(0, minutes - 50)) };
  });
  const n = samples.length;
  const duration = { n, points: n ? round(samples.reduce((sum, s) => sum + s.points, 0) / n) : null,
    averageMinutes: n ? round(samples.reduce((sum, s) => sum + s.minutes, 0) / n) : null,
    over50: samples.filter(s => s.minutes > 50).length, coverage: 'measured-sample-only' };
  // v1 has only qualified duration evidence. A customer rating is NOT both
  // wash-quality and behavior. Wash days are NOT verified attendance days.
  // The three rate deductions remain unapproved; missing fields stay null.
  const components = Object.entries(QUALITY_WEIGHTS).map(([key, weight]) => ({ key, weight,
    points: key === 'duration' ? duration.points : null, n: key === 'duration' ? n : null,
    reason: key === 'duration' ? (n ? 'partial-sample' : 'missing-evidence')
      : ['complaints', 'cancellations', 'lateness'].includes(key) ? 'rule-and-evidence-incomplete' : 'missing-evidence' }));
  return { ...report, samples, duration, components, finalScore: null, status: 'incomplete' };
}
export function normalizeQualityReport(input) {
  if (input?.rulesVersion === QUALITY_V3) return normalizeQualityV3(input, normalizeQualityV1);
  return input?.rulesVersion === QUALITY_V2 ? normalizeQualityV2(input, normalizeQualityV1) : normalizeQualityV1(input);
}
export const qualityReportId = report => `${report.bikerUID}__${report.from}__${report.to}__${report.rulesVersion}`
  + ([QUALITY_V2, QUALITY_V3].includes(report.rulesVersion) ? `__${new Date(report.snapshotAt).toISOString().replace(/\D/g, '')}` : '');
const digest = report => createHash('sha256').update(JSON.stringify(report)).digest('hex');
async function adminOnly(db, auth) {
  if (await callerRole(db, auth) !== 'admin') throw new AuthError('تقارير الجودة مقصورة على الأدمن.');
}

export async function readQualityReports(db, auth, input) {
  await adminOnly(db, auth); // Before all report/worker access, including existence.
  const parsed = z.object({ bikerUID: identity, periodKey: month,
    rulesVersion: z.enum([QUALITY_RULES_VERSION, QUALITY_V2, QUALITY_V3, 'all-approved']), includeSource: z.boolean().optional() }).strict().safeParse(input);
  if (!parsed.success) bad('معرّف العامل أو الفترة غير صالح.');
  const { bikerUID, periodKey, rulesVersion } = parsed.data;
  const snapshot = await db.collection(QUALITY_COLLECTION).where('bikerUID', '==', bikerUID).limit(100).get();
  if (snapshot.size >= 100) throw new AuthError('تحتاج قائمة التقارير تقسيم صفحات.', { code: 'failed-precondition' });
  const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(report => report.periodKey === periodKey && (rulesVersion === 'all-approved'
      ? [QUALITY_RULES_VERSION, QUALITY_V2, QUALITY_V3].includes(report.rulesVersion) : report.rulesVersion === rulesVersion))
    .sort((a, b) => b.rulesVersion.localeCompare(a.rulesVersion) || b.to.localeCompare(a.to) || String(b.snapshotAt || '').localeCompare(String(a.snapshotAt || ''))
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!parsed.data.includeSource) return { reports };
  let source;
  try { source = await readCanonicalQualitySource(db, bikerUID, periodKey); }
  catch { source = { available: false, reason: 'read-failed' }; }
  const currentDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const monthEnd = new Date(Date.UTC(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const from = reports[0]?.from || `${periodKey}-01`;
  const to = reports[0]?.to || (monthEnd < currentDay ? monthEnd : currentDay);
  let manual = null;
  if (from <= to) {
    try { manual = await readManualReview(db, auth, source, { bikerUID, periodKey, from, to }); }
    catch { manual = { available: false, reason: 'manual-review-unavailable' }; }
  }
  return { reports, source, manual };
}

const APPROVED_VERSIONS = [QUALITY_RULES_VERSION, QUALITY_V2, QUALITY_V3];
const byNewest = (a, b) => b.rulesVersion.localeCompare(a.rulesVersion) || b.to.localeCompare(a.to)
  || String(b.snapshotAt || '').localeCompare(String(a.snapshotAt || ''))
  || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
const nextMonthKey = key => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1)).toISOString().slice(0, 7);

/**
 * `read` for every worker of a month in one request — the overview used to
 * send one per worker, each reading that worker's lifetime washes and every
 * report of theirs. Here: one role check, the month's reports, the month's
 * washes once (grouped by worker), the workers and their manual reviews by
 * id. Each result has the shape `read` returns with `includeSource` and
 * `all-approved`. A worker absent from the registry reads as before
 * (`worker-missing`); there is no lifetime-size cut-off, since only the
 * month is read.
 */
export async function readQualityMonth(db, auth, input) {
  await adminOnly(db, auth);
  const parsed = z.object({ periodKey: month, bikerUIDs: z.array(identity).min(1).max(300) }).strict().safeParse(input);
  if (!parsed.success) bad('الفترة أو قائمة العمال غير صالحة.');
  const { periodKey } = parsed.data;
  const uids = [...new Set(parsed.data.bikerUIDs)];
  const [reportSnap, washSnap, workers, manualDocs] = await Promise.all([
    db.collection(QUALITY_COLLECTION).where('periodKey', '==', periodKey).get(),
    db.collection('washes').where('wash_date', '>=', periodKey).where('wash_date', '<', nextMonthKey(periodKey)).get(),
    db.getAll(...uids.map(uid => db.collection('bikers').doc(uid))),
    db.getAll(...uids.map(uid => db.collection(QUALITY_COLLECTION).doc(manualReviewId(uid, periodKey)))),
  ]);
  const reportsOf = new Map(); const washesOf = new Map();
  for (const doc of reportSnap.docs) {
    const report = { id: doc.id, ...doc.data() };
    if (!APPROVED_VERSIONS.includes(report.rulesVersion)) continue;
    if (!reportsOf.has(report.bikerUID)) reportsOf.set(report.bikerUID, []);
    reportsOf.get(report.bikerUID).push(report);
  }
  for (const doc of washSnap.docs) {
    const key = String(doc.get('biker_id') ?? '');
    if (!washesOf.has(key)) washesOf.set(key, []);
    washesOf.get(key).push({ id: doc.id, data: doc.data() });
  }
  const currentDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const monthEnd = new Date(Date.UTC(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { results: uids.map((bikerUID, index) => {
    const reports = (reportsOf.get(bikerUID) || []).sort(byNewest);
    let source;
    try {
      source = workers[index].exists
        ? canonicalQualitySourceFromRows(bikerUID, workers[index].data(), washesOf.get(bikerUID) || [], periodKey)
        : { available: false, reason: 'worker-missing' };
    } catch { source = { available: false, reason: 'read-failed' }; }
    const from = reports[0]?.from || `${periodKey}-01`;
    const to = reports[0]?.to || (monthEnd < currentDay ? monthEnd : currentDay);
    let manual = null;
    if (from <= to) {
      try { manual = manualReviewProjection(source, manualDocs[index].exists ? manualDocs[index].data() : null, { bikerUID, periodKey, from, to }); }
      catch { manual = { available: false, reason: 'manual-review-unavailable' }; }
    }
    return { bikerUID, data: { reports, source, manual } };
  }) };
}

export async function saveQualityReports(db, auth, input) {
  await adminOnly(db, auth);
  const parsed = z.object({ reports: z.array(z.unknown()).min(1).max(50) }).strict().safeParse(input);
  if (!parsed.success) bad('اختر من تقرير واحد إلى 50 تقريرًا.');
  const reports = parsed.data.reports.map(normalizeQualityReport);
  const washIds = [...new Set(reports.flatMap(r => [...r.samples, ...v2WashReferences(r)].map(s => s.washId)))];
  if (reports.some(r => [QUALITY_V2, QUALITY_V3].includes(r.rulesVersion))
    && washIds.length + reports.length * 2 > 450) bad('قسّم حفظ أدلة الجودة إلى دفعات أصغر.');
  const ids = reports.map(qualityReportId);
  if (new Set(ids).size !== ids.length) bad('التقارير مكررة.');
  return db.runTransaction(async tx => {
    // Re-resolve the SAME membership policy inside the atomic transaction.
    const roleDb = { collection: name => ({ doc: id => ({ get: () => tx.get(db.collection(name).doc(id)) }) }) };
    await adminOnly(roleDb, auth);
    const refs = ids.map(id => db.collection(QUALITY_COLLECTION).doc(id));
    const existing = await Promise.all(refs.map(ref => tx.get(ref)));
    const workers = await Promise.all(reports.map(r => tx.get(db.collection('bikers').doc(r.bikerUID))));
    const evidence = await Promise.all(washIds.map(id => tx.get(db.collection('washes').doc(id))));
    const evidenceById = new Map(washIds.map((id, index) => [id, evidence[index]]));
    const canonicalSources = await Promise.all(reports.map((r, i) => r.rulesVersion === QUALITY_V3 && workers[i].exists
      ? readCanonicalQualitySource(db, r.bikerUID, r.periodKey, { transaction: tx, worker: workers[i].data() }) : null));
    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      if (!workers[i].exists) throw new AuthError('العامل غير موجود؛ لم يُحفظ شيء.', { code: 'failed-precondition' });
      const worker = workers[i].data();
      validateV2Worker(report, worker);
      if (worker.start_date && worker.start_date > report.to && report.samples.length) bad('العامل خارج فترة الأدلة.');
      report.status = worker.start_date && worker.start_date > report.to ? 'outside-period' : 'incomplete';
      for (const sample of [...report.samples, ...v2WashReferences(report)]) {
        const wash = evidenceById.get(sample.washId);
        const row = wash.data();
        if (!wash.exists || row.biker_id !== report.bikerUID || !completedCommissionWash(row)
          || String(row.wash_date).slice(0, 10) !== sample.serviceDate || Number(row.quantity) !== 1) {
          throw new AuthError('دليل غسلة لا يطابق العامل والفترة والتنفيذ؛ لم يُحفظ شيء.', { code: 'failed-precondition' });
        }
        if ([QUALITY_V2, QUALITY_V3].includes(report.rulesVersion) && sample.appointmentId
          && String(row.ssp_booking_id || '') !== sample.appointmentId) {
          throw new AuthError('موعد مراجعة التحديث لا يطابق الغسلة؛ لم يُحفظ شيء.', { code: 'failed-precondition' });
        }
      }
      if (report.rulesVersion === QUALITY_V3) {
        finalizeQualityV3(report, canonicalSources[i]);
        if (worker.start_date && worker.start_date > report.to) report.status = 'outside-period';
      }
      if (existing[i].exists && existing[i].data().contentHash !== digest(report)) {
        throw new AuthError('تقرير الفترة محفوظ بمحتوى مختلف؛ لا يُستبدل تلقائيًا.', { code: 'already-exists' });
      }
    }
    let created = 0;
    reports.forEach((report, i) => {
      if (existing[i].exists) return;
      tx.create(refs[i], { ...report, contentHash: digest(report), createdBy: auth.uid,
        createdAt: new Date().toISOString(), ...(report.rulesVersion === QUALITY_V3 ? { canonicalValidatedAt: new Date().toISOString() } : {}) });
      created++;
    });
    return { ids, created, unchanged: reports.length - created };
  });
}
