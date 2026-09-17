// ═══════════════════════════════════════════════════════════════════════════
// حدّ إعادة التعيين — ما يمنع صندوق بريدٍ من أن يُغرَق من نموذجنا
// ═══════════════════════════════════════════════════════════════════════════
// `sendPasswordResetEmail` في المتصفّح يمرّ بحدود Google الخاصة. أمّا
// `generatePasswordResetLink` من Admin SDK فلا: هو استدعاء موثوق بلا سقف،
// ونحن من يرسل بعده. بلا هذا الحدّ يصبح النموذج المفتوح في صفحة الدخول
// مُرسِلاً مجانياً نحو أي صندوق بريد — وهو أسرع طريق لإحراق سمعة النطاق
// الذي بنيناه أصلاً لنخرج من السبام.
//
// العدّاد في Firestore لا في الذاكرة: كل طلب على Vercel قد يهبط على نسخة
// جديدة، فعدّادٌ في الذاكرة يعني بلا عدّاد.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

export const PASSWORD_RESET_THROTTLE_COLLECTION = 'password_reset_throttle';

/** ثانيةٌ بين رسالتين للبريد نفسه: يقتل التكرار العَرَضي على الزر. */
export const PASSWORD_RESET_COOLDOWN_MS = 60_000;
/** سقف اليوم للبريد الواحد: خمس محاولات تكفي أي استرجاع صادق. */
export const PASSWORD_RESET_DAILY_LIMIT = 5;
/** سقف اليوم لعنوان IP: يغطّي مكتباً كاملاً خلف نفس المخرج بلا أن يفتح الباب. */
export const PASSWORD_RESET_IP_DAILY_LIMIT = 20;
export const PASSWORD_RESET_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_CLEANUP_BATCH_SIZE = 400;

/**
 * مُعرّف الوثيقة تجزئةٌ لا البريد نفسه.
 *
 * قائمة بُرد المستخدمين مكتوبةً في مُعرّفات وثائق هي تسريبٌ جاهز لمن يقرأ
 * المجموعة يوماً ما، ولا نحتاج البريد الأصلي: العدّ لا القراءة هو المطلوب.
 */
export function throttleKey(kind, value) {
  const digest = createHash('sha256').update(`${kind}:${String(value ?? '')}`).digest('hex');
  return `${kind}_${digest.slice(0, 40)}`;
}

/** عنوان العميل خلف وكيل Vercel: أول قيمة في `x-forwarded-for` هي الأصل. */
export function clientIp(request) {
  const raw = request?.headers?.['x-forwarded-for'] ?? request?.headers?.['X-Forwarded-For'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const first = String(header ?? '').split(',')[0].trim();
  return first || String(request?.socket?.remoteAddress ?? '').trim() || 'unknown';
}

async function consumeOne(db, FieldValue, docId, { limit, cooldownMs, now }) {
  const ref = db.collection(PASSWORD_RESET_THROTTLE_COLLECTION).doc(docId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    const windowStartedAt = data?.windowStartedAt?.toDate?.()
      ?? (data?.windowStartedAt ? new Date(data.windowStartedAt) : null);
    const lastSentAt = data?.lastSentAt?.toDate?.()
      ?? (data?.lastSentAt ? new Date(data.lastSentAt) : null);

    const windowExpired = !windowStartedAt
      || (now.getTime() - windowStartedAt.getTime()) >= PASSWORD_RESET_WINDOW_MS;
    const count = windowExpired ? 0 : Number(data?.count ?? 0);

    if (cooldownMs && lastSentAt && (now.getTime() - lastSentAt.getTime()) < cooldownMs) {
      return { allowed: false, reason: 'cooldown' };
    }
    if (count >= limit) {
      return { allowed: false, reason: 'daily-limit' };
    }

    const startedAt = windowExpired ? now : windowStartedAt;
    tx.set(ref, {
      count: count + 1,
      windowStartedAt: startedAt,
      lastSentAt: now,
      // وقتٌ للانقضاء يقرأه كنّاس الـ cron: العدّادات المنتهية لا تُترك تتراكم.
      expiresAt: new Date(startedAt.getTime() + PASSWORD_RESET_WINDOW_MS),
      updatedAt: FieldValue?.serverTimestamp ? FieldValue.serverTimestamp() : now,
    }, { merge: true });

    return { allowed: true, reason: 'ok', count: count + 1 };
  });
}

/**
 * يحجز محاولةً واحدة للبريد ولعنوان الطلب معاً.
 *
 * الـ IP يُفحص أولاً: مَن يجرّب بُرداً كثيرة من مصدر واحد يُوقَف قبل أن يصنع
 * وثيقة عدّاد لكل بريدٍ يخمّنه.
 */
export async function consumePasswordResetQuota(db, FieldValue, { email, ip, now = new Date() }) {
  const ipResult = await consumeOne(db, FieldValue, throttleKey('ip', ip), {
    limit: PASSWORD_RESET_IP_DAILY_LIMIT, cooldownMs: 0, now,
  });
  if (!ipResult.allowed) return { allowed: false, reason: `ip-${ipResult.reason}` };

  const emailResult = await consumeOne(db, FieldValue, throttleKey('email', email), {
    limit: PASSWORD_RESET_DAILY_LIMIT, cooldownMs: PASSWORD_RESET_COOLDOWN_MS, now,
  });
  if (!emailResult.allowed) return { allowed: false, reason: `email-${emailResult.reason}` };

  return { allowed: true, reason: 'ok' };
}

/** كنسُ العدّادات المنتهية — يناديه cron التنظيف اليومي نفسه. */
export async function deleteExpiredPasswordResetThrottles(db, now = new Date()) {
  const snapshot = await db.collection(PASSWORD_RESET_THROTTLE_COLLECTION)
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(PASSWORD_RESET_CLEANUP_BATCH_SIZE)
    .get();

  if (snapshot.empty) return { deleted: 0, hasMore: false };

  const batch = db.batch();
  for (const document of snapshot.docs) batch.delete(document.ref);
  await batch.commit();

  return {
    deleted: snapshot.size,
    hasMore: snapshot.size === PASSWORD_RESET_CLEANUP_BATCH_SIZE,
  };
}
