import { useState } from 'react';
import { Plus, Truck, Receipt, BookOpenCheck } from 'lucide-react';
import { initialCostItems, initialAssets } from './data/initialData';
import SummaryCards from './components/SummaryCards';
import CostTable from './components/CostTable';
import AddItemModal from './components/AddItemModal';
import BudgetChart from './components/BudgetChart';
import DepreciationTable from './components/DepreciationTable';
import AddAssetModal from './components/AddAssetModal';

function App() {
  const [activeTab, setActiveTab] = useState('costs');

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

  // ── Tab definitions ───────────────────────────────────────
  const tabs = [
    { id: 'costs', label: 'التكاليف التأسيسية', icon: Receipt },
    { id: 'depreciation', label: 'سجل إهلاك الأصول', icon: BookOpenCheck },
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
                <p className="text-primary-200 text-sm">نظام إدارة التكاليف والأصول</p>
              </div>
            </div>

            {/* Add button — context-aware */}
            <button
              onClick={() =>
                activeTab === 'costs' ? setIsCostModalOpen(true) : setIsAssetModalOpen(true)
              }
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 border border-white/20"
            >
              <Plus size={18} />
              {activeTab === 'costs' ? 'إضافة بند جديد' : 'إضافة أصل جديد'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-t-xl transition-colors ${
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
        {activeTab === 'costs' && (
          <>
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
          </>
        )}

        {activeTab === 'depreciation' && (
          <DepreciationTable assets={assets} onDeleteAsset={handleDeleteAsset} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-400">
          نظام محاسبة المغسلة المتنقلة — إدارة التكاليف التأسيسية وإهلاك الأصول
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
    </div>
  );
}

export default App;
