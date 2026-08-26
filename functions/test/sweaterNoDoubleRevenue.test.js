/**
 * الإيراد مرة واحدة — الادعاء الذي لا يكفي فيه فصل الحسابين
 * ═══════════════════════════════════════════════════════════════════════════
 * فصلُ ٤٠٠٠ عن ٤٠٠١ يجعل الازدواج **مرئياً**، لا مستحيلاً. وهذا الملف يختبر
 * الاستحالة: غسلةٌ محلية وحجز سويتر يصفان نفس الخدمة **لا ينتجان إيراداً
 * مضاعفاً** — لا في دفتر الأستاذ ولا في قائمة الدخل.
 *
 * والمنع في **المُحوِّل** لا في الشاشة: هذا الاختبار يستدعي `postSource`
 * مباشرةً، أي يتخطّى كل واجهة — وهو بالضبط ما تفعله أداة صيانة أو استدعاءٌ
 * يُكتب بعد سنة.
 *
 * Run: npm run test:functions   (يحتاج المحاكي)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { postSource, seedChartOfAccounts, COL } from '../src/ledger.js';
import { ACC } from '../src/posting.js';
import { linkWashToBooking, unlinkWashBooking, linkOfBooking, LINKS_COL } from '../src/sweater/revenueOrigin.js';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../../src/lib/accounting/chartOfAccounts.js';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const PROJECT = 'demo-sweater-nodouble';

let app, db;

/** مجموع الدائن على حسابٍ ما عبر كل القيود — أي «كم إيراداً أُثبت؟». */
async function creditOn(accountId) {
  const snap = await db.collection(COL.ENTRIES).get();
  let total = 0;
  for (const doc of snap.docs) {
    for (const l of doc.data().lines || []) {
      if (String(l.accountId) === accountId) total += (Number(l.credit) || 0) - (Number(l.debit) || 0);
    }
  }
  return Math.round(total * 100) / 100;
}

d('لا ازدواج في إيراد سويتر', () => {
  beforeAll(async () => {
    app = initializeApp({ projectId: PROJECT }, 'sweater-nodouble');
    db = getFirestore(app);
  }, 60_000);

  afterAll(async () => { if (app) await deleteApp(app); });

  beforeEach(async () => {
    for (const c of [COL.ENTRIES, COL.LOCKS, COL.PERIODS, COL.AUDIT, COL.ACCOUNTS,
      'counters', 'washes', LINKS_COL]) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((x) => x.ref.delete()));
    }
    await seedChartOfAccounts(db, FieldValue, DEFAULT_CHART_OF_ACCOUNTS, { userId: 'acct1' });
    await db.collection('app_settings').doc('accounting').set({
      value: { vatRegistered: true, washPriceMode: 'inclusive', vatRate: 0.15, taxPolicyHistory: [] },
    });
  }, 60_000);

  const wash = (over = {}) => ({
    biker_name: 'أحمد', quantity: 1, price: 23, status: 'مكتملة',
    wash_date: '2026-05-20', payment_method: 'cash', ...over,
  });

  it('الغسلة المباشرة تُرحَّل كما كانت — التكامل لا يكسر ما يعمل', async () => {
    await db.collection('washes').doc('W1').set(wash({ revenue_origin: 'direct' }));
    const res = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'W1' }, { userId: 'acct1' });
    expect(res.entryNumber).toBeGreaterThan(0);
    expect(await creditOn(ACC.WASH_REVENUE)).toBe(20);
  }, 60_000);

  it('وغسلةٌ بلا مصدرٍ مذكور تُرحَّل — التوافق مع البيانات القديمة', async () => {
    // كل غسلات الإنتاج القديمة بلا الحقل. لو منعها التكامل لتوقّف كل شيء.
    await db.collection('washes').doc('W_OLD').set(wash());
    await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: 'W_OLD' }, { userId: 'acct1' }))
      .resolves.toMatchObject({ entryNumber: expect.any(Number) });
  }, 60_000);

  it('وغسلةٌ مصدرها سويتر يرفضها المُحوِّل — لا الشاشة', async () => {
    // الادعاء الحامل: الاستدعاء المباشر يتخطّى كل واجهة، وهنا يُرفض أيضاً.
    await db.collection('washes').doc('W2').set(
      wash({ revenue_origin: 'sweater', ssp_booking_id: 'B-100' }),
    );
    await expect(postSource(db, FieldValue, { kind: 'wash', sourceId: 'W2' }, { userId: 'acct1' }))
      .rejects.toThrow(/سويتر/);

    // ولا قيد ولا قفل ولا ريال.
    expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
    expect((await db.collection(COL.LOCKS).get()).size).toBe(0);
    expect(await creditOn(ACC.WASH_REVENUE)).toBe(0);
  }, 60_000);

  it('ورسالة الرفض تقول أين يُعترف بالإيراد بدلاً من هنا', async () => {
    await db.collection('washes').doc('W3').set(wash({ revenue_origin: 'sweater' }));
    const err = await postSource(db, FieldValue, { kind: 'wash', sourceId: 'W3' }, { userId: 'acct1' })
      .catch((e) => e.message);
    expect(err).toContain('تسوية سويتر الشهرية');
    expect(err).toContain('مرتين');
  }, 60_000);

  it('والحصيلة: خدمةٌ واحدة ⇐ إيرادٌ واحد في دفتر الأستاذ', async () => {
    // نفس الخدمة وصلت من مسارين: سُجّلت غسلةً محلية (لأن الموظف سجّلها)
    // ووصلت حجزاً من سويتر. الغسلة موسومة `sweater` فتُرفض، ويبقى الإيراد
    // للتسوية الشهرية وحدها.
    await db.collection('washes').doc('W4').set(
      wash({ revenue_origin: 'sweater', ssp_booking_id: 'B-200' }),
    );
    await postSource(db, FieldValue, { kind: 'wash', sourceId: 'W4' }, { userId: 'acct1' }).catch(() => {});

    const totalRevenue = await creditOn(ACC.WASH_REVENUE) + await creditOn(ACC.SWEATER_REVENUE);
    expect(totalRevenue).toBe(0);          // لم يُثبت شيء بعد — التسوية لم تُعتمد
    expect((await db.collection(COL.ENTRIES).get()).size).toBe(0);
  }, 60_000);

  it('وغسلةٌ مباشرة وحجزٌ منفصل: إيرادان لخدمتين، وهو الصواب', async () => {
    // الضمانة ليست «إيرادٌ واحد دائماً» بل «إيرادٌ واحد لكل خدمة».
    await db.collection('washes').doc('W5').set(wash({ revenue_origin: 'direct' }));
    await postSource(db, FieldValue, { kind: 'wash', sourceId: 'W5' }, { userId: 'acct1' });
    expect(await creditOn(ACC.WASH_REVENUE)).toBe(20);
    expect(await creditOn(ACC.SWEATER_REVENUE)).toBe(0);
  }, 60_000);
});

