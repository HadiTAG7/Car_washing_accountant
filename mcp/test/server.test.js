/**
 * الخادم نفسه — يتكلّم MCP فعلاً، لا افتراضاً
 * ═══════════════════════════════════════════════════════════════════════════
 * `tools.test.js` يفحص السجل. هذا يفحص الخادم: يُشغَّل كعملية مستقلة، ويتصل به
 * عميل MCP حقيقي عبر stdio، ويطلب قائمة الأدوات.
 *
 * ما يثبته وحده:
 *
 *   • أن الخادم يبدأ أصلاً — خطأ استيراد أو مخطَّط zod لا يقبله الـ SDK يظهر
 *     هنا فقط، ولا يمسّه أي اختبار وحدة.
 *   • أن **سرد الأدوات لا يحتاج بيانات دخول**. الاتصال كسول عمداً: عميل MCP
 *     يسرد الأدوات عند بدء الجلسة، فلو كان تسجيل الدخول شرطاً للسرد لفشل
 *     الخادم عند الإقلاع بدل أن يفشل عند أول استعمال — ولضاع الفرق بين
 *     «غير مُهيَّأ» و«معطوب».
 *   • أن `SWEATER_MCP_READONLY` يُخفي أدوات الكتابة من القائمة نفسها. الرفض
 *     شيء، وعدم العرض شيء أقوى: أداة لا يراها النموذج لا يمكن إقناعه باستعمالها.
 *
 * Run: npm test --prefix mcp
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, '..', 'server.js');

async function listTools(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    // Deliberately NO credentials: listing must work without them.
    env: { PATH: process.env.PATH, ...env },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe('الخادم عبر stdio', () => {
  it('يبدأ ويسرد أدواته بلا بيانات دخول', async () => {
    const tools = await listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('sweater_whoami');
    expect(names).toContain('sweater_report');
    expect(names).toContain('sweater_vat_report');
    expect(names).toContain('sweater_post_source');
    expect(names).toContain('sweater_reverse_entry');

    // كل أداة تصل بوصف — وهو ما يقرؤه النموذج ليقرر أتنطبق أم لا.
    for (const t of tools) expect(t.description?.length, t.name).toBeGreaterThan(40);
  }, 30_000);

  it('ووضع القراءة فقط يُخفي أدوات الكتابة من القائمة', async () => {
    const open = (await listTools()).map((t) => t.name);
    const locked = (await listTools({ SWEATER_MCP_READONLY: '1' })).map((t) => t.name);

    expect(locked.length).toBeLessThan(open.length);
    expect(locked).toContain('sweater_report');
    for (const w of ['sweater_post_source', 'sweater_reverse_entry', 'sweater_close_period',
      'sweater_reopen_period', 'sweater_issue_document', 'sweater_void_document',
      'sweater_startup_entry', 'sweater_seed_chart']) {
      expect(locked, `${w} ما زالت معروضة`).not.toContain(w);
    }
  }, 30_000);

  it('وأداة تُستدعى بلا اعتماد تُرجع رسالة تقول أين يُضبط، لا انهياراً', async () => {
    // The distinction that matters operationally: a misconfigured server must
    // stay alive and SAY what is missing. A crash here would look identical to
    // a broken project, and the person would go looking in the wrong place.
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER],
      env: { PATH: process.env.PATH },
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const res = await client.callTool({ name: 'sweater_whoami', arguments: {} });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/SWEATER_EMAIL/);
      // ولا يزال حياً بعدها.
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 30_000);
});
