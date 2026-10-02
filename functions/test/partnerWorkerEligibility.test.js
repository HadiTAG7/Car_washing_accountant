import { describe, it, expect } from 'vitest';
import { operatingParticipation, eligibilityFor, setPartnerEligibility, ELIGIBILITY_COL } from '../src/partnerWorkerEligibility.js';
import { dispatch } from '../src/handlers.js';

const partners = ['hadi', 'ali', 'mohammed'].map(id => ({ id, workers_count: 10 }));
const settings = [{ id: 'hadi', changes: { '2026-10': { eligibleWorkers: 5, reason: 'PRIVATE travel', updatedBy: 'SECRET admin' }, '2026-12': { eligibleWorkers: 10 } } }];

describe('أهلية البايكرز الخاصة وحصة التشغيل', () => {
  it('قبل التعطيل الجميع ثلث ثم هادي خمس والباقون خمسان مع بقاء رأس المال الأصلي', () => {
    expect(operatingParticipation(partners, settings, 'hadi', '2026-09').factor).toBeCloseTo(1 / 3);
    const allocation = partners.map(p => operatingParticipation(partners, settings, p.id, '2026-10'));
    expect(allocation.map(p => p.factor)).toEqual([0.2, 0.4, 0.4]);
    expect(allocation.reduce((s, p) => s + p.factor, 0)).toBe(1);
    expect(allocation[0]).toMatchObject({ originalWorkers: 10, eligibleWorkers: 5, suspendedWorkers: 5 });
    expect(allocation[1]).toMatchObject({ originalWorkers: 10, eligibleWorkers: 10, suspendedWorkers: 0 });
    expect(JSON.stringify(allocation)).not.toMatch(/PRIVATE|SECRET|totalEligible|ali|mohammed|updatedBy/);
    expect(partners.map(p => p.workers_count)).toEqual([10, 10, 10]);
  });
  it('يستمر التعطيل ثم ترجع الحصة الأصلية من شهر الاستعادة فقط', () => {
    expect(operatingParticipation(partners, settings, 'hadi', '2026-11').factor).toBe(0.2);
    expect(operatingParticipation(partners, settings, 'hadi', '2026-12').factor).toBeCloseTo(1 / 3);
  });
  it('التعطيل الكامل صفر والباقون يتقاسمون كامل التشغيل دون تغيير تعدادهم', () => {
    const stopped = [{ id: 'hadi', changes: { '2026-10': { eligibleWorkers: 0 } } }];
    expect(operatingParticipation(partners, stopped, 'hadi', '2026-10').factor).toBe(0);
    expect(operatingParticipation(partners, stopped, 'ali', '2026-10').factor).toBe(0.5);
  });
  it('يرفض غياب أي بايكر مؤهل بدل إظهار توزيع صفري مضلل', () => {
    expect(() => operatingParticipation(partners, partners.map(p => ({ id: p.id, changes: { '2026-10': { eligibleWorkers: 0 } } })), 'hadi', '2026-10')).toThrow(/مؤهل/);
  });
  it.each([-1, 11, 0.5, '5', null])('يرفض العدد المخزن غير الصحيح %s ولا يصنع أرقاماً', eligibleWorkers => {
    expect(() => eligibilityFor(partners[0], { changes: { '2026-10': { eligibleWorkers } } }, '2026-10')).toThrow();
  });
  it('لا يكشف التغيير المستقبلي للشريك في تقرير الشهر الحالي', () => {
    const own = eligibilityFor(partners[0], settings[0], '2026-09');
    expect(own).toEqual({ originalWorkers: 10, eligibleWorkers: 10, suspendedWorkers: 0, effectiveFrom: null });
  });
});

