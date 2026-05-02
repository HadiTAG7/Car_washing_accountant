import { useState, useCallback } from 'react';
import {
  Landmark,
  Calculator,
  Wrench,
  FileBarChart,
  MapPin,
  Loader2,
  Plus,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import LoginScreen from './components/LoginScreen';
import { DemoBanner } from './components/ErrorState';
import StartupPage from './components/StartupPage';
import UnitEconomicsPage from './components/UnitEconomicsPage';
import FleetMaintenancePage from './components/FleetMaintenancePage';
import CashFlowPage from './components/CashFlowPage';
import RoutesPage from './components/RoutesPage';
import FinancialEntrySelector from './components/FinancialEntrySelector';

import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured, requireAuth } from './lib/supabaseClient';

const TABS = [
  { id: 'startup',   label: 'التأسيس والأصول',   icon: Landmark    },
  { id: 'economics', label: 'اقتصاديات الوحدة',  icon: Calculator  },
  { id: 'fleet',     label: 'صيانة الأسطول',     icon: Wrench      },
  { id: 'cashflow',  label: 'التدفق النقدي',     icon: FileBarChart},
  { id: 'routes',    label: 'ربحية المسارات',    icon: MapPin      },
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
      setActiveTab('startup');
    } else if (type === 'transaction') {
      setActiveTab('cashflow');
    }
    setPendingEntry(type);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#eef2f7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={28} className="animate-spin text-primary-700" />
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
    <div className="min-h-screen bg-[#eef2f7]">
      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={session?.user}
        onSignOut={isSupabaseConfigured ? signOut : null}
        onAddEntry={() => setShowEntrySelector(true)}
      />

      <div className="mr-64 min-h-screen flex flex-col">
        {!isSupabaseConfigured && <DemoBanner />}

        {activeTab === 'startup'   && (
          <StartupPage
            pendingEntry={pendingEntry}
            onClearPendingEntry={clearPendingEntry}
          />
        )}
        {activeTab === 'economics' && <UnitEconomicsPage />}
        {activeTab === 'fleet'     && <FleetMaintenancePage />}
        {activeTab === 'cashflow'  && (
          <CashFlowPage
            pendingEntry={pendingEntry}
            onClearPendingEntry={clearPendingEntry}
          />
        )}
        {activeTab === 'routes'    && <RoutesPage />}
      </div>

      <FinancialEntrySelector
        isOpen={showEntrySelector}
        onSelect={handleEntrySelect}
        onClose={() => setShowEntrySelector(false)}
      />
    </div>
  );
}
