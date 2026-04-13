import { useState } from 'react';
import { Pencil, Check, X, Trash2 } from 'lucide-react';
import { getCategoryLabel, formatCurrency, getVariance, getStatus } from '../data/initialData';

function StatusBadge({ status }) {
  if (status === 'under') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        🟢 أقل من الميزانية
      </span>
    );
  }
  if (status === 'over') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        🔴 تجاوز الميزانية
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      ⚪ مطابق للميزانية
    </span>
  );
}

export default function CostTable({ items, onUpdateActual, onDeleteItem }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  function startEdit(item) {
    setEditingId(item.id);
    setEditValue(String(item.actual));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  function saveEdit(id) {
    const val = parseFloat(editValue);
    if (!isNaN(val) && val >= 0) {
      onUpdateActual(id, val);
    }
    setEditingId(null);
    setEditValue('');
  }

  function handleKeyDown(e, id) {
    if (e.key === 'Enter') saveEdit(id);
    if (e.key === 'Escape') cancelEdit();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-bold text-gray-800">جدول التكاليف التأسيسية</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="px-4 py-3 text-right font-semibold">التصنيف</th>
              <th className="px-4 py-3 text-right font-semibold">اسم البند</th>
              <th className="px-4 py-3 text-right font-semibold">الميزانية المحددة</th>
              <th className="px-4 py-3 text-right font-semibold">التكلفة الفعلية</th>
              <th className="px-4 py-3 text-right font-semibold">الفرق</th>
              <th className="px-4 py-3 text-right font-semibold">الحالة</th>
              <th className="px-4 py-3 text-center font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  لا توجد بنود مضافة بعد. أضف بنداً جديداً للبدء.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const variance = getVariance(item.budgeted, item.actual);
              const status = getStatus(variance);
              const isEditing = editingId === item.id;

              return (
                <tr key={item.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="inline-block bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-lg">
                      {getCategoryLabel(item.category)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{item.itemName}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(item.budgeted)}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, item.id)}
                          className="w-28 px-2 py-1 border border-primary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 text-right"
                          autoFocus
                          min="0"
                        />
                        <button
                          onClick={() => saveEdit(item.id)}
                          className="text-emerald-600 hover:text-emerald-700 p-1"
                          title="حفظ"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-gray-600 p-1"
                          title="إلغاء"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-700">{formatCurrency(item.actual)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold ${
                        status === 'over'
                          ? 'text-red-600'
                          : status === 'under'
                            ? 'text-emerald-600'
                            : 'text-gray-600'
                      }`}
                    >
                      {formatCurrency(Math.abs(variance))}
                      {status === 'over' && ' −'}
                      {status === 'under' && ' +'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      {!isEditing && (
                        <button
                          onClick={() => startEdit(item)}
                          className="text-primary-500 hover:text-primary-700 p-1.5 rounded-lg hover:bg-primary-50 transition-colors"
                          title="تعديل التكلفة الفعلية"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="حذف"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
