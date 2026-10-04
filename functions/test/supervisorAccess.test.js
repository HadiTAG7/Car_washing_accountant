import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HANDLER_NAMES, callerRole, dispatch } from '../src/handlers.js';
import { SUPERVISOR_READ_HANDLERS } from '../../src/lib/supervisorAccess.js';
const dbFor = (admin = false, role = 'supervisor', hasUser = true) => ({ collection: name => ({ doc: () => ({ get: async () => ({ exists: name === 'users' ? hasUser : admin, data: () => ({ role }) }) }) }) });
describe('supervisor server authorization', () => {
  it('resolves the explicit read-only role', async () => { expect(await callerRole(dbFor(), { uid: 's' })).toBe('supervisor'); });
  it('cannot inherit an admin marker', async () => { expect(await callerRole(dbFor(true), { uid: 's' })).toBe('supervisor'); });
  it('ignores custom admin claims and preserves the stored supervisor role', async () => {
    expect(await callerRole(dbFor(true), { uid: 's', token: { role: 'admin', admin: true, tenantId: 'other' } })).toBe('supervisor');
  });
  it.each(['supervisorOverview', 'supervisorRecords'])('denies multi-tenant token for unscoped %s', async name => {
    await expect(dispatch(dbFor(), {}, name, {}, { uid: 's', token: { firebase: { tenant: 'other' } } })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.each(['unknown', null, '', undefined])('fails closed for legacy invalid role %s, even with an admin marker', async role => {
    for (const marker of [false, true]) {
      const db = dbFor(marker, role === undefined ? null : role);
      await expect(callerRole(db, { uid: 's', token: { role: 'admin' } })).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(dispatch(db, {}, 'authClaimFirstAdmin', {}, { uid: 's' })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it.each(['admin', 'accountant', 'operator', 'partner'])('retains explicit migrated role %s', async role => {
    expect(await callerRole(dbFor(false, role), { uid: 's' })).toBe(role);
  });
  it('preserves a legacy admin marker with no membership document, and denies an unregistered account', async () => {
    expect(await callerRole(dbFor(true, null, false), { uid: 's' })).toBe('admin');
    await expect(callerRole(dbFor(false, null, false), { uid: 's' })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('covers every actual callable export and every registered server handler', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const exports = [...source.matchAll(/export const (\w+) = callable\('([^']+)'\)/g)];
    expect(exports.length).toBe((source.match(/export const /g) || []).length);
    expect(exports.map(m => m[1]).sort()).toEqual([...HANDLER_NAMES].sort());
    expect(exports.every(m => m[1] === m[2])).toBe(true);
    expect(SUPERVISOR_READ_HANDLERS).toEqual(['supervisorOverview', 'supervisorRecords', 'authBootstrapStatus']);
  });
  it.each(HANDLER_NAMES.filter(name => !SUPERVISOR_READ_HANDLERS.includes(name)))('refuses %s before business access', async name => {
    for (const marker of [false, true]) {
      await expect(dispatch(dbFor(marker), {}, name, { role: 'admin', apply: true }, { uid: 's', token: { role: 'admin', admin: true } })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
});
