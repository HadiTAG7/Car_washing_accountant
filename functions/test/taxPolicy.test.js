/**
 * سياسة الضريبة بتاريخ سريان — driven over BOTH copies.
 *
 * The server's copy decides what a posted entry says; the client's decides how
 * an unposted record is read on screen. If they disagree, a month reconciles
 * on one side and not the other — so both are run over one battery here,
 * exactly as `invariants.test.js` does for entry validation.
 *
 * The bug these pin down: the first change used to store the NEW policy alone.
 * With one row dated August, `taxPolicyAt('2026-07-15')` found nothing on or
 * before July, fell back to the current settings — which the change had just
 * made exclusive — and reported July as exclusive. One setting change silently
 * restated a filed month.
 *
 * Run: npm run test:functions (no emulator needed)
 */
import { describe, it, expect } from 'vitest';
import * as server from '../src/taxPolicy.js';
import * as client from '../../src/lib/accounting/taxPolicy.js';

const IMPLEMENTATIONS = [['server', server], ['client', client]];

/** inclusive since the books began, exclusive from August. */
const HISTORY = [
  { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
  { effectiveFrom: '2026-08-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
];
const SETTLED = { vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15, taxPolicyHistory: HISTORY };

describe.each(IMPLEMENTATIONS)('%s — taxPolicyAt', (_name, impl) => {
  it('تختار آخر سطر ساري في التاريخ أو قبله', () => {
    expect(impl.taxPolicyAt('2026-01-01', SETTLED)).toMatchObject({ known: true, washPriceMode: 'inclusive' });
    expect(impl.taxPolicyAt('2026-07-31', SETTLED)).toMatchObject({ known: true, washPriceMode: 'inclusive' });
    expect(impl.taxPolicyAt('2026-08-01', SETTLED)).toMatchObject({ known: true, washPriceMode: 'exclusive' });
    expect(impl.taxPolicyAt('2026-12-31', SETTLED)).toMatchObject({ known: true, washPriceMode: 'exclusive' });
  });

  // ── الفجوة التي كانت تُملأ بإعداد اليوم ──────────────────────────────
  it('وتاريخ قبل أول baseline يعود unknown ولا يعود بإعداد اليوم', () => {
    const before = impl.taxPolicyAt('2025-12-31', SETTLED);
    expect(before.known).toBe(false);
    expect(before.reason).toBe(impl.POLICY_UNKNOWN.BEFORE_BASELINE);
    expect(before.baselineFrom).toBe('2026-01-01');
    // Nothing to accidentally use as a number.
    expect(before.washPriceMode).toBeNull();
    expect(before.vatRegistered).toBeNull();
    expect(before.vatRate).toBeNull();
  });

  it('وتاريخ غير حقيقي يعود unknown — 2026-13-40 و2026-02-30', () => {
    for (const bad of ['2026-13-40', '2026-02-30', '', 'أمس']) {
      const r = impl.taxPolicyAt(bad, SETTLED);
      expect(r.known).toBe(false);
      expect(r.reason).toBe(impl.POLICY_UNKNOWN.BAD_DATE);
      expect(r.washPriceMode).toBeNull();
    }
    expect(impl.isRealPolicyDate('2026-02-30')).toBe(false);
    expect(impl.isRealPolicyDate('2028-02-29')).toBe(true);
  });

  it('وبلا سجل إطلاقاً تسري الإعدادات الحالية، معلَّمةً بأنها افتراض', () => {
    const r = impl.taxPolicyAt('2020-05-05', { vatRegistered: false, washPriceMode: 'exclusive' });
    expect(r).toMatchObject({
      known: true, source: impl.POLICY_SOURCE.UNVERSIONED,
      vatRegistered: false, washPriceMode: 'exclusive',
    });
    expect(impl.hasTaxPolicyHistory({})).toBe(false);
    expect(impl.taxPolicyBaselineDate({})).toBeNull();
    expect(impl.taxPolicyBaselineDate(SETTLED)).toBe('2026-01-01');
  });

  it('وتتجاهل السطور بلا تاريخ سريان — لا تُخمَّن', () => {
    const settings = { ...SETTLED, taxPolicyHistory: [{ washPriceMode: 'inclusive' }, ...HISTORY] };
    expect(impl.normalizeTaxPolicyHistory(settings.taxPolicyHistory, settings)).toHaveLength(2);
    expect(impl.taxPolicyAt('2026-03-01', settings).washPriceMode).toBe('inclusive');
  });

  it('والتسجيل الضريبي والنسبة يُقرآن بتاريخهما', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: [
        { effectiveFrom: '2018-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
        { effectiveFrom: '2020-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      ],
    };
    expect(impl.taxPolicyAt('2020-06-30', settings).vatRate).toBe(0.05);
    expect(impl.taxPolicyAt('2020-07-01', settings).vatRate).toBe(0.15);
  });
});

describe.each(IMPLEMENTATIONS)('%s — normalizeTaxPolicy: null ليست صفراً', (_name, impl) => {
  // The same `Number(null) === 0` trap that made a purchase with no stated VAT
  // amount deduct as a zero-VAT purchase. Here it would have silently set a
  // policy rate of 0% where the caller meant "not stated — inherit".
  it('نسبة غير مذكورة ترث الاحتياطية، وصفر صريح يبقى صفراً', () => {
    for (const unstated of [null, undefined, '', '  ']) {
      expect(impl.normalizeTaxPolicy({ vatRate: unstated }, { vatRate: 0.15 }).vatRate).toBe(0.15);
    }
    expect(impl.normalizeTaxPolicy({ vatRate: 0 }, { vatRate: 0.15 }).vatRate).toBe(0);
    expect(impl.normalizeTaxPolicy({ vatRate: '0' }, { vatRate: 0.15 }).vatRate).toBe(0);
    expect(impl.normalizeTaxPolicy({ vatRate: 0.05 }, { vatRate: 0.15 }).vatRate).toBe(0.05);
  });

  it('واحتياطية غير مذكورة تسقط إلى النسبة الافتراضية', () => {
    expect(impl.normalizeTaxPolicy({}, {}).vatRate).toBe(impl.DEFAULT_VAT_RATE);
    expect(impl.normalizeTaxPolicy({}, { vatRate: null }).vatRate).toBe(impl.DEFAULT_VAT_RATE);
  });

  it('وسطر تاريخي بنسبة غير مذكورة يرث بدل أن يصير 0%', () => {
    const settings = {
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
      taxPolicyHistory: [
        { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: null },
      ],
    };
    expect(impl.taxPolicyAt('2026-06-01', settings).vatRate).toBe(0.15);
  });
});

describe.each(IMPLEMENTATIONS)('%s — أول تغيير يكتب baseline صريحاً', (_name, impl) => {
  const current = { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: [] };

  it('يرفض أول تغيير بلا تاريخ بداية للسياسة الحالية', () => {
    expect(() => impl.withTaxPolicyChange(current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01'))
      .toThrow(/تاريخ بداية السياسة الحالية/);
  });

  it('ويكتب سطرين: baseline للسابقة ثم التغيير', () => {
    const next = impl.withTaxPolicyChange(
      current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01',
      { baselineFrom: '2026-01-01' },
    );
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ effectiveFrom: '2026-01-01', washPriceMode: 'inclusive', baseline: true });
    expect(next[1]).toMatchObject({ effectiveFrom: '2026-08-01', washPriceMode: 'exclusive' });

    // …and July therefore reads INCLUSIVE, which is the whole point.
    const settled = { vatRegistered: true, washPriceMode: 'exclusive', taxPolicyHistory: next };
    expect(impl.taxPolicyAt('2026-07-15', settled)).toMatchObject({ known: true, washPriceMode: 'inclusive' });
    expect(impl.taxPolicyAt('2026-08-15', settled)).toMatchObject({ known: true, washPriceMode: 'exclusive' });
  });

  it('وbaseline في يوم التغيير نفسه يعطي سطراً واحداً', () => {
    const next = impl.withTaxPolicyChange(
      current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01',
      { baselineFrom: '2026-08-01' },
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ effectiveFrom: '2026-08-01', washPriceMode: 'exclusive', baseline: true });
  });

  it('ويرفض baseline بعد تاريخ السريان', () => {
    expect(() => impl.withTaxPolicyChange(
      current, { ...current, washPriceMode: 'exclusive' }, '2026-08-01',
      { baselineFrom: '2026-09-01' },
    )).toThrow(/بعد تاريخ سريان/);
  });

  it('ويرفض تاريخ سريان غير حقيقي', () => {
    expect(() => impl.withTaxPolicyChange(current, current, '2026-02-30', { baselineFrom: '2026-01-01' }))
      .toThrow(/تاريخ سريان/);
  });

  it('والتهيئة وحدها تسجّل السياسة القائمة بلا تغيير', () => {
    const seeded = impl.seedTaxPolicyBaseline(current, '2026-01-01', { note: 'بداية الدفاتر' });
    expect(seeded).toEqual([{
      effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive',
      vatRate: 0.15, baseline: true, note: 'بداية الدفاتر',
    }]);
    expect(() => impl.seedTaxPolicyBaseline({ ...current, taxPolicyHistory: seeded }, '2025-01-01'))
      .toThrow(/مُهيّأ بالفعل/);
  });
});

describe.each(IMPLEMENTATIONS)('%s — التغييرات اللاحقة', (_name, impl) => {
  const settled = { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: [HISTORY[0]] };

  it('لا تُسجّل شيئاً إذا كان التاريخ يرث السياسة نفسها', () => {
    const next = impl.withTaxPolicyChange(settled, { ...settled, autoPost: true }, '2026-08-01');
    expect(next).toEqual([HISTORY[0]]);
  });

  it('وتغييران في اليوم نفسه يتركان سطراً واحداً', () => {
    const first = impl.withTaxPolicyChange(settled, { ...settled, washPriceMode: 'exclusive' }, '2026-08-01');
    const second = impl.withTaxPolicyChange(
      { ...settled, washPriceMode: 'exclusive', taxPolicyHistory: first },
      { ...settled, vatRegistered: false, washPriceMode: 'exclusive' },
      '2026-08-01',
    );
    expect(second.filter((h) => h.effectiveFrom === '2026-08-01')).toHaveLength(1);
    expect(second.find((h) => h.effectiveFrom === '2026-08-01')).toMatchObject({ vatRegistered: false });
  });

  it('والسطور تبقى مرتبة تصاعدياً', () => {
    const a = impl.withTaxPolicyChange(settled, { ...settled, washPriceMode: 'exclusive' }, '2026-08-01');
    const b = impl.withTaxPolicyChange(
      { ...settled, washPriceMode: 'exclusive', taxPolicyHistory: a },
      { ...settled, vatRate: 0.05, washPriceMode: 'exclusive' },
      '2026-03-01',
    );
    expect(b.map((h) => h.effectiveFrom)).toEqual(['2026-01-01', '2026-03-01', '2026-08-01']);
  });

  // ── التغيير المستقبلي لا يحرّك اليوم ────────────────────────────────
  it('تغيير مستقبلي لا يغيّر سياسة اليوم ولا الحقول المسطّحة', () => {
    const future = impl.withTaxPolicyChange(settled, { ...settled, washPriceMode: 'exclusive' }, '2026-12-01');
    const asOf = '2026-08-15';
    expect(impl.taxPolicyAt(asOf, { taxPolicyHistory: future })).toMatchObject({ washPriceMode: 'inclusive' });
    // The compatibility fields must equal taxPolicyAt(today), not the last row.
    expect(impl.currentPolicyFields(future, asOf)).toEqual({
      vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15,
    });
    // …and once the date arrives, they move on their own.
    expect(impl.currentPolicyFields(future, '2026-12-01')).toMatchObject({ washPriceMode: 'exclusive' });
  });

  it('والحقول المسطّحة قبل الـbaseline لا تُخترع', () => {
    expect(impl.currentPolicyFields(HISTORY, '2025-06-01')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// قرار إضافة السطر: يُقاس على ما سيسري في تاريخه، لا على إعداد اليوم
// ═══════════════════════════════════════════════════════════════════════════
// The comparison used to be `proposed` against the CURRENT flat fields, which
// silently dropped two whole classes of legitimate change: a future row
// returning to an earlier policy, and a historical correction to a policy that
// happens to match today.
describe.each(IMPLEMENTATIONS)('%s — السطر يُقاس بما يسبقه', (_name, impl) => {
  const settled = (rows) => ({
    vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: rows,
  });

  it('inclusive اليوم → exclusive سبتمبر → inclusive أكتوبر: السطر يُحفظ', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
      { effectiveFrom: '2026-09-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
    ];
    // Today is August, so the flat fields read `inclusive` — and the October
    // row matches them. The old comparison dropped it for that reason and the
    // transition simply disappeared.
    const next = impl.withTaxPolicyChange(
      settled(rows),
      { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      '2026-10-01',
    );
    expect(next.map((h) => h.effectiveFrom)).toEqual(['2026-01-01', '2026-09-01', '2026-10-01']);
    const after = { taxPolicyHistory: next };
    expect(impl.taxPolicyAt('2026-08-15', after).washPriceMode).toBe('inclusive');
    expect(impl.taxPolicyAt('2026-09-15', after).washPriceMode).toBe('exclusive');
    expect(impl.taxPolicyAt('2026-10-15', after).washPriceMode).toBe('inclusive');
    // …and today's flat fields did not move.
    expect(impl.currentPolicyFields(next, '2026-08-15')).toMatchObject({ washPriceMode: 'inclusive' });
  });

  it('و5% يناير → 15% يوليو → تصحيح مارس إلى 15% رغم أنها نسبة اليوم', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05, baseline: true },
      { effectiveFrom: '2026-07-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
    ];
    const next = impl.withTaxPolicyChange(
      { ...settled(rows), vatRate: 0.15 },
      { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 },
      '2026-03-01',
    );
    expect(next.map((h) => h.effectiveFrom)).toEqual(['2026-01-01', '2026-03-01', '2026-07-01']);
    const after = { taxPolicyHistory: next };
    expect(impl.taxPolicyAt('2026-02-15', after).vatRate).toBe(0.05);
    expect(impl.taxPolicyAt('2026-03-15', after).vatRate).toBe(0.15);
  });

  it('وتعديل سطر موجود في التاريخ نفسه يُقاس بما قبله لا بنفسه', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
      { effectiveFrom: '2026-09-01', vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.15 },
    ];
    // Correcting September to 5%: still a real transition from January.
    const edited = impl.withTaxPolicyChange(
      settled(rows), { vatRegistered: true, washPriceMode: 'exclusive', vatRate: 0.05 }, '2026-09-01',
    );
    expect(edited).toHaveLength(2);
    expect(impl.taxPolicyAt('2026-09-15', { taxPolicyHistory: edited })).toMatchObject({ vatRate: 0.05 });

    // …and correcting it BACK to January's policy removes the transition,
    // because there is no longer one to describe.
    const undone = impl.withTaxPolicyChange(
      settled(rows), { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }, '2026-09-01',
    );
    expect(undone.map((h) => h.effectiveFrom)).toEqual(['2026-01-01']);
    expect(impl.taxPolicyAt('2026-09-15', { taxPolicyHistory: undone }).washPriceMode).toBe('inclusive');
  });

  it('وسياسة مطابقة فعلاً لما سيسري لا تضيف سطراً عديم الأثر', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
    ];
    const next = impl.withTaxPolicyChange(
      settled(rows), { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15 }, '2026-08-01',
    );
    expect(next).toEqual(rows);
  });

  it('وسطر أسبق من الـbaseline يصبح هو الـbaseline، وواحد فقط', () => {
    const rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
    ];
    const next = impl.withTaxPolicyChange(
      settled(rows), { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.05 }, '2025-06-01',
    );
    expect(next.map((h) => h.effectiveFrom)).toEqual(['2025-06-01', '2026-01-01']);
    expect(next.filter((h) => h.baseline)).toHaveLength(1);
    expect(next[0].baseline).toBe(true);
    expect(next[1].baseline).toBeUndefined();
  });

  it('ولا يُترك تاريخان متكرران مهما تكرر التعديل', () => {
    let rows = [
      { effectiveFrom: '2026-01-01', vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, baseline: true },
    ];
    for (const rate of [0.05, 0.15, 0.05]) {
      rows = impl.withTaxPolicyChange(settled(rows), {
        vatRegistered: true, washPriceMode: 'inclusive', vatRate: rate,
      }, '2026-09-01');
    }
    expect(new Set(rows.map((h) => h.effectiveFrom)).size).toBe(rows.length);
    expect(rows.map((h) => h.effectiveFrom)).toEqual(['2026-01-01', '2026-09-01']);
    expect(rows[1].vatRate).toBe(0.05);
  });
});

describe('النسختان متطابقتان', () => {
  const cases = [
    ['2026-07-31', SETTLED],
    ['2026-08-15', SETTLED],
    ['2025-12-31', SETTLED],
    ['2026-02-30', SETTLED],
    ['2020-01-01', { vatRegistered: false, washPriceMode: 'inclusive' }],
    ['', { taxPolicyHistory: HISTORY }],
  ];
  it.each(cases)('taxPolicyAt(%s) يعطي النتيجة نفسها', (date, settings) => {
    expect(server.taxPolicyAt(date, settings)).toEqual(client.taxPolicyAt(date, settings));
  });
});
