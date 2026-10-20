import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePartners } from '../hooks/usePartners';
import { usePartnerProfile } from '../hooks/usePartnerProfile';

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
 *   investorLinkMissing a successful read confirmed no linked row.
 *   partnerLinkLoading  still resolving the signed-in account's link.
 *   partnerLinkError    a failed read, not evidence that the link is absent.
 *   myPartner          the partner row owned by the current user, or
 *                      null when admin.
 *   viewedPartner      myPartner when partner-logged-in; the admin's
 *                      `actingAsPartnerId` selection when an admin is
 *                      simulating; null otherwise.
 *   isPartnerView      true when viewedPartner !== null (partner OR
 *                      simulating admin).
 *   scalingFactor      viewedPartner.workersCount / totalWorkers when
 *                      staff view a partner, else 1. Guarded against
 *                      totalWorkers=0. Always 0 on an investor account:
 *                      its share is a server figure it never receives.
 *   canMutate          isAdmin && not simulating. Simulating admins drop
 *                      write access so the simulation faithfully
 *                      reproduces a partner's read-only UX.
 *   actingAsPartnerId  admin override; persisted in localStorage so
 *                      a reload doesn't unintentionally drop the view.
 *                      Honoured for role `admin` only — the server
 *                      refuses anyone else naming a partner.
 *
 * ── مَن يقرأ `partners` ──
 * الموظفون وحدهم (المدير والمحاسب والمشغّل)، وبعد معرفة الدور لا قبلها.
 * حساب الشريك لا يقرأ المجموعة أصلاً — القواعد ترفضه — وصفّه يأتيه من
 * الخادم مقصوصاً (`usePartnerProfile`): اسمه وعمالته، بلا جوالات الآخرين ولا
 * عمالتهم، فلا نسبة تُشتق في متصفحه.
 */

const DEFAULT_VALUE = {
  isAdmin:            true,
  isInvestorAccount:  false,
  investorLinkMissing: false,
  partnerLinkLoading: false,
  partnerLinkError: null,
  recheckPartnerLink: () => {},
  role:               null,
  myPartner:          null,
  viewedPartner:      null,
  actingAsPartnerId:  null,
  setActingAsPartnerId: () => {},
  scalingFactor:      1,
  isPartnerView:      false,
  canMutate:          true,
};
const PartnerViewContext = createContext(DEFAULT_VALUE);

const STORAGE_KEY = 'sweater:actingAsPartnerId';
const STAFF_ROLES = ['admin', 'accountant', 'operator'];

export function PartnerViewProvider({ children, role = null }) {
  const { user } = useAuth();
  const isSupervisor = role === 'supervisor';
  const isInvestorAccount = role === 'partner';
  const isStaffRole = STAFF_ROLES.includes(role);
  const { partners, refetch } = usePartners({ enabled: isStaffRole });
  const profile = usePartnerProfile({ enabled: isInvestorAccount });

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

  // Find the partner row owned by the current user: the server's projection
  // for an investor, the staff list for a staff account linked to a row.
  const myPartner = useMemo(() => {
    if (!user?.id) return null;
    if (isInvestorAccount) return profile.partner ? { ...profile.partner, userId: user.id } : null;
    if (!isStaffRole) return null;
    return partners.find((p) => p.userId && p.userId === user.id) || null;
  }, [partners, user, isInvestorAccount, isStaffRole, profile.partner]);

  // الحالة التي كانت تُسلّم الواجهة كاملةً: دورٌ مستثمر بلا صفٍّ مربوط.
  const partnerLinkLoading = isInvestorAccount && Boolean(profile.loading);
  const partnerLinkError = isInvestorAccount ? (profile.error || null) : null;
  const investorLinkMissing = isInvestorAccount && !partnerLinkLoading && !partnerLinkError && !myPartner;
  const isAdmin = !isSupervisor && !isInvestorAccount && !myPartner;
  // An old localStorage pick must not put an accountant into a simulation the
  // server refuses (it ignores `partnerId` from anyone but an admin).
  const simulatingId = isAdmin && role === 'admin' ? actingAsPartnerId : null;

  // Admin override wins for admins; partners always see themselves.
  // If the simulated id no longer matches a row (admin deleted that
  // partner mid-session), viewedPartner falls back to null naturally:
  // banner disappears, scalingFactor returns to 1, dropdown shows
  // its placeholder. The orphan localStorage id is harmless until the
  // admin makes their next selection, which overwrites it.
  const viewedPartner = useMemo(() => {
    if (simulatingId) {
      return partners.find((p) => p.id === simulatingId) || null;
    }
    return myPartner;
  }, [simulatingId, myPartner, partners]);

  const totalWorkers = useMemo(
    () => partners.reduce((s, p) => s + (p.workersCount || 0), 0),
    [partners],
  );

  // المستثمر لا يملك عمالة الشركة ولا يحتاجها: كل رقمٍ في صفحته مقسومٌ في
  // الخادم. والواحد الصحيح يعني «أرقام الشركة كاملة» — آخر ما يُعرض عليه.
  // الصفر يفشل مغلقاً لو وصلته صفحةٌ تضرب بالحصّة.
  const scalingFactor = isInvestorAccount
    ? 0
    : (viewedPartner && totalWorkers > 0
      ? (viewedPartner.workersCount || 0) / totalWorkers
      : 1);

  // المستثمر المنتظر أو المسدود في عرض الشريك أيضاً: كل قمع مشروط بـ `isPartnerView`
  // يجب أن ينطبق عليه، لا أن يُفلته النقصُ إلى المسار الإداري.
  const isPartnerView = viewedPartner !== null || isInvestorAccount;
  const canMutate     = !isSupervisor && isAdmin && !simulatingId;

  const value = useMemo(() => ({
    isAdmin,
    isInvestorAccount,
    investorLinkMissing,
    partnerLinkLoading,
    partnerLinkError,
    recheckPartnerLink: isInvestorAccount ? profile.refetch : refetch,
    role,
    myPartner,
    viewedPartner,
    actingAsPartnerId: simulatingId,
    setActingAsPartnerId,
    scalingFactor,
    isPartnerView,
    canMutate,
  }), [
    isAdmin, isInvestorAccount, investorLinkMissing, partnerLinkLoading, partnerLinkError, refetch, profile.refetch, role,
    myPartner, viewedPartner, simulatingId, setActingAsPartnerId,
    scalingFactor, isPartnerView, canMutate,
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
