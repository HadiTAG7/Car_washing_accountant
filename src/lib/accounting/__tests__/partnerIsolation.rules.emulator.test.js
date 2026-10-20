/**
 * عزل الشريك — كل مجموعةٍ تسمّيها القواعد، لا قائمةٌ يكتبها الاختبار.
 *
 * حساب الشريك لا يقرأ من Firestore مباشرةً إلا مستنده في `users` ومفاتيح
 * مساعده. كل رقمٍ آخر يصله من الخادم مقسوماً بحصّته. فالقائمة هنا تُبنى من
 * نصّ `firestore.rules` نفسه: مجموعةٌ تُضاف للقواعد غداً تدخل الاختبار تلقائياً،
 * ولا تحتاج من يتذكّر أن يضيفها هنا.
 *
 * Run: npm run test:rules
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const d = EMU ? describe : describe.skip;
const RULES = readFileSync('firestore.rules', 'utf8');

/** Every collection the rules name: explicit matches plus the wildcard lists. */
function ruleCollections(text) {
  const names = new Set([...text.matchAll(/match \/([A-Za-z_]+)\/\{/g)].map(m => m[1]));
  for (const list of text.matchAll(/return c in \[([^\]]*)\]/g)) {
    for (const m of list[1].matchAll(/'([A-Za-z_]+)'/g)) names.add(m[1]);
  }
  names.delete('databases');
  return [...names].sort();
}
const COLLECTIONS = ruleCollections(RULES);
// What a partner's browser may still read directly — its own documents only.
const OWN = { users: 'partner1', partner_mcp_keys: 'pmk_own' };

let env;
const ctx = {};

d('عزل الشريك في قواعد Firestore', () => {
  beforeAll(async () => {
    const [host, port] = EMU.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-sweater-partner-isolation',
      firestore: { host, port: Number(port), rules: RULES },
    });
  }, 60_000);

  afterAll(async () => { if (env) await env.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'users', 'admin1'), { email: 'a@x.com', role: 'admin' });
      await setDoc(doc(db, 'app_admins', 'admin1'), { note: 'admin' });
      await setDoc(doc(db, 'users', 'acct1'), { email: 'c@x.com', role: 'accountant' });
      await setDoc(doc(db, 'users', 'op1'), { email: 'o@x.com', role: 'operator' });
      await setDoc(doc(db, 'users', 'partner1'), { email: 'p@x.com', role: 'partner' });
      await setDoc(doc(db, 'users', 'boss-partner'), { email: 'bp@x.com', role: 'partner' });
      await setDoc(doc(db, 'app_admins', 'boss-partner'), { note: 'admin' });
      for (const name of COLLECTIONS) {
        if (name === 'users') continue;
        await setDoc(doc(db, name, 'x1'), { note: 'seed', partner_id: 'p1', ownerUid: 'someone-else' });
      }
      await setDoc(doc(db, 'partners', 'p1'), { partner_name: 'أحمد', workers_count: 3, user_id: 'partner1' });
      await setDoc(doc(db, 'partner_mcp_keys', 'pmk_own'), { partnerId: 'p1', ownerUid: 'partner1', status: 'active' });
    });
    ctx.admin = env.authenticatedContext('admin1').firestore();
    ctx.acct = env.authenticatedContext('acct1').firestore();
    ctx.op = env.authenticatedContext('op1').firestore();
    ctx.partner = env.authenticatedContext('partner1').firestore();
    ctx.bossPartner = env.authenticatedContext('boss-partner').firestore();
  }, 60_000);

  it('the list is built from the rules and covers the sensitive collections', () => {
    for (const name of ['partners', 'bikers', 'washes', 'partner_payments', 'journal_entries',
      'sweater_integration_keys', 'auth_users_backup', 'housing_units', 'startup_costs']) {
      expect(COLLECTIONS).toContain(name);
    }
  });

  it('a partner reads no business document directly — not even its own partner row', async () => {
    const leaks = [];
    for (const name of COLLECTIONS) {
      if (OWN[name]) continue;
      const one = await getDoc(doc(ctx.partner, name, name === 'partners' ? 'p1' : 'x1')).then(() => true, () => false);
      const all = await getDocs(collection(ctx.partner, name)).then(() => true, () => false);
      if (one || all) leaks.push(name);
    }
    expect(leaks).toEqual([]);
  });

  it('a partner still reads its own user document and its own assistant key', async () => {
    await assertSucceeds(getDoc(doc(ctx.partner, 'users', 'partner1')));
    await assertFails(getDoc(doc(ctx.partner, 'users', 'admin1')));
    await assertSucceeds(getDoc(doc(ctx.partner, 'partner_mcp_keys', 'pmk_own')));
    await assertSucceeds(getDocs(query(collection(ctx.partner, 'partner_mcp_keys'), where('ownerUid', '==', 'partner1'))));
    await assertFails(getDoc(doc(ctx.partner, 'partner_mcp_keys', 'x1')));
  });

  it('staff read the business collections; a partner account also marked admin is staff', async () => {
    for (const db of [ctx.admin, ctx.acct, ctx.op, ctx.bossPartner]) {
      for (const name of ['partners', 'bikers', 'washes', 'partner_payments', 'journal_entries', 'chart_of_accounts']) {
        await assertSucceeds(getDoc(doc(db, name, name === 'partners' ? 'p1' : 'x1')));
      }
    }
  });

  it('partners: the admin writes; an operator or accountant cannot add, re-weight, relink or delete', async () => {
    for (const db of [ctx.op, ctx.acct, ctx.partner]) {
      await assertFails(setDoc(doc(db, 'partners', 'p9'), { partner_name: 'جديد', workers_count: 1 }));
      await assertFails(updateDoc(doc(db, 'partners', 'p1'), { workers_count: 30 }));
      await assertFails(updateDoc(doc(db, 'partners', 'p1'), { user_id: 'someone-else' }));
      await assertFails(updateDoc(doc(db, 'partners', 'p1'), { paid_amount: 1 }));
      await assertFails(deleteDoc(doc(db, 'partners', 'p1')));
    }
    await assertSucceeds(setDoc(doc(ctx.admin, 'partners', 'p9'), { partner_name: 'جديد', workers_count: 1 }));
    await assertSucceeds(updateDoc(doc(ctx.admin, 'partners', 'p1'), { workers_count: 4 }));
    await assertSucceeds(deleteDoc(doc(ctx.admin, 'partners', 'p9')));
  });

  it('an operator still records and removes a receipt — without touching partners', async () => {
    await assertSucceeds(setDoc(doc(ctx.op, 'partner_payments', 'r1'), { partner_id: 'p1', amount: 500, payment_date: '2026-10-01' }));
    await assertSucceeds(deleteDoc(doc(ctx.op, 'partner_payments', 'r1')));
    await assertFails(setDoc(doc(ctx.partner, 'partner_payments', 'r2'), { partner_id: 'p1', amount: 1 }));
  });

  it('server-only secrets: no client role reads the integration keys or the auth backup', async () => {
    for (const db of [ctx.admin, ctx.acct, ctx.op, ctx.partner]) {
      for (const name of ['sweater_integration_keys', 'auth_users_backup']) {
        await assertFails(getDoc(doc(db, name, 'x1')));
        await assertFails(setDoc(doc(db, name, 'x2'), { note: 'forged' }));
      }
    }
  });
});
