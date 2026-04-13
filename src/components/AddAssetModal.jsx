import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export default function AddAssetModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    assetName: '',
    purchaseDate: '',
    purchaseCost: '',
    salvageValue: '',
    usefulLife: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.assetName.trim() || !form.purchaseCost || !form.usefulLife || !form.purchaseDate) return;

    onAdd({
      assetName: form.assetName.trim(),
      purchaseDate: form.purchaseDate,
      purchaseCost: parseFloat(form.purchaseCost),
      salvageValue: form.salvageValue ? parseFloat(form.salvageValue) : 0,
      usefulLife: parseInt(form.usefulLife, 10),
    });

    setForm({ assetName: '', purchaseDate: '', purchaseCost: '', salvageValue: '', usefulLife: '' });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة أصل جديد
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Asset Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">اسم الأصل</label>
            <input
              type="text"
              name="assetName"
              value={form.assetName}
              onChange={handleChange}
              placeholder="مثال: شاحنة غسيل متنقلة"
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Purchase Date */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">تاريخ الشراء</label>
            <input
              type="date"
              name="purchaseDate"
              value={form.purchaseDate}
              onChange={handleChange}
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Cost & Salvage row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                تكلفة الشراء (ر.س)
              </label>
              <input
                type="number"
                name="purchaseCost"
                value={form.purchaseCost}
                onChange={handleChange}
                placeholder="0"
                required
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                القيمة التخريدية (ر.س)
              </label>
              <input
                type="number"
                name="salvageValue"
                value={form.salvageValue}
                onChange={handleChange}
                placeholder="0"
                min="0"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Useful Life */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              العمر الإنتاجي (بالسنوات)
            </label>
            <input
              type="number"
              name="usefulLife"
              value={form.usefulLife}
              onChange={handleChange}
              placeholder="مثال: 5"
              required
              min="1"
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              إضافة الأصل
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
