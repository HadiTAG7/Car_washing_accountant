import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const { signed, n8n } = vi.hoisted(() => ({ signed: vi.fn(), n8n: vi.fn() }));
vi.mock('../src/sweater/operationsHttp.js', () => ({ operationsHandler: () => signed }));
vi.mock('../src/sweater/n8nHttp.js', () => ({ n8nOperationsHandler: () => n8n }));
import handler from '../../api/integrations/sweater/operations.js';

describe('n8n deployment routing', () => {
  it('selects exactly one authenticator, never a Bearer fallback on the HMAC route', async () => {
    signed.mockClear(); n8n.mockClear();
    const res = {}, direct = { query: {}, headers: { authorization: 'Bearer invalid' } };
    await handler(direct, res);
    expect(signed).toHaveBeenCalledWith(direct, res); expect(n8n).not.toHaveBeenCalled();
    signed.mockClear();
    const routed = { query: { n8nEndpoint: '1' } };
    await handler(routed, res);
    expect(n8n).toHaveBeenCalledWith(routed, res); expect(signed).not.toHaveBeenCalled();
    n8n.mockClear();
    await handler({ query: { n8nEndpoint: ['1', '1'] } }, res);
    expect(signed).toHaveBeenCalledOnce(); expect(n8n).not.toHaveBeenCalled();
  });
  it('ships the exact rewrite without adding a thirteenth serverless function', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
    expect(config.rewrites).toContainEqual({ source: '/api/integrations/sweater/n8n', destination: '/api/integrations/sweater/operations?n8nEndpoint=1' });
    const files = dir => readdirSync(dir).flatMap(name => {
      const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path];
    });
    expect(files(join(root, 'api')).filter(path => path.endsWith('.js')).length).toBeLessThanOrEqual(12);
  });
});
