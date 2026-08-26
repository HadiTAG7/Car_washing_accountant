// ═══════════════════════════════════════════════════════════════════════════
// إعدادٌ مؤرخ — الصفّ الساري يوم الحدث، لا صفّ اليوم
// ═══════════════════════════════════════════════════════════════════════════
// ثلاثة إعدادات تشترك في نفس السؤال: «ما القاعدة التي كانت سارية يوم ٢٠ مايو؟»
// — سعر الخدمة، والحالات المؤهلة للاعتراف، وأنواع الخصومات ومبالغها. ولو
// أجاب أيٌّ منها بقاعدة **اليوم**، لتغيّرت أرقام شهرٍ مقفل لأن أحداً عدّل
// سعراً بعده. فالجواب الوحيد المقبول هو صفّ ذلك اليوم.
//
// ── و«لا أعرف» جوابٌ مشروع ──
// هذا هو الدرس المدفوع ثمنه في `taxPolicyAt`: تاريخٌ قبل أول صفٍّ معروف لا
// يُجاب بأقدم صفّ ولا بأحدثه — يُجاب بـ`known:false`، ويوقف الاعتراف
// بالإيراد. الاختراع هنا لا يظهر إلا بعد أشهر في رقمٍ لا أحد يعرف من أين جاء.
// ═══════════════════════════════════════════════════════════════════════════

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** أول عشرة محارف — التاريخ وحده مهما جاء الوقت بعده. */
export function isoDay(value) {
  const s = String(value ?? '').slice(0, 10);
  return ISO.test(s) ? s : '';
}

/**
 * الصفّ الساري لهذا المفتاح في هذا اليوم.
 *
 * `rows` صفوفٌ تحمل `{ key, effectiveFrom, effectiveTo?, status }`.
 * يُختار **آخر** صفٍّ بدأ سريانه في اليوم أو قبله، ولم ينتهِ. `status` غير
 * `active` يُستبعد قبل كل شيء: صفٌّ مسودة أو ملغى ليس قاعدةً سارية.
 *
 * الترتيب بالتاريخ ثم بـ`createdAt` — صفّان بنفس `effectiveFrom` يقرّرهما
 * الأحدث كتابةً، وهو تصحيحٌ لسابقه لا منافس له.
 */
export function resolveDatedRow(rows, key, date, { keyField = 'key' } = {}) {
  const day = isoDay(date);
  if (!day) return { known: false, reason: 'bad-date' };

  const k = String(key ?? '').trim();
  if (!k) return { known: false, reason: 'missing-key' };

  const candidates = (rows || [])
    .filter((r) => String(r?.[keyField] ?? '').trim() === k)
    .filter((r) => (r?.status ?? 'active') === 'active')
    .filter((r) => isoDay(r?.effectiveFrom))
    .sort((a, b) => {
      const d = isoDay(a.effectiveFrom).localeCompare(isoDay(b.effectiveFrom));
      return d !== 0 ? d : String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });

  if (!candidates.length) return { known: false, reason: 'no-rows', key: k };

  const started = candidates.filter((r) => isoDay(r.effectiveFrom) <= day);
  if (!started.length) {
    // التاريخ أقدم من أول قاعدة معروفة — نفس امتناع `taxPolicyAt`.
    return {
      known: false,
      reason: 'before-baseline',
      key: k,
      baselineFrom: isoDay(candidates[0].effectiveFrom),
    };
  }

  const row = started[started.length - 1];
  const until = isoDay(row.effectiveTo);
  if (until && until < day) {
    // انتهى سريانه ولم يخلفه شيء — فجوةٌ تُقال ولا تُسدّ بالتخمين.
    return { known: false, reason: 'expired', key: k, expiredOn: until };
  }
  return { known: true, row, effectiveFrom: isoDay(row.effectiveFrom) };
}

/** الصفوف السارية اليوم لكل مفتاح — للعرض في شاشات الإعداد. */
export function activeRowsOn(rows, date, { keyField = 'key' } = {}) {
  const keys = [...new Set((rows || []).map((r) => String(r?.[keyField] ?? '').trim()).filter(Boolean))];
  const out = [];
  for (const k of keys) {
    const hit = resolveDatedRow(rows, k, date, { keyField });
    if (hit.known) out.push(hit.row);
  }
  return out;
}

/**
 * ما يمنع صفّاً مؤرخاً من أن يُحفظ — رسائل عربية تُعرض لا منطقيات تُبتلع.
 */
export function datedRowProblems(row, { keyField = 'key', keyLabel = 'المفتاح' } = {}) {
  const problems = [];
  if (!String(row?.[keyField] ?? '').trim()) problems.push(`${keyLabel} مطلوب.`);
  if (!isoDay(row?.effectiveFrom)) problems.push('تاريخ بدء السريان مطلوب بصيغة YYYY-MM-DD.');
  const to = row?.effectiveTo == null || row?.effectiveTo === '' ? '' : isoDay(row.effectiveTo);
  if (row?.effectiveTo && !to) problems.push('تاريخ نهاية السريان غير صالح.');
  if (to && isoDay(row?.effectiveFrom) && to < isoDay(row.effectiveFrom)) {
    problems.push('نهاية السريان قبل بدايته.');
  }
  if (row?.status && !['active', 'draft', 'archived'].includes(row.status)) {
    problems.push(`حالة غير صالحة: ${row.status}`);
  }
  return problems;
}
