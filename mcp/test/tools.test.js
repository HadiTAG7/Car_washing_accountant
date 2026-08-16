/**
 * خادم MCP — ما يجب أن يبقى صحيحاً مهما تغيّر
 * ═══════════════════════════════════════════════════════════════════════════
 * The valuable tests here are ARCHITECTURAL, not behavioural. Behaviour is
 * already covered: the callables have 44 tests through the real Functions and
 * Auth emulators, the rules have 56, the ledger has 408. Re-testing them
 * through a second door would prove nothing new.
 *
 * What is NEW — and what nothing else in this repo can catch — is the way this
 * server could quietly stop being a client. Someone adds `setDoc` here to make
 * one thing faster, and the ledger silently loses balance-checking, period
 * derivation, atomic numbering, the posting lock and the audit record, all at
 * once and with no test turning red. So that is asserted directly, against the
 * source, where a future edit has to trip over it.
 *
 * Run: npm test --prefix mcp
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', 'src', f), 'utf8');

async function load(env = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return {
    tools: await import('../src/tools.js'),
    client: await import('../src/client.js'),
  };
}

beforeEach(() => { vi.unstubAllEnvs(); });

describe('سلامة سجل الأدوات', () => {
  it('لكل أداة اسم فريد وعنوان ووصف ومخطَّط', async () => {
    const { tools } = await load();
    const names = new Set();
    for (const t of tools.allTools) {
      expect(t.name, 'اسم').toMatch(/^sweater_[a-z_]+$/);
      expect(names.has(t.name), `اسم مكرر: ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.title?.length, `عنوان ${t.name}`).toBeGreaterThan(0);
      // A one-line description is how the model decides whether a tool applies.
      // Too short and it guesses; guessing is how the wrong books get written.
      expect(t.description?.length, `وصف ${t.name}`).toBeGreaterThan(40);
      expect(typeof t.schema).toBe('object');
      expect(typeof t.run).toBe('function');
    }
    expect(tools.allTools.length).toBe(tools.readTools.length + tools.writeTools.length);
  });

  it('والقراءة والكتابة مفصولتان فعلاً لا بالاسم فقط', async () => {
    const { tools } = await load();
    const readNames = tools.readTools.map((t) => t.name);
    const writeNames = tools.writeTools.map((t) => t.name);
    expect(readNames.some((n) => writeNames.includes(n))).toBe(false);
    expect(writeNames.length).toBeGreaterThan(0);
  });
});

describe('الحدّ المعماري: هذا الخادم عميل، لا باب خلفي', () => {
  // The whole design in one assertion. Ledger integrity in this codebase is
  // not enforced by rules alone — rules have no fold, so «debits equal
  // credits» is INEXPRESSIBLE in them. It lives in the callable transaction.
  // A direct Firestore write from here would bypass it completely.
  it('لا يكتب في أي مجموعة دفترية — ولا يملك الأدوات التي تسمح بذلك', async () => {
    // أول صياغة لهذا الاختبار منعت `addDoc` مطلقاً. وكان ذلك **بديلاً عن
    // القاعدة لا القاعدة**: المجموعات التشغيلية — الغسلات والمصروفات — تسمح
    // بها `firestore.rules` لدور operator، فالكتابة فيها لا تتجاوز شيئاً بل
    // تفعل ما يفعله التطبيق. ولمّا لزم تسجيل مصروف من فاتورة، كان المنع
    // سيوقف عملاً مشروعاً ويترك القاعدة الحقيقية بلا حارس.
    //
    // فالقاعدة، مكتوبةً كما هي: **لا كتابة في مجموعة دفترية، بأي وسيلة.**
    const { DIRECT_WRITE_COLLECTIONS } = await import('../src/tools.js');
    const { OPERATIONAL } = await import('../src/fetch.js');

    for (const [kind, coll] of Object.entries(DIRECT_WRITE_COLLECTIONS)) {
      expect(OPERATIONAL, `${kind} → ${coll} ليست مجموعة تشغيلية`).toContain(coll);
    }

    const LEDGER = ['journal_entries', 'journal_lines', 'posting_locks', 'counters',
      'accounting_periods', 'audit_logs', 'chart_of_accounts', 'sales_documents',
      'startup_costs', 'startup_cost_entries', 'app_admins', 'users'];
    for (const c of LEDGER) {
      expect(Object.values(DIRECT_WRITE_COLLECTIONS), `${c} في قائمة الكتابة المباشرة`).not.toContain(c);
    }

    // والوسائل التي تسمح بتعديل مستند قائم أو بحزمة ذرّية تظل ممنوعة: الإنشاء
    // وحده كافٍ لتسجيل مصروف، وأي شيء أوسع يعني تعديل ما قد يكون مُرحّلاً.
    for (const file of ['tools.js', 'fetch.js', 'client.js']) {
      const code = src(file);
      for (const forbidden of ['setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
        expect(code.includes(forbidden), `${file} يستعمل ${forbidden}`).toBe(false);
      }
    }
  });

  it('ولا يستورد Admin SDK إطلاقاً', async () => {
    // `firebase-admin` ignores security rules entirely. Its presence here
    // would make an assistant the most privileged actor in an accounting
    // system — more privileged than the admin who owns it.
    for (const file of ['tools.js', 'fetch.js', 'client.js']) {
      expect(src(file).includes('firebase-admin'), file).toBe(false);
    }
  });

  it('وكل عملية دفترية تمرّ بـ callServer', async () => {
    const { tools } = await load();
    // `sweater_record_expense` هو الاستثناء الوحيد وهو ليس عملية دفترية:
    // ينشئ سجلاً تشغيلياً فقط، ولا يلمس الدفاتر — إدخاله إليها يبقى نداءً
    // منفصلاً بـ `sweater_post_source`، أي فعلاً واعياً لا أثراً جانبياً.
    for (const t of tools.writeTools) {
      if (t.name === 'sweater_record_expense') {
        expect(String(t.run).includes('callServer'), 'تسجيل المصروف يجب ألا يرحّل تلقائياً').toBe(false);
        continue;
      }
      expect(String(t.run).includes('callServer'), `${t.name} لا يمرّ بالخادم`).toBe(true);
    }
  });

  it('وبيانات الدخول تُقرأ من البيئة لا من وسائط الأداة', async () => {
    // A tool argument is model-controlled. If the account could be chosen per
    // call, a prompt could ask to be someone else.
    const { tools } = await load();
    for (const t of tools.allTools) {
      expect(Object.keys(t.schema)).not.toContain('email');
      expect(Object.keys(t.schema)).not.toContain('password');
    }
    expect(src('client.js')).toContain("env('SWEATER_EMAIL')");
  });
});

describe('وضع القراءة فقط', () => {
  it('يرفض أي نداء للخادم قبل محاولته', async () => {
    const { client } = await load({ SWEATER_MCP_READONLY: '1' });
    expect(client.readOnly).toBe(true);
    // Refused BEFORE `connect()`, so it does not even sign in — no credential
    // is exercised for a call that was never going to be allowed.
    await expect(client.callServer('ledgerClosePeriod', { periodKey: '2026-08' }))
      .rejects.toThrow(/القراءة فقط/);
  });

  it('ولا يُفعَّل بقيمة عشوائية', async () => {
    for (const v of ['0', 'false', 'no', '', 'maybe']) {
      const { client } = await load({ SWEATER_MCP_READONLY: v });
      expect(client.readOnly, `قيمة: ${v}`).toBe(false);
    }
    for (const v of ['1', 'true', 'YES', 'True']) {
      const { client } = await load({ SWEATER_MCP_READONLY: v });
      expect(client.readOnly, `قيمة: ${v}`).toBe(true);
    }
  });

  it('وبلا بيانات دخول يقول أين تُضبط، لا «فشل الاتصال»', async () => {
    const { client } = await load({ SWEATER_EMAIL: '', SWEATER_PASSWORD: '' });
    await expect(client.connect()).rejects.toThrow(/SWEATER_EMAIL/);
  });
});

describe('المخطَّطات ترفض ما لا يصح قبل أن يصل الخادم', () => {
  const schemaOf = async (name) => {
    const { tools } = await load();
    return tools.allTools.find((t) => t.name === name).schema;
  };

  it('التواريخ بصيغة YYYY-MM-DD', async () => {
    const s = await schemaOf('sweater_report');
    expect(s.from.safeParse('2026-08-01').success).toBe(true);
    expect(s.from.safeParse('01/08/2026').success).toBe(false);
    expect(s.from.safeParse('اليوم').success).toBe(false);
  });

  it('ومفتاح الفترة شهر لا يوم', async () => {
    const s = await schemaOf('sweater_close_period');
    expect(s.periodKey.safeParse('2026-08').success).toBe(true);
    expect(s.periodKey.safeParse('2026-08-13').success).toBe(false);
  });

  it('وإعادة فتح فترة تحتاج سبباً مكتوباً', async () => {
    const s = await schemaOf('sweater_reopen_period');
    expect(s.reason.safeParse('').success).toBe(false);
    expect(s.reason.safeParse('تصحيح فاتورة مورّد').success).toBe(true);
  });

  it('وترحيل سجل لا يقبل مبلغاً — الخادم يبنيه من السجل', async () => {
    // If the tool took an amount, the model would supply one, and the number
    // in the books would come from a language model instead of from the
    // record it claims to describe.
    const s = await schemaOf('sweater_post_source');
    expect(Object.keys(s).sort()).toEqual(['kind', 'sourceId']);
  });

  it('وصرف التأسيس لا يقبل إجمالياً ولا حالة — كلاهما مشتق', async () => {
    const s = await schemaOf('sweater_startup_entry');
    expect(Object.keys(s)).not.toContain('actualAmount');
    expect(Object.keys(s)).not.toContain('status');
  });
});

describe('تسجيل مصروف من فاتورة — المعاينة قبل الكتابة', () => {
  const tool = async () => {
    const { tools } = await load();
    return tools.allTools.find((t) => t.name === 'sweater_record_expense');
  };

  it('بلا confirm: يُرجع معاينة ولا يتصل بقاعدة البيانات أصلاً', async () => {
    // بلا اعتماد في البيئة، أي محاولة اتصال ترمي «بيانات الدخول مفقودة».
    // فنجاح هذا النداء هو نفسه الدليل على أن المعاينة لا تكتب ولا تتصل.
    const t = await tool();
    const body = JSON.parse((await t.run({
      kind: 'variable', description: 'زيت وفلاتر', amount: 340, date: '2026-08-14',
    })).content[0].text);
    expect(body.preview).toBe(true);
    expect(body['سيُكتب_في']).toBe('variable_expenses');
    expect(body['البيانات'].total_variable_cost).toBe(340);
    expect(body['تنبيه']).toMatch(/confirm/);
  });

  it('والمعاينة تقول هل الضريبة قابلة للخصم ولماذا لا', async () => {
    const t = await tool();
    const plain = JSON.parse((await t.run({
      kind: 'variable', description: 'قهوة', amount: 25, date: '2026-08-14',
    })).content[0].text);
    expect(plain['المعاملة_الضريبية'].deductible).toBe(false);
    expect(plain['المعاملة_الضريبية'].reason).toBeTruthy();
  });

  it('ولا يقبل ما لا يصح قبل أن يصل شيء إلى قاعدة البيانات', async () => {
    const s = (await tool()).schema;
    expect(s.amount.safeParse(-5).success).toBe(false);
    expect(s.amount.safeParse(0).success).toBe(false);
    expect(s.date.safeParse('14/08/2026').success).toBe(false);
    expect(s.description.safeParse('').success).toBe(false);
    expect(s.kind.safeParse('wash').success).toBe(false);
  });

  it('والقيمة صفر للضريبة ليست «غير مذكورة»', async () => {
    // توريد معفى أو بنسبة صفر إجابةٌ حقيقية. `?? null` لا `|| null`.
    const t = await tool();
    const body = JSON.parse((await t.run({
      kind: 'variable', description: 'توريد معفى', amount: 100, date: '2026-08-14',
      isTaxInvoice: true, supplier: 'مورّد', invoiceNumber: 'A-1',
      invoiceDate: '2026-08-14', vatAmount: 0,
    })).content[0].text);
    expect(body['البيانات'].vat_amount).toBe(0);
  });

  it('وهي أداة كتابة — فتختفي في وضع القراءة فقط', async () => {
    const { tools } = await load();
    expect(tools.writeTools.map((t) => t.name)).toContain('sweater_record_expense');
    expect(tools.readTools.map((t) => t.name)).not.toContain('sweater_record_expense');
  });
});
