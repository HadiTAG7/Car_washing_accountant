import { useState } from 'react';
import { X, Plus, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function AddTransactionModal({ isOpen, onClose, onAdd }) {
  const [form, setForm] = useState({
    date: '',
    description: '',
    type: 'out',
    amount: '',
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.date || !form.description.trim() || !form.amount) return;

    onAdd({
      date: form.date,
      description: form.description.trim(),
      type: form.type,
      amount: parseFloat(form.amount),
    });

    setForm({ date: '', description: '', type: 'out', amount: '' });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 my-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60">
          <h3 className="text-lg font-bold text-gray-800 dark:text-slate-200 flex items-center gap-2">
            <Plus size={20} className="text-primary-600" />
            إيراد أو مصروف تشغيلي
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:text-slate-400 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {/* Type toggle */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">نوع الحركة</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, type: 'in' })}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                  form.type === 'in'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300'
                }`}
              >
                <ArrowUpRight size={18} />
                إيراد (دخل)
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, type: 'out' })}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border-2 transition-all ${
                  form.type === 'out'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-gray-300'
                }`}
              >
                <ArrowDownRight size={18} />
                مصروف تشغيلي
              </button>
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">التاريخ</label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              required
              className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">الوصف</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder={form.type === 'in' ? 'مثال: إيراد مسار شمال الرياض' : 'مثال: رواتب الموظفين'}
              required
              className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5">المبلغ (ر.س)</label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleChange}
              placeholder="0"
              required
              min="0"
              className="w-full px-4 py-3 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 text-white ${
                form.type === 'in'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-primary-600 hover:bg-primary-700'
              }`}
            >
              <Plus size={18} />
              {form.type === 'in' ? 'تسجيل الإيراد' : 'تسجيل المصروف'}
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
