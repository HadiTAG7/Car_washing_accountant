import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, getDocs, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import {
  assembleCommandCenterSnapshot,
  COMMAND_CENTER_ROLES,
} from '../lib/agentCommandCenter';

export async function loadAgentCaseHistory(caseId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(caseId)) throw new Error('Invalid case ID');
  const rows = await getDocs(query(collection(db, 'agent_command_activity'), where('caseId', '==', caseId)));
  return rows.docs.map((row) => ({ ...row.data(), id: row.id }));
}

export function commandCenterSubscriptions(database) {
  const ref = (name) => collection(database, `agent_command_${name}`);
  return {
    agents: ref('agents'),
    reports: query(ref('reports'), orderBy('reportedAt', 'desc'), limit(80)),
    // Pending decisions cannot disappear behind a global history limit.
    approvals: query(ref('approvals'), where('status', '==', 'pending')),
    alerts: query(ref('alerts'), where('active', '==', true)),
    tasks: ref('tasks'),
    sources: ref('sources'),
    activity: query(ref('activity'), orderBy('occurredAt', 'desc'), limit(100)),
  };
}

export function useAgentCommandCenter(role) {
  const allowed = COMMAND_CENTER_ROLES.includes(role);
  const enabled = Boolean(isFirebaseConfigured && allowed);
  const [state, setState] = useState({ raw: {}, loading: enabled, error: null });
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setRevision((current) => current + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const raw = {};
    const queries = commandCenterSubscriptions(db);
    const received = new Set();
    let failed = null;
    const unsubscribers = Object.entries(queries).map(([name, request]) => onSnapshot(request, (result) => {
      if (!alive) return;
      raw[name] = result.docs.map((row) => ({ ...row.data(), id: row.id }));
      received.add(name);
      setState({ raw: { ...raw }, loading: received.size < Object.keys(queries).length && !failed, error: failed });
    }, (error) => {
      if (!alive) return;
      failed = error;
      setState({ raw: { ...raw }, loading: false, error });
    }));
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      window.clearInterval(timer);
    };
  }, [enabled, revision]);
  const snapshot = useMemo(() => assembleCommandCenterSnapshot(enabled ? state.raw : {}, { now }), [enabled, state.raw, now]);
  return { ...snapshot, allowed, loading: enabled && state.loading, error: enabled ? state.error : null, refresh };
}
