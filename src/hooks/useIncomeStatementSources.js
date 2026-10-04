import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { useAuth } from './useAuth';
import { usePartnerView } from '../contexts/PartnerViewContext';

const COLLECTIONS = { washes: 'washes', variables: 'variable_expenses', monthlies: 'monthly_expenses',
  annualEntries: 'annual_expense_entries', vouchers: 'expense_vouchers', bookings: 'sweater_bookings',
  settlements: 'sweater_settlements', journalEntries: 'journal_entries', legacyLines: 'journal_lines' };
const empty = () => Object.fromEntries(Object.keys(COLLECTIONS).map(key => [key, []]));

export function useIncomeStatementSources() {
  const { user } = useAuth(); const { role } = usePartnerView();
  const identity = user?.id || null;
  const enabled = isFirebaseConfigured && Boolean(identity) && role !== 'supervisor';
  const [epoch, setEpoch] = useState(0);
  const requestKey = JSON.stringify([identity, epoch]);
  const [state, setState] = useState({ key: null, sources: empty(), pending: [], error: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const current = previous => previous.key === requestKey ? previous
      : { key: requestKey, sources: empty(), pending: Object.keys(COLLECTIONS), error: null };
    const subscriptions = Object.entries(COLLECTIONS).map(([name, coll]) => onSnapshot(collection(db, coll), snapshot => {
      if (!alive) return;
      const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setState(value => { const previous = current(value); return { ...previous, sources: { ...previous.sources, [name]: rows }, pending: previous.pending.filter(key => key !== name) }; });
    }, error => {
      if (alive) setState(value => { const previous = current(value); return { ...previous, error, pending: previous.pending.filter(key => key !== name) }; });
    }));
    return () => { alive = false; subscriptions.forEach(unsubscribe => unsubscribe()); };
  }, [enabled, requestKey]);
  const current = enabled && state.key === requestKey ? state : { sources: empty(), pending: enabled ? Object.keys(COLLECTIONS) : [], error: null };
  const entries = current.sources.journalEntries;
  const lines = entries.flatMap(entry => (entry.lines || []).map((line, i) => ({ ...line, entryId: entry.id, id: `${entry.id}:${i}` })))
    .concat(current.sources.legacyLines);
  return { sources: current.sources, entries, lines, loading: current.pending.length > 0, error: current.error, refetch: () => setEpoch(value => value + 1) };
}
