import { isFirebaseConfigured, callPartnerProfile } from '../lib/firebaseClient';
import { useFirestoreQuery } from './useFirestoreQuery';
import { useAuth } from './useAuth';

/**
 * صفّ الشريك المربوط بهذا الحساب — من الخادم لا من `partners`.
 *
 * القواعد لا تسمح للشريك بقراءة `partners` (كل الصفوف بجوالاتها وعمالتها)،
 * فالخادم يحلّ الربط من الحساب ويُرجع الصفّ مقصوصاً. حسابٌ غير مربوط يُرجع
 * `failed-precondition`، وهو جوابٌ لا عطل: «لم يُربط حسابك بعد».
 */
export function usePartnerProfile({ enabled = true } = {}) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => {
      try {
        return await callPartnerProfile();
      } catch (e) {
        if (e?.code === 'failed-precondition') return { unlinked: true, message: e.message };
        throw e;
      }
    },
    {
      enabled: enabled && isFirebaseConfigured && !authLoading && Boolean(userId),
      queryKey: `partnerProfile:${userId || ''}:${enabled}`,
      fallback: null,
      preserveResult: true,
    },
  );
  const linked = data && !data.unlinked && data.id ? data : null;
  return {
    partner: linked,
    unlinked: Boolean(data?.unlinked),
    loading: Boolean(enabled && isFirebaseConfigured && authLoading) || loading,
    error,
    refetch,
  };
}
