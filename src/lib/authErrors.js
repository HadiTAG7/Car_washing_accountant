// ─── Supabase auth error → Arabic message ───────────────────────────────
// GoTrue returns English strings ("Invalid login credentials", ...) that
// leaked straight into an otherwise fully-Arabic UI. Map the known ones;
// fall back to a generic Arabic line that still carries the original text
// so support/debugging isn't blinded.

const RULES = [
  [/invalid login credentials/i,
    'بيانات الدخول غير صحيحة — تأكد من البريد الإلكتروني وكلمة المرور.'],
  [/email not confirmed/i,
    'البريد الإلكتروني غير مفعّل — افتح رسالة التفعيل في بريدك أولاً.'],
  [/user already registered|already been registered/i,
    'هذا البريد الإلكتروني مسجّل مسبقاً.'],
  [/password should be at least/i,
    'كلمة المرور قصيرة — يجب ألا تقل عن ٦ أحرف.'],
  [/new password should be different/i,
    'كلمة المرور الجديدة يجب أن تختلف عن الحالية.'],
  [/rate limit|too many requests|for security purposes/i,
    'محاولات كثيرة خلال وقت قصير — انتظر دقيقة ثم أعد المحاولة.'],
  [/unable to validate email|invalid email|is invalid/i,
    'صيغة البريد الإلكتروني غير صحيحة.'],
  [/email link is invalid or has expired|otp.*expired|token.*expired/i,
    'الرابط غير صالح أو منتهي الصلاحية — اطلب رابطاً جديداً.'],
  [/auth session missing|session.*expired|not authenticated|unauthenticated/i,
    'انتهت الجلسة — أعد تسجيل الدخول.'],
  [/requires-recent-login|recent authentication|recent login/i,
    'لأمان حسابك، أعد تسجيل الدخول ثم غيّر كلمة المرور مباشرة بعدها.'],
  [/wrong-password|invalid-credential|incorrect/i,
    'بيانات الدخول غير صحيحة — تأكد من البريد الإلكتروني وكلمة المرور.'],
  [/user-not-found/i,
    'لا يوجد حساب بهذا البريد الإلكتروني.'],
  [/too-many-requests/i,
    'محاولات كثيرة خلال وقت قصير — انتظر دقيقة ثم أعد المحاولة.'],
  [/email-already-in-use/i,
    'هذا البريد الإلكتروني مسجّل مسبقاً.'],
  [/weak-password/i,
    'كلمة المرور ضعيفة — يجب ألا تقل عن ٦ أحرف.'],
  [/failed to fetch|networkerror|fetch failed|load failed/i,
    'تعذّر الاتصال بالخادم — تحقق من اتصالك بالإنترنت ثم أعد المحاولة.'],
  [/signups? not allowed/i,
    'التسجيل الذاتي غير متاح — تُنشأ الحسابات من إدارة النظام.'],
];

export function translateAuthError(err, fallback = 'تعذّر إتمام الطلب.') {
  const raw = String(err?.message || err || '').trim();
  if (!raw) return fallback;
  for (const [re, msg] of RULES) {
    if (re.test(raw)) return msg;
  }
  // Unknown error: Arabic lead + original detail for diagnosability.
  return `${fallback} (${raw})`;
}
