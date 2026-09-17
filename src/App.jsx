import { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { visibleGroupsFor } from './lib/navGroups';

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
const InvestorPage         = lazy(() => import('./components/InvestorPage'));
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
const AgentCommandCenterPage = lazy(() => import('./components/AgentCommandCenterPage'));
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


// Inner shell wraps the routed content so it can subscribe to the
// MobileMenuContext (provider is one level up).
function AppShell({ membership }) {
  const previewCommandCenter = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('previewCommandCenter');
  const previewPayroll = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('previewPayroll');
  const localPreview = previewCommandCenter || previewPayroll;
  const [activeTab, setActiveTab] = useState(
    previewCommandCenter ? 'agent_command_center' : (previewPayroll ? 'bikers' : 'overview'),
  );
  const { session, loading: authLoading, signOut } = useAuth();
  // العضوية تُسأل مرة واحدة في `App` وتنزل من هناك: المزوّد يحتاج الدور ليقرّر
  // من يرى ماذا، وسؤالها هنا أيضاً يعني جلباً ثانياً ونداءً ثانياً للخادم.
  const { canMutate, isPartnerView } = usePartnerView();
  // وضع المستثمر: تبويبٌ واحد، ومسارٌ واحد يُصيَّر. يُشتق من `isPartnerView`
  // لا من الدور، فيشمل المدير المحاكي — وبه تصبح المحاكاة أمينة.
  const investorMode = !localPreview && isPartnerView;
  // يُمرَّر إلى `BikersPage` لتقرير من يسوّد مسير الرواتب — قرارٌ منفصل عن
  // التنقّل، فيبقى على الدور نفسه.
  const visibleRole = localPreview ? 'admin' : membership.role;
  const visibleGroups = visibleGroupsFor({
    role: membership.role, isPartnerView, localPreview,
  });
  // التبويب النشط يُشتق ولا يُخزَّن: مديرٌ واقفٌ على دفتر الأستاذ يختار شريكاً
  // من القائمة يجب ألا يبقى الدفتر مصيَّراً تحته. والاشتقاق يعني أيضاً أنه
  // يعود إلى مكانه تماماً حين ينهي المحاكاة.
  const effectiveTab = investorMode ? 'investor' : activeTab;

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

  // ── لماذا ننتظر الدور ──
  // الدور يصل بعد جولة إلى Firestore، وهو `null` حتى يصل. و`null` يبدو
  // للمرشّح أدناه كأنه مدير، فيومض للمستثمر ثلاثةٌ وعشرون تبويباً قبل أن
  // تُطوى. الانتظار هنا أرخص من ومضةٍ تُري المستثمر ما لا يخصّه.
  const rolePending = isFirebaseConfigured && Boolean(session) && membership.loading;

  if (authLoading || rolePending) {
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
  if (mustAuthenticate && !session && !localPreview) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen">
      <Sidebar
        groups={visibleGroups}
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
        {!localPreview && !membership.loading && !membership.isMember && (
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
          <div key={effectiveTab} className="animate-page-in flex-1 flex flex-col">
            {effectiveTab === 'investor' && <InvestorPage />}
            {effectiveTab === 'overview'  && <OverviewPage />}
            {effectiveTab === 'agent_command_center' && (
              <AgentCommandCenterPage
                role={previewCommandCenter ? undefined : membership.role}
                preview={previewCommandCenter}
              />
            )}
            {effectiveTab === 'startup'   && (
              <StartupPage
                pendingEntry={pendingEntry}
                onClearPendingEntry={clearPendingEntry}
              />
            )}
            {effectiveTab === 'annual'    && <AnnualExpensesPage />}
            {effectiveTab === 'sweater_settlements' && <SweaterSettlementsPage />}
            {effectiveTab === 'sweater_integration' && <SweaterIntegrationPage />}
            {effectiveTab === 'monthly'   && <MonthlyExpensesPage />}
            {effectiveTab === 'variable'  && <VariableExpensesPage />}
            {effectiveTab === 'washes'    && <WashesPage />}
            {effectiveTab === 'bikers'    && <BikersPage role={visibleRole} payrollPreview={previewPayroll} />}
            {effectiveTab === 'housing'   && <HousingPage />}
            {effectiveTab === 'summary'   && <FinancialSummaryPage />}
            {effectiveTab === 'vat'       && <VatRecoveryPage />}
            {effectiveTab === 'budgets'   && <BudgetsPage />}
            {effectiveTab === 'partners'  && <PartnersPage />}
            {effectiveTab === 'payments'  && <PartnerPaymentsPage />}
            {effectiveTab === 'temporary_expenses' && <TemporaryExpensesPage />}
            {effectiveTab === 'ledger'    && <GeneralLedgerPage />}
            {effectiveTab === 'trial'     && <TrialBalancePage />}
            {effectiveTab === 'balance'   && <BalanceSheetPage />}
            {effectiveTab === 'documents' && <SalesDocumentsPage />}
            {effectiveTab === 'assets'    && <FixedAssetsPage />}
            {effectiveTab === 'periods'   && <PeriodClosePage />}
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
  //
  // ── الدخول ليس عضوية ──
  // The rules read membership from a document; an account created in the Auth
  // console has none, so every page shows «لا صلاحيات» while the sidebar
  // renders everything. Asked once, HERE — أعلى من المزوّد لأنه يحتاج الدور
  // ليقرّر من هو المستثمر، وأعلى من الشلّ لأن سؤالها مرتين جلبٌ مرتين ونداءٌ
  // للخادم مرتين.
  const { session } = useAuth();
  const membership = useMembership(session?.user?.id);
  return (
    <MobileMenuProvider>
      <PartnerViewProvider role={membership.role}>
        <AppShell membership={membership} />
      </PartnerViewProvider>
    </MobileMenuProvider>
  );
}
