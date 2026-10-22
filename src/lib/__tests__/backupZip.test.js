import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dataSource: 'firebase' }));
vi.mock('../firebaseClient', () => ({
  get dataSource() { return state.dataSource; },
  auth: { currentUser: { getIdToken: async () => 'isolated-test-token' } },
}));
vi.mock('../firestoreCrud', () => ({ fetchRows: async () => [] }));
import { buildFullBackup } from '../backupZip';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['firebase', 'supabase'])('names %s backups by the Riyadh day, retaining UTC audit timestamps', async source => {
  state.dataSource = source;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T21:00:00Z'));
  // No service is contacted and no financial record is created.
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ result: { collections: [] } }) }));
  vi.stubGlobal('fetch', fetchMock);
  const result = await buildFullBackup();
  expect(result.filename).toBe('سويتر-نسخة-احتياطية-2026-10-23.zip');
  expect(new TextDecoder().decode(await result.blob.arrayBuffer())).toContain('2026-10-22T21:00:00.000Z');
  if (source === 'supabase') expect(fetchMock).toHaveBeenCalledTimes(1);
  else expect(fetchMock).not.toHaveBeenCalled();
});
