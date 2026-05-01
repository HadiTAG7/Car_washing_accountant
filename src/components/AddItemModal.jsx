import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export default function AddItemModal({ isOpen, onClose, onAdd, categories = [], onAddCategory }) {
  const [form, setForm] = useState({
    category: '',
    itemName: '',
    budgeted: '',
    actual: '',
  });
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.category || !form.itemName.trim() || !form.budgeted) return;

    onAdd({
      category: form.category,
      itemName: form.itemName.trim(),
      budgeted: parseFloat(form.budgeted),
      actual: form.actual ? parseFloat(form.actual) : 0,
    });

    setForm({ category: categories[0]?.id || '', itemName: '', budgeted: '', actual: '' });
    onClose();
  }

  async function handleAddCategory(e) {
    e.preventDefault();
    if (!newCatLabel.trim() || !onAddCategory) return;
    setAddingCat(true);
    try {
      const id = newCatLabel.trim().toLowerCase().replace(/\s+/g, '-');
      await onAddCategory({ id, label: newCatLabel.trim() });
      setForm((prev) => ({ ...prev, category: id }));
      setNewCatLabel('');
      setShowNewCat(false);
    } finally {
      setAddingCat(false);
    }
  }

  if (!isOpen) return null;

  const selectedCategory = form.category || categories[0]?.id || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة بند جديد
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">التصنيف</label>
            <div className="flex gap-2">
              <select
                name="category"
                value={selectedCategory}
                onChange={handleChange}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewCat(!showNewCat)}
                className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-primary-700 hover:bg-primary-50 transition-colors font-semibold"
                title="إضافة تصنيف جديد"
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Inline new category form */}
            {showNewCat && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  placeholder="اسم التصنيف الجديد"
                  className="flex-1 px-3 py-2 border border-primary-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 bg-primary-50/50"
                />
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCatLabel.trim() || addingCat}
                  className="px-4 py-2 bg-primary-700 hover:bg-primary-800 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {addingCat ? '...' : 'أضف'}
                </button>
              </div>
            )}
          </div>

          {/* Item Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم البند</label>
            <input
              type="text"
              name="itemName"
              value={form.itemName}
              onChange={handleChange}
              placeholder="مثال: غسالة صناعية"
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Amounts row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                الميزانية المحددة (ر.س)
              </label>
              <input
                type="number"
                name="budgeted"
                value={form.budgeted}
                onChange={handleChange}
                placeholder="0"
                required
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                التكلفة الفعلية (ر.س)
              </label>
              <input
                type="number"
                name="actual"
                value={form.actual}
                onChange={handleChange}
                placeholder="0"
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              إضافة البند
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
