import { useState, useCallback } from 'react';
import {
  Landmark,
  Calculator,
  FileBarChart,
  MapPin,
  Handshake,
  Loader2,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import LoginScreen from './components/LoginScreen';
import { DemoBanner } from './components/ErrorState';
import StartupPage from './components/StartupPage';
import UnitEconomicsPage from './components/UnitEconomicsPage';
import CashFlowPage from './components/CashFlowPage';
import RoutesPage from './components/RoutesPage';
import PartnersPage from './components/PartnersPage';
import FinancialEntrySelector from './components/FinancialEntrySelector';

import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured, requireAuth, missingEnvNames } from './lib/supabaseClient';

const TABS = [
  { id: 'startup',   label: 'رسوم التأسيس',      icon: Landmark    },
  { id: 'economics', label: 'اقتصاديات الوحدة',  icon: Calculator  },
  { id: 'cashflow',  label: 'التدفق النقدي',     icon: FileBarChart},
  { id: 'routes',    label: 'ربحية المسارات',    icon: MapPin      },
  { id: 'partners',  label: 'إدارة الشركاء',     icon: Handshake   },
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
    } else if (type === 'transaction') {
      setActiveTab('cashflow');
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
        {activeTab === 'economics' && <UnitEconomicsPage />}
        {activeTab === 'cashflow'  && (
          <CashFlowPage
            pendingEntry={pendingEntry}
            onClearPendingEntry={clearPendingEntry}
          />
        )}
        {activeTab === 'routes'    && <RoutesPage />}
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
