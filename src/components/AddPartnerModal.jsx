import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export default function AddPartnerModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    partnerName: '',
    workersCount: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.partnerName.trim()) return;

    onAdd({
      partnerName: form.partnerName.trim(),
      workersCount: parseInt(form.workersCount, 10) || 0,
    });

    setForm({ partnerName: '', workersCount: '' });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-gray-800 dark:text-slate-200 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إضافة شريك جديد
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:text-slate-400 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Partner Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">اسم الشريك</label>
            <input
              type="text"
              name="partnerName"
              value={form.partnerName}
              onChange={handleChange}
              placeholder="مثال: شركة الخدمات المحدودة"
              required
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Workers Count */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">عدد العمالة</label>
            <input
              type="number"
              name="workersCount"
              value={form.workersCount}
              onChange={handleChange}
              placeholder="0"
              min="0"
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              إضافة الشريك
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 rounded-xl text-sm font-medium transition-colors"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
