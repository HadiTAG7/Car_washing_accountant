import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const DEMO_SESSION = { user: { email: 'demo@monster.wash', id: 'demo-user' } };

export function useAuth() {
  const [session, setSession] = useState(() =>
    isSupabaseConfigured ? null : DEMO_SESSION,
  );
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    const sub = data?.subscription;
    return () => { sub?.unsubscribe(); };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) return { data: null, error: { message: 'Supabase is not configured.' } };
    return supabase.auth.signInWithPassword({ email, password });
  }, []);

  const signUp = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) return { data: null, error: { message: 'Supabase is not configured.' } };
    return supabase.auth.signUp({ email, password });
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signUp,
    signOut,
  };
}
