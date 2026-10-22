// قائمة الدخل من أشهرها وحدها = قائمة الدخل من المجموعات كاملة.
//
// منفّذٌ في الذاكرة يتصرّف كـ Firestore (نطاق نصّي فقط، `in` صارم النوع،
// `!= null` يستبعد الغائب، ترتيب المعرّفات) يقرأ بيانات عشوائية مليئة
// بالحالات الحدّية، ثم يُحسب كل ناتج مرتين — من المجموعات كاملة كما كان، ومن
// المحمِّل المحدود بالأشهر — ويجب أن يتطابقا تماماً، أخطاءً كانت أم أرقاماً.
import { describe, expect, it } from 'vitest';
import { loadScopedIncomeSources, monthsBetween } from '../incomeStatementScope.js';
import { overviewWindow } from '../../overviewDashboard.js';
import { dataset, MONTHS, memoryFirestore, outputs, fullSources } from './fixtures/incomeStatementData.js';

// Hundreds of generated datasets per test: seconds alone, longer on a busy runner.
const HEAVY = 120_000;

const scenarios = [
  { name: 'النظرة العامة — الشهر الحالي', periodKey: '2026-10', today: '2026-10-21' },
  { name: 'النظرة العامة — شهر ماضٍ', periodKey: '2026-08', today: '2026-10-21' },
  { name: 'يناير بعد ديسمبر', periodKey: '2026-01', today: '2026-02-10' },
  { name: 'مارس بعد فبراير القصير', periodKey: '2026-03', today: '2026-03-31' },
];

describe('مصادر قائمة الدخل بالأشهر تطابق المجموعات كاملة', () => {
  for (const scenario of scenarios) {
    it(`${scenario.name}: ٢٠٠ بيانات عشوائية`, async () => {
      for (let seed = 1; seed <= 200; seed += 1) {
        const data = dataset(seed * 7919 + scenario.periodKey.length);
        const { exec } = memoryFirestore(data);
        const window = overviewWindow(scenario.periodKey, scenario.today);
        const statementMonths = window.completeMonth ? [window.previousKey, scenario.periodKey] : [scenario.periodKey];
        const todayMonth = scenario.today.slice(0, 7);
        const washMonths = monthsBetween(window.previousKey, todayMonth > scenario.periodKey ? todayMonth : scenario.periodKey);
        const scoped = await loadScopedIncomeSources(exec, { statementMonths, washMonths, withBikers: true });
        const full = await fullSources(exec);
        const args = { statementMonths, periodKey: scenario.periodKey, today: scenario.today };
        expect(outputs({ ...args, sources: scoped }), `seed ${seed}`).toStrictEqual(outputs({ ...args, sources: full }));
      }
    }, HEAVY);
  }

  it('قائمة الدخل لستة أشهر (الاتجاه) تطابق أيضاً', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const data = dataset(seed * 104729);
      const { exec } = memoryFirestore(data);
      const statementMonths = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
      const scoped = await loadScopedIncomeSources(exec, { statementMonths, withBikers: true });
      const full = await fullSources(exec);
      const args = { statementMonths, periodKey: '2026-10', today: '2026-10-21' };
      const strip = o => ({ statements: o.statements, payroll: o.payroll, reconciliation: o.reconciliation });
      expect(strip(outputs({ ...args, sources: scoped })), `seed ${seed}`).toStrictEqual(strip(outputs({ ...args, sources: full })));
    }
  }, HEAVY);

  it('يقرأ أقل بكثير من المجموعات كاملة على بيانات بحجم حقيقي', async () => {
    const data = dataset(42);
    for (let i = 0; i < 3000; i += 1) {
      const m = MONTHS[i % MONTHS.length];
      data.washes[`bulk${String(i).padStart(5, '0')}`] = { wash_date: `${m}-1${i % 9}`, status: 'مكتملة', quantity: 1, price: 23, revenue_origin: 'sweater', ssp_booking_id: `SB${i}` };
    }
    const scopedFs = memoryFirestore(data); const fullFs = memoryFirestore(data);
    await loadScopedIncomeSources(scopedFs.exec, { statementMonths: ['2026-10'], washMonths: ['2026-09', '2026-10'], withBikers: true });
    await fullSources(fullFs.exec);
    expect(scopedFs.reads.docs).toBeLessThan(fullFs.reads.docs / 2);
  }, HEAVY);
});
