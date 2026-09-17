/**
 * مؤشرات الشريك من الخادم — الأشهر والعدّ بحصّته
 * Run: npm run test:functions
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { lastMonthKeys, partnerWashShare, MAX_MONTHS } from '../src/partnerInsights.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;

describe('مفاتيح الأشهر — بلا محاكي', () => {
  it('آخر n شهراً تصاعدياً حتى شهر اليوم', () => {
    expect(lastMonthKeys(3, new Date(2026, 7, 15))).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(lastMonthKeys(1, new Date(2026, 0, 1))).toEqual(['2026-01']);
  });
  it('تعبر السنة، وتُقيَّد بالحدّ', () => {
    expect(lastMonthKeys(2, new Date(2026, 0, 10))).toEqual(['2025-12', '2026-01']);
    expect(lastMonthKeys(99, new Date(2026, 0, 10))).toHaveLength(MAX_MONTHS);
    expect(lastMonthKeys(0, new Date(2026, 0, 10))).toHaveLength(1);
  });
});

d('حصّة الشريك من الغسلات', () => {
  let app, db;
  beforeAll(() => { app = initializeApp({ projectId: 'demo-sweater-insights' }, 'partner-insights'); db = getFirestore(app); }, 60_000);
  afterAll(async () => { if (app) await deleteApp(app); });
  beforeEach(async () => {
    for (const c of ['partners', 'washes']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
    await db.collection('partners').doc('p1').set({ partner_name: 'أحمد', workers_count: 1, user_id: 'u1' });
    await db.collection('partners').doc('p2').set({ partner_name: 'سالم', workers_count: 9, user_id: 'u2' });
    const rows = [];
    for (let i = 1; i <= 10; i += 1) rows.push({ biker_name: 'خالد', quantity: 10, status: 'مكتملة', wash_date: `2026-08-${String(i).padStart(2, '0')}`, price: 11.5 });
    rows.push({ biker_name: 'خالد', quantity: 40, status: 'ملغاة', wash_date: '2026-08-20', price: 11.5 });
    rows.push({ biker_name: 'خالد', quantity: 30, status: 'مكتملة', wash_date: '2026-07-05', price: 11.5 });
    await Promise.all(rows.map((r) => db.collection('washes').add(r)));
  }, 60_000);

  it('١٠٠ غسلة مكتملة × ١٠٪ = ١٠، والملغاة لا تُعدّ، ولا اسمٌ في الردّ', async () => {
    const r = await partnerWashShare(db, { partnerId: 'p1', months: 2, today: new Date(2026, 7, 15) });
    expect(r).toMatchObject({ workersCount: 1, totalWorkers: 10, sharePercent: 10 });
    expect(r.months).toEqual([
      { month: '2026-07', companyCount: 30, shareCount: 3 },
      { month: '2026-08', companyCount: 100, shareCount: 10 },
    ]);
    expect(JSON.stringify(r)).not.toContain('خالد');
  }, 60_000);

  it('شريكٌ بلا عمالة: أصفار بحصّته وعدد الشركة كما هو', async () => {
    await db.collection('partners').doc('p1').update({ workers_count: 0 });
    const r = await partnerWashShare(db, { partnerId: 'p1', months: 1, today: new Date(2026, 7, 15) });
    expect(r.sharePercent).toBe(0);
    expect(r.months[0]).toEqual({ month: '2026-08', companyCount: 100, shareCount: 0 });
  }, 60_000);
});
