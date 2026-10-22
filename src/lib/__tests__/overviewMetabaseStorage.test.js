import { expect, it } from 'vitest';
import { readOverviewMetabase, saveOverviewMetabase } from '../overviewMetabaseStorage';
import { OVERVIEW_SETTINGS } from '../../config/overviewSettings';
const store = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
it('persists valid numbers per month and preserves explicit zero', () => {
  const storage = store();
  saveOverviewMetabase('2026-10', '٣٨٢', storage); saveOverviewMetabase('2026-09', '0', storage);
  expect(readOverviewMetabase('2026-10', storage)).toEqual({ value: '382', storageError: false });
  expect(readOverviewMetabase('2026-09', storage).value).toBe('0');
  expect(readOverviewMetabase('2026-08', storage).value).toBe('');
});
it('clears one month only and never overwrites a valid count with an invalid edit', () => {
  const storage = store();
  saveOverviewMetabase('2026-10', '382', storage); saveOverviewMetabase('2026-09', '25', storage);
  saveOverviewMetabase('2026-10', '-1', storage); expect(readOverviewMetabase('2026-10', storage).value).toBe('382');
  saveOverviewMetabase('2026-10', '', storage); expect(readOverviewMetabase('2026-10', storage).value).toBe('');
  expect(readOverviewMetabase('2026-09', storage).value).toBe('25');
});
it('ignores corrupt persisted input and rejects invalid month keys', () => {
  const storage = store(); storage.values.set(`${OVERVIEW_SETTINGS.metabaseStoragePrefix}2026-10`, 'null');
  expect(readOverviewMetabase('2026-10', storage).value).toBe('');
  expect(saveOverviewMetabase('2026-99', '10', storage).storageError).toBe(true);
});
it('reports unavailable storage or quota errors without crashing or claiming persistence', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  expect(readOverviewMetabase('2026-10', storage)).toEqual({ value: '', storageError: true });
  expect(saveOverviewMetabase('2026-10', '382', storage)).toEqual({ value: '382', storageError: true });
  expect(saveOverviewMetabase('2026-10', '', storage).storageError).toBe(true);
});
