// ═══════════════════════════════════════════════════════════════════════════
// روابط المساعد الذكي للشركاء — رمزٌ في الرابط، وبصمته وحدها في المخزن
// ═══════════════════════════════════════════════════════════════════════════
// كل شريك يحصل على رابط MCP خاص: `/api/partner-mcp/<رمز>`. الرابط هو المفتاح
// — من يعرفه يقرأ حصّة صاحبه، لا أكثر — وهذا ما تقبله واجهات الموصِّلات في
// Claude وChatGPT: رابطٌ واحد يُلصَق، بلا تسجيل دخول ثانٍ.
//
// ── لماذا بصمة (hash) لا تعمية، خلافاً لمفاتيح سويتر ──
// `sweater/integrationKeys.js` يُعمّي السرّ لأن التحقق من HMAC يحتاج السرّ
// نفسه. هنا لا توقيع: الرمز يمرّ في كل طلب كـ Bearer، فالخادم يحسب بصمته
// ويبحث عنها. والبصمة كافية، بل أفضل: نسخُ قاعدة البيانات كاملةً لا يعطي
// رابطاً واحداً، بلا مفتاحٍ رئيس في البيئة يُفقَد أو يُدوَّر.
//
// ── مجموعتان لا واحدة ──
//   `partner_mcp_keys/{keyId}`       — ما يُعرض: الشريك والحالة والتواريخ. يقرأها
//                                       صاحبها والمدير (بالقواعد)، ولا يكتبها عميل.
//   `partner_mcp_key_hashes/{sha256}` — البحث: من البصمة إلى المفتاح. لا يقرأها
//                                       أحدٌ مهما كان دوره؛ الخادم يجلبها بالمعرّف
//                                       مباشرةً، فلا استعلام ولا فهرس ولا زمنٌ يسرّب.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const KEYS_COL = 'partner_mcp_keys';
export const HASHES_COL = 'partner_mcp_key_hashes';
export const RATE_COL = 'partner_mcp_rate_limits';

/**
 * ٦٠ لا ٣٠: عميل MCP بلا جلسة يرسل `initialize` و`notifications/initialized`
 * و`tools/list` قبل كل `tools/call` — فالسؤال الواحد ثلاثة أو أربعة طلبات.
 */
export const RATE_MAX_PER_WINDOW = 60;

/** لا يُكتب «آخر استعمال» أكثر من مرة كل خمس دقائق — كتابةٌ لكل طلب هدر. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const TOKEN_PREFIX = 'pmk_';
// ٣٢ بايتاً بصيغة base64url = ٤٣ حرفاً بالضبط. الشكل يُفحص قبل أي قراءة، فمن
// يجرّب رموزاً عشوائية لا يكلّف قاعدة البيانات شيئاً.
export const TOKEN_RE = /^pmk_[A-Za-z0-9_-]{43}$/;

export class PartnerMcpKeyError extends Error {
  constructor(message, { code = 'failed-precondition' } = {}) {
    super(message);
    this.name = 'PartnerMcpKeyError';
    this.code = code;
  }
}

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const isWellFormedToken = (token) => TOKEN_RE.test(String(token ?? ''));

const nowIso = () => new Date().toISOString();

/**
 * إنشاء رابط — والإنشاء تدويرٌ ضمناً.
 *
 * للشريك رابطٌ فعّال واحد في كل لحظة: أي رابط فعّال سابق يُلغى في نفس
 * المعاملة التي تكتب الجديد، فلا نافذة يعمل فيها رابطان، ولا نافذة لا يعمل
 * فيها أيٌّ منهما. والرمز يُرجع هنا، وهنا فقط.
 */
