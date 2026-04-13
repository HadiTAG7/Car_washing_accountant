import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { MAINTENANCE_TYPES } from '../data/initialData';

export default function AddMaintenanceModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    assetName: '',
    maintenanceType: 'oil',
    lastServiceDate: '',
    nextServiceDate: '',
    estimatedCost: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (
      !form.assetName.trim() ||
      !form.lastServiceDate ||
      !form.nextServiceDate ||
      !form.estimatedCost
    )
      return;

    onAdd({
      assetName: form.assetName.trim(),
      maintenanceType: form.maintenanceType,
      lastServiceDate: form.lastServiceDate,
      nextServiceDate: form.nextServiceDate,
      estimatedCost: parseFloat(form.estimatedCost),
    });

    setForm({
      assetName: '',
      maintenanceType: 'oil',
      lastServiceDate: '',
      nextServiceDate: '',
      estimatedCost: '',
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة سجل صيانة
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Asset Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              اسم المركبة/المعدة
            </label>
            <input
              type="text"
              name="assetName"
              value={form.assetName}
              onChange={handleChange}
              placeholder="مثال: شاحنة إيسوزو"
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Maintenance Type */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">نوع الصيانة</label>
            <select
              name="maintenanceType"
              value={form.maintenanceType}
              onChange={handleChange}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              {MAINTENANCE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                تاريخ آخر صيانة
              </label>
              <input
                type="date"
                name="lastServiceDate"
                value={form.lastServiceDate}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                تاريخ الصيانة القادمة
              </label>
              <input
                type="date"
                name="nextServiceDate"
                value={form.nextServiceDate}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Cost */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              التكلفة التقديرية (ر.س)
            </label>
            <input
              type="number"
              name="estimatedCost"
              value={form.estimatedCost}
              onChange={handleChange}
              placeholder="0"
              required
              min="0"
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
              إضافة السجل
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
