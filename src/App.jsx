import { useState, useCallback } from 'react';
import {
  LayoutDashboard,
  Landmark,
  Repeat,
  Receipt,
  Activity,
  Car,
  Bike,
  Home,
  BarChart3,
  Target,
  Handshake, Plug,
  HandCoins,
  RefreshCw,
  Percent,
  Loader2,
  BookOpen,
  Scale,
  Lock,
  FileText,
  Boxes,
} from 'lucide-react';

import { lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import LoginScreen from './components/LoginScreen';
import MembershipBanner from './components/MembershipBanner';
import UpdatePasswordScreen from './components/UpdatePasswordScreen';
import { DemoBanner } from './components/ErrorState';
import LoadingState from './components/LoadingState';
import FinancialEntrySelector from './components/FinancialEntrySelector';

// Route-level code-splitting: each tab's page is its own chunk, loaded on
// first visit. Trims the initial bundle (recharts, the heavy P&L/budget
// pages, etc. no longer ship in the first paint) — a real win on mobile.
const OverviewPage         = lazy(() => import('./components/OverviewPage'));
const StartupPage          = lazy(() => import('./components/StartupPage'));
const AnnualExpensesPage   = lazy(() => import('./components/AnnualExpensesPage'));
const SweaterSettlementsPage = lazy(() => import('./components/SweaterSettlementsPage'));
const SweaterIntegrationPage = lazy(() => import('./components/SweaterIntegrationPage'));
const MonthlyExpensesPage  = lazy(() => import('./components/MonthlyExpensesPage'));
const VariableExpensesPage = lazy(() => import('./components/VariableExpensesPage'));
const WashesPage           = lazy(() => import('./components/WashesPage'));
const FinancialSummaryPage = lazy(() => import('./components/FinancialSummaryPage'));
const VatRecoveryPage      = lazy(() => import('./components/VatRecoveryPage'));
const BudgetsPage          = lazy(() => import('./components/BudgetsPage'));
const PartnersPage         = lazy(() => import('./components/PartnersPage'));
const PartnerPaymentsPage  = lazy(() => import('./components/PartnerPaymentsPage'));
const BikersPage           = lazy(() => import('./components/BikersPage'));
const HousingPage          = lazy(() => import('./components/HousingPage'));
const TemporaryExpensesPage = lazy(() => import('./components/TemporaryExpensesPage'));
// ── الدفاتر المحاسبية ──────────────────────────────────────────────────
const GeneralLedgerPage    = lazy(() => import('./components/GeneralLedgerPage'));
const TrialBalancePage     = lazy(() => import('./components/TrialBalancePage'));
const BalanceSheetPage     = lazy(() => import('./components/BalanceSheetPage'));
const SalesDocumentsPage   = lazy(() => import('./components/SalesDocumentsPage'));
const FixedAssetsPage      = lazy(() => import('./components/FixedAssetsPage'));
const PeriodClosePage      = lazy(() => import('./components/PeriodClosePage'));

import { useAuth } from './hooks/useAuth';
import { useMembership } from './hooks/useMembership';
import { isFirebaseConfigured, requireAuth, missingEnvNames } from './lib/firebaseClient';
import { MobileMenuProvider, useMobileMenu } from './contexts/MobileMenuContext';
import { PartnerViewProvider, usePartnerView } from './contexts/PartnerViewContext';
import PartnerViewBanner from './components/PartnerViewBanner';

// ── القائمة مجموعاتٌ لا سطراً واحداً ──
// Nineteen flat entries stopped being a list and became a scroll — worst on
// the phone, where the owner works. The grouping is by the QUESTION each tab
// answers, not by data model: «ماذا حدث اليوم؟» vs «كم أنفقنا؟» vs «ما تقوله
// الدفاتر؟». `overview` stays titleless at the top because a summary belongs
// to no category — it is the answer before the questions.
//
// Tab ids are untouched: the render chain below keys off them, so regrouping
// is a presentation change that cannot break a route.
const TAB_GROUPS = [
  {
    id: 'top',
    title: null,
    tabs: [
      { id: 'overview',  label: 'نظرة عامة',              icon: LayoutDashboard },
    ],
  },
  {
    id: 'ops',
    title: 'التشغيل اليومي',
    tabs: [
      { id: 'washes',    label: 'الغسلات',                icon: Car         },
      { id: 'bikers',    label: 'البايكر',                 icon: Bike        },
      { id: 'housing',   label: 'السكن',                   icon: Home        },
      { id: 'temporary_expenses', label: 'المصروفات المؤقتة', icon: RefreshCw },
    ],
  },
  {
    id: 'sweater',
    title: 'منصة سويتر',
    tabs: [
      { id: 'sweater_settlements', label: 'تسويات سويتر',  icon: Handshake },
      { id: 'sweater_integration', label: 'تكامل سويتر',   icon: Plug      },
    ],
  },
  {
    id: 'expenses',
    title: 'المصاريف',
    tabs: [
      { id: 'startup',   label: 'رسوم التأسيس',           icon: Landmark    },
      { id: 'annual',    label: 'المصاريف السنوية',       icon: Repeat      },
      { id: 'monthly',   label: 'المصاريف الشهرية',       icon: Receipt     },
      { id: 'variable',  label: 'المصاريف المتغيرة',      icon: Activity    },
    ],
  },
  {
    id: 'reports',
    title: 'التقارير والرقابة',
    tabs: [
      { id: 'summary',   label: 'قائمة الدخل',            icon: BarChart3   },
      { id: 'vat',       label: 'الضريبة المستردة',       icon: Percent     },
      { id: 'budgets',   label: 'الرقابة والميزانيات',    icon: Target      },
    ],
  },
  {
    id: 'partners',
    title: 'الشركاء',
    tabs: [
      { id: 'partners',  label: 'إدارة الشركاء',          icon: Handshake   },
      { id: 'payments',  label: 'مدفوعات الشركاء',        icon: HandCoins   },
    ],
  },
  {
    id: 'books',
    title: 'الدفاتر المحاسبية',
    tabs: [
      { id: 'ledger',    label: 'دفتر الأستاذ',            icon: BookOpen    },
      { id: 'trial',     label: 'ميزان المراجعة',          icon: Scale       },
      { id: 'balance',   label: 'المركز المالي',           icon: Landmark    },
      { id: 'documents', label: 'المستندات الضريبية',      icon: FileText    },
      { id: 'assets',    label: 'الأصول الثابتة',          icon: Boxes       },
      { id: 'periods',   label: 'إقفال الفترة',            icon: Lock        },
    ],
  },
];

// Inner shell wraps the routed content so it can subscribe to the
// MobileMenuContext (provider is one level up).
function AppShell() {
  const [activeTab, setActiveTab] = useState('overview');
  const { session, loading: authLoading, signOut } = useAuth();
  // ── الدخول ليس عضوية ──
  // The rules read membership from a document; an account created in the Auth
  // console has none, so every page shows «لا صلاحيات» while the sidebar
  // renders everything. Asked once, here, so the answer is given ONCE and by
  // name instead of eighteen times as a generic permission error.
  const membership = useMembership(session?.user?.id);
  const { canMutate } = usePartnerView();

  const [showEntrySelector, setShowEntrySelector] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);

  const { open: mobileMenuOpen, setOpen: setMobileMenuOpen } = useMobileMenu();

  const clearPendingEntry = useCallback(() => setPendingEntry(null), []);

  function handleEntrySelect(type) {
    setShowEntrySelector(false);
    if (type === 'item') {
      setActiveTab('startup');
    }
    setPendingEntry(type);
  }

  // Selecting a tab from inside the mobile drawer should auto-close it.
  function handleSelectTab(id) {
    setActiveTab(id);
    setMobileMenuOpen(false);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin text-accent-500" />
          <p className="text-sm">جارٍ التحقق من الجلسة...</p>
        </div>
      </div>
    );
  }

  // /update-password is the landing route for Supabase's reset-password
  // email. Render the dedicated UpdatePasswordScreen instead of either
  // the dashboard OR the login screen — the user lands here WITH a
  // short-lived recovery session, so the auth gate below would
  // otherwise let them straight into the dashboard with stale state.
  const onUpdatePasswordRoute = typeof window !== 'undefined'
    && window.location.pathname === '/update-password';
  if (onUpdatePasswordRoute) {
    return <UpdatePasswordScreen />;
  }

  // Sidebar's logout appends `?signedOut=<ts>` to the URL so that we
  // can force the LoginScreen even when VITE_REQUIRE_AUTH is off.
  // Without this, the dashboard re-renders unauthenticated and looks
  // identical to "nothing happened" from the user's perspective.
  const justSignedOut = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('signedOut');

  const mustAuthenticate = (requireAuth || justSignedOut) && isFirebaseConfigured;
  if (mustAuthenticate && !session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen">
      <Sidebar
        groups={TAB_GROUPS}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        user={session?.user}
        onSignOut={isFirebaseConfigured ? signOut : null}
        // Hide the "+ إضافة سجل مالي" sidebar entrypoint in partner view —
        // a partner has strict read-only access; a simulating admin sees
        // the partner's UX (no shortcut to write).
        onAddEntry={canMutate
          ? () => { setShowEntrySelector(true); setMobileMenuOpen(false); }
          : null}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="min-h-screen md:mr-64 flex flex-col">
        <PartnerViewBanner />
        {!isFirebaseConfigured && <DemoBanner missing={missingEnvNames} />}
        {!membership.loading && !membership.isMember && (
          <MembershipBanner
            user={session?.user}
            membership={membership}
            onRecheck={membership.recheck}
          />
        )}

        <Suspense fallback={<LoadingState message="جارٍ تحميل الصفحة..." />}>
          {/* key={activeTab} remounts the wrapper per tab so the page-in
              entrance replays on every switch (no-op under
              prefers-reduced-motion). */}
          <div key={activeTab} className="animate-page-in flex-1 flex flex-col">
            {activeTab === 'overview'  && <OverviewPage />}
            {activeTab === 'startup'   && (
              <StartupPage
                pendingEntry={pendingEntry}
                onClearPendingEntry={clearPendingEntry}
              />
            )}
            {activeTab === 'annual'    && <AnnualExpensesPage />}
            {activeTab === 'sweater_settlements' && <SweaterSettlementsPage />}
            {activeTab === 'sweater_integration' && <SweaterIntegrationPage />}
            {activeTab === 'monthly'   && <MonthlyExpensesPage />}
            {activeTab === 'variable'  && <VariableExpensesPage />}
            {activeTab === 'washes'    && <WashesPage />}
            {activeTab === 'bikers'    && <BikersPage />}
            {activeTab === 'housing'   && <HousingPage />}
            {activeTab === 'summary'   && <FinancialSummaryPage />}
            {activeTab === 'vat'       && <VatRecoveryPage />}
            {activeTab === 'budgets'   && <BudgetsPage />}
            {activeTab === 'partners'  && <PartnersPage />}
            {activeTab === 'payments'  && <PartnerPaymentsPage />}
            {activeTab === 'temporary_expenses' && <TemporaryExpensesPage />}
            {activeTab === 'ledger'    && <GeneralLedgerPage />}
            {activeTab === 'trial'     && <TrialBalancePage />}
            {activeTab === 'balance'   && <BalanceSheetPage />}
            {activeTab === 'documents' && <SalesDocumentsPage />}
            {activeTab === 'assets'    && <FixedAssetsPage />}
            {activeTab === 'periods'   && <PeriodClosePage />}
          </div>
        </Suspense>
      </div>

      <FinancialEntrySelector
        isOpen={showEntrySelector}
        onSelect={handleEntrySelect}
        onClose={() => setShowEntrySelector(false)}
      />
    </div>
  );
}

export default function App() {
  // PartnerViewProvider sits INSIDE MobileMenuProvider because it depends
  // on useAuth + usePartners; those hooks are safe to call at any point
  // in the tree, but keeping the auth-aware contexts close to the shell
  // makes the ownership easier to follow.
  return (
    <MobileMenuProvider>
      <PartnerViewProvider>
        <AppShell />
      </PartnerViewProvider>
    </MobileMenuProvider>
  );
}
