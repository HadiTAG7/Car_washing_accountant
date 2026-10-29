import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { KEYS_COL, checkRateLimit, IntegrationAuthError } from './integrationKeys.js';

export const N8N_SCOPE = 'n8n_wash_ingest';
export const N8N_PRINCIPAL = 'n8n-wash-sync';
export const N8N_AUTH_MODE = 'bearer-sha256';
export const N8N_KEY_LIFETIME_MS = 90 * 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
const refused = () => new IntegrationAuthError('مفتاح n8n غير صالح أو منتهي.');

// A separate credential family. Existing HMAC keys cannot authenticate here,
// and these keys cannot authenticate on the existing signed endpoints.
export async function createN8nKey(db, FieldValue, { label = null, actor = null, nowMs = Date.now() } = {}) {
  const keyId = `nk_${randomBytes(8).toString('hex')}`;
  const secret = `${keyId}.${randomBytes(32).toString('base64url')}`;
  const tokenHash = hash(secret);
  const expiresAtIso = new Date(nowMs + N8N_KEY_LIFETIME_MS).toISOString();
  await db.collection(KEYS_COL).doc(keyId).set({
    keyId, label: String(label || 'n8n — تسجيل الغسلات').slice(0, 120),
    scope: N8N_SCOPE, principal: N8N_PRINCIPAL, authMode: N8N_AUTH_MODE,
    tokenHash, fingerprint: tokenHash.slice(0, 16), status: 'active',
    createdBy: actor, createdAt: FieldValue.serverTimestamp(),
    createdAtIso: new Date(nowMs).toISOString(), expiresAtIso,
    lastUsedAtIso: null, revokedAtIso: null, revokedBy: null,
  });
  return { keyId, secret, fingerprint: tokenHash.slice(0, 16), scope: N8N_SCOPE,
    authMode: N8N_AUTH_MODE, expiresAtIso };
}

export async function verifyN8nRequest(db, FieldValue, { authorization, nowMs = Date.now() } = {}) {
  // No query/body credentials. Reject arrays, control characters and extra text.
  const match = typeof authorization === 'string'
    ? /^Bearer (nk_[a-f0-9]{16}\.[A-Za-z0-9_-]{43})$/i.exec(authorization) : null;
  if (!match) throw refused();
  const token = match[1], keyId = token.split('.')[0];
  const snap = await db.collection(KEYS_COL).doc(keyId).get();
  if (!snap.exists) throw refused();
  const key = snap.data();
  if (key.authMode !== N8N_AUTH_MODE || key.scope !== N8N_SCOPE || key.principal !== N8N_PRINCIPAL
      || key.status !== 'active' || !Number.isFinite(Date.parse(key.expiresAtIso))
      || Date.parse(key.expiresAtIso) <= nowMs || !/^[a-f0-9]{64}$/.test(key.tokenHash || '')) throw refused();
  if (!timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(key.tokenHash, 'hex'))) throw refused();
  await checkRateLimit(db, FieldValue, keyId, nowMs);
  await db.collection(KEYS_COL).doc(keyId).set({
    lastUsedAt: FieldValue.serverTimestamp(), lastUsedAtIso: new Date(nowMs).toISOString(),
  }, { merge: true });
  return { keyId, principal: N8N_PRINCIPAL, scope: N8N_SCOPE };
}
