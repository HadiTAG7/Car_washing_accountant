import { useState, useCallback } from 'react';
import {
  Landmark,
  Repeat,
  Receipt,
  Activity,
  Car,
  BarChart3,
  Target,
  Handshake,
  HandCoins,
  RefreshCw,
  Loader2,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import LoginScreen from './components/LoginScreen';
import { DemoBanner } from './components/ErrorState';
import StartupPage from './components/StartupPage';
import AnnualExpensesPage from './components/AnnualExpensesPage';
import MonthlyExpensesPage from './components/MonthlyExpensesPage';
import VariableExpensesPage from './components/VariableExpensesPage';
import WashesPage from './components/WashesPage';
import FinancialSummaryPage from './components/FinancialSummaryPage';
import BudgetsPage from './components/BudgetsPage';
import PartnersPage from './components/PartnersPage';
import PartnerPaymentsPage from './components/PartnerPaymentsPage';
import TemporaryExpensesPage from './components/TemporaryExpensesPage';
import FinancialEntrySelector from './components/FinancialEntrySelector';

import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured, requireAuth, missingEnvNames } from './lib/supabaseClient';
import { MobileMenuProvider, useMobileMenu } from './contexts/MobileMenuContext';
import { PartnerViewProvider, usePartnerView } from './contexts/PartnerViewContext';
import PartnerViewBanner from './components/PartnerViewBanner';

const TABS = [
  { id: 'startup',   label: 'رسوم التأسيس',           icon: Landmark    },
  { id: 'annual',    label: 'المصاريف السنوية',       icon: Repeat      },
  { id: 'monthly',   label: 'المصاريف الشهرية',       icon: Receipt     },
  { id: 'variable',  label: 'المصاريف المتغيرة',      icon: Activity    },
  { id: 'washes',    label: 'الغسلات',                icon: Car         },
  { id: 'summary',   label: 'الملخص المالي وصافي الربح', icon: BarChart3 },
  { id: 'budgets',   label: 'الرقابة والميزانيات',    icon: Target      },
  { id: 'partners',  label: 'إدارة الشركاء',          icon: Handshake   },
  { id: 'payments',  label: 'المدفوعات الخاصة لكل شريك', icon: HandCoins },
  { id: 'temporary_expenses', label: 'المصروفات المؤقتة', icon: RefreshCw },
];

// Inner shell wraps the routed content so it can subscribe to the
// MobileMenuContext (provider is one level up).
function AppShell() {
  const [activeTab, setActiveTab] = useState('startup');
  const { session, loading: authLoading, signOut } = useAuth();
  const { canMutate } = usePartnerView();

  const [showEntrySelector, setShowEntrySelector] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);

  const { open: mobileMenuOpen, setOpen: setMobileMenuOpen } = useMobileMenu();

  const clearPendingEntry = useCallback(() => setPendingEntry(null), []);

  function handleEntrySelect(type) {
    setShowEntrySelector(false);
    if (type === 'item' || type === 'asset') {
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

  // Sidebar's logout appends `?signedOut=<ts>` to the URL so that we
  // can force the LoginScreen even when VITE_REQUIRE_AUTH is off.
  // Without this, the dashboard re-renders unauthenticated and looks
  // identical to "nothing happened" from the user's perspective.
  const justSignedOut = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('signedOut');

  const mustAuthenticate = (requireAuth || justSignedOut) && isSupabaseConfigured;
  if (mustAuthenticate && !session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen">
      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        user={session?.user}
        onSignOut={isSupabaseConfigured ? signOut : null}
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
        {!isSupabaseConfigured && <DemoBanner missing={missingEnvNames} />}

        {activeTab === 'startup'   && (
          <StartupPage
            pendingEntry={pendingEntry}
            onClearPendingEntry={clearPendingEntry}
          />
        )}
        {activeTab === 'annual'    && <AnnualExpensesPage />}
        {activeTab === 'monthly'   && <MonthlyExpensesPage />}
        {activeTab === 'variable'  && <VariableExpensesPage />}
        {activeTab === 'washes'    && <WashesPage />}
        {activeTab === 'summary'   && <FinancialSummaryPage />}
        {activeTab === 'budgets'   && <BudgetsPage />}
        {activeTab === 'partners'  && <PartnersPage />}
        {activeTab === 'payments'  && <PartnerPaymentsPage />}
        {activeTab === 'temporary_expenses' && <TemporaryExpensesPage />}
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
