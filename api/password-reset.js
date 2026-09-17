// ═══════════════════════════════════════════════════════════════════════════
// /api/password-reset — الرابط من Firebase، والرسالة من نطاقنا
// ═══════════════════════════════════════════════════════════════════════════
// المسار القديم كان سطراً واحداً في المتصفّح: `sendPasswordResetEmail` يولّد
// الرابط ويرسل الرسالة معاً — من `noreply@<project>.firebaseapp.com`. الرابط
// كان سليماً دائماً؛ الرسالة هي التي كانت تنتهي في السبام.
//
// هنا يُفصَل الأمران: Admin SDK يولّد الرابط (نفس الأمان، نفس مدّة الصلاحية،
// نفس صفحة Firebase التي تعالج الرمز)، ثم نرسله نحن من نطاقٍ نملكه وبقالبٍ
// عربي. إن لم يُضبط مزوّد بريد، يردّ هذا المسار `501` والواجهة تعود إلى مسار
// Firebase — فالأسوأ من رسالة في السبام هو غياب الرسالة.
//
// ── ما لا يقوله هذا المسار أبداً ──
// «لا يوجد حساب بهذا البريد» جوابٌ يحوّل نموذج الاسترجاع إلى أداة تعداد
// للحسابات. الردّ موحّد: بريدٌ معروف أو مجهول، يرى المتصفّح `200 { ok: true }`.
//
// ── متغيّرات البيئة ──
//   FIREBASE_SERVICE_ACCOUNT            مفتاح الخدمة (موجود أصلاً لـ /api/ledger)
//   PASSWORD_RESET_EMAIL_PROVIDER       resend | sendgrid | mailgun
//   PASSWORD_RESET_EMAIL_API_KEY        مفتاح المزوّد
//   PASSWORD_RESET_EMAIL_FROM           no-reply@your-domain.com  (نطاق موثّق)
//   PASSWORD_RESET_EMAIL_FROM_NAME      اسم المرسِل الظاهر (اختياري)
//   PASSWORD_RESET_EMAIL_REPLY_TO       صندوق يقرأه بشر (اختياري، مُستحسن)
//   PASSWORD_RESET_APP_URL              عنوان اللوحة للعودة إليها بعد التعيين
//   PASSWORD_RESET_LINK_HOST            نطاق إجراءات مخصّص بعد توثيقه (اختياري)
// التفاصيل وسجلات DNS في docs/EMAIL_DELIVERABILITY.md
// ═══════════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto';
import {
  PasswordResetEmailError,
  normalizeEmail,
  readMailerConfig,
  renderPasswordResetEmail,
  deliverPasswordResetEmail,
} from '../server/passwordResetEmail.js';
import { clientIp, consumePasswordResetQuota } from '../server/passwordResetThrottle.js';
import { PasswordResetConfigError, getPasswordResetRuntime } from '../server/passwordResetRuntime.js';

export const config = { maxDuration: 30 };

const MAX_BODY_BYTES = 4 * 1024;

/**
 * الجسم قد يصل مُحلّلاً (Vercel) أو تيّاراً (اختبار، مستضيف آخر).
 * الحالتان مدعومتان كي لا يعتمد الصواب على مَن يستضيف.
 */
async function readJsonBody(request) {
  const given = request?.body;
  if (given && typeof given === 'object' && !Buffer.isBuffer(given)) return given;
  if (typeof given === 'string') {
    try { return JSON.parse(given); } catch { return {}; }
  }

  if (typeof request?.[Symbol.asyncIterator] !== 'function') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) return {};
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/**
 * نطاق إجراءات مخصّص — بعد توثيقه في Firebase وحده.
 *
 * لا يُعاد الكتابة إلا على النطاق الافتراضي `*.firebaseapp.com`: إن كان
 * المشروع يُصدر أصلاً رابطاً على نطاقٍ مخصّص فالمتغيّر زائد، وإعادة كتابته
 * فوقه تكسر رابطاً يعمل.
 */
