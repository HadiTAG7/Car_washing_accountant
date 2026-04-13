import { useState } from 'react';
import {
  Plus,
  Truck,
  Landmark,
  Calculator,
  Wrench,
  FileBarChart,
} from 'lucide-react';
import {
  initialCostItems,
  initialAssets,
  initialMaintenanceRecords,
} from './data/initialData';
import SummaryCards from './components/SummaryCards';
import CostTable from './components/CostTable';
import AddItemModal from './components/AddItemModal';
import BudgetChart from './components/BudgetChart';
import DepreciationTable from './components/DepreciationTable';
import AddAssetModal from './components/AddAssetModal';
import UnitEconomics from './components/UnitEconomics';
import FleetMaintenance from './components/FleetMaintenance';
import AddMaintenanceModal from './components/AddMaintenanceModal';
import CashFlowReport from './components/CashFlowReport';

const ADD_BUTTON_CONFIG = {
  startup: { label: 'إضافة بند جديد', modal: 'cost' },
  economics: null,
  fleet: { label: 'إضافة سجل صيانة', modal: 'maintenance' },
  cashflow: null,
};

function App() {
  const [activeTab, setActiveTab] = useState('startup');

  // ── Startup Costs state ───────────────────────────────────
  const [items, setItems] = useState(initialCostItems);
  const [isCostModalOpen, setIsCostModalOpen] = useState(false);

  const totalBudgeted = items.reduce((sum, item) => sum + item.budgeted, 0);
  const totalActual = items.reduce((sum, item) => sum + item.actual, 0);
  const totalVariance = totalBudgeted - totalActual;

  function handleAddItem(newItem) {
    setItems((prev) => [...prev, { ...newItem, id: Date.now() }]);
  }

  function handleUpdateActual(id, newActual) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, actual: newActual } : item))
    );
  }

  function handleDeleteItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  // ── Depreciation state ────────────────────────────────────
  const [assets, setAssets] = useState(initialAssets);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);

  function handleAddAsset(newAsset) {
    setAssets((prev) => [...prev, { ...newAsset, id: Date.now() }]);
  }

  function handleDeleteAsset(id) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Fleet Maintenance state ───────────────────────────────
  const [maintenanceRecords, setMaintenanceRecords] = useState(initialMaintenanceRecords);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);

  function handleAddMaintenance(record) {
    setMaintenanceRecords((prev) => [...prev, { ...record, id: Date.now() }]);
  }

  function handleDeleteMaintenance(id) {
    setMaintenanceRecords((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Context-aware add button ──────────────────────────────
  function handleAddClick() {
    const config = ADD_BUTTON_CONFIG[activeTab];
    if (!config) return;
    if (config.modal === 'cost') setIsCostModalOpen(true);
    else if (config.modal === 'maintenance') setIsMaintenanceModalOpen(true);
  }

  const addBtnConfig = ADD_BUTTON_CONFIG[activeTab];

  // ── Tab definitions ───────────────────────────────────────
  const tabs = [
    { id: 'startup', label: 'التأسيس والإهلاك', icon: Landmark },
    { id: 'economics', label: 'اقتصاديات الوحدة ونقطة التعادل', icon: Calculator },
    { id: 'fleet', label: 'صيانة الأسطول', icon: Wrench },
    { id: 'cashflow', label: 'التدفق النقدي والتقارير', icon: FileBarChart },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-l from-primary-700 to-primary-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 p-2.5 rounded-xl">
                <Truck size={28} />
              </div>
              <div>
                <h1 className="text-xl font-bold">محاسبة المغسلة المتنقلة</h1>
                <p className="text-primary-200 text-sm">نظام إدارة التكاليف والأصول والتشغيل</p>
              </div>
            </div>

            {/* Context-aware Add button */}
            {addBtnConfig && (
              <button
                onClick={handleAddClick}
                className="bg-white/15 hover:bg-white/25 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 border border-white/20"
              >
                <Plus size={18} />
                {addBtnConfig.label}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-100 text-primary-800'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab 1: Startup Costs + Depreciation combined */}
        {activeTab === 'startup' && (
          <>
            {/* ── Cost section ── */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-800">التكاليف التأسيسية</h2>
              <button
                onClick={() => setIsAssetModalOpen(true)}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
              >
                <Plus size={16} />
                إضافة أصل جديد
              </button>
            </div>

            <SummaryCards
              totalBudgeted={totalBudgeted}
              totalActual={totalActual}
              totalVariance={totalVariance}
            />
            <CostTable
              items={items}
              onUpdateActual={handleUpdateActual}
              onDeleteItem={handleDeleteItem}
            />
            <BudgetChart items={items} />

            {/* ── Depreciation section ── */}
            <div className="mt-12 pt-8 border-t-2 border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 mb-6">سجل إهلاك الأصول</h2>
              <DepreciationTable assets={assets} onDeleteAsset={handleDeleteAsset} />
            </div>
          </>
        )}

        {/* Tab 2: Unit Economics & Break-Even */}
        {activeTab === 'economics' && <UnitEconomics />}

        {/* Tab 3: Fleet Maintenance */}
        {activeTab === 'fleet' && (
          <FleetMaintenance
            records={maintenanceRecords}
            onDeleteRecord={handleDeleteMaintenance}
          />
        )}

        {/* Tab 4: Cash Flow & Reports */}
        {activeTab === 'cashflow' && (
          <CashFlowReport items={items} assets={assets} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-400">
          نظام محاسبة المغسلة المتنقلة — إدارة التكاليف والأصول والتشغيل
        </div>
      </footer>

      {/* Modals */}
      <AddItemModal
        isOpen={isCostModalOpen}
        onClose={() => setIsCostModalOpen(false)}
        onAdd={handleAddItem}
      />
      <AddAssetModal
        isOpen={isAssetModalOpen}
        onClose={() => setIsAssetModalOpen(false)}
        onAdd={handleAddAsset}
      />
      <AddMaintenanceModal
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        onAdd={handleAddMaintenance}
      />
    </div>
  );
}

export default App;
