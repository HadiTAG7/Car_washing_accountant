import { afterEach, expect, it, vi } from 'vitest';
import handler, { requiredIntegrationSettings } from '../../api/integrations/sweater/health.js';

afterEach(()=>vi.unstubAllEnvs());
it('keeps the Firebase readiness requirements when the migration is off',()=>{
  expect(requiredIntegrationSettings({}).map(x=>x.name)).toEqual(['FIREBASE_SERVICE_ACCOUNT','SWEATER_KEY_ENCRYPTION_KEY']);
});
it('checks the active Supabase connection, not an unrelated Firebase credential',()=>{
  expect(requiredIntegrationSettings({DATA_SOURCE:'supabase'}).map(x=>x.name)).toEqual(['LEDGER_DB_URL','SUPABASE_URL','SWEATER_KEY_ENCRYPTION_KEY']);
});
it('reports readiness without revealing connection, URL or encryption values',()=>{
  for(const [key,value] of Object.entries({DATA_SOURCE:'supabase',LEDGER_DB_URL:'private-database-value',SUPABASE_URL:'https://example.supabase.co',SWEATER_KEY_ENCRYPTION_KEY:'private-encryption-value',FIREBASE_SERVICE_ACCOUNT:''})) vi.stubEnv(key,value);
  let body;
  const res={setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn(x=>{body=x;})};
  handler({method:'GET'},res);
  expect(body.result.ready).toBe(true);
  expect(body.result.missing).toEqual([]);
  expect(JSON.stringify(body)).not.toMatch(/private-database-value|example.supabase.co|private-encryption-value/);
});
it('fails closed when the active connection is missing, even if Firebase is configured',()=>{
  for(const [key,value] of Object.entries({DATA_SOURCE:'supabase',LEDGER_DB_URL:'',SUPABASE_URL:'https://example.supabase.co',SWEATER_KEY_ENCRYPTION_KEY:'configured',FIREBASE_SERVICE_ACCOUNT:'configured'})) vi.stubEnv(key,value);
  let body;
  const res={setHeader:vi.fn(),status:vi.fn().mockReturnThis(),json:vi.fn(x=>{body=x;})};
  handler({method:'GET'},res);
  expect(body.result.ready).toBe(false);
  expect(body.result.missing).toEqual(['LEDGER_DB_URL']);
});