export async function createPartnerMcpKey(db, FieldValue, {
  partnerId, ownerUid, label = null, actor = null,
}) {
  if (!partnerId || !ownerUid) {
    throw new PartnerMcpKeyError('الرابط يحتاج شريكاً وحساباً مربوطاً.', { code: 'invalid-argument' });
  }
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const keyId = `pmk_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const createdAtIso = nowIso();

  const rotatedKeyIds = await db.runTransaction(async (tx) => {
    const active = await tx.get(
      db.collection(KEYS_COL).where('partnerId', '==', String(partnerId)).where('status', '==', 'active'),
    );
    const rotated = [];
    for (const d of active.docs) {
      rotated.push(d.id);
      tx.set(d.ref, {
        status: 'revoked',
        revokedAt: FieldValue.serverTimestamp(),
        revokedAtIso: createdAtIso,
        revokedBy: actor ?? null,
        revokedReason: 'تدوير',
      }, { merge: true });
    }
    tx.set(db.collection(KEYS_COL).doc(keyId), {
      keyId,
      partnerId: String(partnerId),
      ownerUid: String(ownerUid),
      status: 'active',
      label: label ? String(label).slice(0, 120) : null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtIso,
      createdBy: actor ?? null,
      lastUsedAtIso: null,
      revokedAtIso: null,
      revokedBy: null,
      revokedReason: null,
      rotatedFrom: rotated[0] ?? null,
    });
    tx.set(db.collection(HASHES_COL).doc(hashToken(token)), {
      keyId, partnerId: String(partnerId), ownerUid: String(ownerUid), createdAtIso,
    });
    return rotated;
  });

  return { keyId, token, createdAtIso, rotatedKeyIds };
}

/** إلغاء — وإلغاءُ المُلغى لا يخطئ: النتيجة هي هي. */
export async function revokePartnerMcpKey(db, FieldValue, { keyId, actor = null, reason = null }) {
  const ref = db.collection(KEYS_COL).doc(String(keyId ?? ''));
  const snap = await ref.get();
  if (!snap.exists) throw new PartnerMcpKeyError('لا رابط بهذا المعرّف.', { code: 'not-found' });
  if (snap.data().status === 'revoked') {
    return { keyId: snap.id, status: 'revoked', revokedAtIso: snap.data().revokedAtIso ?? null };
  }
  const revokedAtIso = nowIso();
  await ref.set({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedAtIso,
    revokedBy: actor ?? null,
    revokedReason: reason ? String(reason).slice(0, 300) : null,
  }, { merge: true });
  return { keyId: snap.id, status: 'revoked', revokedAtIso };
}

/**
 * من الرمز إلى صاحبه — أو `null`.
 *
 * `null` واحدٌ لكل فشل: شكلٌ خاطئ، بصمةٌ مجهولة، مفتاحٌ مُلغى، شريكٌ محذوف،
 * أو شريكٌ أُعيد ربطه بحسابٍ آخر. المنفذ يردّ عليها كلها بـ 404 واحد، فمن
 * يجرّب لا يتعلّم أيَّها أصاب.
 *
 * وفحص `user_id` في كل طلب مقصود: لو نقلت الإدارة سجل الشريك إلى حسابٍ آخر،
 * يموت رابط الحساب القديم في اللحظة نفسها، لا عند إلغاءٍ قد لا يتذكّره أحد.
 */
export async function resolvePartnerMcpToken(db, token) {
  if (!isWellFormedToken(token)) return null;
  const hashSnap = await db.collection(HASHES_COL).doc(hashToken(token)).get();
  if (!hashSnap.exists) return null;
  const { keyId, ownerUid } = hashSnap.data();

  const keySnap = await db.collection(KEYS_COL).doc(String(keyId)).get();
  if (!keySnap.exists || keySnap.data().status !== 'active') return null;
  const key = keySnap.data();

  const partnerSnap = await db.collection('partners').doc(String(key.partnerId)).get();
  if (!partnerSnap.exists) return null;
  const partner = partnerSnap.data();
  if (String(partner.user_id ?? '') !== String(ownerUid ?? key.ownerUid ?? '')) return null;

  return {
    keyId: keySnap.id,
    partnerId: partnerSnap.id,
    ownerUid: String(key.ownerUid),
    lastUsedAtIso: key.lastUsedAtIso ?? null,
    createdAtIso: key.createdAtIso ?? null,
    partner: {
      id: partnerSnap.id,
      partnerName: partner.partner_name ?? '',
      workersCount: Number(partner.workers_count) || 0,
      status: partner.status ?? 'active',
    },
  };
}

/** يُسجّل «آخر استعمال» — بخفّة: مرةً كل `TOUCH_INTERVAL_MS`. */
export async function touchPartnerMcpKey(db, FieldValue, { keyId, lastUsedAtIso = null, nowMs = Date.now() }) {
  const last = lastUsedAtIso ? Date.parse(lastUsedAtIso) : NaN;
  if (Number.isFinite(last) && nowMs - last < TOUCH_INTERVAL_MS) return false;
  await db.collection(KEYS_COL).doc(String(keyId)).set({
    lastUsedAt: FieldValue.serverTimestamp(),
    lastUsedAtIso: new Date(nowMs).toISOString(),
  }, { merge: true });
  return true;
}
