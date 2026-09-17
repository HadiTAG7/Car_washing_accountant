// ═══════════════════════════════════════════════════════════════════════════
// رسالة إعادة تعيين كلمة المرور — من نطاقنا، لا من مجمّع مشترك
// ═══════════════════════════════════════════════════════════════════════════
// رسالة Firebase الافتراضية تخرج من `noreply@<project>.firebaseapp.com`:
// نطاق لا نملكه، ومحاذاة DMARC فيه تعود لـ `firebaseapp.com` — مجمّع مشترك
// تستخدمه ملايين المشاريع. النتيجة العملية أن Gmail يودعها السبام، وهو أسوأ
// ما يمكن أن يصيب المسار الوحيد الذي يستعيد به المستخدم حسابه.
//
// هذه الوحدة تبني الرسالة وترسلها عبر مزوّد نملك نطاقه (Resend / SendGrid /
// Mailgun) بواجهة HTTP — بلا اعتمادية جديدة، `fetch` فقط. الرابط نفسه يولّده
// Admin SDK؛ هنا الصياغة والإرسال لا التوليد.
//
// ── ما يجعلها تصل ──
//   • المرسِل على نطاقنا، موقّعاً بـ SPF + DKIM ومحاذى بـ DMARC (راجع
//     docs/EMAIL_DELIVERABILITY.md — بدون سجلات DNS هذه الوحدة لا تكفي).
//   • بديل نصي حقيقي مع كل رسالة HTML: الرسالة أحادية الجزء ترفع درجة السبام.
//   • نص كافٍ حول الرابط، ورابط واحد ظاهر بنصّه — «زر وحيد بلا سياق» هو نمط
//     التصيّد الذي تتعلّمه الفلاتر.
//   • بلا صور خارجية ولا مقتفيات فتح: كلاهما يرفع الدرجة بلا مقابل هنا.
// ═══════════════════════════════════════════════════════════════════════════

