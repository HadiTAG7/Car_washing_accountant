import { useState } from 'react';
import {
  Landmark,
  Calculator,
  Wrench,
  FileBarChart,
  MapPin,
} from 'lucide-react';

import {
  initialCostItems,
  initialAssets,
  initialMaintenanceRecords,
  initialVehiclePerformance,
} from './data/initialData';

import Sidebar from './components/Sidebar';
import StartupPage from './components/StartupPage';
import UnitEconomicsPage from './components/UnitEconomicsPage';
import FleetMaintenancePage from './components/FleetMaintenancePage';
import CashFlowPage from './components/CashFlowPage';
import RoutesPage from './components/RoutesPage';

const TABS = [
  { id: 'startup',   label: 'التأسيس والأصول',   icon: Landmark    },
  { id: 'economics', label: 'اقتصاديات الوحدة',  icon: Calculator  },
  { id: 'fleet',     label: 'صيانة الأسطول',     icon: Wrench      },
  { id: 'cashflow',  label: 'التدفق النقدي',     icon: FileBarChart},
  { id: 'routes',    label: 'ربحية المسارات',    icon: MapPin      },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('startup');

  // ── Shared state ────────────────────────────────────────
  const [items,              setItems]              = useState(initialCostItems);
  const [assets,             setAssets]             = useState(initialAssets);
  const [maintenanceRecords, setMaintenanceRecords] = useState(initialMaintenanceRecords);
  const [vehicles,           setVehicles]           = useState(initialVehiclePerformance);

  // ── Handlers: Cost items ────────────────────────────────
  const addItem          = (i) => setItems((p) => [...p, { ...i, id: Date.now() }]);
  const updateItemActual = (id, actual) =>
    setItems((p) => p.map((i) => (i.id === id ? { ...i, actual } : i)));
  const deleteItem       = (id) => setItems((p) => p.filter((i) => i.id !== id));

  // ── Handlers: Assets ────────────────────────────────────
  const addAsset    = (a) => setAssets((p) => [...p, { ...a, id: Date.now() }]);
  const deleteAsset = (id) => setAssets((p) => p.filter((a) => a.id !== id));

  // ── Handlers: Maintenance ───────────────────────────────
  const addMaintenance    = (r) => setMaintenanceRecords((p) => [...p, { ...r, id: Date.now() }]);
  const deleteMaintenance = (id) => setMaintenanceRecords((p) => p.filter((r) => r.id !== id));

  // ── Handlers: Vehicles ──────────────────────────────────
  const addVehicle    = (v) => setVehicles((p) => [...p, { ...v, id: Date.now() }]);
  const deleteVehicle = (id) => setVehicles((p) => p.filter((v) => v.id !== id));

  return (
    <div className="min-h-screen bg-[#eef2f7]">
      {/* Fixed right sidebar */}
      <Sidebar tabs={TABS} activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Main content — offset for sidebar */}
      <div className="mr-64 min-h-screen flex flex-col">
        {activeTab === 'startup' && (
          <StartupPage
            items={items}
            assets={assets}
            onAddItem={addItem}
            onUpdateActual={updateItemActual}
            onDeleteItem={deleteItem}
            onAddAsset={addAsset}
            onDeleteAsset={deleteAsset}
          />
        )}

        {activeTab === 'economics' && <UnitEconomicsPage />}

        {activeTab === 'fleet' && (
          <FleetMaintenancePage
            records={maintenanceRecords}
            onAddRecord={addMaintenance}
            onDeleteRecord={deleteMaintenance}
          />
        )}

        {activeTab === 'cashflow' && (
          <CashFlowPage items={items} assets={assets} />
        )}

        {activeTab === 'routes' && (
          <RoutesPage
            vehicles={vehicles}
            onAddVehicle={addVehicle}
            onDeleteVehicle={deleteVehicle}
          />
        )}
      </div>
    </div>
  );
}
