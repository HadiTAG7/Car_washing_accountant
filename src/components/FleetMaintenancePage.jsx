import { useMemo, useState } from 'react';
import {
  Plus, Activity, AlertTriangle, Wallet, Wrench, Trash2, Calendar, Download,
} from 'lucide-react';
import {
  getMaintenanceTypeLabel,
  getMaintenanceStatus,
  formatCurrency,
  formatNumber,
  exportToCSV,
  initialPartsEfficiency,
} from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, StatusBadge,
  PrimaryButton, SecondaryButton,
} from './UI';
import AddMaintenanceModal from './AddMaintenanceModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import { useMaintenanceLogs } from '../hooks/useMaintenanceLogs';
import { useVehicles } from '../hooks/useVehicles';

const STATUS_LABEL = {
  critical:   'متأخر جداً',
  overdue:    'متأخر',
  'due-soon': 'قريبة',
  good:       'حالة جيدة',
};

export default function FleetMaintenancePage() {
  const {
    logs,
    loading: logsLoading,
    error:   logsError,
    addLog,
    deleteLog,
    refetch: refetchLogs,
  } = useMaintenanceLogs();

  const {
    vehicles,
    loading: vehiclesLoading,
    error:   vehiclesError,
    refetch: refetchVehicles,
  } = useVehicles();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  // ── Computed KPIs ─────────────────────────────────────────
  const { criticalCount, totalCost, fleetHealth } = useMemo(() => {
    let critical = 0;
    let overdue  = 0;
    let cost     = 0;
    logs.forEach((r) => {
      const s = getMaintenanceStatus(r.nextServiceDate);
      if (s === 'critical') critical += 1;
      else if (s === 'overdue') overdue += 1;
      cost += r.estimatedCost || 0;
    });
    const total = logs.length || 1;
    const penalty = ((critical * 1.93) + (overdue * 0.8)) * (8 / total);
    const health = Math.max(0, Math.min(100, 100 - penalty));
    return { criticalCount: critical, totalCost: cost, fleetHealth: health };
  }, [logs]);

  async function handleAddRecord(record) {
    try {
      setMutationError(null);
      await addLog(record);
    } catch (err) {
      setMutationError(err);
    }
  }

  async function handleDeleteRecord(id) {
    try {
      setMutationError(null);
      await deleteLog(id);
    } catch (err) {
      setMutationError(err);
    }
  }

  function handleExport() {
    exportToCSV(
      'monster-wash-maintenance.csv',
      ['المركبة', 'نوع الصيانة', 'آخر صيانة', 'الصيانة القادمة', 'التكلفة التقديرية', 'الحالة'],
      logs.map((r) => [
        r.assetName,
        getMaintenanceTypeLabel(r.maintenanceType),
        r.lastServiceDate,
        r.nextServiceDate,
        r.estimatedCost,
        STATUS_LABEL[getMaintenanceStatus(r.nextServiceDate)] || '',
      ]),
    );
  }

  const loading = (logsLoading && logs.length === 0) || (vehiclesLoading && vehicles.length === 0);

  return (
    <>
      <TopBar
        title="صيانة الأسطول"
        subtitle="مراقبة حالة المركبات والمعدات وجدولة الصيانة الوقائية"
        actions={
          <SecondaryButton icon={Download} onClick={handleExport} className="hidden md:inline-flex">
            تصدير CSV
          </SecondaryButton>
        }
      />

      <main className="p-8 space-y-6">
        {mutationError && (
          <ErrorState
            title="تعذّر تنفيذ العملية"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}
        {logsError && (
          <ErrorState
            title="تعذّر تحميل سجلات الصيانة"
            error={logsError}
            onRetry={refetchLogs}
          />
        )}
        {vehiclesError && (
          <ErrorState
            title="تعذّر تحميل المركبات"
            error={vehiclesError}
            onRetry={refetchVehicles}
          />
        )}

        {/* ── KPI row ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Activity}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="صحة الأسطول العامة"
            value={`${fleetHealth.toFixed(1)}%`}
            sub="بناءً على حالة المركبات وقطع الغيار"
          />
          <StatCard
            icon={AlertTriangle}
            iconBg="bg-red-50"
            iconColor="text-red-600"
            label="تنبيهات حرجة"
            value={criticalCount.toString().padStart(2, '0')}
            sub="مركبات بحاجة إلى صيانة فورية"
          />
          <StatCard
            icon={Wallet}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="تكلفة الصيانة الشهرية"
            value={formatCurrency(totalCost)}
            sub={`${formatNumber(logs.length)} سجل صيانة نشط`}
          />
        </div>

        {/* ── Maintenance log table ───────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="سجل الصيانة"
            subtitle="جميع عمليات الصيانة المجدولة والمستحقة — انقر على تاريخ قادم لإعادة جدولة"
            action={
              <PrimaryButton
                icon={Plus}
                onClick={() => setIsModalOpen(true)}
                disabled={vehicles.length === 0}
                title={vehicles.length === 0 ? 'أضف مركبة أولاً' : undefined}
              >
                إضافة سجل صيانة
              </PrimaryButton>
            }
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">المركبة/المعدة</th>
                  <th className="py-3 px-4">نوع الصيانة</th>
                  <th className="py-3 px-4">آخر صيانة</th>
                  <th className="py-3 px-4">الصيانة القادمة</th>
                  <th className="py-3 px-4 text-left tabular-nums">التكلفة</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-left w-16">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10">
                      <LoadingState message="جارٍ تحميل سجلات الصيانة..." />
                    </td>
                  </tr>
                )}
                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                      لا توجد سجلات صيانة مسجّلة بعد
                    </td>
                  </tr>
                )}
                {logs.map((r) => {
                  const status = getMaintenanceStatus(r.nextServiceDate);
                  return (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="bg-primary-50 text-primary-700 w-8 h-8 rounded-lg flex items-center justify-center">
                            <Wrench size={14} />
                          </span>
                          {r.assetName}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {getMaintenanceTypeLabel(r.maintenanceType)}
                      </td>
                      <td className="py-3 px-4 text-slate-500 tabular-nums">{r.lastServiceDate}</td>
                      <td className="py-3 px-4 tabular-nums">
                        <span className={`inline-flex items-center gap-1.5 ${
                          status === 'critical' || status === 'overdue' ? 'text-red-600 font-semibold' : 'text-slate-700'
                        }`}>
                          <Calendar size={13} />
                          {r.nextServiceDate}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left tabular-nums text-slate-700">
                        {formatCurrency(r.estimatedCost)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={status}>{STATUS_LABEL[status]}</StatusBadge>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          onClick={() => handleDeleteRecord(r.id)}
                          className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          aria-label="حذف"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Parts efficiency dark card ──────────────────── */}
        <div className="bg-gradient-to-br from-primary-900 to-primary-950 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Activity size={20} className="text-primary-300" />
              تقرير كفاءة القطع
            </h2>
            <span className="text-[11px] font-semibold bg-white/10 text-primary-100 px-3 py-1 rounded-full">
              هذا الشهر
            </span>
          </div>
          <p className="text-xs text-primary-300 mb-6">
            نسبة الحياة المتبقية من العمر الافتراضي لكل قطعة رئيسية في الأسطول
          </p>

          <div className="space-y-4">
            {initialPartsEfficiency.map((p) => {
              const color = p.lifeRatio >= 80 ? 'emerald' : p.lifeRatio >= 60 ? 'amber' : 'red';
              const barClass =
                color === 'emerald' ? 'bg-emerald-400' :
                color === 'amber'   ? 'bg-amber-400'   :
                                      'bg-red-400';
              return (
                <div key={p.partName}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-semibold text-primary-100">{p.partName}</span>
                    <span className="text-sm font-bold tabular-nums">{p.lifeRatio}%</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                      style={{ width: `${p.lifeRatio}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <AddMaintenanceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAddRecord}
        vehicles={vehicles}
      />
    </>
  );
}
