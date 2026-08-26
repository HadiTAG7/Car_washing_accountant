// ═══════════════════════════════════════════════════════════════════════════
// استلام عمليات سويتر — خامٌ لا يُمحى، وتكرارٌ لا يمرّ، ونتيجةٌ تُقرأ
// ═══════════════════════════════════════════════════════════════════════════
// الوكيل ينقل بيانات فقط. هنا تُحفظ كما وردت، ثم تُطبَّع، ثم تُقارَن ببصمتها،
// ثم تُصنَّف. ولا يُنشأ قيدٌ ولا يُحتسب إيراد — ذلك قرارٌ شهري منفصل.
//
// ── ثلاث ضمانات ──
// ١) **الخام لا يُعدَّل ولا يُحذف**: كل نسخة سجلٍّ مستندٌ جديد. نسختان لحجزٍ
//    واحد ليستا تكراراً بل **تاريخه** — وهو ما يجعل «تعديلٌ وصل متأخراً»
//    سؤالاً له جواب.
// ٢) **إعادة الدفعة نفسها لا تفعل شيئاً**: معرّفات المستندات حتمية، فالكتابة
//    الثانية تكتب نفس المحتوى في نفس المكان. لا فحصٌ قد يسبقه سباق — بل
//    بناءٌ يجعل التكرار مستحيلاً.
// ٣) **الفشل في المنتصف لا يترك نصف شيء**: يُطالَب بمعرّف الدفعة أولاً في
//    معاملة، فدفعتان متزامنتان بنفس المعرّف تتصادمان وتفوز واحدة. والاستئناف
//    بإعادة الإرسال — وهي بلا أثرٍ ثانٍ بحكم (١) و(٢).
//
// ── وما لا يُقرَّر هنا ──
// الأهلية تُحسب وتُخزَّن للعرض، لكنها **لا تُنشئ قيداً**. والخصم المستورد
// يُسجَّل `pending_review` ولا يصل الدفاتر إلا باعتماد. استيرادُ رقمٍ ليس
// إقراراً به.
// ═══════════════════════════════════════════════════════════════════════════

import { recordProblems, normalizeRecord, hashRecord, hashBody, SCHEMA_VERSION } from './record.js';
import { coverageProblems } from './recognition.js';
import { AGENT_STATUS } from './vocab.js';
import { isoDay } from './datedConfig.js';

export const COL = Object.freeze({
  RAW: 'sweater_raw_payloads',
  BOOKINGS: 'sweater_bookings',
  RUNS: 'sweater_import_runs',
  STATE: 'sweater_integration_state',
  VARIANCES: 'sweater_variances',
});

/** حدودٌ تُقال بأرقامها حين تُتجاوز — «الحمولة كبيرة» ليست رسالة يُتصرَّف بها. */
export const MAX_RECORDS = 500;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class SweaterIngestError extends Error {
  constructor(message, { code = 'invalid-argument', details = null } = {}) {
    super(message);
    this.name = 'SweaterIngestError';
    this.code = code;
    this.details = details;
  }
}

/** معرّف مستند الخام — حتميّ، فإعادة الإرسال تكتب فوق نفسها لا بجوارها. */
export const rawDocId = (importRunId, sspBookingId) =>
  `${importRunId}__${encodeURIComponent(sspBookingId)}`;

/** معرّف الحجز — المفتاح الطبيعي، فلا يوجد حجزان بنفس الرقم بحكم البناء. */
export const bookingDocId = (sspBookingId) => encodeURIComponent(String(sspBookingId));

export function envelopeProblems(payload) {
  const problems = [];
  if (!payload || typeof payload !== 'object') return ['الحمولة ليست كائناً.'];

  if (!String(payload.importRunId ?? '').trim()) {
    problems.push('importRunId مطلوب — وهو ما يجعل إعادة الإرسال بلا أثرٍ ثانٍ.');
  }
  if (payload.agentStatus && !AGENT_STATUS.includes(payload.agentStatus)) {
    problems.push(`حال الوكيل غير معروف: ${payload.agentStatus}`);
  }
  const records = payload.records;
  if (records != null && !Array.isArray(records)) problems.push('records يجب أن تكون قائمة.');
  if (Array.isArray(records) && records.length > MAX_RECORDS) {
    problems.push(`الدفعة ${records.length} سجلاً والحد ${MAX_RECORDS} — قسّمها على دفعات.`);
  }
  return problems;
}

