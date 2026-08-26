// ═══════════════════════════════════════════════════════════════════════════
// مفاتيح التكامل — السرّ لا يُخزَّن صريحاً، ولا يعبر السلك بعد إنشائه
// ═══════════════════════════════════════════════════════════════════════════
// المطلوب كان أحد حلّين: مفتاحٌ في بيئة المستضيف بلا زرّ تدوير كاذب، أو نظام
// مفاتيح خادمي يعرض السرّ مرة ويدوّر ويُلغي. وهذا الثاني — مع تفضيل التوقيع
// `HMAC-SHA256`.
//
// ── والحلّان يتعارضان ظاهرياً ──
// «خزّن hash فقط» يمنع التحقق من HMAC: التوقيع يحتاج السرّ نفسه لا بصمته.
// والمخرج ليس التنازل عن أحدهما بل ما هو أقوى منهما: **السرّ مُعمّى في
// المخزن** (AES-256-GCM بمفتاحٍ رئيس من بيئة الخادم)، وبصمته وحدها ظاهرة
// للعرض. فَنَسخُ قاعدة البيانات كاملةً لا يعطي مفتاحاً — يحتاج معه مفتاح
// البيئة — والسرّ **لا يعبر السلك إطلاقاً بعد لحظة إنشائه**، لأن الوكيل
// يرسل توقيعاً لا سرّاً. وهذا أضيق من Bearer الذي يمرّ في كل طلب ويستقرّ في
// كل سجلّ وسيط.
//
// ── وماذا يحمي التوقيع فعلاً ──
// يربط الطلب بـ**جسمه وزمنه ومعرّف دفعته** معاً. فطلبٌ التُقط من سجلّ أو
// وسيط لا يمكن إعادة إرساله بجسمٍ آخر، ولا بعد نافذته، ولا بمعرّف دفعةٍ
// أخرى. والثلاثة معاً هي حماية الإعادة.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export const KEYS_COL = 'sweater_integration_keys';
export const RATE_COL = 'sweater_rate_limits';

/** الصلاحية الوحيدة لهذا الحساب. لا مدير ولا محاسب — نقلُ بياناتٍ فقط. */
export const INTEGRATION_SCOPE = 'integration_ingest';
export const INTEGRATION_PRINCIPAL = 'sweater-browser-agent';

/** نافذة قبول الطابع الزمني — واسعةٌ لانحراف الساعات، ضيقةٌ عن الإعادة. */
export const TIMESTAMP_SKEW_SECONDS = 300;
export const RATE_WINDOW_SECONDS = 60;
export const RATE_MAX_PER_WINDOW = 30;

export class IntegrationAuthError extends Error {
  constructor(message, { code = 'unauthenticated', details = null } = {}) {
    super(message);
    this.name = 'IntegrationAuthError';
    this.code = code;
    this.details = details;
  }
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

/** مقارنةٌ ثابتة الزمن — الطول يُوحَّد أولاً وإلا رمى `timingSafeEqual`. */
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) {
    // تُقارَن مع نفسها لتستهلك زمناً مشابهاً قبل الرفض.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

function masterKey() {
  const raw = String(process.env.SWEATER_KEY_ENCRYPTION_KEY ?? '').trim();
  if (!raw) {
    throw new IntegrationAuthError(
      'SWEATER_KEY_ENCRYPTION_KEY غير مضبوط على الخادم — لا يمكن إنشاء مفاتيح تكامل ولا التحقق منها. '
      + 'ولّد ٣٢ بايتاً عشوائياً بصيغة base64 وأضِفها في متغيّرات البيئة.',
      { code: 'failed-precondition' },
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new IntegrationAuthError(
      'SWEATER_KEY_ENCRYPTION_KEY يجب أن يكون ٣٢ بايتاً بصيغة base64.',
      { code: 'failed-precondition' },
    );
  }
  return buf;
}

function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    alg: 'aes-256-gcm',
  };
}

