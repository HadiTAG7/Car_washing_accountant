import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let env;
let ctx;

// عدّاد إعادة التعيين يحمي صناديق البريد من نموذج الاسترجاع المفتوح. عميلٌ
// يمحوه يلغي الحدّ، وعميلٌ يقرأه يعرف متى طُلب استرجاعٌ لبريدٍ ما. المجموعة
// خادمية بالكامل — والمفتاح الخدمي وحده يتجاوز هذه القواعد.
emulatorDescribe('Password-reset throttle Firestore rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-sweater-password-reset-rules',
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
      await setDoc(doc(db, 'password_reset_throttle', 'email_abc'), { count: 3 });
    });
    ctx = {
      admin: env.authenticatedContext('admin1').firestore(),
      accountant: env.authenticatedContext('acct1').firestore(),
      operator: env.authenticatedContext('op1').firestore(),
      anonymous: env.unauthenticatedContext().firestore(),
    };
  });

  it('hides the counters from every client, administrators included', async () => {
    for (const db of Object.values(ctx)) {
      await assertFails(getDoc(doc(db, 'password_reset_throttle', 'email_abc')));
      await assertFails(getDocs(collection(db, 'password_reset_throttle')));
    }
  });

  it('refuses every client write, so the limit cannot be reset from a browser', async () => {
    for (const db of Object.values(ctx)) {
      await assertFails(setDoc(doc(db, 'password_reset_throttle', 'email_abc'), { count: 0 }));
      await assertFails(setDoc(doc(db, 'password_reset_throttle', 'email_new'), { count: 0 }));
      await assertFails(deleteDoc(doc(db, 'password_reset_throttle', 'email_abc')));
    }
  });
});