/**
 * تصنيف سجلٍ واحد مقابل ما هو مخزَّن.
 *
 * `posted` هو الفارق الحاسم: حجزٌ دخل الدفاتر لا يُعدَّل مصدره أبداً. تُحفظ
 * نسخته الجديدة، ويُسجَّل **فرق**، ويُترك القرار للمراجعة — لأن تعديل مصدرٍ
 * مُرحَّل يجعل الدفتر يصف صفّاً لم يعد موجوداً.
 */
export function classifyRecord(normalized, hash, existing) {
  if (!existing) return { outcome: 'new' };
  if (existing.sourceHash === hash) return { outcome: 'duplicate' };
  if (existing.processingStatus === 'posted' || existing.postedEntryId) {
    return {
      outcome: 'needs_review',
      reasonCode: 'modified_after_posting',
      reasonAr: `الحجز مُرحَّل بالفعل وتغيّرت بياناته — لا يُعدَّل مصدره. `
        + 'سُجِّل فرقٌ للمراجعة، والتصحيح بقيد تعديل أو عكس.',
      variance: true,
    };
  }
  return { outcome: 'modified' };
}

/** ما تغيّر بين نسختين — للفرق، وللمراجع الذي يسأل «ما الذي تحرّك؟». */
export function diffRecords(before, after) {
  const changed = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (k === 'sourceHash' || k === 'schemaVersion') continue;
    const a = before?.[k] ?? null;
    const b = after?.[k] ?? null;
    if (!Object.is(a, b)) changed.push({ field: k, before: a, after: b });
  }
  return changed;
}

/**
 * الاستلام كاملاً.
 *
 * `dryRun` يمرّ بكل شيء — التحقق، والبحث عن الموجود، والتصنيف — ولا يكتب
 * حرفاً. فالمعاينة تقول ما **سيحدث** بالضبط، لا ما نظنّه.
 */
