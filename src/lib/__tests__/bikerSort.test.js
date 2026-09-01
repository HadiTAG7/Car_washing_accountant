/**
 * ترتيب سجل البايكر — الفارغ آخراً، والعربية بمقابلٍ عربي
 * ═══════════════════════════════════════════════════════════════════════════
 * الادعاء الحامل: **الفارغ يذهب إلى الذيل في الاتجاهين**. المقارنة الساذجة
 * تضع الفراغ أولاً تصاعدياً، فمن يرتّب بـ«الكفيل» تتصدّر قائمتَه صفوفٌ لا
 * كفيل لها — وهي بالضبط ما لا يريد رؤيته حين يرتّب بالكفيل. الفراغ **غياب
 * قيمة**، لا قيمةٌ صغرى.
 *
 * والثاني: العربية تُقارَن بـ`localeCompare(…, 'ar')`. المقارنة الثنائية
 * تعطي ترتيب UTF-16 لا الترتيب الأبجدي، فتبدو القائمة عشوائية لقارئٍ عربي.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  BIKER_SORT_COLUMNS, DEFAULT_SORT, isBlank, sortBikers, nextSort,
} from '../bikerSort';

const b = (over) => ({
  id: over.name, name: over.name, contactNumber: null, residence: null,
  sponsor: null, nationality: null, salary: 0, advancesTotal: 0,
  iqamaExpiry: null, startDate: null, stats: { washCount: 0, commission: 0 },
  ...over,
});

const ROWS = [
  b({ name: 'خالد', sponsor: 'مؤسسة النور', nationality: 'باكستاني', residence: 'سكن الغرب', salary: 1800, stats: { washCount: 30, commission: 300 }, iqamaExpiry: '2027-01-10' }),
  b({ name: 'أحمد', sponsor: 'شركة الفجر', nationality: 'بنغلاديشي', residence: 'سكن الشمال', salary: 2200, stats: { washCount: 12, commission: 120 }, iqamaExpiry: '2026-09-01' }),
  b({ name: 'سالم', sponsor: null, nationality: 'هندي', residence: null, salary: 2000, stats: { washCount: 45, commission: 450 }, iqamaExpiry: null }),
  b({ name: 'ماجد', sponsor: '   ', nationality: null, residence: 'سكن الشمال', salary: 0, stats: { washCount: 0, commission: 0 }, iqamaExpiry: '2026-05-20' }),
];

const names = (rows) => rows.map((r) => r.name);

describe('isBlank', () => {
  it('الفراغ والمسافات وnull فارغ — والصفر ليس فارغاً', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank(0)).toBe(false);      // راتبٌ صفر قيمةٌ حقيقية
    expect(isBlank('أحمد')).toBe(false);
    expect(isBlank(NaN)).toBe(true);
  });
});

describe('الترتيب النصّي', () => {
  it('على الكفيل تصاعدياً — والفارغ آخراً لا أولاً', () => {
    // الادعاء الحامل: «سالم» و«ماجد» بلا كفيل، فيذهبان للذيل.
    // والترتيب أبجديٌّ عربي: «ش» قبل «م»، فـ«شركة الفجر» (أحمد) تسبق
    // «مؤسسة النور» (خالد) — لا ترتيب إدخالٍ ولا ترتيب حروفٍ ثنائي.
    const sorted = names(sortBikers(ROWS, { column: 'sponsor', direction: 'asc' }));
    expect(sorted.slice(0, 2)).toEqual(['أحمد', 'خالد']);   // شركة… ثم مؤسسة…
    expect(sorted.slice(2).sort()).toEqual(['ماجد', 'سالم'].sort());
  });

  it('وتنازلياً كذلك — الفارغ لا يقفز للأعلى بعكس الاتجاه', () => {
    const sorted = names(sortBikers(ROWS, { column: 'sponsor', direction: 'desc' }));
    expect(sorted.slice(0, 2)).toEqual(['خالد', 'أحمد']);   // مؤسسة… ثم شركة…
    expect(sorted.slice(2).sort()).toEqual(['ماجد', 'سالم'].sort());
  });

  it('وعلى الجنسية والسكن كذلك', () => {
    expect(names(sortBikers(ROWS, { column: 'nationality', direction: 'asc' })).slice(0, 3))
      .toEqual(['خالد', 'أحمد', 'سالم']);   // باكستاني · بنغلاديشي · هندي
    const byRes = names(sortBikers(ROWS, { column: 'residence', direction: 'asc' }));
    expect(byRes[byRes.length - 1]).toBe('سالم');   // بلا سكن
  });

  it('والعربية بترتيبها الأبجدي لا بترتيب الحروف الثنائي', () => {
    // أسماءٌ يختلف فيها الترتيبان فعلاً: «أ» ثنائياً U+0623 و«ا» U+0627،
    // فالمقارنة الخام تُقدّم «أمين» على «احمد». والأبجدية العربية لا ترى
    // بينهما فرقاً في أول حرف، فتحكم بالثاني: «ح» قبل «م».
    // (فِخُّ اختبارٍ سابق: «أحمد · خالد · ياسر» يعطي الترتيب نفسه في
    //  النظامين، فكان يمرّ ولو نُزعت المقارنة العربية كلها.)
    const rows = [b({ name: 'أمين' }), b({ name: 'احمد' }), b({ name: 'خالد' })];
    expect(names(sortBikers(rows, { column: 'name', direction: 'asc' })))
      .toEqual(['احمد', 'أمين', 'خالد']);
    // والدليل أن الادّعاء غير فارغ: الترتيب الثنائي يعطي غيره.
    expect(['أمين', 'احمد', 'خالد'].sort()).toEqual(['أمين', 'احمد', 'خالد']);
  });

  it('والهمزة كتابةً لا تفرّق كفيلاً عن نفسه — «أحمد» و«احمد» متجاوران', () => {
    // في السجلات الحقيقية يُكتب الاسم بهمزةٍ مرّة وبدونها مرّة. لو قُورن
    // ثنائياً لانفصلت النسختان بكل ما يبدأ بـ«إ» أو «ؤ» أو «ئ» بينهما —
    // فيظهر الكفيل الواحد في موضعين من القائمة وكأنهما اثنان.
    const rows = [
      b({ name: 'سعد', sponsor: 'أحمد للنقل' }),
      b({ name: 'بدر', sponsor: 'إبراهيم وشركاه' }),
      b({ name: 'عمر', sponsor: 'احمد للنقل' }),
    ];
    const byS = sortBikers(rows, { column: 'sponsor', direction: 'asc' }).map((r) => r.sponsor);
    expect(byS).toEqual(['إبراهيم وشركاه', 'أحمد للنقل', 'احمد للنقل']);

    // وهذا بالضبط ما يفعله الثنائي: «إبراهيم» يشقّ «أحمد» نصفين.
    expect([...byS].sort()).toEqual(['أحمد للنقل', 'إبراهيم وشركاه', 'احمد للنقل']);
  });

  it('والنسختان تتساويان فعلاً، فيُرتَّب صفّاهما بالاسم لا بالهمزة', () => {
    // فرقٌ دقيق يستحق التثبيت: `sensitivity: 'base'` لا يغيّر **موضع**
    // النسختين في القائمة (العربية تجاورهما أصلاً)، بل يجعلهما **متساويتين**
    // فينتقل الحسم إلى فاصل التساوي: اسم البايكر.
    //
    // وبدونه يُحسم الترتيب بالهمزة نفسها — أي بمن كتب الاسم كيف، وهو فرقٌ
    // لا يراه الناظر في الشاشة فيبدو الصفّان مرتّبين بلا سبب.
    const rows = [
      b({ name: 'زياد', sponsor: 'أحمد للنقل' }),
      b({ name: 'باسم', sponsor: 'احمد للنقل' }),
    ];
    expect(names(sortBikers(rows, { column: 'sponsor', direction: 'asc' })))
      .toEqual(['باسم', 'زياد']);   // بالاسم — لا «زياد» لأن كفيله بهمزة
  });
});

describe('الترتيب الرقمي', () => {
  it('على الراتب — والصفر رقمٌ يُرتَّب لا فراغٌ يُدفع', () => {
    expect(names(sortBikers(ROWS, { column: 'salary', direction: 'desc' })))
      .toEqual(['أحمد', 'سالم', 'خالد', 'ماجد']);
    expect(names(sortBikers(ROWS, { column: 'salary', direction: 'asc' })))
      .toEqual(['ماجد', 'خالد', 'سالم', 'أحمد']);
  });

  it('وعلى غسلات الشهر والعمولة — من القيمة المشتقّة نفسها المعروضة', () => {
    expect(names(sortBikers(ROWS, { column: 'washCount', direction: 'desc' }))[0]).toBe('سالم');
    expect(names(sortBikers(ROWS, { column: 'commission', direction: 'desc' }))[0]).toBe('سالم');
  });
});

describe('ترتيب التواريخ', () => {
  it('على انتهاء الإقامة تصاعدياً — الأقرب انتهاءً أولاً، وبلا إقامة آخراً', () => {
    const sorted = names(sortBikers(ROWS, { column: 'iqamaExpiry', direction: 'asc' }));
    expect(sorted.slice(0, 3)).toEqual(['ماجد', 'أحمد', 'خالد']);
    expect(sorted[3]).toBe('سالم');
  });
});

describe('استقرار الترتيب', () => {
  it('المتساوون يُرتَّبون بالاسم — فلا يتأرجح الجدول بين رسمتين', () => {
    const rows = [
      b({ name: 'ياسر', sponsor: 'نفس الكفيل' }),
      b({ name: 'أحمد', sponsor: 'نفس الكفيل' }),
      b({ name: 'خالد', sponsor: 'نفس الكفيل' }),
    ];
    const once = names(sortBikers(rows, { column: 'sponsor', direction: 'asc' }));
    const twice = names(sortBikers([...rows].reverse(), { column: 'sponsor', direction: 'asc' }));
    expect(once).toEqual(twice);
    expect(once).toEqual(['أحمد', 'خالد', 'ياسر']);
  });

  it('ولا يُمَسّ المصفوف الأصلي', () => {
    const original = [...ROWS];
    sortBikers(ROWS, { column: 'salary', direction: 'desc' });
    expect(ROWS).toEqual(original);
  });

  it('وعمودٌ مجهول يُعيد النسخة كما هي بلا انهيار', () => {
    expect(names(sortBikers(ROWS, { column: 'nope', direction: 'asc' }))).toEqual(names(ROWS));
    expect(sortBikers(null, DEFAULT_SORT)).toEqual([]);
  });
});

describe('nextSort — النقرة التالية', () => {
  it('نفس العمود يقلب الاتجاه', () => {
    expect(nextSort({ column: 'sponsor', direction: 'asc' }, 'sponsor'))
      .toEqual({ column: 'sponsor', direction: 'desc' });
    expect(nextSort({ column: 'sponsor', direction: 'desc' }, 'sponsor'))
      .toEqual({ column: 'sponsor', direction: 'asc' });
  });

  it('وعمودٌ نصّي جديد يبدأ تصاعدياً', () => {
    expect(nextSort({ column: 'name', direction: 'asc' }, 'sponsor'))
      .toEqual({ column: 'sponsor', direction: 'asc' });
  });

  it('وعمودٌ رقمي يبدأ تنازلياً — «من أكثرهم غسلات؟» لا «من أقلّهم؟»', () => {
    expect(nextSort({ column: 'name', direction: 'asc' }, 'washCount'))
      .toEqual({ column: 'washCount', direction: 'desc' });
    expect(nextSort({ column: 'name', direction: 'asc' }, 'salary'))
      .toEqual({ column: 'salary', direction: 'desc' });
  });

  it('لكن التاريخ يبقى تصاعدياً — «أيّ إقامة تنتهي أولاً؟»', () => {
    expect(nextSort({ column: 'name', direction: 'asc' }, 'iqamaExpiry'))
      .toEqual({ column: 'iqamaExpiry', direction: 'asc' });
  });

  it('وعمودٌ مجهول لا يغيّر شيئاً', () => {
    const cur = { column: 'name', direction: 'asc' };
    expect(nextSort(cur, 'nope')).toBe(cur);
  });
});

describe('الأعمدة المعرَّفة', () => {
  it('كل عمودٍ له اسمٌ عربي ونوعٌ ودالةُ قيمة', () => {
    for (const [id, col] of Object.entries(BIKER_SORT_COLUMNS)) {
      expect(col.label, id).toBeTruthy();
      expect(['text', 'number', 'date'], id).toContain(col.type);
      expect(typeof col.key, id).toBe('function');
    }
  });

  it('والأعمدة التي سألَ عنها المالك موجودة', () => {
    for (const id of ['sponsor', 'nationality', 'residence']) {
      expect(BIKER_SORT_COLUMNS[id], id).toBeTruthy();
    }
  });
});