export function applyCustomLinkHost(link, host) {
  const target = String(host ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!target) return link;
  try {
    const url = new URL(link);
    if (!url.hostname.endsWith('.firebaseapp.com')) return link;
    url.hostname = target;
    return url.toString();
  } catch {
    return link;
  }
}

/** رموز رفضِ رابطِ العودة وحده — لا رفضِ الطلب كلّه. */
const CONTINUE_URI_REJECTED = /(unauthorized|invalid|missing)-continue-uri/;

/**
 * يولّد رابط إعادة التعيين، ويتخلّى عن رابط العودة قبل أن يتخلّى عن المستخدم.
 *
 * رابط العودة إلى اللوحة لا يُقبل إلا إذا كان أصله ضمن «النطاقات المصرّح بها»
 * في Firebase Auth. ونطاق نشرٍ جديد ليس منها، فيُرفض الطلب كلّه بـ
 * `auth/unauthorized-continue-uri` — ويسقط معه المسار الوحيد الذي يستعيد به
 * المستخدم حسابه، من أجل زينةٍ لا من أجل الرابط نفسه.
 *
 * الكود الأصلي في `LoginScreen.jsx` كان يحمل هذا الحارس، ونُقل إلى المسار
 * الاحتياطي في `src/lib/passwordReset.js` — لكنه فات المسار الخادمي، فكان
 * أول عطل حقيقي في الإنتاج. رابطٌ بلا عودة يعمل؛ وغياب الرسالة لا يعمل.
 */
export async function generateLink(auth, email, appUrl) {
  if (!appUrl) return auth.generatePasswordResetLink(email);
  try {
    return await auth.generatePasswordResetLink(email, { url: appUrl, handleCodeInApp: false });
  } catch (error) {
    if (!CONTINUE_URI_REJECTED.test(String(error?.code ?? ''))) throw error;
    console.warn(JSON.stringify({
      severity: 'WARNING', event: 'password-reset-continue-uri-rejected',
      hint: 'أضِف نطاق PASSWORD_RESET_APP_URL إلى Firebase Auth ← Settings ← Authorized domains.',
    }));
    return auth.generatePasswordResetLink(email);
  }
}

/**
 * رمز الخطأ متى كان آمناً للعرض.
 *
 * رموز Firebase (`auth/…`, `app/…`) تعدادٌ منشور في التوثيق، لا نصٌّ حرّ:
 * لا تحمل مفتاحاً ولا عنوان بريد ولا أثر مكدّس. وما يخصّ وجود الحساب
 * (`user-not-found`) لا يصل هنا أصلاً — يُعترض قبله ويُردّ بـ ٢٠٠.
 *
 * الكتم الكامل بدا حصافةً وكان عطلاً: أول عطل حقيقي في الإنتاج قضى جولتين
 * كاملتين من النشر قبل أن يُعرف موضعه، لأن الردّ لم يقل غير «داخلي».
 */
export function safeErrorCode(error) {
  const code = String(error?.code ?? '');
  return /^(auth|app|messaging|firestore)\/[a-z0-9-]+$/.test(code) ? code : undefined;
}

