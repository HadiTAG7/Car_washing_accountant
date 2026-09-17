// ─── طلب رابط إعادة التعيين — مسارٌ مفضّل ومسارٌ احتياطي ───────────────────
// المسار المفضّل هو `/api/password-reset`: الرابط نفسه من Firebase، لكن
// الرسالة تخرج من نطاقنا موقّعةً بـ SPF/DKIM/DMARC، فتصل الوارد بدل السبام.
//
// الاحتياطي هو `sendPasswordResetEmail` المدمج. يُستخدم حين لا يكون مزوّد
// البريد مضبوطاً بعد (`501`)، أو حين يسقط المسار الخادمي (`5xx`, شبكة).
// رسالةٌ في السبام أفضل من لا رسالة: الاسترجاع هو الطريق الوحيد إلى حسابٍ
// ضاعت كلمة مروره، وقطعه يعني قفل المستخدم خارج النظام.

import { sendPasswordResetEmail } from 'firebase/auth';

export const PASSWORD_RESET_ENDPOINT = '/api/password-reset';

/** رسائل الحدّ: الرقم الذي يراه المستخدم أنفع من كلمة «حاول لاحقاً». */
const RATE_LIMITED_MESSAGE =
  'طلبات كثيرة على هذا البريد — انتظر دقيقة ثم أعد المحاولة، '
  + 'وتفقّد بريدك: قد تكون الرسالة السابقة وصلت بالفعل.';

export class PasswordResetRateLimited extends Error {
  constructor() {
    super(RATE_LIMITED_MESSAGE);
    this.name = 'PasswordResetRateLimited';
    this.code = 'rate-limited';
  }
}

/**
 * يحاول المسار الخادمي.
 * يرجع `'sent'` عند النجاح، و`'fallback'` حين يتعيّن استخدام مسار Firebase،
 * ويرمي `PasswordResetRateLimited` حين يرفض الخادم لكثرة الطلبات.
 */
async function requestFromServer(email, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(PASSWORD_RESET_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    return 'fallback'; // شبكة أو مسار غير منشور — لا تقطع الاسترجاع.
  }

  if (response.ok) return 'sent';
  if (response.status === 429) throw new PasswordResetRateLimited();
  // 501 = لا مزوّد مضبوط. 404/405 = المسار غير منشور. 5xx = عطل خادمي.
  // في كلٍّ منها يبقى مسار Firebase قادراً على إيصال رابط صالح.
  return 'fallback';
}

/**
 * يرسل رابط إعادة التعيين بأفضل مسار متاح.
 *
 * `auth` هو نسخة Firebase Auth، و`origin` عنوان اللوحة للعودة إليها.
 * يرجع `{ via: 'server' | 'firebase' }` لتستطيع الواجهة تنبيه المستخدم
 * لتفقّد السبام فقط حين يكون ذلك واردًا فعلاً.
 */
export async function requestPasswordReset(auth, email, {
  origin = '',
  fetchImpl = typeof fetch === 'function' ? fetch : null,
} = {}) {
  const target = String(email ?? '').trim();
  if (!target) throw new Error('البريد الإلكتروني مطلوب.');

  if (fetchImpl) {
    const outcome = await requestFromServer(target, fetchImpl);
    if (outcome === 'sent') return { via: 'server' };
  }

  // ── مسار Firebase المدمج ──
  // رابط العودة لا يعمل إلا إذا كان هذا الأصل ضمن النطاقات المصرّح بها في
  // Firebase Auth، وإلا فشل الطلب بـ auth/unauthorized-continue-uri وقطع
  // المسار الوحيد الذي يستعيد الحساب. لذلك هو محاولةٌ لا شرط.
  try {
    await sendPasswordResetEmail(auth, target, origin ? { url: origin } : undefined);
  } catch (err) {
    if (err?.code === 'auth/unauthorized-continue-uri') {
      await sendPasswordResetEmail(auth, target);
    } else {
      throw err;
    }
  }
  return { via: 'firebase' };
}
