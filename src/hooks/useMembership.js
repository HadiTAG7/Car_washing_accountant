import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../lib/firebaseClient';
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

  const row = Array.isArray(data) ? data[0] : null;
  return {
    loading: applicable && loading,
    // A read error is a connectivity or configuration problem, NOT the
    // membership gap — the two need opposite fixes, so a failure never
    // accuses the account of being unregistered.
    isMember: !applicable || Boolean(error) || Boolean(row?.role),
    role: row?.role ?? null,
    error,
    recheck: refetch,
  };
}
