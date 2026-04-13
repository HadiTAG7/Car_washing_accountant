import { useState } from 'react';
import { Plus, WashingMachine } from 'lucide-react';
import { initialCostItems } from './data/initialData';
import SummaryCards from './components/SummaryCards';
import CostTable from './components/CostTable';
import AddItemModal from './components/AddItemModal';
import BudgetChart from './components/BudgetChart';

function App() {
  const [items, setItems] = useState(initialCostItems);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const totalBudgeted = items.reduce((sum, item) => sum + item.budgeted, 0);
  const totalActual = items.reduce((sum, item) => sum + item.actual, 0);
  const totalVariance = totalBudgeted - totalActual;

  function handleAddItem(newItem) {
    setItems((prev) => [
      ...prev,
      { ...newItem, id: Date.now() },
    ]);
  }

  function handleUpdateActual(id, newActual) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, actual: newActual } : item))
    );
  }

  function handleDeleteItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-l from-primary-700 to-primary-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/15 p-2.5 rounded-xl">
                <WashingMachine size={28} />
              </div>
              <div>
                <h1 className="text-xl font-bold">محاسبة المغسلة</h1>
                <p className="text-primary-200 text-sm">لوحة التكاليف التأسيسية</p>
              </div>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 border border-white/20"
            >
              <Plus size={18} />
              إضافة بند جديد
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-400">
          نظام محاسبة المغسلة — لوحة التكاليف التأسيسية
        </div>
      </footer>

      {/* Add Item Modal */}
      <AddItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAddItem}
      />
    </div>
  );
}

export default App;