/** رفضٌ يفرّق بين سوء الضبط وخطأ البرنامج: لكلٍّ إصلاح مختلف. */
export class PasswordResetEmailError extends Error {
  constructor(message, { code = 'password-reset-email', httpStatus = 400 } = {}) {
    super(message);
    this.name = 'PasswordResetEmailError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const SUPPORTED_PROVIDERS = ['resend', 'sendgrid', 'mailgun'];

// ─── البريد ────────────────────────────────────────────────────────────────
// فحصٌ متحفّظ: يرفض ما لا يمكن أن يكون بريداً، ولا يدّعي مطابقة RFC 5322.
// المقاطع مكرّرة عمداً: `user@mail.company.com` بريد مؤسّسي شائع، ونمطٌ
// بنقطةٍ واحدة كان سيرفضه — أي يقفل صاحبه خارج حسابه بلا سبب.
const EMAIL_RE = /^[^\s@,;:<>"]+@(?:[^\s@,;:<>".]+\.)+[^\s@,;:<>".]{2,}$/;

export function normalizeEmail(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value || value.length > 254 || !EMAIL_RE.test(value)) return '';
  return value;
}

/**
 * ضبط المرسِل من متغيّرات البيئة.
 *
 * الغياب ليس خطأً: بلا مزوّد مضبوط يبقى المسار القديم (رسالة Firebase) عاملاً،
 * والواجهة ترجع إليه. لذلك `enabled:false` بدل رمي استثناء.
 */
export function readMailerConfig(env = process.env) {
  const provider = String(env.PASSWORD_RESET_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = String(env.PASSWORD_RESET_EMAIL_API_KEY ?? '').trim();
  const fromEmail = String(env.PASSWORD_RESET_EMAIL_FROM ?? '').trim();

  if (!provider && !apiKey && !fromEmail) {
    return { enabled: false, reason: 'not-configured' };
  }
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new PasswordResetEmailError(
      `PASSWORD_RESET_EMAIL_PROVIDER غير مدعوم — القيم المتاحة: ${SUPPORTED_PROVIDERS.join('، ')}.`,
      { code: 'provider-unsupported', httpStatus: 500 },
    );
  }
  if (!apiKey) {
    throw new PasswordResetEmailError(
      'PASSWORD_RESET_EMAIL_API_KEY غير مضبوط — مفتاح المزوّد مطلوب للإرسال.',
      { code: 'api-key-missing', httpStatus: 500 },
    );
  }
  if (!normalizeEmail(fromEmail)) {
    throw new PasswordResetEmailError(
      'PASSWORD_RESET_EMAIL_FROM غير صالح — ضع بريداً على النطاق الموثّق لدى المزوّد.',
      { code: 'from-invalid', httpStatus: 500 },
    );
  }

  const mailgunDomain = String(env.PASSWORD_RESET_EMAIL_MAILGUN_DOMAIN ?? '').trim()
    || fromEmail.split('@')[1];

  return {
    enabled: true,
    provider,
    apiKey,
    fromEmail: normalizeEmail(fromEmail),
    // اسم المرسِل يقرأه المستخدم قبل أن يقرأ الموضوع: `gemini-eed4a` هو نصف
    // سبب السبام، واسمٌ مفهوم نصف العلاج.
    fromName: String(env.PASSWORD_RESET_EMAIL_FROM_NAME ?? '').trim() || 'سويتر — Sweater',
    // ردٌّ إلى صندوق يقرأه بشر: غيابه إشارة سلبية، ووجوده يفتح باب الدعم.
    replyTo: normalizeEmail(env.PASSWORD_RESET_EMAIL_REPLY_TO ?? '') || '',
    mailgunDomain,
    mailgunRegion: String(env.PASSWORD_RESET_EMAIL_MAILGUN_REGION ?? '').trim().toLowerCase() === 'eu'
      ? 'eu' : 'us',
  };
}

// ─── القالب ────────────────────────────────────────────────────────────────

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * رسالة عربية RTL بهوية سويتر، ومعها بديلها النصي.
 *
 * الـ CSS مضمّن سطرياً لا في `<style>`: عملاء البريد (Outlook وGmail على
 * الويب) يقصّون الأنماط المجمّعة، فتصل الرسالة بلا تنسيق — وهذا بدوره يبدو
 * كرسالة مُركّبة آلياً.
 */
export function renderPasswordResetEmail({ link, appUrl = '', brandName = 'سويتر' } = {}) {
  const url = String(link ?? '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new PasswordResetEmailError('رابط إعادة التعيين غير صالح.', {
      code: 'link-invalid', httpStatus: 500,
    });
  }

  const safeLink = escapeHtml(url);
  const safeBrand = escapeHtml(brandName);
  const subject = `رابط إعادة تعيين كلمة المرور — ${brandName}`;
  // سطر المعاينة: ما يظهر بجانب الموضوع في القائمة قبل الفتح.
  const preheader = 'صالح لمدة ساعة واحدة، ولمرة واحدة فقط.';

  const text = [
    `${brandName} — لوحة التحكم المالية`,
    '',
    'وصلنا طلب لإعادة تعيين كلمة المرور لحسابك.',
    '',
    'افتح الرابط التالي لاختيار كلمة مرور جديدة:',
    url,
    '',
    'الرابط صالح لمدة ساعة واحدة ويُستخدم مرة واحدة فقط.',
    'إن لم تطلب إعادة التعيين فلا يلزمك فعل شيء — كلمة مرورك الحالية تبقى كما هي،',
    'ولن يتغيّر شيء في حسابك ما لم يُفتح الرابط أعلاه.',
    '',
    appUrl ? `لوحة التحكم: ${appUrl}` : '',
    'هذه رسالة آلية من نظام الحسابات الداخلي — لا تشارك الرابط مع أحد.',
  ].filter(Boolean).join('\n');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
        <tr>
          <td style="padding:28px 32px 8px;text-align:right;" dir="rtl">
            <p style="margin:0;font-size:20px;font-weight:700;color:#c74700;letter-spacing:.5px;">${safeBrand}</p>
            <p style="margin:4px 0 0;font-size:12px;color:#64748b;">لوحة التحكم المالية — امتياز سويتر</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 0;text-align:right;" dir="rtl">
            <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">إعادة تعيين كلمة المرور</h1>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.9;color:#334155;">
              وصلنا طلبٌ لإعادة تعيين كلمة المرور لحسابك في لوحة التحكم المالية.
              اضغط الزر أدناه لاختيار كلمة مرور جديدة.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 4px;text-align:center;">
            <a href="${safeLink}" style="display:inline-block;background-color:#c74700;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 30px;border-radius:10px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
              إعادة تعيين كلمة المرور
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 0;text-align:right;" dir="rtl">
            <p style="margin:0 0 6px;font-size:12px;color:#64748b;">إن لم يعمل الزر، انسخ هذا الرابط وافتحه في المتصفّح:</p>
            <p style="margin:0 0 16px;font-size:12px;line-height:1.7;word-break:break-all;" dir="ltr">
              <a href="${safeLink}" style="color:#c74700;text-decoration:underline;">${safeLink}</a>
            </p>
            <p style="margin:0 0 10px;font-size:13px;line-height:1.9;color:#334155;">
              الرابط صالح لمدة ساعة واحدة ويُستخدم مرة واحدة فقط.
            </p>
            <p style="margin:0 0 20px;font-size:13px;line-height:1.9;color:#334155;">
              إن لم تطلب إعادة التعيين فلا يلزمك فعل شيء: كلمة مرورك الحالية تبقى كما هي،
              ولن يتغيّر شيء في حسابك ما لم يُفتح الرابط أعلاه.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 26px;text-align:right;" dir="rtl">
            <hr style="border:0;border-top:1px solid #e2e8f0;margin:0 0 14px;">
            <p style="margin:0;font-size:11px;line-height:1.8;color:#94a3b8;">
              رسالة آلية من نظام الحسابات الداخلي — لا تشارك الرابط مع أحد.<br>
              © ${new Date().getUTCFullYear()} شركة هادي الغانم | Hadi Alghanim Company
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

