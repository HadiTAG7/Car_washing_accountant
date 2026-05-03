import { useMemo, useState } from 'react';
import {
  Plus, Users, UserCheck, Briefcase, Trash2, Phone, Pencil, Check, X,
} from 'lucide-react';
import { formatNumber } from '../data/initialData';
import TopBar from './TopBar';
import {
  Card, SectionHeader, StatCard, StatusBadge,
  PrimaryButton,
} from './UI';
import AddPartnerModal from './AddPartnerModal';
import LoadingState from './LoadingState';
import ErrorState from './ErrorState';
import { usePartners } from '../hooks/usePartners';

function EditableCell({ value, onSave, type = 'text', placeholder, className = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const next = type === 'number' ? parseInt(draft, 10) || 0 : String(draft || '').trim();
    if (next !== value) onSave(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          placeholder={placeholder}
          autoFocus
          className={`px-2 py-1 border border-primary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 ${className}`}
        />
        <button onClick={commit} className="text-emerald-600 hover:text-emerald-800 p-0.5"><Check size={14} /></button>
        <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 p-0.5"><X size={14} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <span>{value || <span className="text-slate-300">—</span>}</span>
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className="text-slate-300 hover:text-primary-600 p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}

export default function PartnersPage() {
  const {
    partners,
    loading,
    error,
    addPartner,
    updatePartner,
    deletePartner,
    refetch,
  } = usePartners();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState(null);

  // ── KPI totals ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPartners = partners.length;
    const totalWorkers  = partners.reduce((s, p) => s + (p.workersCount || 0), 0);
    const activeCount   = partners.filter((p) => p.status === 'active').length;
    return { totalPartners, totalWorkers, activeCount };
  }, [partners]);

  async function handleAdd(partner) {
    try { setMutationError(null); await addPartner(partner); }
    catch (e) { setMutationError(e); }
  }
  async function handleUpdate(id, patch) {
    try { setMutationError(null); await updatePartner(id, patch); }
    catch (e) { setMutationError(e); }
  }
  async function handleDelete(id) {
    try { setMutationError(null); await deletePartner(id); }
    catch (e) { setMutationError(e); }
  }
  async function toggleStatus(p) {
    await handleUpdate(p.id, { status: p.status === 'active' ? 'inactive' : 'active' });
  }

  return (
    <>
      <TopBar
        title="إدارة الشركاء"
        subtitle="متابعة الشركاء، عدد العمالة، وبيانات التواصل"
      />

      <main className="p-8 space-y-6">
        {mutationError && (
          <ErrorState
            title="تعذّر تنفيذ العملية"
            error={mutationError}
            onRetry={() => setMutationError(null)}
          />
        )}
        {error && (
          <ErrorState
            title="تعذّر تحميل بيانات الشركاء"
            error={error}
            onRetry={refetch}
          />
        )}

        {/* ── KPI row ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <StatCard
            icon={Briefcase}
            iconBg="bg-primary-50"
            iconColor="text-primary-700"
            label="إجمالي الشركاء"
            value={formatNumber(kpis.totalPartners)}
            sub="عدد الشركاء المسجّلين في النظام"
          />
          <StatCard
            icon={Users}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            label="إجمالي العمالة"
            value={formatNumber(kpis.totalWorkers)}
            sub="مجموع عمالة جميع الشركاء"
          />
          <StatCard
            icon={UserCheck}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            label="الشركاء النشطين"
            value={formatNumber(kpis.activeCount)}
            sub={`${kpis.totalPartners > 0 ? ((kpis.activeCount / kpis.totalPartners) * 100).toFixed(0) : 0}% من إجمالي الشركاء`}
          />
        </div>

        {/* ── Partners table ─────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            title="قائمة الشركاء"
            subtitle="انقر على أي خانة للتعديل المباشر — أو على زر الحالة لتفعيل/تعطيل الشريك"
            action={
              <PrimaryButton icon={Plus} onClick={() => setIsModalOpen(true)}>
                إضافة شريك جديد
              </PrimaryButton>
            }
          />
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] font-bold text-slate-500 uppercase border-b border-slate-100">
                  <th className="py-3 px-4">اسم الشريك</th>
                  <th className="py-3 px-4 text-center">عدد العمالة</th>
                  <th className="py-3 px-4">رقم التواصل</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-left w-16">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading && partners.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10">
                      <LoadingState message="جارٍ تحميل بيانات الشركاء..." />
                    </td>
                  </tr>
                )}
                {!loading && partners.length === 0 && !error && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                      لا يوجد شركاء مسجّلين بعد — اضغط &quot;إضافة شريك جديد&quot; للبدء
                    </td>
                  </tr>
                )}
                {partners.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="bg-primary-50 text-primary-700 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Briefcase size={14} />
                        </span>
                        <EditableCell
                          value={p.partnerName}
                          onSave={(v) => v && handleUpdate(p.id, { partnerName: v })}
                          className="w-48"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center tabular-nums text-slate-700">
                      <EditableCell
                        value={p.workersCount}
                        type="number"
                        onSave={(v) => handleUpdate(p.id, { workersCount: v })}
                        className="w-20 text-center"
                      />
                    </td>
                    <td className="py-3 px-4 text-slate-600 tabular-nums">
                      <div className="flex items-center gap-2">
                        <Phone size={13} className="text-slate-400 flex-shrink-0" />
                        <EditableCell
                          value={p.contactNumber}
                          onSave={(v) => handleUpdate(p.id, { contactNumber: v })}
                          placeholder="+966 5X XXX XXXX"
                          className="w-40"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <button onClick={() => toggleStatus(p)} className="cursor-pointer" title="انقر لتغيير الحالة">
                        <StatusBadge status={p.status === 'active' ? 'good' : 'neutral'}>
                          {p.status === 'active' ? 'نشط' : 'غير نشط'}
                        </StatusBadge>
                      </button>
                    </td>
                    <td className="py-3 px-4 text-left">
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        aria-label="حذف"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      <AddPartnerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAdd}
      />
    </>
  );
}
