import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const PROJECT = 'demo-supervisor-rules';
const rules = readFileSync('firestore.rules', 'utf8');
const collections = [...new Set([...rules.matchAll(/match \/([a-z_]+)\/\{[^}]+\}/g)].map(m => m[1]))];
let env, db;
run('supervisor direct Firestore privacy and mutation prevention', () => {
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Local emulator required');
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port: Number(port), rules } });
    await env.withSecurityRulesDisabled(async ctx => {
      const adb = ctx.firestore();
      await setDoc(doc(adb, 'users', 'supervisor'), { role: 'supervisor' });
      // Conflicting old admin marker must not restore any write access.
      await setDoc(doc(adb, 'app_admins', 'supervisor'), { note: 'legacy' });
      for (const name of collections) await setDoc(doc(adb, name, 'existing'), { name: 'synthetic', amount: 10, ownerUid: 'supervisor' });
      await setDoc(doc(adb, 'users', 'unknown'), { role: 'legacy-unknown' });
      await setDoc(doc(adb, 'app_admins', 'unknown'), { note: 'legacy' });
      await setDoc(doc(adb, 'users', 'missing-role'), {});
      await setDoc(doc(adb, 'bikers', 'private'), { name: 'worker', iqama_number: 'private' });
    });
    db = env.authenticatedContext('supervisor', { role: 'admin', admin: true }).firestore();
  }, 60000);
  afterAll(async () => { if (env) await env.cleanup(); });
  it('can resolve own membership without exposing worker identity or admin directory', async () => {
    await assertSucceeds(getDoc(doc(db, 'users', 'supervisor')));
    await assertFails(getDoc(doc(db, 'bikers', 'private')));
    await assertFails(getDoc(doc(db, 'app_admins', 'supervisor')));
  });
  it.each(collections)('rejects raw read and every direct mutation of actual rules collection %s', async name => {
    await assertFails(getDoc(doc(db, name, 'existing')));
    await assertFails(setDoc(doc(db, name, 'new'), { name: 'attack' }));
    await assertFails(updateDoc(doc(db, name, 'existing'), { amount: 999 }));
    await assertFails(deleteDoc(doc(db, name, 'existing')));
  });
  it('cannot elevate own role or create another account', async () => {
    await assertFails(updateDoc(doc(db, 'users', 'supervisor'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'users', 'other'), { role: 'admin' }));
  });
  it('public knowledge of a key id cannot grant key read/write', async () => {
    await assertFails(getDoc(doc(db, 'partner_mcp_keys', 'key')));
    await assertFails(setDoc(doc(db, 'partner_mcp_keys', 'key'), { ownerUid: 'supervisor' }));
  });
  it.each(['unknown', 'missing-role'])('denies direct writes for legacy unresolved role %s', async uid => {
    const unresolved = env.authenticatedContext(uid, { role: 'admin', admin: true }).firestore();
    await assertFails(setDoc(doc(unresolved, 'washes', 'attack'), { quantity: 1 }));
    await assertFails(setDoc(doc(unresolved, 'users', 'elevated'), { role: 'admin' }));
  });
  it('denies raw REST reads/create/update/delete even with conflicting admin claims', async () => {
    const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/bikers`;
    const token = createMockUserToken({ sub: 'supervisor', role: 'admin', admin: true }, PROJECT);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const body = JSON.stringify({ fields: { name: { stringValue: 'synthetic attack' } } });
    for (const [method, path, payload] of [['GET', '/existing'], ['POST', '?documentId=rest-new', body], ['PATCH', '/existing', body], ['DELETE', '/existing']]) {
      const response = await fetch(url + path, { method, headers, ...(payload ? { body: payload } : {}) });
      expect(response.status).toBe(403);
    }
  });
});
