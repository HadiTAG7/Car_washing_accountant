import { useCallback, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebaseClient';

const DEMO_SESSION = { user: { email: 'demo@sweater.app', id: 'demo-user' } };

// Firebase exposes a User (or null), not a Supabase-style session object.
// We wrap it in a `{ user: { id, email } }` shape so every consumer
// (App, TopBar, PartnerViewContext) keeps reading `session.user.id` /
// `.email` exactly as before.
function toSession(fbUser) {
  if (!fbUser) return null;
  return { user: { id: fbUser.uid, email: fbUser.email } };
}

export function useAuth() {
  const [session, setSession] = useState(() =>
    isFirebaseConfigured ? null : DEMO_SESSION,
  );
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined;
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setSession(toSession(fbUser));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Return a Supabase-shaped { data, error } so LoginScreen's
  // `const { error } = await signIn(...)` keeps working; Firebase throws
  // on failure, so we catch and normalize.
  const signIn = useCallback(async (email, password) => {
    if (!isFirebaseConfigured) return { data: null, error: { message: 'Firebase is not configured.' } };
    try {
      const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
      return { data: cred, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isFirebaseConfigured) return;
    await fbSignOut(auth);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signOut,
  };
}