export function createPasswordResetHandler({
  runtimeFactory = getPasswordResetRuntime,
  mailerConfig = readMailerConfig,
  render = renderPasswordResetEmail,
  send = deliverPasswordResetEmail,
  consumeQuota = consumePasswordResetQuota,
  now = () => new Date(),
} = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ ok: false, error: 'method-not-allowed' });
      return;
    }

    // الضبط يُقرأ قبل أي عمل: بلا مزوّد لا داعي لفتح Firestore ولا لتوليد رابط.
    let mailer;
    try {
      mailer = mailerConfig(process.env);
    } catch (error) {
      if (error instanceof PasswordResetEmailError) {
        console.error(JSON.stringify({
          severity: 'ERROR', event: 'password-reset-misconfigured', code: error.code,
        }));
        response.status(500).json({ ok: false, error: error.code });
        return;
      }
      throw error;
    }
    if (!mailer.enabled) {
      // ليس خطأً: إشارةٌ للواجهة بأن تستخدم مسار Firebase المدمج.
      response.status(501).json({ ok: false, error: 'not-configured' });
      return;
    }

    const body = await readJsonBody(request);
    const email = normalizeEmail(body?.email);
    if (!email) {
      response.status(400).json({ ok: false, error: 'email-invalid' });
      return;
    }

    const incidentId = randomBytes(6).toString('hex');
    // أي خطوة كنا فيها حين سقط الطلب. يُعاد إلى المتصفّح لأن «داخلي» وحده
    // يترك مَن يشخّص بلا شيء: رقم البلاغ لا يُقرأ إلا من سجلات المستضيف،
    // ومَن يضبط متغيّرات البيئة ليس بالضرورة مَن يملك الوصول إليها. الخطوة
    // اسمٌ ثابت من عندنا، لا رسالة خطأ ولا أثر مكدّس، فلا تسرّب فيها.
    let stage = 'runtime';
    try {
      const { auth, db, FieldValue } = runtimeFactory();

      stage = 'quota';
      const quota = await consumeQuota(db, FieldValue, {
        email, ip: clientIp(request), now: now(),
      });
      if (!quota.allowed) {
        console.info(JSON.stringify({
          severity: 'INFO', event: 'password-reset-throttled', reason: quota.reason,
        }));
        response.status(429).json({ ok: false, error: 'rate-limited', reason: quota.reason });
        return;
      }

      const appUrl = String(process.env.PASSWORD_RESET_APP_URL ?? '').trim();
      stage = 'link';
      let link;
      try {
        // رابط العودة إلى اللوحة يقرّره الخادم لا المتصفّح: قيمةٌ من الجسم
        // تعني إعادة توجيه مفتوحة داخل رسالة يثق بها المستخدم.
        link = await generateLink(auth, email, appUrl);
      } catch (error) {
        const code = String(error?.code ?? '');
        if (code.includes('user-not-found') || code.includes('email-not-found')) {
          // بريدٌ لا حساب له: الردّ نفسه تماماً، ولا رسالة تُرسل.
          console.info(JSON.stringify({
            severity: 'INFO', event: 'password-reset-unknown-account',
          }));
          response.status(200).json({ ok: true });
          return;
        }
        throw error;
      }

      stage = 'send';
      const finalLink = applyCustomLinkHost(link, process.env.PASSWORD_RESET_LINK_HOST);
      const message = render({ link: finalLink, appUrl });
      await send(mailer, { to: email, ...message });

      console.info(JSON.stringify({
        severity: 'INFO', event: 'password-reset-sent', provider: mailer.provider,
      }));
      response.status(200).json({ ok: true });
    } catch (error) {
      // السبب لا يُشتق من وجود الحساب، فذكره لا يفتح باب التعداد — والواجهة
      // تحتاجه لتقرّر العودة إلى مسار Firebase بدل ترك المستخدم بلا رسالة.
      const isProvider = error instanceof PasswordResetEmailError;
      const isConfig = error instanceof PasswordResetConfigError;
      console.error(JSON.stringify({
        severity: 'ERROR', event: 'password-reset-failure', incidentId, stage,
        code: isProvider || isConfig ? error.code : safeErrorCode(error),
        errorName: error?.name || 'Error',
        // نصّ الخطأ في السجلّ وحده. سجلّ المستضيف ليس مقروءاً للعامة، ورسالة
        // Firebase هي ما يسمّي الصلاحية الناقصة بالضبط — وحجبها عن السجل
        // أيضاً حِرصٌ لا يحمي أحداً ويُعمي مَن يصلح.
        detail: isProvider ? undefined : String(error?.message ?? '').slice(0, 300),
      }));
      // سوء الضبط ليس خطأ المتصل ولا عطلاً في الكود: ٥٠٣ ورسالة تسمّي
      // المتغيّر، كما يفعل /api/ledger — نصّها من عندنا لا من الاستثناء.
      if (isConfig) {
        response.status(503).json({ ok: false, error: 'configuration', message: error.message });
        return;
      }
      response.status(isProvider ? 502 : 500).json({
        ok: false, error: isProvider ? error.code : 'internal',
        stage, code: isProvider ? undefined : safeErrorCode(error), incidentId,
      });
    }
  };
}

export default createPasswordResetHandler();
