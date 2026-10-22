import { OVERVIEW_SETTINGS } from '../config/overviewSettings.js';
import { parseMetabaseCount } from './overviewInsights.js';

const monthKey = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))
  ? `${OVERVIEW_SETTINGS.metabaseStoragePrefix}${month}` : null;

// Local to this browser origin; no SDK, database write or cross-device sync.
// Read lazily and write on the user's edit, never an effect that can overwrite
// another month's value while a filter changes.
export function readOverviewMetabase(month, storage) {
  try {
    const key = monthKey(month);
    if (!key) return { value: '', storageError: true };
    const saved = (storage ?? globalThis.localStorage).getItem(key);
    const count = parseMetabaseCount(saved);
    return { value: saved === null || count === null ? '' : String(count), storageError: false };
  } catch { return { value: '', storageError: true }; }
}

export function saveOverviewMetabase(month, value, storage) {
  const result = { value, storageError: false };
  const count = parseMetabaseCount(value);
  // Keep the previous valid saved value when the current edit is invalid.
  if (String(value).trim() !== '' && count === null) return result;
  try {
    const key = monthKey(month);
    if (!key) return { ...result, storageError: true };
    const target = storage ?? globalThis.localStorage;
    if (String(value).trim() === '') target.removeItem(key);
    else target.setItem(key, String(count));
    return result;
  } catch { return { ...result, storageError: true }; }
}
