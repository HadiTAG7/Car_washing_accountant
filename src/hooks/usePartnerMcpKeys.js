import { useCallback, useMemo } from 'react';
import { isFirebaseConfigured } from '../lib/firebaseClient';
import { fetchRows, sortBy, where } from '../lib/firestoreCrud';
import { callServer } from '../lib/ledgerTransport';
import { useFirestoreQuery } from './useFirestoreQuery';
import { useAuth } from './useAuth';

/**
 * روابط المساعد الذكي — للعرض والإنشاء والإلغاء، بلا سرّ.
 *
 * القراءة من `partner_mcp_keys` مباشرةً: القواعد تُعطي صاحب المفتاح مفاتيحه
 * والمدير الكل، وليس في المستند إلا معرّفٌ وحالةٌ وتواريخ. والكتابة عبر
 * الخادم وحده (`partnerMcpCreateKey` / `partnerMcpRevokeKey`)، فالرمز يُولَّد
 * هناك ويعود مرةً واحدة من `createKey` ولا يُخزَّن هنا في أي حال.
 *
 *   scope 'mine' — مفاتيح الحساب الحالي (الشريك عن نفسه).
 *   scope 'all'  — الكل (المدير)، وتُرشَّح بعدها بالشريك في الصفحة.
 */
export function usePartnerMcpKeys({ scope = 'mine', enabled = true } = {}) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const on = enabled && isFirebaseConfigured && (scope === 'all' || Boolean(uid));

  const { data, loading, error, refetch } = useFirestoreQuery(
    async () => sortBy(
      await fetchRows('partner_mcp_keys', scope === 'all' ? [] : [where('ownerUid', '==', uid)]),
      [{ key: 'createdAtIso', dir: 'desc' }],
    ),
    { enabled: on, fallback: [], deps: [scope, uid] },
  );

  const keys = useMemo(() => data ?? [], [data]);

  const createKey = useCallback(async (label = null) => {
    // الرمز يعود هنا مرةً واحدة — يُعرض فوراً ولا يُحفظ.
    const r = await callServer('partnerMcpCreateKey', { label });
    await refetch();
    return r;
  }, [refetch]);

  const revokeKey = useCallback(async (keyId, reason = null) => {
    const r = await callServer('partnerMcpRevokeKey', { keyId, reason });
    await refetch();
    return r;
  }, [refetch]);

  return { keys, loading, error, refetch, createKey, revokeKey };
}

/** المفتاح الفعّال لشريكٍ بعينه من قائمة — أو `null`. */
export function activeKeyFor(keys, partnerId) {
  return (keys || []).find((k) => k.status === 'active' && String(k.partnerId) === String(partnerId)) ?? null;
}
