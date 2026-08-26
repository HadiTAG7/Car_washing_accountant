// ═══════════════════════════════════════════════════════════════════════════
// باب وكيل سويتر — يعرف الاستلام وحده، ولا يعرف طريقاً إلى الدفاتر
// ═══════════════════════════════════════════════════════════════════════════
// هذا الباب **لا يمرّ بـ`dispatch`** ولا بسجل `GUARDS`. والعزل بنيوي لا
// تنظيمي: لو أُضيف دور `integration_ingest` إلى `callerRole` لصار قيمةً قد
// يقبلها حارسٌ آخر يوماً — بسهو، أو بشرطٍ كُتب `!== 'partner'` بدل قائمةٍ
// بيضاء. فالوكيل لا يملك دوراً في المنظومة أصلاً؛ يملك مفتاحاً يفتح باباً
// واحداً، وخلفه دالةٌ واحدة.
//
// وما لا يستطيعه الوكيل ليس ممنوعاً بفحصٍ هنا — هو **غير موجود** في هذا
// الملف: لا ترحيل، ولا إقفال فترة، ولا إصدار فاتورة، ولا اعتماد خصم. أقوى
// من أي `if`.
//
// ── ما يحتاجه للتشغيل ──
//   FIREBASE_SERVICE_ACCOUNT       مفتاح الخدمة JSON كاملاً
//   SWEATER_KEY_ENCRYPTION_KEY     ٣٢ بايتاً base64 — تعمية أسرار المفاتيح
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { verifyIngestRequest, IntegrationAuthError } from '../../../functions/src/sweater/integrationKeys.js';
import {
  ingestSweaterOperations, recordAgentHeartbeat, SweaterIngestError, MAX_BODY_BYTES,
} from '../../../functions/src/sweater/ingest.js';
import { hashBody } from '../../../functions/src/sweater/record.js';

const STATUS = {
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  'invalid-argument': 400,
  'failed-precondition': 412,
  'resource-exhausted': 429,
  internal: 500,
};

function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT غير مضبوط على المستضيف.');
  try { return JSON.parse(raw); } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT ليس JSON صالحاً.');
  }
}

function adminDb() {
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount()) });
  return getFirestore();
}

const header = (req, name) => {
  const v = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v ?? '');
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { code: 'invalid-argument', message: 'POST فقط.' } });
  }

  let db;
  try { db = adminDb(); } catch (e) {
    return res.status(503).json({ error: { code: 'failed-precondition', message: e.message } });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body ?? {});
  if (body === null) {
    return res.status(400).json({ error: { code: 'invalid-argument', message: 'الجسم ليس JSON صالحاً.' } });
  }

  // حدّ الحجم قبل أي عمل — حمولةٌ ضخمة تُرفض ولا تُحلَّل.
  const size = Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  if (size > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: {
        code: 'invalid-argument',
        message: `الحمولة ${Math.round(size / 1024)} كيلوبايت والحد ${Math.round(MAX_BODY_BYTES / 1024)} — قسّمها على دفعات.`,
      },
    });
  }

  const mode = String(body?.mode ?? 'import');
  const importRunId = String(body?.importRunId ?? '').trim();
  const dryRun = body?.dryRun === true;

  try {
    // ── التوقيع يغطي الجسم والزمن والدفعة معاً ──
    // `bodyHash` يُحسب هنا من السجلات الفعلية، لا يُؤخذ من المُرسِل — وإلا
    // وقّع على بصمةٍ وأرسل جسماً آخر.
    const bodyHash = hashBody(mode === 'heartbeat' ? (body?.agentStatus ?? '') : (body?.records ?? []));
    const auth = await verifyIngestRequest(db, FieldValue, {
      keyId: header(req, 'x-sweater-key-id'),
      timestamp: header(req, 'x-sweater-timestamp'),
      signature: header(req, 'x-sweater-signature'),
      importRunId: importRunId || (mode === 'heartbeat' ? 'heartbeat' : ''),
      bodyHash,
    });

    if (mode === 'heartbeat') {
      const out = await recordAgentHeartbeat(db, FieldValue, {
        agentStatus: body?.agentStatus,
        note: body?.note ?? null,
        coverage: body?.coverage ?? null,
      });
      return res.status(200).json({ result: { mode: 'heartbeat', ...out } });
    }

    const result = await ingestSweaterOperations(db, FieldValue, body, {
      actor: auth.principal,
      dryRun,
      source: 'browser_agent',
    });
    return res.status(200).json({ result });
  } catch (e) {
    const code = (e instanceof IntegrationAuthError || e instanceof SweaterIngestError)
      ? e.code : 'internal';
    const status = STATUS[code] ?? 500;
    // رسالةٌ داخلية لا تُسرَّب — والموثّقة تُقال كما هي ليتصرّف الوكيل.
    const message = status === 500 ? 'خطأ داخلي.' : e.message;
    if (status === 500) console.error('🔥 sweater/import:', e);
    return res.status(status).json({ error: { code, message, details: e.details ?? null } });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
