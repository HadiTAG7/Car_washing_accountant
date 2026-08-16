/**
 * الطبقة المشتركة — ما ينكسر حين يصير للخادم بابان
 * ═══════════════════════════════════════════════════════════════════════════
 * السلوك مغطّى فعلاً: ٤٤ اختبار استدعاء عبر محاكيات الدوال والمصادقة الحقيقيين
 * تفحص كل حارس وكل دور وكل رفض من طرفٍ إلى طرف. تكرارها هنا لا يثبت جديداً.
 *
 * الجديد هو ما يفتحه **وجود بابين**، وكلها فجوات تصمت بدل أن تصرخ:
 *
 *   • معالج بحارس غير موجود — يرمي `GUARDS[undefined] is not a function`،
 *     وهو انهيار داخلي لا رفض صلاحيات. مسار يبدو مغلقاً وهو مكسور.
 *   • معالج لا يُصدَّر من `index.js` — لا وجود له في Cloud Functions إطلاقاً،
 *     ولا شيء يقوله. يعمل عبر HTTP ويختفي عبر الاستدعاءات.
 *   • رمز خطأ جديد لا تعرفه خريطة HTTP — يصير 500، فيقرأ العميل «خطأ داخلي»
 *     لرفضٍ مفهوم كان يجب أن يُعرَض للمستخدم.
 *
 * Run: npm run test:functions
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  HANDLERS, HANDLER_NAMES, GUARDS, AuthError, DispatchError,
  normalizeError, dispatch,
} from '../src/handlers.js';
import { LedgerError } from '../src/ledger.js';
import { InvoicingError } from '../src/invoicing.js';
import { TaxPolicyError } from '../src/taxPolicy.js';
import { PurchaseTaxError } from '../src/purchaseTax.js';
import { StartupCostError } from '../src/startupCosts.js';
import { BootstrapError } from '../src/bootstrapAdmin.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, '..', ...p), 'utf8');

describe('سلامة سجل المعالجات', () => {
  it('كل معالج له حارس موجود فعلاً وجسم قابل للنداء', () => {
    expect(HANDLER_NAMES.length).toBeGreaterThan(20);
    for (const name of HANDLER_NAMES) {
      const h = HANDLERS[name];
      expect(typeof h.guard, name).toBe('string');
      // بلا هذا الفحص يكون الخطأ انهياراً داخلياً وقت النداء، لا رفضاً.
      expect(typeof GUARDS[h.guard], `${name} → حارس مجهول: ${h.guard}`).toBe('function');
      expect(typeof h.run, name).toBe('function');
    }
  });

  it('وكل معالج مُصدَّر من index.js — وإلا فهو غير موجود في Cloud Functions', () => {
    const index = read('index.js');
    for (const name of HANDLER_NAMES) {
      expect(index.includes(`export const ${name} = callable('${name}')`), `${name} غير مُصدَّر`).toBe(true);
    }
  });

  it('ولا يُصدَّر من index.js اسمٌ بلا معالج', () => {
    const exported = [...read('index.js').matchAll(/export const (\w+) = callable\('(\w+)'\)/g)];
    for (const [, exportName, handlerName] of exported) {
      expect(exportName, 'الاسم المُصدَّر يطابق اسم المعالج').toBe(handlerName);
      expect(HANDLER_NAMES, `${handlerName} مُصدَّر بلا معالج`).toContain(handlerName);
    }
    expect(exported.length).toBe(HANDLER_NAMES.length);
  });

  it('والطبقة المشتركة لا تعرف وسيلة نقل', () => {
    // اللحظة التي تستورد فيها `firebase-functions` هي اللحظة التي تتوقف فيها
    // عن العمل خلف الباب الثاني.
    //
    // الفحص على **الاستيراد والاستعمال**، لا على ورود الكلمة: أول صياغة كانت
    // تبحث عن النص فأصابت تعليقاً يشرح القاعدة نفسها. اختبارٌ يسقط على شرحه
    // اختبارٌ يقيس الشيء الخطأ.
    const code = read('src', 'handlers.js');
    expect(/from\s+'firebase-functions/.test(code), 'يستورد firebase-functions').toBe(false);
    expect(/new\s+HttpsError/.test(code), 'ينشئ HttpsError').toBe(false);
  });
});

describe('توحيد الأخطاء', () => {
  const cases = [
    ['AuthError', new AuthError('م', { code: 'permission-denied' }), 'permission-denied'],
    ['AuthError افتراضي', new AuthError('م'), 'permission-denied'],
    ['LedgerError', new LedgerError('م', { code: 'failed-precondition' }), 'failed-precondition'],
    ['InvoicingError', new InvoicingError('م', { code: 'already-exists' }), 'already-exists'],
    ['TaxPolicyError', new TaxPolicyError('م'), 'invalid-argument'],
    ['StartupCostError', new StartupCostError('م'), 'failed-precondition'],
    ['BootstrapError', new BootstrapError('م'), 'failed-precondition'],
  ];

  for (const [label, err, code] of cases) {
    it(`${label} → ${code}`, () => {
      const out = normalizeError(err);
      expect(out.code).toBe(code);
      expect(out.message).toBe('م');
    });
  }

  it('ورسالة المحاسبة تصل كاملةً مع قائمة المشاكل', () => {
    // رفض الترحيل يسمّي ما هو مكسور بالضبط. طيّه في «حاول مرة أخرى» يجعل
    // المستخدم يعيد المحاولة على شيء لن تصلحه إعادة المحاولة أبداً.
    const e = new LedgerError('القيد غير متوازن.', { code: 'failed-precondition' });
    e.problems = ['مدين 100 ≠ دائن 90'];
    const out = normalizeError(e);
    expect(out.message).toBe('القيد غير متوازن.');
    expect(out.details.problems).toEqual(['مدين 100 ≠ دائن 90']);
  });

  it('ورفض ضريبة المدخلات يحمل سببه', () => {
    const e = new PurchaseTaxError('لا يمكن تحديد الضريبة.');
    e.reason = 'no_rate';
    expect(normalizeError(e).details).toEqual({ reason: 'no_rate' });
  });

  it('وأي خطأ آخر لا يسرّب شيئاً داخلياً', () => {
    const out = normalizeError(new Error('SELECT * FROM secrets WHERE token=abc123'));
    expect(out.code).toBe('internal');
    expect(out.message).not.toContain('secrets');
    expect(out.message).not.toContain('abc123');
  });
});

describe('التوجيه', () => {
  it('اسم غير معروف يُرفض بـ not-found لا بانهيار', () => {
    // عميل بُني على خادم أحدث يستحق أن يُقال له إن العملية غير موجودة هنا.
    return expect(dispatch({}, {}, 'ledgerDeleteEverything', {}, { uid: 'u1' }))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('وبلا هوية لا يُنفَّذ شيء — قبل أي قراءة', async () => {
    // `db` هنا كائن فارغ عمداً: لو حاول الحارس قراءة Firestore قبل فحص
    // الهوية لانهار بدل أن يرفض، وهذا ما يثبته الاختبار.
    await expect(dispatch({}, {}, 'ledgerClosePeriod', { periodKey: '2026-08' }, null))
      .rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(dispatch({}, {}, 'authBootstrapStatus', {}, {}))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('والرفض من نوع يقرأه المنفذ', async () => {
    const e = await dispatch({}, {}, 'nope', {}, { uid: 'u1' }).catch((x) => x);
    expect(e).toBeInstanceOf(DispatchError);
    expect(e.code).toBe('not-found');
  });
});

describe('خريطة HTTP تغطي كل ما تنتجه الطبقة المشتركة', () => {
  // فجوة صامتة: رمز جديد لا تعرفه الخريطة يصير 500، فيقرأ المستخدم «خطأ
  // داخلي» لرفضٍ كان يجب أن يراه ويتصرّف بناءً عليه.
  const CODES = [
    'unauthenticated', 'permission-denied', 'not-found', 'already-exists',
    'invalid-argument', 'failed-precondition', 'internal',
  ];

  it('كل رمز في المفردات له حالة HTTP صريحة', () => {
    const api = readFileSync(join(here, '..', '..', 'api', 'ledger.js'), 'utf8');
    const mapped = [...api.matchAll(/'([a-z-]+)':\s*(\d{3})/g)].map((m) => m[1]);
    for (const code of CODES) {
      expect(mapped, `الرمز ${code} بلا حالة HTTP — سيصير 500`).toContain(code);
    }
  });

  it('وواجهة HTTP لا تلمس Firestore مباشرةً', () => {
    // Admin SDK يتجاوز القواعد كلياً. فكل ما يمسّ البيانات يمرّ بـ dispatch،
    // وإلا فقد صارت هذه الواجهة بابَ تجاوزٍ بدل أن تكون منفذاً.
    const api = readFileSync(join(here, '..', '..', 'api', 'ledger.js'), 'utf8');
    for (const forbidden of ['.collection(', '.doc(', 'runTransaction', 'FieldValue.']) {
      expect(api.includes(forbidden), `تستعمل ${forbidden}`).toBe(false);
    }
    expect(api).toContain('dispatch(');
  });
});
