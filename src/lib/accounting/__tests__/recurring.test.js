import { describe, it, expect } from 'vitest';
import {
  voucherId, dueDateFor, isRecurringTemplate, templateActiveIn, validateTemplate,
  buildVoucher, missingVouchers, ungeneratableTemplates, summariseVouchers,
  generatedTemplateIds,
} from '../recurring';

const RENT = {
  id: 't1', expenseName: 'إيجار المحل', totalMonthlyCost: 5000,
  paymentDay: 5, recurrence: 'monthly', quantity: 1, unitCost: 5000,
  isTaxInvoice: true, invoiceUrl: 'https://x/inv',
};

describe('مفتاح السند', () => {
  it('مشتق من المصروف والفترة — وهو ما يمنع التكرار', () => {
    expect(voucherId('t1', '2026-08')).toBe('t1__2026-08');
    expect(voucherId('t1', '2026-08')).toBe(voucherId('t1', '2026-08'));
    expect(voucherId('t1', '2026-08')).not.toBe(voucherId('t1', '2026-09'));
    expect(voucherId('t2', '2026-08')).not.toBe(voucherId('t1', '2026-08'));
  });
});

describe('تاريخ الاستحقاق', () => {
  it('يستخدم يوم السداد كما هو', () => {
    expect(dueDateFor('2026-08', 5)).toBe('2026-08-05');
    expect(dueDateFor('2026-08', 25)).toBe('2026-08-25');
  });

  it('يقصر اليوم 31 على آخر الشهر — لا وجود لـ«31 فبراير»', () => {
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateFor('2028-02', 31)).toBe('2028-02-29');
    expect(dueDateFor('2026-04', 31)).toBe('2026-04-30');
    expect(dueDateFor('2026-01', 31)).toBe('2026-01-31');
  });

  it('بلا يوم سداد يستحق في آخر الشهر', () => {
    expect(dueDateFor('2026-02', null)).toBe('2026-02-28');
    expect(dueDateFor('2026-08', 0)).toBe('2026-08-31');
  });

  it('فترة غير صالحة تعطي فراغاً لا تاريخاً مختلقاً', () => {
    expect(dueDateFor('2026-8', 5)).toBe('');
    expect(dueDateFor('', 5)).toBe('');
  });
});

describe('سريان القالب', () => {
  it('المتكرر فقط يولّد سندات', () => {
    expect(isRecurringTemplate(RENT)).toBe(true);
    expect(isRecurringTemplate({ ...RENT, recurrence: 'one_time' })).toBe(false);
    expect(templateActiveIn({ ...RENT, recurrence: 'one_time' }, '2026-08')).toBe(false);
  });

  it('قالب بلا مدى يسري دائماً — وهو حال كل الصفوف القائمة', () => {
    expect(templateActiveIn(RENT, '2020-01')).toBe(true);
    expect(templateActiveIn(RENT, '2030-12')).toBe(true);
  });

  it('يحترم فترتَي البداية والنهاية', () => {
    const t = { ...RENT, startPeriod: '2026-03', endPeriod: '2026-06' };
    expect(templateActiveIn(t, '2026-02')).toBe(false);
    expect(templateActiveIn(t, '2026-03')).toBe(true);
    expect(templateActiveIn(t, '2026-06')).toBe(true);
    expect(templateActiveIn(t, '2026-07')).toBe(false);
  });

  it('القالب الموقوف لا يولّد', () => {
    expect(templateActiveIn({ ...RENT, active: false }, '2026-08')).toBe(false);
  });
});

describe('التحقق من القالب', () => {
  it('القالب السليم بلا ملاحظات', () => {
    expect(validateTemplate(RENT)).toEqual([]);
  });

  it('يرفض قيمة صفرية أو اسماً فارغاً', () => {
    expect(validateTemplate({ ...RENT, totalMonthlyCost: 0 })[0]).toMatch(/أكبر من صفر/);
    expect(validateTemplate({ ...RENT, expenseName: '  ' })[0]).toMatch(/اسم المصروف/);
  });

  it('يرفض مدى مقلوباً', () => {
    expect(validateTemplate({ ...RENT, startPeriod: '2026-06', endPeriod: '2026-03' })[0])
      .toMatch(/قبل فترة البداية/);
  });
});

describe('بناء السند', () => {
  const v = buildVoucher(RENT, '2026-08');

  it('يحمل مفتاحاً حتمياً وتاريخ استحقاق وفترة', () => {
    expect(v.id).toBe('t1__2026-08');
    expect(v.periodKey).toBe('2026-08');
    expect(v.dueDate).toBe('2026-08-05');
  });

  it('ينسخ المبلغ ولا يشير إليه — رفع الإيجار لا يعيد كتابة سندات الماضي', () => {
    const raised = buildVoucher({ ...RENT, totalMonthlyCost: 6000 }, '2027-01');
    expect(v.amount).toBe(5000);
    expect(raised.amount).toBe(6000);
  });

  it('ينسخ حالة الفاتورة الضريبية ورابطها', () => {
    expect(v.isTaxInvoice).toBe(true);
    expect(v.invoiceUrl).toBe('https://x/inv');
    expect(buildVoucher({ ...RENT, isTaxInvoice: false }, '2026-08').isTaxInvoice).toBe(false);
  });

  it('يبدأ غير مسدَّد وفعّالاً', () => {
    expect(v.paymentStatus).toBe('pending');
    expect(v.status).toBe('active');
    expect(v.paidDate).toBeNull();
  });
});

