import { z } from 'zod';
import { AuthError } from '../functions/src/handlers.js';

export const QUALITY_V2 = 'cqo-20261015-v2';
const bad = message => { throw new AuthError(message, { code: 'invalid-argument' }); };
const round = value => Math.round(value * 100) / 100;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
});
const proof = z.object({ reference: z.string().trim().min(1).max(500), hash: z.string().regex(/^[a-f0-9]{64}$/), readDate: day }).strict();
const wash = z.object({ washId: id, serviceDate: day }).strict();
const stars = z.object({ mean: z.number().min(0).max(5).nullable(), n: z.number().int().min(0).max(100000) }).strict()
  .refine(s => (s.n ? s.mean !== null : s.mean === null) && (s.mean === null || Math.abs(round(s.mean) - s.mean) < 1e-9));
const segment = z.object({ from: day, to: day, wash: stars, behavior: stars, source: proof }).strict();
const rate = z.object({ eligible: z.array(z.object({ id, serviceDate: day }).strict()).max(500),
  attributedIds: z.array(id).max(500), source: proof }).strict();
const extras = z.object({ rulesVersion: z.literal(QUALITY_V2), snapshotAt: z.string().datetime({ offset: true }),
  sourceIdentity: z.object({ externalId: id.nullable(), sspId: id.nullable() }).strict(),
  evidence: z.object({ ratings: z.array(segment).max(31).optional(),
    productivity: z.object({ workDays: z.array(day).max(31), completed: z.array(wash).max(500), source: proof }).strict().optional(),
    updates: z.object({ reviews: z.array(wash.extend({ appointmentId: id,
      forgotten: z.array(z.enum(['arrival', 'start', 'end'])).max(3), evidenceType: z.literal('explicit-status-review'), source: proof }).strict()).max(500) }).strict().optional(),
    complaints: rate.optional(), cancellations: rate.optional(), lateness: rate.optional(),
  }).strict(),
}).passthrough(); // Remaining base fields still pass through the unchanged STRICT v1 parser.
const unique = values => new Set(values).size === values.length;
const riyadhDay = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date(value));