export async function ingestSweaterOperations(db, FieldValue, payload, {
  actor = 'sweater-browser-agent', dryRun = false, source = 'browser_agent',
} = {}) {
  const envelope = envelopeProblems(payload);
  if (envelope.length) throw new SweaterIngestError(envelope[0], { details: { problems: envelope } });

  const importRunId = String(payload.importRunId).trim();
  const bodyHash = hashBody(payload.records ?? []);
  const records = Array.isArray(payload.records) ? payload.records : [];
  const coverage = payload.coverage ?? null;
  const coverageIssues = coverageProblems(coverage);

  const runRef = db.collection(COL.RUNS).doc(importRunId);

  // ── المطالبة بالمعرّف أولاً: هنا يُحسم التزامن وإعادة الإرسال معاً ──
  if (!dryRun) {
    const verdict = await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      if (snap.exists) {
        const prev = snap.data();
        if (prev.bodyHash === bodyHash) return { replay: true, result: prev.result ?? null };
        // نفس المعرّف بحمولةٍ أخرى: إما عبثٌ وإما وكيلٌ أعاد استعمال معرّف.
        // كلاهما يُرفض — قبولُه يجعل «الدفعة رقم كذا» تعني شيئين.
        throw new SweaterIngestError(
          `المعرّف ${importRunId} استُعمل بحمولة مختلفة — لا يُعاد استعماله.`,
          { code: 'already-exists' },
        );
      }
      tx.set(runRef, {
        importRunId, bodyHash, source, actor,
        agentStatus: payload.agentStatus ?? 'ok',
        coverage, coverageIssues,
        recordCount: records.length,
        startedAt: FieldValue.serverTimestamp(),
        startedAtIso: new Date().toISOString(),
        status: 'running',
        schemaVersion: SCHEMA_VERSION,
      });
      return { replay: false };
    });
    if (verdict.replay) {
      return { importRunId, dryRun: false, replay: true, ...(verdict.result ?? {}) };
    }
  }

  // ── القراءة ثم التصنيف ──
  const rows = [];
  const counts = { new: 0, modified: 0, duplicate: 0, rejected: 0, needsReview: 0 };
  const seenInBatch = new Map();

  for (const raw of records) {
    const problems = recordProblems(raw);
    if (problems.length) {
      counts.rejected += 1;
      rows.push({
        sspBookingId: String(raw?.sspBookingId ?? '—'),
        outcome: 'rejected',
        reasonCode: problems[0].code,
        reasonAr: problems[0].ar,
        allProblems: problems,
      });
      continue;
    }

    const normalized = normalizeRecord(raw);
    const hash = hashRecord(normalized);
    const id = normalized.sspBookingId;

    // تكرارٌ داخل الدفعة نفسها — مصدران أرسلا الحجز ذاته، أو صفحةٌ تكرّرت.
    if (seenInBatch.has(id)) {
      const first = seenInBatch.get(id);
      counts[first === hash ? 'duplicate' : 'needsReview'] += 1;
      rows.push(first === hash
        ? { sspBookingId: id, outcome: 'duplicate', reasonCode: 'duplicate_in_batch',
          reasonAr: 'مكرر داخل الدفعة نفسها بنفس البيانات — أُهمل الثاني.' }
        : { sspBookingId: id, outcome: 'needs_review', reasonCode: 'duplicate_conflict',
          reasonAr: 'الحجز نفسه ورد مرتين في الدفعة ببيانات مختلفة — أيهما الصحيح؟' });
      continue;
    }
    seenInBatch.set(id, hash);

    const existingSnap = await db.collection(COL.BOOKINGS).doc(bookingDocId(id)).get();
    const existing = existingSnap.exists ? existingSnap.data() : null;
    const verdict = classifyRecord(normalized, hash, existing);

    const key = verdict.outcome === 'needs_review' ? 'needsReview'
      : verdict.outcome === 'new' ? 'new'
        : verdict.outcome === 'modified' ? 'modified' : 'duplicate';
    counts[key] += 1;

    rows.push({
      sspBookingId: id,
      outcome: verdict.outcome,
      reasonCode: verdict.reasonCode ?? null,
      reasonAr: verdict.reasonAr ?? null,
      _normalized: normalized,
      _hash: hash,
      _existing: existing,
      _variance: verdict.variance === true,
    });
  }

  if (dryRun) {
    return {
      importRunId, dryRun: true, replay: false,
      coverageIssues,
      counts,
      rows: rows.map(({ _normalized, _hash, _existing, _variance, ...r }) => r),
    };
  }

  // ── الكتابة: دفعاتٌ من ٢٠٠ مستند، ومعرّفاتٌ حتمية فلا تكرار ──
  const writable = rows.filter((r) => r._normalized && r.outcome !== 'duplicate');
  const CHUNK = 200;
  for (let i = 0; i < writable.length; i += CHUNK) {
    const batch = db.batch();
    for (const r of writable.slice(i, i + CHUNK)) {
      // ١) الخام — مستندٌ لكل نسخة، لا يُعدَّل ولا يُحذف.
      batch.set(db.collection(COL.RAW).doc(rawDocId(importRunId, r.sspBookingId)), {
        importRunId, source, actor,
        sspBookingId: r.sspBookingId,
        sourceHash: r._hash,
        schemaVersion: SCHEMA_VERSION,
        rawPayload: r._normalized,
        sourceUpdatedAt: r._normalized.completedAt ?? r._normalized.serviceDate ?? null,
        fetchedAt: FieldValue.serverTimestamp(),
        fetchedAtIso: new Date().toISOString(),
        processingStatus: r.outcome === 'needs_review' ? 'needs_review' : 'normalized',
        processingErrors: r.reasonCode ? [r.reasonCode] : [],
      });

      // ٢) الفرق حين تغيّر مُرحَّل — لا تعديل، بل سجلٌّ يُقرَّر فيه.
      if (r._variance) {
        batch.set(db.collection(COL.VARIANCES).doc(`${importRunId}__${bookingDocId(r.sspBookingId)}`), {
          kind: 'booking_modified_after_posting',
          sspBookingId: r.sspBookingId,
          importRunId,
          periodKey: String(r._existing?.serviceDate ?? '').slice(0, 7) || null,
          changes: diffRecords(r._existing?.record ?? null, r._normalized),
          resolution: 'unresolved',
          detectedAt: FieldValue.serverTimestamp(),
          detectedAtIso: new Date().toISOString(),
        });
      }

      // ٣) الحجز — لا يُلمَس إن كان مُرحَّلاً.
      if (!r._variance) {
        batch.set(db.collection(COL.BOOKINGS).doc(bookingDocId(r.sspBookingId)), {
          sspBookingId: r.sspBookingId,
          record: r._normalized,
          sourceHash: r._hash,
          schemaVersion: SCHEMA_VERSION,
          source,
          lastImportRunId: importRunId,
          serviceDate: r._normalized.serviceDate,
          periodKey: String(r._normalized.serviceDate ?? '').slice(0, 7) || null,
          normalizedStatus: r._normalized.normalizedStatus,
          processingStatus: r.outcome === 'needs_review' ? 'needs_review' : 'validated',
          reviewReasonCode: r.reasonCode ?? null,
          // الأهلية والتسعير يُحسبان في خطوة الاعتراف الشهرية — لا هنا.
          recognitionEligibility: null,
          recognitionReason: null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtIso: new Date().toISOString(),
        }, { merge: true });
      }
    }
    await batch.commit();
  }

  const result = {
    counts,
    coverageIssues,
    rows: rows.map(({ _normalized, _hash, _existing, _variance, ...r }) => r),
  };

  await runRef.set({
    status: coverageIssues.length ? 'completed_with_gaps' : 'completed',
    finishedAt: FieldValue.serverTimestamp(),
    finishedAtIso: new Date().toISOString(),
    result,
  }, { merge: true });

  // حال التكامل — تقرؤه صفحة الإعداد وحارس التقادم، بلا أي سرّ.
  await db.collection(COL.STATE).doc('current').set({
    lastRunId: importRunId,
    lastSuccessAt: FieldValue.serverTimestamp(),
    lastSuccessAtIso: new Date().toISOString(),
    lastAgentStatus: payload.agentStatus ?? 'ok',
    lastCoverage: coverage,
    lastCounts: counts,
    source,
  }, { merge: true });

  return { importRunId, dryRun: false, replay: false, ...result };
}

