// Auxiliary transfer-kit test, not a product change. Requires preinstalled
// Firestore+Storage runtimes; fixture documents and files are synthetic only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
const run = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST ? describe : describe.skip;
let env, supervisor;
run('supervisor Storage boundary', () => {
  beforeAll(async () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST).toBe('127.0.0.1:9199');
    env = await initializeTestEnvironment({ projectId: 'demo-supervisor-storage',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
      storage: { host: '127.0.0.1', port: 9199, rules: readFileSync('storage.rules', 'utf8') } });
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', 'supervisor'), { role: 'supervisor' });
      await setDoc(doc(ctx.firestore(), 'app_admins', 'supervisor'), { note: 'synthetic old marker' });
      await setDoc(doc(ctx.firestore(), 'users', 'unknown'), { role: 'unknown' });
      await setDoc(doc(ctx.firestore(), 'app_admins', 'unknown'), { note: 'synthetic old marker' });
      await setDoc(doc(ctx.firestore(), 'users', 'admin'), { role: 'admin' });
      await setDoc(doc(ctx.firestore(), 'app_admins', 'admin'), { note: 'synthetic admin' });
      await ctx.storage().ref('invoices/existing.txt').putString('synthetic invoice');
    });
    supervisor = env.authenticatedContext('supervisor', { role: 'admin', admin: true }).storage();
  }, 60000);
  afterAll(async () => { if (env) await env.cleanup(); });
  it('denies supervisor uploads despite the old admin marker and admin claims', async () => {
    await assertFails(supervisor.ref('invoices/new.txt').putString('synthetic attack'));
  });
  it('denies supervisor metadata changes', async () => {
    await assertFails(supervisor.ref('invoices/existing.txt').updateMetadata({ contentType: 'application/json' }));
  });
  it('denies supervisor deletes', async () => {
    await assertFails(supervisor.ref('invoices/existing.txt').delete());
  });
  it('denies unknown roles with an admin marker', async () => {
    await assertFails(env.authenticatedContext('unknown', { admin: true }).storage().ref('invoices/unknown.txt').putString('synthetic attack'));
  });
  it('keeps existing admin upload authorization', async () => {
    await assertSucceeds(env.authenticatedContext('admin').storage().ref('invoices/admin.txt').putString('synthetic invoice'));
  });
  it('documents existing public reads instead of claiming attachment confidentiality', async () => {
    await assertSucceeds(supervisor.ref('invoices/existing.txt').getMetadata());
  });
});
