/**
 * تحقق حقول نوافذ سويتر — الفرق بين «لم يُذكر» و«صفر»
 * ═══════════════════════════════════════════════════════════════════════════
 * هذا التحقق هو ما كان غائباً حين كانت الأسئلة بـ`window.prompt`:
 * `Number(prompt('المبلغ'))` على فراغٍ يعطي **صفراً** فيُسجَّل تحصيلٌ بصفر
 * ريال، وعلى نصٍّ يعطي `NaN` فيذهب إلى الخادم — الاثنان بصمت.
 *
 * ويُختبر هنا مباشرةً لا عبر رسم نافذة، لسببٍ عملي: مدخل `type="number"`
 * يرفض النصّ فيزيائياً فلا يصل الفرع الرقمي من طريقه — لكنه يحرس كل مسارٍ
 * آخر (قيمةٌ افتراضية، أو حقلٌ يتحوّل نوعه لاحقاً).
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import {
  fieldProblem, firstProblem, dialogPayload, initialValues,
} from '../dialogFields';

const F = {
  label: { name: 'label', label: 'اسم المفتاح', type: 'text', required: true },
  reason: { name: 'reason', label: 'سبب الإلغاء', type: 'textarea', required: true },
  stated: { name: 'statedNetDue', label: 'صافي الكشف', type: 'number', required: true, min: 0 },
  amount: { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true },
  date: { name: 'receivedDate', label: 'تاريخ الاستلام', type: 'date', required: true },
  note: { name: 'note', label: 'ملاحظة', type: 'text' },
};

describe('fieldProblem — المطلوب', () => {
  it('الفراغ والمسافات وحدها تُرفض', () => {
    expect(fieldProblem(F.label, '')).toBe('اسم المفتاح مطلوب.');
    expect(fieldProblem(F.label, '   ')).toBe('اسم المفتاح مطلوب.');
    expect(fieldProblem(F.label, null)).toBe('اسم المفتاح مطلوب.');
    expect(fieldProblem(F.label, undefined)).toBe('اسم المفتاح مطلوب.');
  });

  it('وقيمةٌ حقيقية تمرّ', () => {
    expect(fieldProblem(F.label, 'الوكيل الرابع — Codex')).toBeNull();
    expect(fieldProblem(F.reason, 'تدوير دوري')).toBeNull();
  });

  it('والاختياري الفارغ يمرّ', () => {
    expect(fieldProblem(F.note, '')).toBeNull();
  });
});

describe('fieldProblem — الأرقام', () => {
  it('النصّ يُرفض برسالةٍ تسمّي الحقل — الفرع الذي كان `NaN` يعبره', () => {
    expect(fieldProblem(F.stated, 'مئتان')).toBe('صافي الكشف يجب أن يكون رقماً.');
    expect(fieldProblem(F.stated, '12abc')).toBe('صافي الكشف يجب أن يكون رقماً.');
  });

  it('والسالب يُرفض حين `min: 0`', () => {
    expect(fieldProblem(F.stated, '-1')).toBe('صافي الكشف لا يكون سالباً.');
  });

  it('والصفر مقبولٌ للكشف — «الكشف صفر» حقيقةٌ تُسجَّل', () => {
    expect(fieldProblem(F.stated, '0')).toBeNull();
  });

  it('لكنه مرفوضٌ للتحصيل — تحصيلٌ بصفر ليس تحصيلاً', () => {
    // هذا بالضبط ما كان `prompt` يمرّره: فراغٌ ⇒ `Number('')` ⇒ صفر.
    expect(fieldProblem(F.amount, '0')).toBe('المبلغ يجب أن يكون أكبر من صفر.');
    expect(fieldProblem(F.amount, '-5')).toBe('المبلغ يجب أن يكون أكبر من صفر.');
    expect(fieldProblem(F.amount, '216')).toBeNull();
  });

  it('والكسور تمرّ', () => {
    expect(fieldProblem(F.stated, '204.5')).toBeNull();
  });

  it('واللانهاية تُرفض', () => {
    expect(fieldProblem(F.stated, 'Infinity')).toBe('صافي الكشف يجب أن يكون رقماً.');
  });
});

describe('fieldProblem — التواريخ', () => {
  it('الصيغة الصحيحة تمرّ، وغيرها يُرفض', () => {
    expect(fieldProblem(F.date, '2026-06-10')).toBeNull();
    expect(fieldProblem(F.date, '10/06/2026')).toMatch(/YYYY-MM-DD/);
    expect(fieldProblem(F.date, 'غداً')).toMatch(/YYYY-MM-DD/);
  });

  it('والفراغ يُرفض بـ«مطلوب» لا بصيغة — الرسالة تصف المشكلة الحقيقية', () => {
    expect(fieldProblem(F.date, '')).toBe('تاريخ الاستلام مطلوب.');
  });
});

describe('firstProblem', () => {
  const fields = [F.amount, F.date];

  it('يرجع أول مشكلة ويجمّد الإرسال', () => {
    expect(firstProblem(fields, { amount: '', receivedDate: '' })).toMatch(/المبلغ مطلوب/);
    expect(firstProblem(fields, { amount: '216', receivedDate: '' })).toMatch(/تاريخ الاستلام مطلوب/);
  });

  it('و`null` حين يصحّ كل شيء', () => {
    expect(firstProblem(fields, { amount: '216', receivedDate: '2026-06-10' })).toBeNull();
  });
});

describe('dialogPayload', () => {
  it('الأرقام أرقاماً والنصوص مُشذَّبة', () => {
    expect(dialogPayload([F.amount, F.date], {
      amount: ' 216 ', receivedDate: '2026-06-10',
    })).toEqual({ amount: 216, receivedDate: '2026-06-10' });

    expect(dialogPayload([F.label], { label: '  وكيل الليل  ' }))
      .toEqual({ label: 'وكيل الليل' });
  });

  it('والفراغ `null` لا `0` ولا `\'\'` — الخلط هو ما سجّل تحصيلاً بصفر', () => {
    expect(dialogPayload([F.amount, F.note], { amount: '', note: '   ' }))
      .toEqual({ amount: null, note: null });
  });

  it('وصفرٌ صريح يبقى صفراً — لا يصير `null`', () => {
    expect(dialogPayload([F.stated], { statedNetDue: '0' })).toEqual({ statedNetDue: 0 });
  });
});

describe('initialValues', () => {
  it('كل حقلٍ وافتراضه، والباقي فراغ', () => {
    expect(initialValues([
      { name: 'label', defaultValue: 'الوكيل الرابع — Codex' },
      { name: 'reason' },
    ])).toEqual({ label: 'الوكيل الرابع — Codex', reason: '' });
  });

  it('وقائمةٌ فارغة أو غائبة لا تنهار', () => {
    expect(initialValues([])).toEqual({});
    expect(initialValues(undefined)).toEqual({});
  });
});
