import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('Vercel ledger cold start with native Node ESM (not Vite resolution)', () => {
  it('loads the operational sync production route natively and refuses GET before any credentials', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { default: handler } = await import('./api/integrations/sweater/operations.js');
      const res = { setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
      await handler({method:'GET'}, res); console.log(JSON.stringify({code:res.code}));
    `], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' } });
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ code: 405 });
  }, 20000);
  it('loads the complete production handler and rejects GET without credentials or database access', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { default: handler } = await import('./api/ledger.js');
      const response = {
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };
      await handler({ method: 'GET', headers: {} }, response);
      console.log(JSON.stringify({ status: response.statusCode,
        allow: response.headers.Allow, code: response.body.error.code }));
    `], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8', timeout: 15000,
      // No production secrets, emulator settings or application credentials.
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: 405, allow: 'POST', code: 'invalid-argument' });
  }, 20000);
});
