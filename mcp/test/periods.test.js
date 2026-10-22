/**
 * الفترات — «هذا الشهر» يُحَلّ في الخادم لا في رأس النموذج
 * Run: npm test --prefix mcp
 */
import { describe, it, expect } from 'vitest';
import { resolvePeriod, previousPeriod, todayInfo, monthKeysBetween, PERIOD_TOKENS } from '../src/periods.js';
import { execFileSync } from 'node:child_process';

const NOW = new Date('2026-08-15T12:00:00+03:00'); // ١٥ أغسطس ٢٠٢٦ في الرياض

describe('اليوم', () => {
  it('يُرجع التاريخ والشهر الحالي بصيغتَيهما', () => {
    expect(todayInfo(NOW)).toMatchObject({ today: '2026-08-15', currentMonth: '2026-08' });
    expect(todayInfo(NOW).label).toContain('2026');
  });
  it('يعبر منتصف الليل في الرياض ولو بقي الخادم في اليوم السابق', () => {
    expect(todayInfo(new Date('2026-10-22T20:59:59.999Z')).today).toBe('2026-10-22');
    expect(todayInfo(new Date('2026-10-22T21:00:00.000Z'))).toMatchObject({ today: '2026-10-23', currentMonth: '2026-10' });
    expect(todayInfo(new Date('2026-10-22T22:12:00.000Z')).label).toContain('23');
  });
  it('يعتمد شهر وسنة الرياض عند حدود الشهر والسنة والكبيسة', () => {
    const monthEdge = new Date('2026-10-31T21:00:00Z');
    expect(todayInfo(monthEdge)).toMatchObject({ today: '2026-11-01', currentMonth: '2026-11' });
    expect(resolvePeriod({ period: 'this_month' }, { now: monthEdge })).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(resolvePeriod({ period: 'last_month' }, { now: monthEdge })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    const yearEdge = new Date('2026-12-31T21:00:00Z');
    expect(resolvePeriod({ period: 'ytd' }, { now: yearEdge })).toMatchObject({ from: '2027-01-01', to: '2027-01-01' });
    expect(resolvePeriod({ period: 'last_year' }, { now: yearEdge })).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(todayInfo(new Date('2028-02-28T21:00:00Z')).today).toBe('2028-02-29');
  });
  it('يعطي النتيجة نفسها على خوادم UTC والرياض ولوس أنجلوس وطوكيو', () => {
    const moduleUrl = new URL('../src/periods.js', import.meta.url).href;
    const script = `import { todayInfo, resolvePeriod } from ${JSON.stringify(moduleUrl)};
      const now = new Date('2026-12-31T21:30:00Z');
      console.log(JSON.stringify({ today: todayInfo(now), current: resolvePeriod({}, { now }), previous: resolvePeriod({ period: 'last_month' }, { now }) }));`;
    const results = ['UTC', 'Asia/Riyadh', 'America/Los_Angeles', 'Asia/Tokyo'].map(TZ =>
      JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ } })));
    for (const result of results) {
      expect(result).toEqual(results[0]);
      expect(result.today.today).toBe('2027-01-01');
      expect(result.current.periodKey).toBe('2027-01');
      expect(result.previous.periodKey).toBe('2026-12');
    }
  });
});

describe('حلّ الفترة', () => {
  const at = (spec) => resolvePeriod(spec, { now: NOW });

  it('الافتراضي هذا الشهر — بحدوده الصحيحة', () => {
    expect(at({})).toMatchObject({ from: '2026-08-01', to: '2026-08-31', periodKey: '2026-08', months: ['2026-08'] });
    expect(at({}).label).toContain('هذا الشهر');
  });
  it('الشهر الماضي، وفبراير الكبيسة، والسنة والربع', () => {
    expect(at({ period: 'last_month' })).toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
    expect(at({ month: '2028-02' })).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(at({ period: '2026' })).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(at({ period: '2026-Q3' })).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(at({ period: '2026-Q3' }).months).toEqual(['2026-07', '2026-08', '2026-09']);
  });
  it('آخر n أشهر تعبر السنة، ومنذ بداية السنة تنتهي اليوم', () => {
    expect(at({ period: 'last_3_months' })).toMatchObject({ from: '2026-06-01', to: '2026-08-31' });
    expect(resolvePeriod({ period: 'last_3_months' }, { now: new Date(2026, 0, 10) })).toMatchObject({ from: '2025-11-01', to: '2026-01-31' });
    expect(at({ period: 'ytd' })).toMatchObject({ from: '2026-01-01', to: '2026-08-15' });
    expect(at({ period: 'last_quarter' })).toMatchObject({ from: '2026-04-01', to: '2026-06-30' });
  });
  it('`from`/`to` الصريحان يعلوان، و`all` بلا حدود', () => {
    expect(at({ period: 'last_month', from: '2026-01-05', to: '2026-02-10' })).toMatchObject({ from: '2026-01-05', to: '2026-02-10', kind: 'custom' });
    expect(at({ period: 'all' })).toMatchObject({ from: null, to: null, kind: 'all' });
    expect(resolvePeriod({}, { now: NOW, fallback: 'all' }).kind).toBe('all');
  });
  it('فترةٌ غير مفهومة تُرفض برسالةٍ تسمّي المقبول', () => {
    expect(() => at({ period: 'الشهر الجاي' })).toThrow(/2026-08/);
    expect(() => at({ period: 'الشهر الجاي' })).toThrow(/this_month/);
  });
  it('كل الكلمات المعلنة تُحَلّ', () => {
    for (const t of PERIOD_TOKENS) expect(() => at({ period: t }), t).not.toThrow();
  });
});

describe('الفترة السابقة والأشهر بين حدَّين', () => {
  it('شهرٌ سابقٌ لشهر، وثلاثةٌ لثلاثة، ولا سابق لـ all', () => {
    expect(previousPeriod(resolvePeriod({ month: '2026-08' })).months).toEqual(['2026-07']);
    expect(previousPeriod(resolvePeriod({ period: '2026-Q3' })).months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(previousPeriod(resolvePeriod({ month: '2026-01' })).months).toEqual(['2025-12']);
    expect(previousPeriod(resolvePeriod({ period: 'all' }))).toBeNull();
  });
  it('monthKeysBetween شاملة الطرفين', () => {
    expect(monthKeysBetween('2025-11-03', '2026-02-28')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
