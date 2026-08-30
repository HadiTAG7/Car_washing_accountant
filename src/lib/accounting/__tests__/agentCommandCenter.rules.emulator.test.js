import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let env;
let ctx;

emulatorDescribe('Agent command-center Firestore rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-sweater-agent-command-rules',
      firestore: { rules: await readFile('firestore.rules', 'utf8') },
    });
  });

  afterAll(async () => { await env?.cleanup(); });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore();
      await setDoc(doc(db, 'users', 'admin1'), { role: 'admin' });
      await setDoc(doc(db, 'users', 'acct1'), { role: 'accountant' });
      await setDoc(doc(db, 'users', 'op1'), { role: 'operator' });
      await setDoc(doc(db, 'users', 'partner1'), { role: 'partner' });
      await setDoc(doc(db, 'agent_command_agents', 'cfo'), { status: 'healthy' });
      await setDoc(doc(db, 'agent_command_agents', 'operations-manager'), { status: 'healthy' });
      await setDoc(doc(db, 'agent_command_reports', 'r1'), { agentId: 'cfo', title: 'تقرير' });
      await setDoc(doc(db, 'agent_command_ingestion', 'private-hash'), { eventId: 'event1' });
    });
    ctx = {
      admin: env.authenticatedContext('admin1').firestore(),
      accountant: env.authenticatedContext('acct1').firestore(),
      operator: env.authenticatedContext('op1').firestore(),
      partner: env.authenticatedContext('partner1').firestore(),
      anonymous: env.unauthenticatedContext().firestore(),
    };
  });

  it('limits command-center reads to accountant and admin roles', async () => {
    await assertSucceeds(getDocs(collection(ctx.admin, 'agent_command_agents')));
    await assertSucceeds(getDocs(collection(ctx.accountant, 'agent_command_reports')));
    await assertSucceeds(getDoc(doc(ctx.accountant, 'agent_command_agents', 'operations-manager')));
    await assertFails(getDocs(collection(ctx.operator, 'agent_command_agents')));
    await assertFails(getDocs(collection(ctx.partner, 'agent_command_reports')));
    await assertFails(getDocs(collection(ctx.anonymous, 'agent_command_agents')));
  });

  it('rejects every direct client write, including admin writes', async () => {
    for (const db of [ctx.admin, ctx.accountant, ctx.operator]) {
      await assertFails(setDoc(doc(db, 'agent_command_agents', 'cfo'), { status: 'critical' }));
      await assertFails(setDoc(doc(db, 'agent_command_agents', 'operations-manager'), { status: 'critical' }));
      await assertFails(setDoc(doc(db, 'agent_command_agents', 'free-form-agent'), { status: 'healthy' }));
      await assertFails(setDoc(doc(db, 'agent_command_approvals', 'forged'), { status: 'approved' }));
      await assertFails(setDoc(doc(db, 'agent_command_activity', 'forged'), { message: 'مزور' }));
    }
  });

  it('keeps idempotency markers private even from administrators', async () => {
    await assertFails(getDoc(doc(ctx.admin, 'agent_command_ingestion', 'private-hash')));
    await assertFails(getDoc(doc(ctx.accountant, 'agent_command_ingestion', 'private-hash')));
    expect(true).toBe(true);
  });
});