// ─── الإرسال ───────────────────────────────────────────────────────────────

function providerRequest(config, { to, subject, html, text }) {
  const from = config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;

  if (config.provider === 'resend') {
    return {
      url: 'https://api.resend.com/emails',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from, to: [to], subject, html, text,
          ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        }),
      },
    };
  }

  if (config.provider === 'sendgrid') {
    return {
      url: 'https://api.sendgrid.com/v3/mail/send',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: config.fromEmail, name: config.fromName },
          ...(config.replyTo ? { reply_to: { email: config.replyTo } } : {}),
          subject,
          // الترتيب مُلزِم في SendGrid: النص أولاً ثم HTML، وإلا رُفض الطلب.
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
          // مقتفي النقر يعيد كتابة الرابط إلى نطاق المزوّد المشترك، فيعود
          // عدم تطابق النطاق الذي جئنا لإزالته. مطفأ عمداً.
          tracking_settings: {
            click_tracking: { enable: false, enable_text: false },
            open_tracking: { enable: false },
          },
        }),
      },
    };
  }

  // Mailgun: نموذج مُرمّز لا JSON.
  const host = config.mailgunRegion === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const form = new URLSearchParams({
    from, to, subject, text, html,
    'o:tracking-clicks': 'no',
    'o:tracking-opens': 'no',
  });
  if (config.replyTo) form.set('h:Reply-To', config.replyTo);
  return {
    url: `https://${host}/v3/${encodeURIComponent(config.mailgunDomain)}/messages`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
  };
}

/**
 * يسلّم الرسالة للمزوّد.
 *
 * فشل المزوّد لا يُبلَّغ للمتصفّح: الواجهة ترد رداً موحّداً مهما جرى (منعاً
 * لتعداد البُرد)، فالتشخيص يعيش في السجلّ وحده — ولذلك يحمل الخطأ حالة المزوّد
 * لا نص رده الكامل، كي لا يتسرّب مفتاحٌ أو عنوانٌ إلى السجلات.
 */
export async function deliverPasswordResetEmail(config, message, { fetchImpl = fetch } = {}) {
  const to = normalizeEmail(message?.to);
  if (!to) {
    throw new PasswordResetEmailError('المستلم غير صالح.', {
      code: 'recipient-invalid', httpStatus: 400,
    });
  }

  const { url, init } = providerRequest(config, { ...message, to });
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new PasswordResetEmailError('تعذّر الاتصال بمزوّد البريد.', {
      code: 'provider-unreachable', httpStatus: 502,
    });
  }

  if (!response?.ok) {
    throw new PasswordResetEmailError(
      `مزوّد البريد رفض الرسالة (HTTP ${response?.status ?? 'unknown'}).`,
      { code: 'provider-rejected', httpStatus: 502 },
    );
  }
  return { ok: true, provider: config.provider, status: response.status ?? 200 };
}
