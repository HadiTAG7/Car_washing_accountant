import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callFinanceApi } from '../financeApi';
import { cachedRead, peekCached, __resetReadCache } from '../readCache';

vi.mock('../firebaseClient', () => ({ auth: { currentUser: { getIdToken: async () => 'TEST-TOKEN' } } }));

const ok = result => ({ ok: true, json: async () => ({ result }) });
async function primeJournal() {
  await cachedRead('journal_entries', async () => [{ id: 'old', entryDate: '2026-10-29' }]);
  expect(peekCached('journal_entries')).toBeTruthy();
}

beforeEach(() => { __resetReadCache(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('finance calls and the shared read cache', () => {
  it.each([
    ['finance-workbench', { action: 'browse' }],
    ['finance-workbench', { action: 'read', kind: 'variable', sourceId: 'x' }],
    ['finance-workbench', { action: 'preview', kind: 'variable', sourceId: 'x' }],
    ['finance-workbench', { kind: 'founding', request: { action: 'read' } }],
    ['finance-workbench', { kind: 'founding', request: { action: 'statementSuggest' } }],
    ['finance-reports', { action: 'list' }],
  ])('a read (%s %j) keeps cached pages', async (endpoint, input) => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({})));
    await primeJournal();
    await callFinanceApi(endpoint, input);
    expect(peekCached('journal_entries')).toBeTruthy();
  });

  it.each([
    ['finance-workbench', { kind: 'founding', request: { action: 'postEntries' } }],
    ['finance-workbench', { kind: 'founding', request: { action: 'proposeTransfer' } }],
    ['finance-workbench', { action: 'post', kind: 'variable', sourceId: 'x' }],
    ['finance-workbench', { action: 'approve', kind: 'variable', sourceId: 'x' }],
    ['finance-reports', { action: 'save' }],
  ])('a write (%s %j) drops cached reads so the trial balance re-reads the journal', async (endpoint, input) => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ posted: 1 })));
    await primeJournal();
    await callFinanceApi(endpoint, input);
    expect(peekCached('journal_entries')).toBeNull();
  });

  it('drops cached reads after a write that failed or was cut off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await primeJournal();
    await expect(callFinanceApi('finance-workbench', { kind: 'founding', request: { action: 'postEntries' } })).rejects.toThrow('network');
    expect(peekCached('journal_entries')).toBeNull();
  });
});
