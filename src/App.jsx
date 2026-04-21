import { useState } from 'react';
import {
  Landmark,
  Calculator,
  Wrench,
  FileBarChart,
  MapPin,
  Loader2,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import LoginScreen from './components/LoginScreen';
import { DemoBanner } from './components/ErrorState';
import StartupPage from './components/StartupPage';
import UnitEconomicsPage from './components/UnitEconomicsPage';
import FleetMaintenancePage from './components/FleetMaintenancePage';
import CashFlowPage from './components/CashFlowPage';
import RoutesPage from './components/RoutesPage';

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

  // Bootstrapping auth
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

  // Gate behind auth if VITE_REQUIRE_AUTH=true AND Supabase is configured
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
      />

      <div className="mr-64 min-h-screen flex flex-col">
        {!isSupabaseConfigured && <DemoBanner />}

        {activeTab === 'startup'   && <StartupPage />}
        {activeTab === 'economics' && <UnitEconomicsPage />}
        {activeTab === 'fleet'     && <FleetMaintenancePage />}
        {activeTab === 'cashflow'  && <CashFlowPage />}
        {activeTab === 'routes'    && <RoutesPage />}
      </div>
    </div>
  );
}
