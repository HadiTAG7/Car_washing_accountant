// ═══════════════════════════════════════════════════════════════════════════
// الفترات — «هذا الشهر» بلغة الإنسان، لا بحدود ISO يحسبها النموذج
// ═══════════════════════════════════════════════════════════════════════════
// كانت التقارير تطلب `from`/`to` بصيغة YYYY-MM-DD، فيضطر المساعد إلى حساب
// «أول الشهر وآخره» بنفسه — وهو لا يعرف تاريخ اليوم أصلاً. فأخطأ في الشهر،
// أو في آخر يومٍ في فبراير، أو سأل المستخدم عمّا يستطيع الخادم معرفته وحده.
//
// هنا الفترة تُحَلّ من كلمةٍ أو مفتاح: `this_month` · `last_month` · `2026-08`
// · `2026` · `2026-Q3` · `last_3_months` · `ytd` · `all`. و`from`/`to`
// الصريحان يعلوان على كل شيء. دوالٌ نقيّة تأخذ «اليوم» وسيطاً فتُختبر.
// ═══════════════════════════════════════════════════════════════════════════

export const PERIOD_TOKENS = [
  'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year',
  'ytd', 'last_3_months', 'last_6_months', 'last_12_months', 'all',
];

const AR_MONTH = new Intl.DateTimeFormat('ar-SA', { month: 'long', numberingSystem: 'latn' });
const AR_DAY = new Intl.DateTimeFormat('ar-SA', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', numberingSystem: 'latn',
});

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m) => `${y}-${pad(m)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${AR_MONTH.format(new Date(y, m - 1, 1))} ${y}`;
};
const shift = (y, m, delta) => {
  const d = new Date(y, m - 1 + delta, 1);
  return [d.getFullYear(), d.getMonth() + 1];
};

/** تاريخ اليوم كما يجب أن يراه المساعد — في كل ردٍّ تقريباً. */
export function todayInfo(now = new Date()) {
  const y = now.getFullYear(); const m = now.getMonth() + 1; const d = now.getDate();
  return {
    today: `${y}-${pad(m)}-${pad(d)}`,
    currentMonth: keyOf(y, m),
    label: AR_DAY.format(now),
  };
}

/** كل مفاتيح الأشهر بين حدَّين (شاملاً). */
export function monthKeysBetween(from, to) {
  const out = [];
  let [y, m] = String(from).slice(0, 7).split('-').map(Number);
  const end = String(to).slice(0, 7);
  for (let i = 0; i < 240 && keyOf(y, m) <= end; i += 1) {
    out.push(keyOf(y, m));
    [y, m] = shift(y, m, 1);
  }
  return out;
}

function rangeOfMonths(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return { from: `${fromKey}-01`, to: `${toKey}-${pad(lastDay(ty, tm))}`, fy, fm, ty, tm };
}

/**
 * حلّ الفترة.
 *
 * الأولوية: `from`/`to` الصريحان ← `month` ← `period` ← الافتراضي (`this_month`
 * أو ما يمرّره المستدعي في `fallback`). النتيجة دائماً `{ from, to, label,
 * months }` — و`all` تُرجع حدوداً فارغة تعني «بلا قيد».
 */
