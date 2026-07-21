// ─── Firestore CRUD helpers ──────────────────────────────────────────────
// Thin wrappers so the data hooks stay declarative and never touch the raw
// SDK. Rows come back shaped like the old Supabase rows — { id, ...fields }
// with the id injected from the document key — so mappers.js is unchanged.
//
// Re-exports the query constraint builders (where/orderBy/limit) so hooks
// import everything Firestore from one place.

import {
  collection, doc, getDoc, getDocs, query,
  addDoc, setDoc, updateDoc as fbUpdateDoc, deleteDoc as fbDeleteDoc,
  where, orderBy, limit, writeBatch,
} from 'firebase/firestore';
import { db } from './firebaseClient';

export { where, orderBy, limit };

/**
 * Client-side multi-key sort — reproduces Supabase's `.order()` chains
 * WITHOUT needing Firestore composite indexes (our collections are tiny).
 * specs: [{ key, dir: 'asc'|'desc' }]. Nulls/undefined always sort last.
 * Numeric strings compare numerically; everything else via localeCompare.
 */
export function sortBy(rows, specs) {
  const arr = [...rows];
  arr.sort((a, b) => {
    for (const { key, dir = 'asc' } of specs) {
      const av = a[key]; const bv = b[key];
      const an = av == null || av === ''; const bn = bv == null || bv === '';
      if (an && bn) continue;
      if (an) return 1;   // nulls last regardless of dir
      if (bn) return -1;
      let c;
      if (typeof av === 'number' && typeof bv === 'number') c = av - bv;
      else c = String(av).localeCompare(String(bv), undefined, { numeric: true });
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
  return arr;
}

// Firestore doc → row object. The document key is authoritative for `id`
// (imported docs also carry an `id` field equal to their key; new docs
// don't, so injecting here keeps both consistent).
function toRow(d) {
  return { id: d.id, ...d.data() };
}

/** Fetch every doc in a collection matching the given constraints. */
export async function fetchRows(path, constraints = []) {
  const snap = await getDocs(query(collection(db, path), ...constraints));
  return snap.docs.map(toRow);
}

/** Fetch a single doc by id, or null if missing. */
export async function getRow(path, id) {
  const snap = await getDoc(doc(db, path, id));
  return snap.exists() ? toRow(snap) : null;
}

/**
 * Insert a document. If `data.id` is present it becomes the document key
 * (used by `categories`, whose ids are app-generated slugs/UUIDs); the id
 * is not duplicated into the body. Otherwise Firestore assigns the key.
 * `created_at` is stamped (ISO string) when absent so date-sorted lists
 * order correctly — Supabase set this via a column default.
 */
export async function insertRow(path, data) {
  const { id, ...body } = data;
  if (body.created_at === undefined) body.created_at = new Date().toISOString();
  if (id != null && id !== '') {
    await setDoc(doc(db, path, String(id)), body);
    return String(id);
  }
  const ref = await addDoc(collection(db, path), body);
  return ref.id;
}

/** Patch a document by id. */
export async function updateRow(path, id, patch) {
  await fbUpdateDoc(doc(db, path, id), patch);
}

/** Delete a document by id. */
export async function deleteRow(path, id) {
  await fbDeleteDoc(doc(db, path, id));
}

/**
 * Run a set of writes atomically (Firestore batched write). Each op is
 * { type: 'set'|'update'|'delete', path, id, data? }. Used to keep the
 * partners.paid_amount aggregate in lock-step with partner_payments —
 * the invariant the Supabase trigger used to enforce server-side.
 */
export async function runBatch(ops) {
  const batch = writeBatch(db);
  for (const op of ops) {
    const ref = doc(db, op.path, op.id);
    if (op.type === 'set')         batch.set(ref, op.data);
    else if (op.type === 'update') batch.update(ref, op.data);
    else if (op.type === 'delete') batch.delete(ref);
  }
  await batch.commit();
}
