// The Supabase half of `verifyIdToken(token, true)`: only a signed user token
// from this project's issuer, and only while its session is alive.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { dataSource, ledgerConnection, supabaseAuth, verifySupabaseToken } from '../backend.js';
import { SUPABASE_ROOT_CA } from '../supabaseCa.js';

const SECRET = 'test-secret-with-at-least-thirty-two-characters!!';
const UID = '6b1f2e5c-8a3d-4f0b-9c7e-1d2a3b4c5d6e';
const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';

let server; let url; let es; let otherEs;
beforeAll(async () => {
  es = await generateKeyPair('ES256');
  otherEs = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(es.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(r => server.close(r)));

const env = (extra = {}) => ({ SUPABASE_URL: url, ...extra });
const claims = (extra = {}) => ({ sub: UID, role: 'authenticated', email: 'a@b.sa', session_id: SESSION, ...extra });
const hs = (c = claims(), { iss = `${url}/auth/v1`, aud = 'authenticated', secret = SECRET } = {}) =>
  new SignJWT(c).setProtectedHeader({ alg: 'HS256' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
const esToken = (c = claims(), key = es.privateKey) =>
  new SignJWT(c).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(`${url}/auth/v1`).setAudience('authenticated')
    .setIssuedAt().setExpirationTime('5m').sign(key);

describe('DATA_SOURCE', () => {
  it('is Firebase unless set to supabase', () => {
    expect(dataSource({})).toBe('firebase');
    expect(dataSource({ DATA_SOURCE: 'firebase' })).toBe('firebase');
    expect(dataSource({ DATA_SOURCE: 'Supabase' })).toBe('firebase');
    expect(dataSource({ DATA_SOURCE: ' supabase ' })).toBe('supabase');
  });
});

describe('verifySupabaseToken', () => {
  it('accepts a project-signed ES256 user token (JWKS)', async () => {
    const p = await verifySupabaseToken(await esToken(), env());
    expect(p.sub).toBe(UID);
  });
  it('rejects ES256 signed by another key', async () => {
    await expect(verifySupabaseToken(await esToken(claims(), otherEs.privateKey), env())).rejects.toThrow();
  });
  it('accepts HS256 only with the project secret', async () => {
    expect((await verifySupabaseToken(await hs(), env({ SUPABASE_JWT_SECRET: SECRET }))).sub).toBe(UID);
    await expect(verifySupabaseToken(await hs(), env())).rejects.toThrow('hs256-without-secret');
    await expect(verifySupabaseToken(await hs(claims(), { secret: `${SECRET}x` }), env({ SUPABASE_JWT_SECRET: SECRET }))).rejects.toThrow();
  });
  it('rejects another issuer, another audience, and non-user roles', async () => {
    const e = env({ SUPABASE_JWT_SECRET: SECRET });
    await expect(verifySupabaseToken(await hs(claims(), { iss: 'https://evil.supabase.co/auth/v1' }), e)).rejects.toThrow();
    await expect(verifySupabaseToken(await hs(claims(), { aud: 'anon' }), e)).rejects.toThrow();
    await expect(verifySupabaseToken(await hs(claims({ role: 'anon' })), e)).rejects.toThrow('not-a-user-token');
    await expect(verifySupabaseToken(await hs(claims({ role: 'service_role' })), e)).rejects.toThrow('not-a-user-token');
    await expect(verifySupabaseToken(await hs(claims({ sub: '' })), e)).rejects.toThrow('not-a-user-token');
  });
  it('refuses an unsigned token', async () => {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none' })}.${b64({ ...claims(), iss: `${url}/auth/v1`, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    await expect(verifySupabaseToken(none, env({ SUPABASE_JWT_SECRET: SECRET }))).rejects.toThrow();
  });
});

describe('supabaseAuth.verifyIdToken', () => {
  const db = live => ({ sessionIsLive: async (uid, sid) => live && uid === UID && sid === SESSION });
  it('returns the Firebase-shaped decoded token', async () => {
    const decoded = await supabaseAuth(db(true), env()).verifyIdToken(await esToken(), true);
    expect(decoded.uid).toBe(UID);
    expect(decoded.email).toBe('a@b.sa');
  });
  it('checkRevoked refuses a signed-out, banned or deleted session', async () => {
    await expect(supabaseAuth(db(false), env()).verifyIdToken(await esToken(), true)).rejects.toThrow('session-revoked');
    // Without checkRevoked the signature alone decides, as in Firebase.
    expect((await supabaseAuth(db(false), env()).verifyIdToken(await esToken(), false)).uid).toBe(UID);
  });
});

describe('ledgerConnection (TLS to the database)', () => {
  const POOLER = 'postgresql://ledger_server.abc:pw-1_x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
  it('the bundled CA is Supabase Root 2021 CA', () => {
    const cert = new X509Certificate(SUPABASE_ROOT_CA);
    expect(cert.subject).toContain('CN=Supabase Root 2021 CA');
    expect(cert.ca).toBe(true);
    expect(cert.fingerprint256).toBe('80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  });
  it('a Supabase host is verified against that CA, whatever sslmode the URL carries', () => {
    for (const suffix of ['', '?sslmode=require', '?sslmode=disable', '?sslmode=verify-full&sslrootcert=/x.crt&application_name=api']) {
      const c = ledgerConnection({ LEDGER_DB_URL: POOLER + suffix });
      expect(c.ssl).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
      expect(c.connectionString).not.toMatch(/ssl/);
      // node-pg keeps this TLS setting (a URL sslmode would have replaced it).
      const params = new pg.Client(c).connectionParameters;
      expect(params.ssl).toEqual({ ca: SUPABASE_ROOT_CA, rejectUnauthorized: true });
      expect([params.user, params.password, params.host, params.port]).toEqual(['ledger_server.abc', 'pw-1_x', 'aws-0-eu-west-1.pooler.supabase.com', 6543]);
    }
    expect(ledgerConnection({ LEDGER_DB_URL: `${POOLER}?application_name=api` }).connectionString).toContain('application_name=api');
  });
  it('LEDGER_DB_CA replaces the bundled CA; a local database goes without TLS', () => {
    expect(ledgerConnection({ LEDGER_DB_URL: POOLER, LEDGER_DB_CA: 'PEM' }).ssl.ca).toBe('PEM');
    const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    expect(ledgerConnection({ LEDGER_DB_URL: local })).toEqual({ connectionString: local, ssl: undefined });
    expect(ledgerConnection({ LEDGER_DB_URL: 'postgresql://u:p@db.evilsupabase.co:5432/postgres' }).ssl).toBeUndefined();
  });
  it('a missing or broken URL is a configuration error', () => {
    expect(() => ledgerConnection({})).toThrow(/LEDGER_DB_URL/);
    expect(() => ledgerConnection({ LEDGER_DB_URL: 'not a url' })).toThrow(/LEDGER_DB_URL/);
  });
});
