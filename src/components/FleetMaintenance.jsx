import { Wrench, AlertTriangle, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import {
  formatCurrency,
  getMaintenanceTypeLabel,
  getMaintenanceStatus,
} from '../data/initialData';

function formatDate(dateStr) {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr));
}

function StatusBadge({ status }) {
  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        🔴 متأخرة
      </span>
    );
  }
  if (status === 'due-soon') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        🟡 قريبة
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
      🟢 جيدة
    </span>
  );
}

function MaintenanceSummaryCards({ records }) {
  const overdue = records.filter((r) => getMaintenanceStatus(r.nextServiceDate) === 'overdue').length;
  const dueSoon = records.filter((r) => getMaintenanceStatus(r.nextServiceDate) === 'due-soon').length;
  const totalEstCost = records.reduce((s, r) => s + r.estimatedCost, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-red-50 text-red-600 p-3 rounded-xl">
            <AlertTriangle size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">صيانات متأخرة</p>
        <p className="text-2xl font-bold text-red-700">{overdue}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-amber-50 text-amber-600 p-3 rounded-xl">
            <Clock size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">صيانات قريبة (خلال ١٤ يوم)</p>
        <p className="text-2xl font-bold text-amber-700">{dueSoon}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-primary-50 text-primary-600 p-3 rounded-xl">
            <Wrench size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي التكاليف التقديرية</p>
        <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalEstCost)}</p>
      </div>
    </div>
  );
}

export default function FleetMaintenance({ records, onDeleteRecord }) {
  return (
    <>
      <MaintenanceSummaryCards records={records} />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Wrench size={20} className="text-primary-600" />
            سجل صيانة الأسطول
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-4 py-3 text-right font-semibold">المركبة/المعدة</th>
                <th className="px-4 py-3 text-right font-semibold">نوع الصيانة</th>
                <th className="px-4 py-3 text-right font-semibold">آخر صيانة</th>
                <th className="px-4 py-3 text-right font-semibold">الصيانة القادمة</th>
                <th className="px-4 py-3 text-right font-semibold">التكلفة التقديرية</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                <th className="px-4 py-3 text-center font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    لا توجد سجلات صيانة بعد. أضف سجلاً جديداً للبدء.
                  </td>
                </tr>
              )}
              {records.map((rec) => {
                const status = getMaintenanceStatus(rec.nextServiceDate);
                return (
                  <tr key={rec.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{rec.assetName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-lg">
                        {getMaintenanceTypeLabel(rec.maintenanceType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(rec.lastServiceDate)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(rec.nextServiceDate)}</td>
                    <td className="px-4 py-3 text-gray-700 font-semibold">{formatCurrency(rec.estimatedCost)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => onDeleteRecord(rec.id)}
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
    </>
  );
}
