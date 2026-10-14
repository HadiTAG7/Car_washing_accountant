import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let environment;
suite('Quality reports remain default-denied to every direct client under unchanged production rules', () => {
  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    environment = await initializeTestEnvironment({ projectId: 'demo-quality-rules',
      firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') } });
    await environment.withSecurityRulesDisabled(async context => {
      for (const role of ['admin', 'partner', 'accountant', 'operator', 'supervisor']) {
        await setDoc(doc(context.firestore(), 'users', role), { role });
      }
      await setDoc(doc(context.firestore(), 'biker_quality_reports', 'test-report'), { bikerUID: 'dummy', finalScore: null });
    });
  });
  afterAll(async () => { if (environment) await environment.cleanup(); });
  it.each(['admin', 'partner', 'accountant', 'operator', 'supervisor', null])('denies direct report get/list/write for %s', async role => {
    const db = role ? environment.authenticatedContext(role).firestore() : environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'biker_quality_reports', 'test-report')));
    await assertFails(getDocs(collection(db, 'biker_quality_reports')));
    await assertFails(setDoc(doc(db, 'biker_quality_reports', 'attack'), { finalScore: 100 }));
  });
});