export function resolvePeriod({ period, month, from, to } = {}, { now = new Date(), fallback = 'this_month' } = {}) {
  const t = todayInfo(now);
  const [cy, cm] = t.currentMonth.split('-').map(Number);

  if (from || to) {
    const f = from || null; const e = to || null;
    return {
      from: f, to: e, kind: 'custom',
      label: f && e ? `من ${f} إلى ${e}` : (f ? `من ${f}` : `حتى ${e}`),
      months: f && e ? monthKeysBetween(f, e) : [],
    };
  }

  const spec = String(month || period || fallback || 'this_month').trim();

  const mk = /^(\d{4})-(\d{2})$/.exec(spec);
  if (mk) {
    const r = rangeOfMonths(spec, spec);
    return { from: r.from, to: r.to, kind: 'month', periodKey: spec, label: monthLabel(spec), months: [spec] };
  }
  const yk = /^(\d{4})$/.exec(spec);
  if (yk) {
    const r = rangeOfMonths(`${spec}-01`, `${spec}-12`);
    return { from: r.from, to: r.to, kind: 'year', label: `سنة ${spec}`, months: monthKeysBetween(r.from, r.to) };
  }
  const qk = /^(\d{4})-Q([1-4])$/i.exec(spec);
  if (qk) {
    const y = Number(qk[1]); const q = Number(qk[2]);
    const r = rangeOfMonths(keyOf(y, (q - 1) * 3 + 1), keyOf(y, q * 3));
    return { from: r.from, to: r.to, kind: 'quarter', label: `الربع ${q} من ${y}`, months: monthKeysBetween(r.from, r.to) };
  }

  const lastN = /^last_(\d{1,2})_months$/.exec(spec);
  if (lastN) {
    const n = Math.min(24, Math.max(1, Number(lastN[1])));
    const [sy, sm] = shift(cy, cm, -(n - 1));
    const r = rangeOfMonths(keyOf(sy, sm), t.currentMonth);
    return { from: r.from, to: r.to, kind: 'range', label: `آخر ${n} أشهر (${keyOf(sy, sm)} → ${t.currentMonth})`, months: monthKeysBetween(r.from, r.to) };
  }

  switch (spec) {
    case 'this_month': {
      const r = rangeOfMonths(t.currentMonth, t.currentMonth);
      return { from: r.from, to: r.to, kind: 'month', periodKey: t.currentMonth, label: `${monthLabel(t.currentMonth)} (هذا الشهر)`, months: [t.currentMonth] };
    }
    case 'last_month': {
      const [y, m] = shift(cy, cm, -1); const k = keyOf(y, m);
      const r = rangeOfMonths(k, k);
      return { from: r.from, to: r.to, kind: 'month', periodKey: k, label: `${monthLabel(k)} (الشهر الماضي)`, months: [k] };
    }
    case 'this_quarter': case 'last_quarter': {
      let q = Math.floor((cm - 1) / 3) + 1; let y = cy;
      if (spec === 'last_quarter') { q -= 1; if (q === 0) { q = 4; y -= 1; } }
      const r = rangeOfMonths(keyOf(y, (q - 1) * 3 + 1), keyOf(y, q * 3));
      return { from: r.from, to: r.to, kind: 'quarter', label: `الربع ${q} من ${y}`, months: monthKeysBetween(r.from, r.to) };
    }
    case 'this_year': case 'ytd': {
      const r = rangeOfMonths(keyOf(cy, 1), spec === 'ytd' ? t.currentMonth : keyOf(cy, 12));
      return { from: r.from, to: spec === 'ytd' ? t.today : r.to, kind: 'year', label: spec === 'ytd' ? `منذ بداية ${cy} حتى اليوم` : `سنة ${cy}`, months: monthKeysBetween(r.from, r.to) };
    }
    case 'last_year': {
      const r = rangeOfMonths(keyOf(cy - 1, 1), keyOf(cy - 1, 12));
      return { from: r.from, to: r.to, kind: 'year', label: `سنة ${cy - 1}`, months: monthKeysBetween(r.from, r.to) };
    }
    case 'all':
      return { from: null, to: null, kind: 'all', label: 'كل الفترات', months: [] };
    default:
      throw new Error(
        `فترة غير مفهومة: «${spec}». استعمل شهراً مثل 2026-08، أو سنةً 2026، أو ربعاً 2026-Q3، `
        + `أو كلمةً: ${PERIOD_TOKENS.join(' · ')}.`,
      );
  }
}

/** الفترة السابقة بنفس الطول — للمقارنة. `null` لـ `all` والمخصّص بلا حدود. */
export function previousPeriod(p) {
  if (!p?.months?.length) return null;
  const n = p.months.length;
  const [fy, fm] = p.months[0].split('-').map(Number);
  const [ey, em] = shift(fy, fm, -1);
  const [sy, sm] = shift(fy, fm, -n);
  const r = rangeOfMonths(keyOf(sy, sm), keyOf(ey, em));
  return { from: r.from, to: r.to, kind: p.kind, label: n === 1 ? monthLabel(keyOf(sy, sm)) : `${keyOf(sy, sm)} → ${keyOf(ey, em)}`, months: monthKeysBetween(r.from, r.to) };
}

export { monthLabel };