/**
 * نبضة الوكيل — يقول حاله بلا بيانات.
 *
 * `otp_required` و`session_expired` توقّفٌ آمن: الوكيل لا يحاول تجاوز مصادقة
 * ولا يخزّن رمزاً، ويرفع العلم ليراه صاحب النظام.
 */
export async function recordAgentHeartbeat(db, FieldValue, { agentStatus, note = null, coverage = null }) {
  if (!AGENT_STATUS.includes(agentStatus)) {
    throw new SweaterIngestError(`حال الوكيل غير معروف: ${agentStatus}`);
  }
  const alert = ['session_expired', 'otp_required', 'blocked'].includes(agentStatus);
  await db.collection(COL.STATE).doc('current').set({
    lastAgentStatus: agentStatus,
    lastHeartbeatAt: FieldValue.serverTimestamp(),
    lastHeartbeatAtIso: new Date().toISOString(),
    lastHeartbeatNote: note ? String(note).slice(0, 500) : null,
    ...(coverage ? { lastCoverage: coverage } : {}),
    ...(alert ? { alert: true, alertSince: FieldValue.serverTimestamp() } : { alert: false }),
  }, { merge: true });
  return { agentStatus, alert };
}

/** حارس التقادم — يُحسب لحظة القراءة، فلا يحتاج مجدولاً. */
export function stalenessOf(state, nowIso, { thresholdHours = 30 } = {}) {
  const last = state?.lastSuccessAtIso;
  if (!last) return { stale: true, reasonAr: 'لم يصل أي استيراد ناجح بعد.' };
  const hours = (Date.parse(nowIso) - Date.parse(last)) / 36e5;
  if (!Number.isFinite(hours)) return { stale: true, reasonAr: 'تاريخ آخر استيراد غير مقروء.' };
  return hours > thresholdHours
    ? { stale: true, hours: Math.floor(hours), reasonAr: `آخر استيراد ناجح قبل ${Math.floor(hours)} ساعة.` }
    : { stale: false, hours: Math.floor(hours) };
}

export { isoDay };
