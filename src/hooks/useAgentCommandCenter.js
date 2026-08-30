import { useMemo } from 'react';
import {
  collection, getDocs, limit, orderBy, query,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import {
  assembleCommandCenterSnapshot,
  COMMAND_CENTER_ROLES,
  EMPTY_COMMAND_CENTER_SNAPSHOT,
} from '../lib/agentCommandCenter';

const COLLECTIONS = Object.freeze({
  agents: 'agent_command_agents',
  reports: 'agent_command_reports',
  alerts: 'agent_command_alerts',
  approvals: 'agent_command_approvals',
  sources: 'agent_command_sources',
  activity: 'agent_command_activity',
});

function rowsOf(snapshot) {
  return snapshot.docs.map((row) => ({ id: row.id, ...row.data() }));
}

async function readCommandCenter() {
  const [agents, reports, alerts, approvals, sources, activity] = await Promise.all([
    getDocs(collection(db, COLLECTIONS.agents)),
    getDocs(query(collection(db, COLLECTIONS.reports), orderBy('reportedAt', 'desc'), limit(40))),
    getDocs(query(collection(db, COLLECTIONS.alerts), orderBy('createdAt', 'desc'), limit(40))),
    getDocs(query(collection(db, COLLECTIONS.approvals), orderBy('createdAt', 'desc'), limit(40))),
    getDocs(collection(db, COLLECTIONS.sources)),
    getDocs(query(collection(db, COLLECTIONS.activity), orderBy('occurredAt', 'desc'), limit(50))),
  ]);
  return [{
    agents: rowsOf(agents),
    reports: rowsOf(reports),
    alerts: rowsOf(alerts),
    approvals: rowsOf(approvals),
    sources: rowsOf(sources),
    activity: rowsOf(activity),
  }];
}

export function useAgentCommandCenter(role) {
  const allowed = COMMAND_CENTER_ROLES.includes(role);
  const queryState = useFirestoreQuery(readCommandCenter, {
    enabled: Boolean(isFirebaseConfigured && allowed),
    deps: [role],
    fallback: [],
  });
  const raw = queryState.data?.[0];
  const snapshot = useMemo(
    () => (raw ? assembleCommandCenterSnapshot(raw) : EMPTY_COMMAND_CENTER_SNAPSHOT),
    [raw],
  );

  return {
    ...snapshot,
    allowed,
    loading: queryState.loading,
    error: queryState.error,
    refresh: queryState.refetch,
  };
}
