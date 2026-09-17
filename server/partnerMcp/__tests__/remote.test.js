/**
 * منفذ الشريك — عبر HTTP حقيقي، بعميل MCP حقيقي، وبلا Firestore
 * ═══════════════════════════════════════════════════════════════════════════
 * الرابط هو المفتاح، فكل ما يحرسه يجب أن يكون مُختبَراً لا موصوفاً: الشكل
 * يُرفض قبل أي قراءة، والمجهول والمُلغى 404 واحد، وغياب الإعداد 503 يسمّي
 * متغيّره، وحدّ المعدل 429. التبعيات تُحقَن فلا يلمس الاختبار قاعدة بيانات.
 *
 * Run: npm test
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPartnerMcpHandler } from '../../../api/partner-mcp/[secret].js';
import { partnerToolNames } from '../tools.js';

const GOOD = `pmk_${'a'.repeat(43)}`;
const UNKNOWN = `pmk_${'b'.repeat(43)}`;
const PRINCIPAL = { keyId: 'pmk_k1', partnerId: 'p1', ownerUid: 'u1', lastUsedAtIso: null, partner: { id: 'p1', partnerName: 'أحمد', workersCount: 1 } };

const fakeLoad = {
  partners: async () => [{ id: 'p1', partnerName: 'أحمد', workersCount: 1 }, { id: 'p2', partnerName: 'سالم', workersCount: 3 }],
  receipts: async () => [],
  feeRules: async () => [],
  months: async () => ['2026-08'],
  accounts: async () => [],
  settings: async () => ({}),
  ledger: async () => ({ entries: [], lines: [] }),
  washes: async () => [],
};

let server; let base;
const resolve = vi.fn(async (_db, token) => (token === GOOD ? PRINCIPAL : null));
const rateLimit = vi.fn(async () => ({ count: 1 }));
const touch = vi.fn(async () => false);
let runtimeFactory = () => ({ db: {}, FieldValue: {} });

beforeAll(async () => {
  const handler = createPartnerMcpHandler({
    runtimeFactory: () => runtimeFactory(),
    resolve, rateLimit, touch,
    loaderFactory: () => fakeLoad,
  });
  server = createServer((req, res) => { handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

const status = (path) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
});

async function connect(token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/partner-mcp/${token}`)));
  return client;
}

describe('حراسة الرمز', () => {
  it('الرمز الصحيح يفتح جلسةً بأدوات الشريك وحدها', async () => {
    const client = await connect(GOOD);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([...partnerToolNames].sort());
    const me = await client.callTool({ name: 'partner_whoami', arguments: {} });
    const body = JSON.parse(me.content[0].text);
    expect(body.partnerName).toBe('أحمد');
    expect(body.sharePercent).toBe(25);
    expect(JSON.stringify(body)).not.toContain('سالم');
    await client.close();
  }, 30_000);

  it('رمزٌ مشوّه الشكل: 404 — ولا يُسأل المخزن أصلاً', async () => {
    resolve.mockClear();
    for (const bad of ['x', 'pmk_short', `${GOOD}extra`, `sk_${'a'.repeat(43)}`, '']) {
      expect((await status(`/api/partner-mcp/${bad}`)).status, bad || '(فارغ)').toBe(404);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('ورمزٌ سليم الشكل لكن مجهولٌ أو مُلغى: 404 نفسه', async () => {
    expect((await status(`/api/partner-mcp/${UNKNOWN}`)).status).toBe(404);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), UNKNOWN);
  });

  it('وترميزٌ مشوّه في المسار لا يُسقط الخادم', async () => {
    expect((await status('/api/partner-mcp/%E0%A4%A')).status).toBe(404);
  });
});

describe('الإعداد والمعدل', () => {
  it('بلا FIREBASE_SERVICE_ACCOUNT: 503 يسمّي المتغيّر', async () => {
    const prev = runtimeFactory;
    runtimeFactory = () => { throw new Error('FIREBASE_SERVICE_ACCOUNT غير مضبوط.'); };
    try {
      const res = await status(`/api/partner-mcp/${GOOD}`);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/FIREBASE_SERVICE_ACCOUNT/);
    } finally { runtimeFactory = prev; }
  });

  it('وتجاوز الحدّ: 429', async () => {
    rateLimit.mockImplementationOnce(async () => { const e = new Error('تجاوزت الحدّ'); e.code = 'resource-exhausted'; throw e; });
    expect((await status(`/api/partner-mcp/${GOOD}`)).status).toBe(429);
  });

  it('و«آخر استعمال» يُلمَس بمعرّف المفتاح لا بالرمز', async () => {
    touch.mockClear();
    await status(`/api/partner-mcp/${GOOD}`);
    expect(touch).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ keyId: 'pmk_k1' }));
    expect(JSON.stringify(touch.mock.calls)).not.toContain(GOOD);
  });
});