// The server's transaction contract: all reads precede writes, stored state
// and original ownership are separate, and audit + revision are atomic.
function database({ changes = {}, revision = 0, closed = [], allStopped = false } = {}) {
  const rows = {
    users: [{ id: 'admin', role: 'admin' }, ...['partner', 'operator', 'accountant'].map(id => ({ id, role: id }))],
    partners,
    [ELIGIBILITY_COL]: [{ id: 'hadi', changes, revision }, ...(allStopped ? ['ali', 'mohammed'].map(id => ({ id, changes: { '2026-10': { eligibleWorkers: 0 } } })) : [])],
    accounting_periods: closed.map(id => ({ id, status: 'closed' })),
  };
  const writes = [];
  const snapshot = row => ({ id: row?.id, exists: Boolean(row), data: () => row, get: key => row?.[key] });
  let sequence = 0;
  const db = {
    writes,
    collection(name) {
      return { name, get: async () => ({ docs: (rows[name] || []).map(snapshot) }),
        doc: (id = `audit-${++sequence}`) => ({ name, id, get: async () => snapshot(rows[name]?.find(r => r.id === id)), collection: sub => db.collection(`${name}/${id}/${sub}`) }) };
    },
    runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, data) => writes.push({ path: `${ref.name}/${ref.id}`, data }) }),
  };
  return db;
}
const input = { partnerId: 'hadi', periodKey: '2026-10', eligibleWorkers: 5, reason: 'سفر خمسة عمال', expectedRevision: 0 };
const actor = { userId: 'admin', today: new Date('2026-10-02T21:05:00Z') };
const fieldValue = { serverTimestamp: () => 'SERVER timestamp' };

describe('حفظ أهلية الشريك للأدمن فقط', () => {
  it('حفظ منفصل مؤرخ ومدقق دون تغيير سجل الشريك أو القيود', async () => {
    const db = database();
    await setPartnerEligibility(db, fieldValue, input, actor);
    expect(db.writes).toHaveLength(2);
    expect(db.writes[0]).toMatchObject({ path: `${ELIGIBILITY_COL}/hadi`, data: { revision: 1, changes: { '2026-10': { eligibleWorkers: 5, reason: input.reason, updatedBy: 'admin' } } } });
    expect(db.writes[1].path).toContain(`${ELIGIBILITY_COL}/hadi/audit/`);
    expect(db.writes[1].data).toMatchObject({ before: 10, after: 5, periodKey: '2026-10', actorUid: 'admin' });
    expect(db.writes.some(w => /partners\/|journal_|partner_payments/.test(w.path))).toBe(false);
  });
  it.each([
    { eligibleWorkers: 11 }, { eligibleWorkers: -1 }, { eligibleWorkers: 1.5 }, { eligibleWorkers: '5' },
    { reason: '' }, { periodKey: '2026-13' }, { periodKey: '2026-09' }, { expectedRevision: -1 }, { partnerId: '../hadi' },
  ])('يرفض الحمولة غير الصحيحة بلا كتابة %j', async patch => {
    const db = database();
    await expect(setPartnerEligibility(db, fieldValue, { ...input, ...patch }, actor)).rejects.toBeTruthy();
    expect(db.writes).toEqual([]);
  });
  it('يرفض تغيير شهر مقفل ولو كان الإقفال في شهر لاحق سيؤثر فيه التغيير', async () => {
    for (const periodKey of ['2026-10', '2026-11']) {
      const db = database({ closed: [periodKey] });
      await expect(setPartnerEligibility(db, fieldValue, input, actor)).rejects.toThrow(/مقفل/);
      expect(db.writes).toEqual([]);
    }
  });
  it('نسخة قديمة لا تكتب فوق قرار أدمن آخر', async () => {
    const db = database({ revision: 1 });
    await expect(setPartnerEligibility(db, fieldValue, input, actor)).rejects.toThrow(/تغيّر/);
    expect(db.writes).toEqual([]);
  });
  it('يرفض تعطيل الجميع حتى لو حدث في تغيير مستقبلي محفوظ', async () => {
    const db = database({ allStopped: true });
    await expect(setPartnerEligibility(db, fieldValue, { ...input, eligibleWorkers: 0 }, actor)).rejects.toThrow(/مؤهل/);
    expect(db.writes).toEqual([]);
  });
  it.each(['partner', 'operator', 'accountant'])('لا يسمح للدور %s بإدارة أو قراءة الإعدادات ولو زور دور الأدمن', async uid => {
    const db = database();
    for (const name of ['partnerEligibilityGet', 'partnerEligibilitySet']) {
      await expect(dispatch(db, fieldValue, name, { ...input, role: 'admin' }, { uid, token: { role: 'admin' } })).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(db.writes).toEqual([]);
  });
  it('غير المسجل يرفض قبل أي وصول للبيانات', async () => {
    await expect(dispatch(null, null, 'partnerEligibilityGet', {}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
