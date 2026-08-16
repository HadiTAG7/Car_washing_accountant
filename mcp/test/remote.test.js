/**
 * الخادم البعيد — عبر HTTP حقيقي، بعميل MCP حقيقي
 * ═══════════════════════════════════════════════════════════════════════════
 * النسخة المحلية سرّها ملفٌ على الجهاز. وهذه على رابط عام، فالرابط نفسه هو
 * المفتاح — وكل ما يحرسه يجب أن يكون مُختبَراً لا موصوفاً.
 *
 * يُشغَّل المعالج خلف `http.createServer` ويُتصل به بـ
 * `StreamableHTTPClientTransport`، أي بنفس الطريق الذي يسلكه Claude أو ChatGPT.
 * وهذا أيضاً ما يثبت أن الملف محايد عن Vercel: لو اتّكأ على `res.status().json()`
 * أو على `req.query` لَما عمل هنا — ولا على Render ولا Fly.
 *
 * Run: npm test --prefix mcp
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SECRET = 'test-secret-0123456789abcdef';

let server; let base;

async function boot() {
  const { default: handler } = await import('../../api/mcp/[secret].js');
  server = createServer((req, res) => { handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

/** Reloads the module so a changed env var actually takes effect. */
async function reboot(env) {
  if (server) await new Promise((r) => server.close(r));
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  await boot();
}

async function connect(secret = SECRET) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp/${secret}`)));
  return client;
}

const status = (path) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
}).then((r) => r.status);

afterAll(async () => { if (server) await new Promise((r) => server.close(r)); vi.unstubAllEnvs(); });

describe('حراسة السرّ', () => {
  beforeAll(async () => { await reboot({ MCP_SECRET: SECRET }); }, 30_000);

  it('السرّ الصحيح يفتح جلسة MCP', async () => {
    const client = await connect();
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
  }, 30_000);

  it('والسرّ الخاطئ: 404 — لا 403', async () => {
    // 403 يؤكّد لمن يجرّب أن العنوان صحيح وأن الباقي تخمين. 404 لا يقول شيئاً.
    expect(await status('/api/mcp/wrong-secret-here')).toBe(404);
  });

  it('وسرٌّ بطول مختلف يُرفض كذلك', async () => {
    expect(await status('/api/mcp/x')).toBe(404);
    expect(await status(`/api/mcp/${SECRET}extra`)).toBe(404);
  });

  it('وبلا سرّ في المسار: 404', async () => {
    expect(await status('/api/mcp/')).toBe(404);
  });
});

describe('بلا MCP_SECRET الخادم معطَّل', () => {
  beforeAll(async () => { await reboot({ MCP_SECRET: '' }); }, 30_000);

  it('يرفض كل شيء بـ 503 ويقول أي متغيّر ناقص', async () => {
    // بلا هذا الفرع، خادمٌ نُشر قبل ضبط السرّ يقارن بسلسلة فارغة — أي أنه
    // يقبل رابطاً بلا سرّ أصلاً. الرفض هنا صريح لا ضمني.
    const res = await fetch(`${base}/api/mcp/${SECRET}`, { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/MCP_SECRET/);
  });
});

describe('الكتابة معطَّلة افتراضياً', () => {
  const WRITES = ['sweater_post_source', 'sweater_reverse_entry', 'sweater_close_period',
    'sweater_reopen_period', 'sweater_issue_document', 'sweater_void_document',
    'sweater_startup_entry', 'sweater_seed_chart'];

  it('بلا MCP_ALLOW_WRITES لا تُعرَض أداة كتابة واحدة', async () => {
    await reboot({ MCP_SECRET: SECRET });
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const w of WRITES) expect(names, `${w} معروضة`).not.toContain(w);
    expect(names).toContain('sweater_report');
    await client.close();
  }, 30_000);

  it('ومع MCP_ALLOW_WRITES=1 تُعرَض', async () => {
    await reboot({ MCP_SECRET: SECRET, MCP_ALLOW_WRITES: '1' });
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const w of WRITES) expect(names, `${w} غائبة`).toContain(w);
    await client.close();
  }, 30_000);

  it('ولا تُفتح بقيمة عشوائية', async () => {
    for (const v of ['0', 'false', 'no', 'maybe', '']) {
      await reboot({ MCP_SECRET: SECRET, MCP_ALLOW_WRITES: v });
      const client = await connect();
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names, `فُتحت بـ «${v}»`).not.toContain('sweater_post_source');
      await client.close();
    }
  }, 60_000);
});

describe('البعيد والمحلي يعرضان نفس الأدوات', () => {
  it('مجموعة القراءة متطابقة — لا نسختان تنحرفان', async () => {
    await reboot({ MCP_SECRET: SECRET, MCP_ALLOW_WRITES: '1' });
    const { allTools } = await import('../src/tools.js');
    const client = await connect();
    const remote = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(remote).toEqual(allTools.map((t) => t.name).sort());
    await client.close();
  }, 30_000);
});
