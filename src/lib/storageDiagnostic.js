// Fixed, non-identifying markers. This module never imports Firebase or sends requests.
export const DIAGNOSTIC_KEY = 'sweater:storage-diagnostic:v1';
export const DIAGNOSTIC_DB = 'sweater-storage-diagnostic-v1';
const MARKER = `${DIAGNOSTIC_KEY}:marker`;
const HISTORY = `${DIAGNOSTIC_KEY}:history`;
const TEST = `${DIAGNOSTIC_KEY}:support`;
const LIMIT = 20;
const markerState = value => value == null ? 'absent' : value === 'present' ? 'present' : 'unexpected';
const unavailable = () => ({ readable: false, writable: false, marker: 'unavailable' });
const safeRows = value => {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row?.version === 1 && typeof row.readAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.readAt) && Number.isFinite(Date.parse(row.readAt))
    && ['localStorage', 'indexedDB'].every(name => row[name] && typeof row[name].readable === 'boolean'
      && typeof row[name].writable === 'boolean' && ['present', 'absent', 'unexpected', 'unavailable'].includes(row[name].marker)))
    .map(row => ({ version: 1, readAt: row.readAt,
      localStorage: { readable: row.localStorage.readable, writable: row.localStorage.writable, marker: row.localStorage.marker },
      indexedDB: { readable: row.indexedDB.readable, writable: row.indexedDB.writable, marker: row.indexedDB.marker } })).slice(-LIMIT);
};
const merge = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
  .sort((a,b) => a.readAt.localeCompare(b.readAt)).slice(-LIMIT);

function localRead(realm) {
  try {
    const storage = realm.localStorage;
    const marker = markerState(storage.getItem(MARKER));
    let history = []; try { history = safeRows(JSON.parse(storage.getItem(HISTORY) || '[]')); } catch { /* owned history only */ }
    let writable = false;
    try { storage.setItem(TEST, 'supported'); storage.removeItem(TEST); writable = true; } catch { /* read-only storage */ }
    return { state: { readable: true, writable, marker }, history };
  } catch { return { state: unavailable(), history: [] }; }
}
function openProbe(realm) {
  return new Promise((resolve, reject) => {
    let request; let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error('diagnostic-storage-timeout')); }, 2000);
    const fail = () => { if (!finished) { finished = true; clearTimeout(timer); reject(new Error('diagnostic-storage-unavailable')); } };
    try { request = realm.indexedDB.open(DIAGNOSTIC_DB, 1); } catch { fail(); return; }
    request.onerror = fail; request.onblocked = fail;
    request.onupgradeneeded = () => { if (finished) { request.transaction.abort(); return; } request.result.createObjectStore('probe'); };
    request.onsuccess = () => { if (finished) { request.result.close(); return; } finished = true; clearTimeout(timer);
      request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('probe', mode); let result;
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(new Error('diagnostic-transaction-failed'));
    action(tx.objectStore('probe'), value => { result = value; });
  });
}
async function idbRead(realm) {
  let db;
  try {
    db = await openProbe(realm);
    const row = await transaction(db, 'readonly', (store, done) => {
      const a = store.get(MARKER); const b = store.get(HISTORY); let marker; let history; let count = 0;
      const complete = () => { if (++count === 2) done({ marker, history }); };
      a.onsuccess = () => { marker = a.result; complete(); }; b.onsuccess = () => { history = b.result; complete(); };
    });
    let writable = false;
    try { await transaction(db, 'readwrite', store => { store.put('supported', TEST); store.delete(TEST); }); writable = true; } catch { /* read-only database */ }
    return { state: { readable: true, writable, marker: markerState(row.marker) }, history: safeRows(row.history) };
  } catch { return { state: unavailable(), history: [] }; }
  finally { db?.close(); }
}
export async function inspectStorage(realm = window) {
  const local = localRead(realm); const idb = await idbRead(realm);
  return { current: { version: 1, readAt: new Date().toISOString(), localStorage: local.state, indexedDB: idb.state },
    history: merge([...local.history, ...idb.history]) };
}
export async function seedStorage(realm = window) {
  const inspection = await inspectStorage(realm);
  const history = merge([...inspection.history, inspection.current]);
  const savedTo = [];
  try { realm.localStorage.setItem(HISTORY, JSON.stringify(history)); savedTo.push('localStorage'); } catch { /* try independent store */ }
  let db;
  try { db = await openProbe(realm); await transaction(db, 'readwrite', store => store.put(history, HISTORY)); savedTo.push('indexedDB'); }
  catch { /* do not seed unless evidence committed somewhere */ }
  finally { db?.close(); }
  if (!savedTo.length) return { ...inspection, history, savedTo, seeded: { localStorage: false, indexedDB: false }, evidenceSaved: false };
  const seeded = { localStorage: false, indexedDB: false };
  // Both evidence writes have completed before either marker can change.
  try { realm.localStorage.setItem(MARKER, 'present'); seeded.localStorage = true; } catch { /* unsupported store */ }
  try { db = await openProbe(realm); await transaction(db, 'readwrite', store => store.put('present', MARKER)); seeded.indexedDB = true; }
  catch { /* unsupported store */ }
  finally { db?.close(); }
  return { ...inspection, history, savedTo, seeded, evidenceSaved: true };
}
