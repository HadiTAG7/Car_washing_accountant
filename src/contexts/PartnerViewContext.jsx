import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePartners } from '../hooks/usePartners';

/**
 * PartnerViewContext — single source of truth for the Pro-Rata Partner
 * Portal overlay. Decides who's looking (admin vs partner), computes the
 * pro-rata scaling factor that every financial page multiplies its
 * aggregates by, and exposes a `canMutate` flag that all "+ إضافة" /
 * row-action / status-toggle controls guard against.
 *
 * ── إشارتان لا واحدة ──
 * الدور (`users/{uid}.role`) يجيب «هل هذا الحساب مستثمر؟»، وصفُّ الشريك
 * المربوط بـ `userId` يجيب «أيُّ مستثمر، وما حصّته؟». كان هذا الملف يسأل
 * الثاني وحده، فحسابٌ دوره `partner` بلا صفٍّ مربوط كان يُعامَل معاملة
 * المدير كاملةً — والقواعد وحدها تردّ كتاباته برسالة صلاحيات عامة.
 *
 * والآن الدور يقرّر **هل** والصفُّ يقرّر **أيّ**، والنقص يفشل مغلقاً: مستثمر
 * بلا ربط ليس مديراً، بل حسابٌ مسدود لا يقرأ ولا يكتب حتى تربطه الإدارة.
 *
 * Contract:
 *   isAdmin            true when the account is not an investor AND is
 *                      not linked to any partner row.
 *   isInvestorAccount  the role says `partner`.
 *   investorLinkMissing an investor whose `partners` row is unlinked —
 *                      the fail-closed state.
 *   myPartner          the partner row owned by the current user, or
 *                      null when admin.
 *   viewedPartner      myPartner when partner-logged-in; the admin's
 *                      `actingAsPartnerId` selection when an admin is
 *                      simulating; null otherwise.
 *   isPartnerView      true when viewedPartner !== null (partner OR
 *                      simulating admin).
 *   scalingFactor      viewedPartner.workersCount / totalWorkers when
 *                      isPartnerView, else 1. Guarded against
 *                      totalWorkers=0.
 *   canMutate          isAdmin && !actingAsPartnerId. Simulating
 *                      admins drop write access so the simulation
 *                      faithfully reproduces a partner's read-only UX.
 *   actingAsPartnerId  admin override; persisted in localStorage so
 *                      a reload doesn't unintentionally drop the view.
 *   totalWorkers       fleet-wide headcount, used by the banner to
 *                      render the partner's percentage share.
 */

const DEFAULT_VALUE = {
  isAdmin:            true,
  isInvestorAccount:  false,
  investorLinkMissing: false,
  role:               null,
  myPartner:          null,
  viewedPartner:      null,
  actingAsPartnerId:  null,
  setActingAsPartnerId: () => {},
  scalingFactor:      1,
  isPartnerView:      false,
  canMutate:          true,
  totalWorkers:       0,
};
const PartnerViewContext = createContext(DEFAULT_VALUE);

const STORAGE_KEY = 'sweater:actingAsPartnerId';

export function PartnerViewProvider({ children, role = null }) {
  const { user } = useAuth();
  const { partners } = usePartners();

  // Admin's "simulate as X" pick survives reload via localStorage.
  // SSR-safe access guard mirrors useDarkMode's pattern.
  const [actingAsPartnerId, setActingAsPartnerIdState] = useState(() => {
    if (typeof window === 'undefined') return null;
    try { return window.localStorage.getItem(STORAGE_KEY) || null; }
    catch { return null; }
  });
  const setActingAsPartnerId = useCallback((id) => {
    setActingAsPartnerIdState(id || null);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (actingAsPartnerId) window.localStorage.setItem(STORAGE_KEY, actingAsPartnerId);
      else                   window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode etc. — silently drop */ }
  }, [actingAsPartnerId]);

  // Find the partner row owned by the current user.
  const myPartner = useMemo(() => {
    if (!user?.id) return null;
    return partners.find((p) => p.userId && p.userId === user.id) || null;
  }, [partners, user]);

  const isInvestorAccount = role === 'partner';
  // الحالة التي كانت تُسلّم الواجهة كاملةً: دورٌ مستثمر بلا صفٍّ مربوط.
  const investorLinkMissing = isInvestorAccount && !myPartner;
  const isAdmin = !isInvestorAccount && !myPartner;

  // Admin override wins for admins; partners always see themselves.
  // If the simulated id no longer matches a row (admin deleted that
  // partner mid-session), viewedPartner falls back to null naturally:
  // banner disappears, scalingFactor returns to 1, dropdown shows
  // its placeholder. The orphan localStorage id is harmless until the
  // admin makes their next selection, which overwrites it.
  const viewedPartner = useMemo(() => {
    if (isAdmin && actingAsPartnerId) {
      return partners.find((p) => p.id === actingAsPartnerId) || null;
    }
    return myPartner;
  }, [isAdmin, actingAsPartnerId, myPartner, partners]);

  const totalWorkers = useMemo(
    () => partners.reduce((s, p) => s + (p.workersCount || 0), 0),
    [partners],
  );

  // بلا ربط لا نعرف الحصّة، والواحد الصحيح يعني «أرقام الشركة كاملة» — وهو
  // آخر ما يُعرض على حسابٍ لم نتحقّق من هويته بعد. الصفر يفشل مغلقاً.
  const scalingFactor = investorLinkMissing
    ? 0
    : (viewedPartner && totalWorkers > 0
      ? (viewedPartner.workersCount || 0) / totalWorkers
      : 1);

  // المستثمر المسدود في عرض الشريك أيضاً: كل قمع مشروط بـ `isPartnerView`
  // يجب أن ينطبق عليه، لا أن يُفلته النقصُ إلى المسار الإداري.
  const isPartnerView = viewedPartner !== null || investorLinkMissing;
  const canMutate     = isAdmin && actingAsPartnerId === null;

  const value = useMemo(() => ({
    isAdmin,
    isInvestorAccount,
    investorLinkMissing,
    role,
    myPartner,
    viewedPartner,
    actingAsPartnerId,
    setActingAsPartnerId,
    scalingFactor,
    isPartnerView,
    canMutate,
    totalWorkers,
  }), [
    isAdmin, isInvestorAccount, investorLinkMissing, role,
    myPartner, viewedPartner, actingAsPartnerId, setActingAsPartnerId,
    scalingFactor, isPartnerView, canMutate, totalWorkers,
  ]);

  return (
    <PartnerViewContext.Provider value={value}>
      {children}
    </PartnerViewContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePartnerView() {
  return useContext(PartnerViewContext);
}
