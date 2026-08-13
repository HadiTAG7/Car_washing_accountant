import { useCallback, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';

/**
 * هل هذا الحساب معروف للنظام أصلاً؟
 *
 * Signing in is not membership. The rules read it from a DOCUMENT —
 * `isMember() = exists(users/<uid>) || exists(app_admins/<uid>)` — and an
 * account created straight in the Auth console has neither. Every read is
 * then refused with «Missing or insufficient permissions» while the sidebar,
 * which never consults a role, still renders every admin page. The user sees
 * «I am logged in as the admin and the app says I have no permissions», which
 * names neither the cause nor the cure.
 *
 * So the app asks the question directly. A signed-in user may always read
 * their OWN `users/<uid>` document (`allow get: if request.auth.uid == uid`),
 * and a missing document comes back as `exists() === false` rather than an
 * error — so this tells "not a member" apart from "something else is broken"
 * without needing any extra permission.
 *
 * `role` is what the RULES will apply, not what the UI assumes.
 */
export function useMembership(userId) {
  // Demo mode and the signed-out moment are not «not a member» — there is no
  // question to ask, so nothing is asked and nothing is claimed.
  const applicable = Boolean(isFirebaseConfigured && userId);

  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => {
      const snap = await getDoc(doc(db, 'users', userId));
      return [{ role: snap.exists() ? (snap.data().role || 'operator') : null }];
    },
    { enabled: applicable, deps: [userId], fallback: [{ role: null }] },
  );

  // ── هل ما زال النظام بلا مالك؟ ──
  // Asked only when the account turns out NOT to be a member, and answered by
  // the server — a client cannot list `users` (that needs `isAdmin()`), so
  // «is this installation unclaimed» is a question only the server can settle.
  // Asked before the button is offered, so the app never shows an action that
  // will fail.
  const row = Array.isArray(data) ? data[0] : null;
  const missing = applicable && !loading && !error && !row?.role;

  const { data: statusData } = useFirestoreQuery(
    async () => [await callServer('authBootstrapStatus', {})],
    { enabled: missing, deps: [missing], fallback: [{ unclaimed: false }] },
  );
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);

  const claimFirstAdmin = useCallback(async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      await callServer('authClaimFirstAdmin', {});
      await refetch();
      return true;
    } catch (e) {
      setClaimError(e);
      return false;
    } finally {
      setClaiming(false);
    }
  }, [refetch]);

  return {
    loading: applicable && loading,
    // True only while NOBODY owns this installation. Once anyone does, the
    // server refuses and the button is not offered.
    unclaimed: Boolean(statusData?.[0]?.unclaimed),
    claiming,
    claimError,
    claimFirstAdmin,
    // A read error is a connectivity or configuration problem, NOT the
    // membership gap — the two need opposite fixes, so a failure never
    // accuses the account of being unregistered.
    isMember: !applicable || Boolean(error) || Boolean(row?.role),
    role: row?.role ?? null,
    error,
    recheck: refetch,
  };
}
