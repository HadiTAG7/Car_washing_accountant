import { describe, it, expect, vi } from 'vitest';
import { DIAGNOSTIC_KEY, DIAGNOSTIC_DB, inspectStorage, seedStorage } from '../storageDiagnostic';
const marker = `${DIAGNOSTIC_KEY}:marker`; const history = `${DIAGNOSTIC_KEY}:history`;
function fixture(initial = {}, failWrite = () => false) {
  const rows = new Map(Object.entries(initial)); const calls = [];
  const realm = { localStorage: {
    getItem: key => { calls.push(['get', key]); if (!key.startsWith(DIAGNOSTIC_KEY)) throw Error('Auth or unrelated storage read'); return rows.get(key) ?? null; },
    setItem: (key, value) => { calls.push(['set', key]); if (failWrite(key)) throw Error('Quota exceeded'); rows.set(key, value); },
    removeItem: key => { calls.push(['remove', key]); rows.delete(key); },
  }, indexedDB: { open: name => { calls.push(['open', name]); if (name !== DIAGNOSTIC_DB) throw Error('Foreign database'); throw Error('Storage blocked'); } } };
  return { rows, calls, realm };
}
describe('non-secret storage diagnostic evidence', () => {
  it('reads only its own keys/database and never seeds on inspection or exports unrelated secrets', async () => {
    const f = fixture({ 'firebase:authUser:secret': 'NEVER_READ_TOKEN', 'financial_data': 'NEVER_READ_MONEY' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try { const r = await inspectStorage(f.realm);
      expect(r.current.localStorage).toEqual({ readable: true, writable: true, marker: 'absent' });
      expect(r.current.indexedDB.marker).toBe('unavailable'); expect(f.rows.has(marker)).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/TOKEN|MONEY|secret/); expect(fetch).not.toHaveBeenCalled();
      expect(f.calls.every(([, key]) => key.startsWith(DIAGNOSTIC_KEY) || key === DIAGNOSTIC_DB)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('commits evidence of absence before planting, then preserves evidence of presence on reseeding', async () => {
    const f = fixture(); const first = await seedStorage(f.realm);
    expect(first.evidenceSaved).toBe(true); expect(first.current.localStorage.marker).toBe('absent');
    expect(first.seeded).toEqual({ localStorage: true, indexedDB: false }); expect(f.rows.get(marker)).toBe('present');
    expect(JSON.parse(f.rows.get(history))[0].localStorage.marker).toBe('absent');
    expect(f.calls.findIndex(x => x[0] === 'set' && x[1] === history)).toBeLessThan(f.calls.findIndex(x => x[0] === 'set' && x[1] === marker));
    const next = await seedStorage(f.realm); expect(next.current.localStorage.marker).toBe('present');
    expect(next.history.some(x => x.localStorage.marker === 'absent')).toBe(true);
    expect(next.history.some(x => x.localStorage.marker === 'present')).toBe(true);
  });
  it('does not overwrite a marker when no store can preserve the pre-planting evidence', async () => {
    const f = fixture({ [marker]: 'old-evidence' }, key => key === history);
    const r = await seedStorage(f.realm); expect(r.evidenceSaved).toBe(false);
    expect(r.current.localStorage.marker).toBe('unexpected'); expect(f.rows.get(marker)).toBe('old-evidence');
    expect(f.calls.some(x => x[0] === 'set' && x[1] === marker)).toBe(false);
  });
  it('handles read-only or fully blocked storage without pretending that a marker exists', async () => {
    const readOnly = fixture({}, () => true); expect((await inspectStorage(readOnly.realm)).current.localStorage).toEqual({ readable: true, writable: false, marker: 'absent' });
    const blocked = { get localStorage() { throw Error('blocked'); }, get indexedDB() { throw Error('blocked'); } };
    const r = await seedStorage(blocked); expect(r.evidenceSaved).toBe(false);
    expect(r.current.localStorage.marker).toBe('unavailable'); expect(r.seeded).toEqual({ localStorage: false, indexedDB: false });
  });
  it('bounds and sanitizes owned historical readings rather than exporting arbitrary stored objects', async () => {
    const state = { readable: true, writable: true, marker: 'present', token: 'DO_NOT_EXPORT' };
    const records = Array.from({ length: 25 }, (_, i) => ({ version: 1, readAt: new Date(Date.UTC(2026, 9, 8, 0, 0, i)).toISOString(), localStorage: state, indexedDB: state, extra: 'DO_NOT_EXPORT' }));
    records.push({ ...records[0], readAt: '2026-10-08 (DO_NOT_EXPORT)' });
    const r = await inspectStorage(fixture({ [history]: JSON.stringify(records) }).realm);
    expect(r.history).toHaveLength(20); expect(JSON.stringify(r)).not.toContain('DO_NOT_EXPORT');
  });
});
