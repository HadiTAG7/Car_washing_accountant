import { describe, expect, it } from 'vitest';
import { resolveMcpBackend, resolveMcpAppOrigin } from '../src/backend-config.js';

describe('MCP follows the approved hosting backend', () => {
  it('retains the existing Firebase default', () => {
    expect(resolveMcpBackend({}).dataSource).toBe('firebase');
  });
  it('follows website Supabase configuration without extra MCP-only variables', () => {
    expect(resolveMcpBackend({ DATA_SOURCE:'supabase', SUPABASE_URL:'https://project.supabase.co', VITE_SUPABASE_ANON_KEY:'sb_publishable_test' }))
      .toEqual({dataSource:'supabase',url:'https://project.supabase.co',publishableKey:'sb_publishable_test'});
  });
  it('retains explicit local MCP backend and project overrides', () => {
    expect(resolveMcpBackend({DATA_SOURCE:'supabase',SWEATER_DATA_SOURCE:'firebase'}).dataSource).toBe('firebase');
    expect(resolveMcpBackend({DATA_SOURCE:'firebase',SWEATER_DATA_SOURCE:' supabase ',SWEATER_SUPABASE_URL:'https://local.supabase.co',SUPABASE_URL:'https://hosting.supabase.co',SWEATER_SUPABASE_ANON_KEY:'explicit'}))
      .toEqual({dataSource:'supabase',url:'https://local.supabase.co',publishableKey:'explicit'});
  });
  it('does not use privileged service-role or JWT secrets as browser API keys', () => {
    expect(resolveMcpBackend({DATA_SOURCE:'supabase',SUPABASE_SERVICE_ROLE_KEY:'secret',SUPABASE_JWT_SECRET:'secret'}).publishableKey).toBe('');
  });
});

describe('MCP preview workflow isolation', () => {
  it('uses the current preview deployment, not the production default', () => {
    expect(resolveMcpAppOrigin({VERCEL_ENV:'preview',VERCEL_URL:'migration-preview.vercel.app'})).toBe('https://migration-preview.vercel.app');
  });
  it('fails closed if a preview has no configured origin', () => {
    expect(()=>resolveMcpAppOrigin({VERCEL_ENV:'preview'})).toThrow(/required/);
  });
  it('retains explicit operator origins and the production default', () => {
    expect(resolveMcpAppOrigin({SWEATER_APP_URL:'https://approved.example/path'})).toBe('https://approved.example');
    expect(resolveMcpAppOrigin({})).toBe('https://sweater-hadi-alghanim.vercel.app');
    expect(resolveMcpAppOrigin({SWEATER_APP_URL:'http://127.0.0.1:5184'})).toBe('http://127.0.0.1:5184');
  });
  it('rejects non-HTTPS remote origins, credential URLs and non-HTTP protocols', () => {
    for(const value of ['http://untrusted.example','ftp://localhost','https://user:password@example.com']) {
      expect(()=>resolveMcpAppOrigin({SWEATER_APP_URL:value})).toThrow();
    }
  });
});
