/**
 * أدوات الشريك — بقارئٍ مزيّف، وبأرقامٍ تُطابق دوال التطبيق
 * ═══════════════════════════════════════════════════════════════════════════
 * ثلاثة ادعاءات: كل أداةٍ تخرج من المصفاة، وأرقامها هي أرقام `monthlyStatement`
 * مقسومةً بالنسبة لا رقمٌ ثانٍ، وليس في الملف أداةُ كتابةٍ واحدة.
 *
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { partnerTools, partnerToolNames } from '../tools.js';
import { monthlyStatement } from '../../../src/lib/accounting/monthlyStatement.js';

const ACCOUNTS = [
  { code: '1010', nameArabic: 'الصندوق', accountType: 'asset', normalBalance: 'debit' },
  { code: '2100', nameArabic: 'ضريبة مخرجات', accountType: 'liability', normalBalance: 'credit' },
  { code: '4000', nameArabic: 'إيرادات غسيل السيارات', accountType: 'revenue', normalBalance: 'credit' },
  { code: '4010', nameArabic: 'مردودات المبيعات', accountType: 'revenue', normalBalance: 'debit', contra: true },
  { code: '5000', nameArabic: 'عمولات البايكرز', accountType: 'expense', normalBalance: 'debit', directCost: true },
  { code: '5200', nameArabic: 'الإيجار', accountType: 'expense', normalBalance: 'debit' },
];

let seq = 0;
function entryOf(entryDate, rows) {
  seq += 1;
  const id = `e${seq}`;
  return {
    id, entryDate, periodKey: entryDate.slice(0, 7), entryNumber: seq, status: 'posted', sourceType: 'manual',
    lines: rows.map((r) => ({ accountId: r[0], debit: r[1] || 0, credit: r[2] || 0 })),
  };
}
const linesOf = (entries) => entries.flatMap((e) => e.lines.map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` })));

// بيع ١١٥: نقد ١١٥ / إيراد ١٠٠ / ضريبة ١٥ — وإيجار ٤٠.
const ENTRIES = [
  entryOf('2026-08-11', [['1010', 115, 0], ['4000', 0, 100], ['2100', 0, 15]]),
  entryOf('2026-08-15', [['5200', 40, 0], ['1010', 0, 40]]),
  entryOf('2026-07-03', [['1010', 230, 0], ['4000', 0, 200], ['2100', 0, 30]]),
];

const PARTNERS = [
  { id: 'p1', partnerName: 'أحمد الغانم', workersCount: 1, status: 'active' },
  { id: 'p2', partnerName: 'سالم', workersCount: 9, status: 'active' },
];
const RECEIPTS = [
  { id: 'r1', amount: 5000, paymentDate: '2026-08-02', paymentMethod: 'cash', notes: 'دفعة أولى' },
];
// عشرة صفوفٍ بعشر غسلات = ١٠٠ غسلة مكتملة، وواحدةٌ ملغاة لا تُعدّ.
const WASHES = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, quantity: 10, price: 11.5, status: 'مكتملة', washDate: `2026-08-${String(i + 1).padStart(2, '0')}`, priceMode: null })),
  { id: 'wx', quantity: 50, price: 11.5, status: 'ملغاة', washDate: '2026-08-20', priceMode: null },
];

const calls = [];
const fakeLoad = {
  partners: async () => { calls.push('partners'); return PARTNERS; },
  receipts: async () => RECEIPTS,
  feeRules: async () => [],
  months: async () => ['2026-08', '2026-07'],
  accounts: async () => ACCOUNTS,
  periodStatuses: async () => new Map([['2026-08', 'open'], ['2026-07', 'closed']]),
  settings: async () => ({ vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }),
  ledger: async (fromKey, toKey) => {
    const entries = ENTRIES.filter((e) => e.periodKey >= fromKey && e.periodKey <= toKey);
    return { entries, lines: linesOf(entries) };
  },
  washes: async (periodKey) => WASHES.filter((w) => w.washDate.slice(0, 7) === periodKey),
};
const ctx = {
  principal: { keyId: 'pmk_k1', partnerId: 'p1', ownerUid: 'uid-1', createdAtIso: '2026-08-01T00:00:00.000Z', partner: PARTNERS[0] },
  load: fakeLoad,
};

const tool = (name) => partnerTools.find((t) => t.name === name);
const call = async (name, args = {}) => JSON.parse((await tool(name).run(args, ctx)).content[0].text);
const FORBIDDEN_TEXT = ['سالم', 'uid-1', 'user_id', 'bikerName', 'biker_name', 'ownerUid'];

describe('سجل الأدوات', () => {
  it('ستّ أدوات، كلها بالبادئة `partner_`، ولا كتابةٌ بينها', () => {
    expect(partnerToolNames).toEqual([
      'partner_whoami', 'partner_capital', 'partner_income_statement',
      'partner_trend', 'partner_operations', 'partner_roi', 'partner_summary',
    ]);
    for (const t of partnerTools) {
      expect(t.name.startsWith('partner_'), t.name).toBe(true);
      expect(`${t.title} ${t.description}`).not.toMatch(/ترحيل|عكس|إقفال|سجّل|احذف/);
      expect(typeof t.run).toBe('function');
    }
  });
});

describe('كل أداةٍ تخرج من المصفاة', () => {
  for (const name of partnerToolNames) {
    it(`${name}: لا اسم شريكٍ آخر ولا معرّف حساب`, async () => {
      const res = await tool(name).run({}, ctx);
      const text = res.content[0].text;
      expect(res.isError).toBeFalsy();
      for (const f of FORBIDDEN_TEXT) expect(text, `${name} يحمل «${f}»`).not.toContain(f);
      expect(() => JSON.parse(text)).not.toThrow();
    });
  }
});

describe('من أنا', () => {
  it('اسمي ونسبتي ومجموع العمالة — لا قائمة الشركاء', async () => {
    const me = await call('partner_whoami');
    expect(me).toMatchObject({ partnerName: 'أحمد الغانم', workersCount: 1, totalWorkers: 10, sharePercent: 10, hasShare: true, latestMonth: '2026-08' });
    expect(me.partners).toBeUndefined();
    expect(me.mode).toMatch(/قراءة فقط/);
  });
});

describe('رأس مالي', () => {
  it('سنداتي وحدها، والطريقة بلغتها', async () => {
    const cap = await call('partner_capital');
    expect(cap.paid).toBe(5000);
    expect(cap.receipts).toEqual([{ date: '2026-08-02', amount: 5000, method: 'cash', methodLabel: 'نقدي', notes: 'دفعة أولى' }]);
    expect(cap.required).toBe(20000);
    expect(cap.remaining).toBe(15000);
  });
});

describe('قائمة الدخل بحصّتي', () => {
  it('هي `monthlyStatement` بالنسبة — لا حسابٌ ثانٍ', async () => {
    const st = await call('partner_income_statement', { month: '2026-08' });
    const expected = monthlyStatement({
      accounts: ACCOUNTS, entries: ENTRIES, lines: linesOf(ENTRIES), periodKey: '2026-08', feeRules: [], scalingFactor: 0.1,
    });
    expect(st.netRevenue).toBe(expected.netRevenue);       // 10
    expect(st.operatingExpenses).toBe(expected.operatingExpenses); // 4
    expect(st.netProfit).toBe(expected.netProfit);         // (100-40-9)*0.1 = 5.1
    expect(st.netProfit).toBe(5.1);
    expect(st.expensesByAccount).toEqual([{ code: '5200', name: 'الإيجار', amount: 4 }]);
    expect(st.hasActivity).toBe(true);
  });

  it('وتحمل حال الفترة: مفتوح = مبدئي، مُقفَل = نهائي', async () => {
    expect((await call('partner_income_statement', { month: '2026-08' })).periodStatus).toBe('open');
    const closed = await call('partner_income_statement', { month: '2026-07' });
    expect(closed.periodStatus).toBe('closed');
    expect(closed.periodStatusLabel).toMatch(/نهائي/);
  });

  it('بلا شهر: آخر شهرٍ مُرحَّل لا شهر اليوم', async () => {
    expect((await call('partner_income_statement')).month).toBe('2026-08');
  });

  it('شهرٌ بلا حركة: تلميحٌ لا خطأ', async () => {
    const st = await call('partner_income_statement', { month: '2024-01' });
    expect(st.hasActivity).toBe(false);
    expect(st.note).toMatch(/لا توجد حركة/);
    expect(st.availableMonths).toEqual(['2026-08', '2026-07']);
  });

  it('بلا عمالة: إشعارٌ لا أصفار', async () => {
    const noShare = { ...ctx, load: { ...fakeLoad, partners: async () => [{ id: 'p1', partnerName: 'أحمد', workersCount: 0 }, PARTNERS[1]] } };
    const st = JSON.parse((await tool('partner_income_statement').run({}, noShare)).content[0].text);
    expect(st.hasShare).toBe(false);
    expect(st.hint).toMatch(/٠٪/);
    expect(st.netRevenue).toBeUndefined();
  });
});

describe('التشغيل بحصّتي', () => {
  it('١٠٠ غسلة ونسبتي ١٠٪ = ١٠ غسلات — والملغاة لا تُعدّ', async () => {
    const ops = await call('partner_operations', { month: '2026-08' });
    expect(ops.washes.companyCount).toBe(100);
    expect(ops.washes.yourShareCount).toBe(10);
    expect(ops.washes.text).toBe('10 من أصل 100 غسلة تعادل حصّتك');
    // ١٠٠ × ١١٫٥ شامل = ١١٥٠ إجمالي، ١٠٠٠ صافٍ — بحصّته: ١١٥ و١٠٠.
    expect(ops.washes.grossSalesShare).toBe(115);
    expect(ops.washes.netSalesShare).toBe(100);
    expect(ops.ledger.expensesByAccount).toEqual([{ code: '5200', name: 'الإيجار', amount: 4 }]);
  });
});

describe('الاتجاه والملخّص', () => {
  it('الاتجاه شهرٌ لكل مفتاح، بقراءةٍ واحدة للمدى', async () => {
    const tr = await call('partner_trend', { months: 3 });
    expect(tr.months).toHaveLength(3);
    expect(tr.months.every((m) => /^\d{4}-\d{2}$/.test(m.month))).toBe(true);
    expect(tr.sharePercent).toBe(10);
  });

  it('الملخّص يجمع الهوية ورأس المال وآخر شهر — ويقرأ الشركاء مرةً واحدة عبر الذاكرة', async () => {
    const memo = new Map();
    const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
    calls.length = 0;
    const memoLoad = { ...fakeLoad, partners: () => once('partners', fakeLoad.partners) };
    const sum = JSON.parse((await tool('partner_summary').run({}, { ...ctx, load: memoLoad })).content[0].text);
    expect(sum).toMatchObject({ partnerName: 'أحمد الغانم', sharePercent: 10 });
    expect(sum.capital.paid).toBe(5000);
    expect(sum.latestMonth).toMatchObject({ month: '2026-08', netProfit: 5.1 });
    expect(sum.trend).toHaveLength(6);
    expect(calls.filter((c) => c === 'partners')).toHaveLength(1);
  });
});

describe('استرداد رأس مالي', () => {
  it('حصّته منذ أول قيد مقابل ما دفعه، مع تقديرٍ وتغيّرٍ ومنذ بداية السنة', async () => {
    const r = await call('partner_roi');
    // بلا قواعد رسومٍ مضبوطة تُطبَّق الافتراضية (١٠٪ + ٥٪ من الربح):
    // يوليو: (200 − 30) × 0.1 = 17 · أغسطس: (100 − 40 − 9) × 0.1 = 5.1 → 22.1 من 5000
    expect(r.cumulativeProfit).toBe(22.1);
    expect(r.paid).toBe(5000);
    expect(r.recovered).toBe(false);
    expect(r.recoveredPercent).toBe(0.4);
    expect(r.monthsToRecover).toBeGreaterThan(0);
    expect(r.estimate).toMatch(/شهراً/);
    expect(r.latestMonth).toMatchObject({ month: '2026-08', netProfit: 5.1, direction: 'down' });
    expect(r.yearToDate).toEqual({ year: '2026', netProfit: 22.1 });
  });
});
