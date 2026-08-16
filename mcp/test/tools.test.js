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
  it('لا يستورد أي بدائية كتابة من Firestore', async () => {
    for (const file of ['tools.js', 'fetch.js', 'client.js']) {
      const code = src(file);
      for (const forbidden of ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
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

  it('وكل أداة كتابة تمرّ بـ callServer', async () => {
    const { tools } = await load();
    for (const t of tools.writeTools) {
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
