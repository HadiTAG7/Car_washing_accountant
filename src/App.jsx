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
import FinancialEntrySelector from './components/FinancialEntrySelector';

import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured, requireAuth, missingEnvNames } from './lib/supabaseClient';

const TABS = [
  { id: 'startup',   label: 'رسوم التأسيس',           icon: Landmark    },
  { id: 'annual',    label: 'المصاريف السنوية',       icon: Repeat      },
  { id: 'monthly',   label: 'المصاريف الشهرية',       icon: Receipt     },
  { id: 'variable',  label: 'المصاريف المتغيرة',      icon: Activity    },
  { id: 'washes',    label: 'الغسلات',                icon: Car         },
  { id: 'summary',   label: 'الملخص المالي وصافي الربح', icon: BarChart3 },
  { id: 'budgets',   label: 'الرقابة والميزانيات',    icon: Target      },
  { id: 'partners',  label: 'إدارة الشركاء',          icon: Handshake   },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('startup');
  const { session, loading: authLoading, signOut } = useAuth();

  const [showEntrySelector, setShowEntrySelector] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);

  const clearPendingEntry = useCallback(() => setPendingEntry(null), []);

  function handleEntrySelect(type) {
    setShowEntrySelector(false);
    if (type === 'item' || type === 'asset') {
      // TODO: 'asset' routes here from FinancialEntrySelector but the assets
      // module is not part of Module 1 — it will be reintroduced in a later
      // module rebuild. For now the entry is a no-op on the startup tab.
      setActiveTab('startup');
    }
    setPendingEntry(type);
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

  const mustAuthenticate = requireAuth && isSupabaseConfigured;
  if (mustAuthenticate && !session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen">
      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={session?.user}
        onSignOut={isSupabaseConfigured ? signOut : null}
        onAddEntry={() => setShowEntrySelector(true)}
      />

      <div className="mr-64 min-h-screen flex flex-col">
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
      </div>

      <FinancialEntrySelector
        isOpen={showEntrySelector}
        onSelect={handleEntrySelect}
        onClose={() => setShowEntrySelector(false)}
      />
    </div>
  );
}