// تطبيقٌ مستقل: الكتلة الأولى تحذف تطبيقها في `afterAll`، وإعادةُ استعماله
// هنا تجعل هذه الكتلة تُتخطّى بصمت — وسويتٌ متخطّاة تبدو كسويتٍ ناجحة.
let linkApp, linkDb;

d('ربط الغسلة بالحجز — تفرّدٌ في الاتجاهين', () => {
  beforeAll(() => {
    linkApp = initializeApp({ projectId: PROJECT }, 'sweater-links');
    linkDb = getFirestore(linkApp);
  }, 60_000);

  afterAll(async () => { if (linkApp) await deleteApp(linkApp); });

  beforeEach(async () => {
    const snap = await linkDb.collection(LINKS_COL).get();
    await Promise.all(snap.docs.map((x) => x.ref.delete()));
  }, 30_000);

  it('الربط يُنشئ الطرفين، وإعادته بلا أثر', async () => {
    const a = await linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B1', actor: 'acct1' });
    expect(a.alreadyLinked).toBe(false);
    const b = await linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B1' });
    expect(b.alreadyLinked).toBe(true);
    expect((await linkOfBooking(linkDb, 'B1')).washId).toBe('W1');
  }, 60_000);

  it('وحجزٌ مربوط لا يُربط بغسلةٍ ثانية', async () => {
    await linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B1' });
    await expect(linkWashToBooking(linkDb, FieldValue, { washId: 'W2', sspBookingId: 'B1' }))
      .rejects.toThrow(/مربوطٌ بغسلةٍ أخرى/);
  }, 60_000);

  it('وغسلةٌ مربوطة لا تُربط بحجزٍ ثانٍ — الاتجاه الآخر', async () => {
    await linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B1' });
    await expect(linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B2' }))
      .rejects.toThrow(/مربوطةٌ بحجزٍ آخر/);
  }, 60_000);

  it('ومحاولتان متزامنتان على نفس الحجز: واحدة تفوز', async () => {
    const results = await Promise.allSettled([
      linkWashToBooking(linkDb, FieldValue, { washId: 'WA', sspBookingId: 'BX' }),
      linkWashToBooking(linkDb, FieldValue, { washId: 'WB', sspBookingId: 'BX' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const link = await linkOfBooking(linkDb, 'BX');
    expect(['WA', 'WB']).toContain(link.washId);
  }, 60_000);

  it('وفكّ الربط يزيل الطرفين معاً', async () => {
    await linkWashToBooking(linkDb, FieldValue, { washId: 'W1', sspBookingId: 'B1' });
    await unlinkWashBooking(linkDb, { washId: 'W1', sspBookingId: 'B1' });
    expect(await linkOfBooking(linkDb, 'B1')).toBeNull();
    await expect(linkWashToBooking(linkDb, FieldValue, { washId: 'W9', sspBookingId: 'B1' }))
      .resolves.toMatchObject({ alreadyLinked: false });
  }, 60_000);
});