function decryptSecret(box) {
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(box.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** النصّ الذي يُوقَّع — ثلاثةٌ معاً: الزمن، والدفعة، والجسم. */
export function signingString(timestamp, importRunId, bodyHash) {
  return `${timestamp}.${importRunId}.${bodyHash}`;
}

export function computeSignature(secret, timestamp, importRunId, bodyHash) {
  return createHmac('sha256', String(secret))
    .update(signingString(timestamp, importRunId, bodyHash))
    .digest('hex');
}

/**
 * إنشاء مفتاح — يُعرض سرُّه **مرة واحدة** ولا يُسترجَع بعدها.
 *
 * لو أمكن استرجاعه لصار المخزن كافياً لانتحال الوكيل. وفَقْدُه ليس كارثة:
 * يُلغى ويُنشأ غيره، وهذا هو التدوير.
 */
export async function createIntegrationKey(db, FieldValue, { label = null, actor = null } = {}) {
  const secret = randomBytes(32).toString('base64url');
  const keyId = `sk_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const box = encryptSecret(secret);

  await db.collection(KEYS_COL).doc(keyId).set({
    keyId,
    label: label ? String(label).slice(0, 120) : null,
    scope: INTEGRATION_SCOPE,
    principal: INTEGRATION_PRINCIPAL,
    // البصمة للعرض والتمييز — لا تكفي لاشتقاق السرّ.
    fingerprint: sha256(secret).slice(0, 16),
    secretBox: box,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso: new Date().toISOString(),
    createdBy: actor ?? null,
    lastUsedAtIso: null,
    revokedAtIso: null,
    revokedBy: null,
  });

  // السرّ يُرجع هنا فقط، وفي هذه اللحظة فقط.
  return { keyId, secret, fingerprint: sha256(secret).slice(0, 16), scope: INTEGRATION_SCOPE };
}

export async function revokeIntegrationKey(db, FieldValue, { keyId, actor = null, reason = null }) {
  const ref = db.collection(KEYS_COL).doc(String(keyId));
  const snap = await ref.get();
  if (!snap.exists) throw new IntegrationAuthError('لا مفتاح بهذا المعرّف.', { code: 'not-found' });
  await ref.set({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedAtIso: new Date().toISOString(),
    revokedBy: actor ?? null,
    revokedReason: reason ? String(reason).slice(0, 300) : null,
  }, { merge: true });
  return { keyId: String(keyId), status: 'revoked' };
}

/** القائمة للعرض — بلا سرّ ولا معمّى، مهما كان دور الطالب. */
export async function listIntegrationKeys(db) {
  const snap = await db.collection(KEYS_COL).get();
  return snap.docs.map((d) => {
    const k = d.data();
    return {
      keyId: k.keyId, label: k.label, scope: k.scope, status: k.status,
      fingerprint: k.fingerprint,
      createdAtIso: k.createdAtIso ?? null, createdBy: k.createdBy ?? null,
      lastUsedAtIso: k.lastUsedAtIso ?? null, revokedAtIso: k.revokedAtIso ?? null,
    };
  });
}

/** حدّ المعدل — عدّادٌ في نافذةٍ زمنية، بمعاملة لأن serverless بلا ذاكرة. */
export async function checkRateLimit(db, FieldValue, keyId, nowMs) {
  const window = Math.floor(nowMs / 1000 / RATE_WINDOW_SECONDS);
  const ref = db.collection(RATE_COL).doc(`${keyId}__${window}`);
  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = (snap.exists ? Number(snap.data().count) || 0 : 0) + 1;
    tx.set(ref, { keyId, window, count: n, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return n;
  });
  if (count > RATE_MAX_PER_WINDOW) {
    throw new IntegrationAuthError(
      `تجاوزت ${RATE_MAX_PER_WINDOW} طلباً في ${RATE_WINDOW_SECONDS} ثانية — أعد المحاولة بعد قليل.`,
      { code: 'resource-exhausted' },
    );
  }
  return { count, window };
}

/**
 * التحقق الكامل من طلبٍ وارد.
 *
 * الترتيب مقصود: المفتاح، ثم الزمن، ثم التوقيع. ولا يُقال للمُرسِل أيُّها فشل
 * بتفصيل — «توقيع غير صالح» تكفي، لأن التمييز بين «مفتاح مجهول» و«توقيع خاطئ»
 * يُعطي من يجرّب خريطةً لما يجرّبه.
 */
export async function verifyIngestRequest(db, FieldValue, {
  keyId, timestamp, importRunId, bodyHash, signature, nowMs = Date.now(),
}) {
  if (!keyId || !timestamp || !signature || !importRunId || !bodyHash) {
    throw new IntegrationAuthError('طلبٌ غير موثّق — ينقصه المفتاح أو الطابع الزمني أو التوقيع.');
  }

  const snap = await db.collection(KEYS_COL).doc(String(keyId)).get();
  if (!snap.exists) throw new IntegrationAuthError('توقيع غير صالح.');
  const key = snap.data();
  if (key.status !== 'active') {
    throw new IntegrationAuthError('هذا المفتاح مُلغى.', { code: 'permission-denied' });
  }
  if (key.scope !== INTEGRATION_SCOPE) {
    // مفتاحٌ بصلاحيةٍ أخرى لا يدخل من هذا الباب مهما كانت.
    throw new IntegrationAuthError('صلاحية المفتاح لا تسمح بالاستلام.', { code: 'permission-denied' });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new IntegrationAuthError('طابع زمني غير صالح.');
  const skew = Math.abs(nowMs / 1000 - ts);
  if (skew > TIMESTAMP_SKEW_SECONDS) {
    throw new IntegrationAuthError(
      `الطابع الزمني خارج النافذة (${Math.round(skew)} ثانية) — تحقّق من ساعة الوكيل.`,
    );
  }

  const secret = decryptSecret(key.secretBox);
  const expected = computeSignature(secret, timestamp, importRunId, bodyHash);
  if (!safeEqualHex(expected, signature)) throw new IntegrationAuthError('توقيع غير صالح.');

  await checkRateLimit(db, FieldValue, String(keyId), nowMs);

  await db.collection(KEYS_COL).doc(String(keyId)).set({
    lastUsedAt: FieldValue.serverTimestamp(),
    lastUsedAtIso: new Date().toISOString(),
  }, { merge: true });

  return { keyId: String(keyId), principal: key.principal ?? INTEGRATION_PRINCIPAL, scope: key.scope };
}
