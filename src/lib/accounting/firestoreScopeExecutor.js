// The browser side of `loadScopedIncomeSources`: each primitive is one
// single-field Firestore query (automatic indexes only). Reads are charged
// per document returned, a `count()` one read per 1,000 matches.
import {
  collection, query, where, getDocs, getCountFromServer, documentId, limit, orderBy,
} from 'firebase/firestore';
import { db } from '../firebaseClient';

const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
const ref = name => collection(db, name);

export const firestoreScopeExecutor = {
  all: async name => rows(await getDocs(ref(name))),
  range: async (name, field, from, toExclusive) => rows(await getDocs(query(ref(name), where(field, '>=', from), where(field, '<', toExclusive)))),
  equals: async (name, field, value) => rows(await getDocs(query(ref(name), where(field, '==', value)))),
  notNull: async (name, field) => rows(await getDocs(query(ref(name), where(field, '!=', null)))),
  inValues: async (name, field, values) => rows(await getDocs(query(ref(name), where(field, 'in', values)))),
  byIds: async (name, ids) => rows(await getDocs(query(ref(name), where(documentId(), 'in', ids)))),
  count: async (name, field, values) => (await getCountFromServer(query(ref(name), where(field, 'in', values)))).data().count,
  probe: async name => !(await getDocs(query(ref(name), limit(1)))).empty,
  /** The first or last string value of a field (one read) — a month list's bounds. */
  edge: async (name, field, dir) => {
    const snap = await getDocs(query(ref(name), where(field, '>=', '0000'), orderBy(field, dir), limit(1)));
    return snap.empty ? null : snap.docs[0].get(field);
  },
};