describe('السندات الناقصة في مدى', () => {
  const TEMPLATES = [
    RENT,
    { id: 't2', expenseName: 'إنترنت', totalMonthlyCost: 300, paymentDay: 20, recurrence: 'monthly' },
    { id: 't3', expenseName: 'شراء لمرة واحدة', totalMonthlyCost: 900, recurrence: 'one_time' },
  ];

  it('سند لكل قالب متكرر في كل شهر من المدى', () => {
    const out = missingVouchers(TEMPLATES, new Set(), { from: '2026-01', through: '2026-03' });
    expect(out).toHaveLength(6);              // 2 templates × 3 months
    expect(out.map((v) => v.periodKey)).toEqual(
      ['2026-01', '2026-01', '2026-02', '2026-02', '2026-03', '2026-03'],
    );
  });

  it('يتخطّى ما هو موجود — فالتشغيل الثاني لا ينشئ شيئاً', () => {
    const first = missingVouchers(TEMPLATES, new Set(), { from: '2026-01', through: '2026-02' });
    const have = new Set(first.map((v) => v.id));
    expect(missingVouchers(TEMPLATES, have, { from: '2026-01', through: '2026-02' })).toEqual([]);
  });

  it('يكمل الفجوة وحدها بعد حذف شهر من الموجود', () => {
    const all = new Set(missingVouchers(TEMPLATES, new Set(), { from: '2026-01', through: '2026-03' })
      .map((v) => v.id));
    all.delete('t1__2026-02');
    const out = missingVouchers(TEMPLATES, all, { from: '2026-01', through: '2026-03' });
    expect(out.map((v) => v.id)).toEqual(['t1__2026-02']);
  });

  it('يستبعد القالب لمرة واحدة — فهو مستند بالفعل', () => {
    const out = missingVouchers(TEMPLATES, new Set(), { from: '2026-01', through: '2026-01' });
    expect(out.map((v) => v.templateId)).not.toContain('t3');
  });

  it('يحترم مدى سريان القالب', () => {
    const bounded = [{ ...RENT, startPeriod: '2026-02', endPeriod: '2026-02' }];
    expect(missingVouchers(bounded, new Set(), { from: '2026-01', through: '2026-04' })
      .map((v) => v.periodKey)).toEqual(['2026-02']);
  });

  it('مدى مقلوب أو غير صالح لا يولّد شيئاً', () => {
    expect(missingVouchers(TEMPLATES, new Set(), { from: '2026-05', through: '2026-01' })).toEqual([]);
    expect(missingVouchers(TEMPLATES, new Set(), { from: 'x', through: '2026-01' })).toEqual([]);
    expect(missingVouchers(TEMPLATES, new Set(), {})).toEqual([]);
  });

  it('يعبر حدّ السنة', () => {
    const out = missingVouchers([RENT], new Set(), { from: '2026-11', through: '2027-01' });
    expect(out.map((v) => v.periodKey)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('المستبعدون مع السبب', () => {
  it('يذكر سبب كل قالب لم يولّد', () => {
    const out = ungeneratableTemplates([
      { id: 'a', expenseName: 'بلا مبلغ', totalMonthlyCost: 0, recurrence: 'monthly' },
      { id: 'b', expenseName: 'موقوف', totalMonthlyCost: 100, recurrence: 'monthly', active: false },
      { id: 'c', expenseName: 'منتهٍ', totalMonthlyCost: 100, recurrence: 'monthly', endPeriod: '2025-12' },
      RENT,
    ], { from: '2026-01', through: '2026-03' });
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].reason).toMatch(/أكبر من صفر/);
    expect(out[1].reason).toBe('موقوف');
    expect(out[2].reason).toMatch(/انتهى في 2025-12/);
  });
});

describe('ملخص السندات', () => {
  const VOUCHERS = [
    { id: 'v1', templateId: 't1', periodKey: '2026-01', amount: 5000, paymentStatus: 'paid', status: 'active' },
    { id: 'v2', templateId: 't2', periodKey: '2026-01', amount: 300, paymentStatus: 'pending', status: 'active' },
    { id: 'v3', templateId: 't1', periodKey: '2026-02', amount: 5000, paymentStatus: 'pending', status: 'active' },
    { id: 'v4', templateId: 't3', periodKey: '2026-02', amount: 999, paymentStatus: 'pending', status: 'cancelled' },
  ];

  it('يجمع بالفترة، الأحدث أولاً، ويستبعد الملغى', () => {
    expect(summariseVouchers(VOUCHERS)).toEqual([
      { periodKey: '2026-02', count: 1, total: 5000, unpaid: 5000 },
      { periodKey: '2026-01', count: 2, total: 5300, unpaid: 300 },
    ]);
  });

  it('يعرف أي القوالب صار له سندات — أساس منع الازدواج في الضريبة', () => {
    const ids = generatedTemplateIds(VOUCHERS);
    expect(ids.has('t1')).toBe(true);
    expect(ids.has('t2')).toBe(true);
    expect(ids.has('t3')).toBe(false);   // cancelled only
  });
});