export function normalizeQualityV2(input, normalizeV1) {
  const result = extras.safeParse(input);
  if (!result.success) bad('أدلة الجودة متعددة المعايير غير صالحة.');
  const { snapshotAt, sourceIdentity, evidence, ...base } = result.data;
  const report = normalizeV1({ ...base, rulesVersion: 'cqo-20261014-v1' });
  if (riyadhDay(snapshotAt) !== report.sourceReadDate || report.sourceReadDate > riyadhDay(Date.now())
    || Date.parse(snapshotAt) > Date.now() + 60000) bad('تاريخ لقطة الجودة غير صالح أو مستقبلي.');
  const inPeriod = date => date >= report.from && date <= report.to;
  const checkProof = (source, dates = []) => {
    if (source.readDate > report.sourceReadDate || dates.some(d => d > source.readDate)) bad('تاريخ قراءة الدليل لا يغطي الوقائع أو لاحق للّقطة.');
  };
  const checkWashes = rows => {
    if (!unique(rows.map(s => s.washId)) || rows.some(s => !inPeriod(s.serviceDate))) bad('دليل الغسلات مكرر أو خارج الفترة.');
  };
  const components = report.components.map(c => ({ ...c,
    reason: c.key === 'duration' ? c.reason : ({ washQuality: 'missing-rating-sample', behavior: 'missing-rating-sample',
      productivity: 'missing-work-days', statusUpdates: 'missing-explicit-status-review' }[c.key] || 'awaiting-rule-and-evidence') }));
  const update = (key, data) => Object.assign(components.find(c => c.key === key), data);
  const ratings = evidence.ratings || [];
  for (const s of ratings) {
    if (!inPeriod(s.from) || !inPeriod(s.to) || s.from > s.to || s.source.readDate < s.to) bad('نطاق عينة النجوم غير صالح.');
    checkProof(s.source);
  }
  for (const [key, field, weight] of [['washQuality', 'wash', 30], ['behavior', 'behavior', 20]]) {
    const measured = ratings.filter(s => s[field].n > 0).sort((a, b) => a.from.localeCompare(b.from));
    if (measured.some((s, i) => i && s.from <= measured[i - 1].to)) bad('مقاطع النجوم متداخلة؛ لا يجمع الإجمالي مع تفاصيله.');
    const n = measured.reduce((sum, s) => sum + s[field].n, 0);
    if (n) update(key, { n, points: round(measured.reduce((sum, s) => sum + s[field].mean * s[field].n, 0) / n / 5 * weight),
      approximate: true, reason: 'partial-rounded-rating-sample', unit: 'ratings' });
  }
  if (evidence.productivity) {
    const p = evidence.productivity;
    checkProof(p.source, [...p.workDays, ...p.completed.map(s => s.serviceDate)]); checkWashes(p.completed);
    if (!unique(p.workDays) || p.workDays.some(d => !inPeriod(d)) || p.completed.some(s => !p.workDays.includes(s.serviceDate))) bad('أيام العمل المثبتة غير صالحة.');
    if (p.workDays.length) update('productivity', { points: round(Math.min(1, p.completed.length / p.workDays.length / 8) * 10),
      n: p.workDays.length, completed: p.completed.length, reason: 'verified-work-days', unit: 'work-days' });
  }
  if (evidence.updates) {
    const reviews = evidence.updates.reviews;
    checkWashes(reviews);
    for (const row of reviews) {
      checkProof(row.source, [row.serviceDate]);
      if (!unique(row.forgotten)) bad('تحديث الحالة مكرر.');
    }
    // A booking can have several required transitions: count the booking ONCE.
    const affected = new Set(reviews.filter(r => r.forgotten.length).map(r => r.appointmentId)).size;
    if (reviews.length) update('statusUpdates', { points: round(Math.max(0, 10 - 100 * affected / reviews.length)),
      n: reviews.length, affected, reason: 'explicit-status-review', unit: 'reviewed-washes' });
  }
  for (const key of ['complaints', 'cancellations', 'lateness']) {
    const facts = evidence[key];
    if (!facts) continue;
    checkProof(facts.source, facts.eligible.map(r => r.serviceDate));
    if (!unique(facts.eligible.map(r => r.id)) || !unique(facts.attributedIds)
      || facts.eligible.some(r => !inPeriod(r.serviceDate)) || facts.attributedIds.some(id => !facts.eligible.some(r => r.id === id))) bad('مقام الحالات أو ربطها غير صالح.');
    update(key, { n: facts.eligible.length, affected: facts.attributedIds.length,
      rate: facts.eligible.length ? facts.attributedIds.length / facts.eligible.length : null,
      reason: facts.eligible.length ? 'awaiting-approved-rule' : 'awaiting-rule-and-evidence' });
    // No proposed complaint/cancellation/lateness curve is executable in v2.
  }
  if (Object.values(evidence).some(value => Array.isArray(value) ? value.length : Boolean(value)) && !sourceIdentity.externalId) bad('تحتاج الأدلة هوية سويتر المتحققة.');
  if (ratings.some(s => s.wash.n || s.behavior.n) && !sourceIdentity.sspId) bad('تحتاج عينة النجوم الربط المتحقق بهوية منصة المصدر.');
  const known = components.filter(c => c.points !== null);
  return { ...report, rulesVersion: QUALITY_V2, snapshotAt: new Date(snapshotAt).toISOString(), sourceIdentity, evidence, components,
    availablePoints: known.length ? round(known.reduce((sum, c) => sum + c.points, 0)) : null,
    availableWeight: known.reduce((sum, c) => sum + c.weight, 0),
    // Three policy curves are still awaiting human approval: never claim final/100.
    finalScore: null, status: 'incomplete' };
}

export function v2WashReferences(report) {
  return [...(report.evidence?.productivity?.completed || []), ...(report.evidence?.updates?.reviews || [])];
}

export function validateV2Worker(report, worker) {
  if (report.rulesVersion !== QUALITY_V2) return;
  if (report.sourceIdentity.externalId && String(worker.driver_external_id || '').trim() !== report.sourceIdentity.externalId) {
    throw new AuthError('هوية سويتر لا تطابق العامل؛ لم يُحفظ شيء.', { code: 'failed-precondition' });
  }
  const dates = [...report.samples.map(s => s.serviceDate), ...v2WashReferences(report).map(s => s.serviceDate),
    ...(report.evidence.productivity?.workDays || []), ...(report.evidence.ratings || []).flatMap(s => [s.from, s.to]),
    ...['complaints', 'cancellations', 'lateness'].flatMap(key => (report.evidence[key]?.eligible || []).map(r => r.serviceDate))];
  if (dates.some(d => (worker.start_date && d < worker.start_date) || (worker.end_date && d > worker.end_date))) {
    throw new AuthError('الدليل خارج فترة العامل؛ لم يُحفظ شيء.', { code: 'failed-precondition' });
  }
}
