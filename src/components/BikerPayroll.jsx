import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign, Banknote, CalendarDays, CheckCircle2, Download, Eye,
  Landmark, LockKeyhole, Printer, RotateCcw, Save, ShieldAlert, Undo2, WalletCards,
} from 'lucide-react';
import { Card, SectionHeader, StatCard } from './UI';
import ErrorState from './ErrorState';
import LoadingState from './LoadingState';
import Toast from './Toast';
import DateField from './DateField';
import { usePayrollItems, usePayrollRuns } from '../hooks/usePayroll';
import { describeBackendError } from '../lib/firebaseClient';
import { downloadCsv } from '../lib/exportCsv';
import { formatCurrency, formatDate, formatNumber } from '../data/initialData';
import './BikerPayroll.css';

const POLICY = 'أيام الشهر الفعلية';
const FORMULA = 'صافي المستحق = الراتب المستحق + العمولة + البونص − الخصومات − السلفة المخصومة';
const STATUS = {
  draft: 'مسودة', approved: 'معتمد', paid: 'مصروف', reversed: 'معكوس', cancelled: 'ملغى',
};
const INPUT = 'w-full px-3 py-2.5 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm tabular-nums focus:outline-none focus:border-primary-500 disabled:opacity-60';

function monthKeyNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function todayLocalIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function boundsOf(periodKey) {
  const safeKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey) ? periodKey : monthKeyNow();
  const [year, month] = safeKey.split('-').map(Number);
  const days = new Date(year, month, 0).getDate();
  const next = new Date(year, month, 1);
  return {
    start: `${safeKey}-01`,
    end: `${safeKey}-${String(days).padStart(2, '0')}`,
    distribution: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
  };
}

function statusClass(status) {
  return {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    paid: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    reversed: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    cancelled: 'bg-slate-800 text-white dark:bg-slate-700',
  }[status] || 'bg-slate-100 text-slate-700';
}

function StatusChip({ status }) {
  return <span className={`inline-flex px-2.5 py-1 rounded-control text-[11px] font-bold ${statusClass(status)}`}>{STATUS[status] || status}</span>;
}

const DEMO_LINES = [
  {
    bikerId: 'demo-1', name: 'أحمد محمد', monthlySalary: 1200, startDate: '2026-08-01', endDate: null,
    eligibleStart: '2026-08-01', eligibleEnd: '2026-08-31', daysEntitled: 31, monthDays: 31,
    basicDue: 1200, commission: 86, bonus: 100, bonusReason: 'التزام مميز', deduction: 25,
    deductionReason: 'غياب موثق', advanceOutstanding: 300, advanceDeduction: 150, netDue: 1211, status: 'draft',
  },
  {
    bikerId: 'demo-2', name: 'محمد علي', monthlySalary: 900, startDate: '2026-08-16', endDate: null,
    eligibleStart: '2026-08-16', eligibleEnd: '2026-08-31', daysEntitled: 16, monthDays: 31,
    basicDue: 464.52, commission: 42, bonus: 0, bonusReason: null, deduction: 0,
    deductionReason: null, advanceOutstanding: 0, advanceDeduction: 0, netDue: 506.52, status: 'draft',
  },
  {
    bikerId: 'demo-3', name: 'سالم حسن', monthlySalary: 1000, startDate: '2026-07-10', endDate: '2026-08-20',
    eligibleStart: '2026-08-01', eligibleEnd: '2026-08-20', daysEntitled: 20, monthDays: 31,
    basicDue: 645.16, commission: 28, bonus: 0, bonusReason: null, deduction: 50,
    deductionReason: 'عهدة تشغيلية مستقلة', advanceOutstanding: 100, advanceDeduction: 100, netDue: 523.16, status: 'draft',
  },
];

const DEMO_PREVIEW = {
  runId: null, periodKey: '2026-08', periodStart: '2026-08-01', periodEnd: '2026-08-31',
  distributionDate: '2026-09-01', policySnapshot: { method: 'actual_month_days', label: POLICY, monthDays: 31 },
  estimated: true, status: 'draft', lineCount: DEMO_LINES.length, lines: DEMO_LINES,
  totals: { basic: 2309.68, commissions: 156, bonuses: 100, deductions: 75, advances: 250, net: 2240.68 },
};

function previewFromRun(run, items) {
  if (!run) return null;
  return {
    ...run,
    status: run.status || 'draft',
    lines: items || [],
    lineCount: items?.length || run.lineCount || 0,
  };
}

function adjustmentsFromLines(lines) {
  return Object.fromEntries((lines || []).map((line) => [line.bikerId, {
    bikerId: line.bikerId,
    bonus: line.bonus || 0,
    bonusReason: line.bonusReason || '',
    deduction: line.deduction || 0,
    deductionReason: line.deductionReason || '',
    advanceDeduction: line.advanceDeduction || 0,
  }]));
}

function PayrollActionDialog({ action, run, busy, onClose, onSubmit }) {
  const today = todayLocalIso();
  const earlyPay = action === 'pay' && today < (run?.distributionDate || '');
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [date, setDate] = useState(action === 'pay'
    ? (earlyPay ? today : (run?.distributionDate || today)) : today);
  if (!action) return null;
  const meta = {
    approve: ['اعتماد مسير الرواتب', 'الاعتماد يثبّت اللقطات ولا ينشئ قيداً محاسبياً.'],
    unapprove: ['إلغاء اعتماد المسير', 'سيعود المسير إلى مسودة، والسبب إلزامي ويُسجَّل في التدقيق.'],
    pay: ['صرف مسير الرواتب', 'ينشئ الخادم قيداً متوازناً ويسوّي السلف ذرياً. لا يوجد تحويل بنكي تلقائي.'],
    reverse: ['عكس مسير مصروف', 'سيُنشأ قيد عكسي وتُعاد أرصدة السلف وحالات السطور ذرياً.'],
    cancel: ['إلغاء المسودة', 'يُحفظ الإلغاء والسبب ولا يُحذف المسير.'],
  }[action];
  const reasonRequired = ['unapprove', 'reverse', 'cancel'].includes(action) || earlyPay;
  const valid = action === 'approve' || (!reasonRequired || reason.trim())
    && (action !== 'pay' || Boolean(date)) && (action !== 'reverse' || Boolean(date));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={meta[0]}>
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative w-full max-w-lg p-5 sm:p-6 payroll-no-print">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{meta[0]}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{meta[1]}</p>
        {action === 'pay' && (
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              طريقة الصرف
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={`mt-1 ${INPUT}`}>
                <option value="bank">بنكي</option><option value="cash">نقدي</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              تاريخ الصرف
              <DateField value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
        )}
        {action === 'reverse' && (
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mt-5">
            تاريخ القيد العكسي
            <DateField value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {action !== 'approve' && (
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mt-4">
            السبب {reasonRequired && <span className="text-rose-600">— إلزامي</span>}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={`mt-1 ${INPUT} resize-none`} placeholder="اكتب سبباً واضحاً للتدقيق" />
          </label>
        )}
        <div className="flex gap-2 mt-5">
          <button type="button" disabled={!valid || busy} onClick={() => onSubmit({ reason: reason.trim(), paymentMethod, date })} className="sw-button sw-button--sm sw-button--primary">
            {busy ? 'جارٍ التنفيذ…' : 'تأكيد'}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className="sw-button sw-button--sm sw-button--secondary">إلغاء</button>
        </div>
      </Card>
    </div>
  );
}

function AdjustmentInputs({ line, adjustment, disabled, onChange, compact = false }) {
  const inputClass = 'w-full min-w-24 px-2 py-2 rounded-control border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm tabular-nums focus:outline-none focus:border-primary-500 disabled:opacity-60';
  const reasonClass = `${inputClass} mt-1 min-w-36 text-right`;
  const moneyInput = (key, label, max) => (
    <div className={compact ? '' : 'min-w-36'}>
      <label className="sr-only">{label} {line.name}</label>
      <input type="number" min="0" max={max} step="0.01" disabled={disabled} value={adjustment[key] ?? 0}
        onChange={(e) => onChange(key, e.target.value)} className={inputClass} aria-label={`${label} ${line.name}`} />
    </div>
  );
  return (
    <>
      <div>
        {compact && <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">البونص</span>}
        {moneyInput('bonus', 'بونص')}
        {(Number(adjustment.bonus) || 0) > 0 && <input disabled={disabled} value={adjustment.bonusReason || ''} onChange={(e) => onChange('bonusReason', e.target.value)} className={reasonClass} placeholder="سبب البونص (إلزامي)" aria-label={`سبب بونص ${line.name}`} />}
      </div>
      <div>
        {compact && <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">الخصم</span>}
        {moneyInput('deduction', 'خصم')}
        {(Number(adjustment.deduction) || 0) > 0 && <input disabled={disabled} value={adjustment.deductionReason || ''} onChange={(e) => onChange('deductionReason', e.target.value)} className={reasonClass} placeholder="سبب الخصم (إلزامي)" aria-label={`سبب خصم ${line.name}`} />}
      </div>
      <div>
        {compact && <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">السلفة المخصومة</span>}
        {moneyInput('advanceDeduction', 'خصم السلفة', line.advanceOutstanding)}
        <span className="block text-[10px] text-slate-500 mt-1">من قائم {formatCurrency(line.advanceOutstanding)}</span>
      </div>
    </>
  );
}

export default function BikerPayroll({ role, previewMode = false }) {
  const [periodKey, setPeriodKey] = useState(previewMode ? '2026-08' : monthKeyNow());
  const bounds = useMemo(() => boundsOf(periodKey), [periodKey]);
  const [periodStart, setPeriodStart] = useState(bounds.start);
  const [periodEnd, setPeriodEnd] = useState(bounds.end);
  const [preview, setPreview] = useState(previewMode ? DEMO_PREVIEW : null);
  const [adjustments, setAdjustments] = useState(() => adjustmentsFromLines(previewMode ? DEMO_LINES : []));
  const [busy, setBusy] = useState(null);
  const [action, setAction] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', tone: 'success' });
  const api = usePayrollRuns({ enabled: !previewMode });

  const activeRun = useMemo(() => api.runs.find((run) => run.periodKey === periodKey
    && !['reversed', 'cancelled'].includes(run.status)) || null, [api.runs, periodKey]);
  const itemsQuery = usePayrollItems(activeRun?.runId, { enabled: !previewMode });

  useEffect(() => {
    setPeriodStart(bounds.start); setPeriodEnd(bounds.end);
    if (!previewMode) { setPreview(null); setAdjustments({}); }
  }, [bounds.start, bounds.end, previewMode]);

  useEffect(() => {
    if (previewMode || !activeRun || itemsQuery.loading) return;
    const next = previewFromRun(activeRun, itemsQuery.data || []);
    setPreview(next);
    setPeriodStart(activeRun.periodStart || bounds.start);
    setPeriodEnd(activeRun.periodEnd || bounds.end);
    setAdjustments(adjustmentsFromLines(next.lines));
  }, [activeRun, itemsQuery.data, itemsQuery.loading, bounds.start, bounds.end, previewMode]);

  const canDraft = role === 'admin' || role === 'accountant' || previewMode;
  const isAdmin = role === 'admin' && !previewMode;
  const locked = previewMode || ['approved', 'paid', 'reversed', 'cancelled'].includes(preview?.status);

  const payload = useCallback(() => ({
    periodKey, periodStart, periodEnd,
    adjustments: Object.values(adjustments).map((row) => ({
      ...row,
      bonus: Number(row.bonus) || 0,
      deduction: Number(row.deduction) || 0,
      advanceDeduction: Number(row.advanceDeduction) || 0,
    })),
  }), [periodKey, periodStart, periodEnd, adjustments]);

  const guarded = useCallback(async (name, fn, message) => {
    if (previewMode) return null;
    setBusy(name); setError(null);
    try {
      const result = await fn();
      setToast({ open: true, message, tone: 'success' });
      await api.refetch();
      return result;
    } catch (e) {
      const text = describeBackendError(e) || e?.message || 'تعذّر تنفيذ العملية';
      setError(e); setToast({ open: true, message: text, tone: 'error' });
      return null;
    } finally { setBusy(null); }
  }, [api, previewMode]);

  const runPreview = () => guarded('preview', async () => {
    const result = await api.preview(payload());
    setPreview({ ...result, status: activeRun?.status || 'draft', runId: activeRun?.runId || null });
    setAdjustments(adjustmentsFromLines(result.lines));
    return result;
  }, 'اكتملت المعاينة الخادمية');

  const saveDraft = () => guarded('save', async () => {
    const result = await api.saveDraft(payload());
    setPreview({ ...result, status: 'draft' });
    setAdjustments(adjustmentsFromLines(result.lines));
    return result;
  }, 'حُفظت المسودة دون إنشاء قيد');

  const updateAdjustment = (line, key, value) => setAdjustments((prev) => ({
    ...prev,
    [line.bikerId]: { ...(prev[line.bikerId] || { bikerId: line.bikerId }), [key]: value },
  }));

  const exportCsv = () => {
    if (!preview?.lines?.length) return;
    downloadCsv(`مسير-رواتب-${periodKey}`, [
      'الاسم', 'الراتب الشهري', 'تاريخ المباشرة', 'نهاية الخدمة', 'الأيام المستحقة',
      'الأساسي المستحق', 'العمولة', 'البونص', 'سبب البونص', 'الخصم', 'سبب الخصم',
      'السلف القائمة', 'السلفة المخصومة', 'صافي المستحق', 'الحالة',
    ], preview.lines.map((line) => [
      line.name, line.monthlySalary, line.startDate || '', line.endDate || '', line.daysEntitled,
      line.basicDue, line.commission, line.bonus, line.bonusReason || '', line.deduction,
      line.deductionReason || '', line.advanceOutstanding, line.advanceDeduction, line.netDue,
      STATUS[line.status || preview.status] || line.status || preview.status,
    ]));
  };

  async function submitAction(values) {
    const current = action;
    let result = null;
    if (current === 'approve') result = await guarded('approve', () => api.approve(preview.runId), 'اعتُمد المسير دون قيد');
    if (current === 'unapprove') result = await guarded('unapprove', () => api.unapprove(preview.runId, values.reason), 'أُلغي الاعتماد وعاد المسير مسودة');
    if (current === 'pay') result = await guarded('pay', () => api.pay({
      runId: preview.runId, paymentMethod: values.paymentMethod, payDate: values.date, earlyReason: values.reason,
    }), 'صُرف المسير ورُحّل القيد ذرياً');
    if (current === 'reverse') result = await guarded('reverse', () => api.reverse({
      runId: preview.runId, reversalDate: values.date, reason: values.reason,
    }), 'عُكس المسير وأُعيدت السلف ذرياً');
    if (current === 'cancel') result = await guarded('cancel', () => api.cancel(preview.runId, values.reason), 'أُلغي المسير دون حذف');
    if (result) {
      setAction(null);
      if (['reverse', 'cancel'].includes(current)) {
        setPreview(null);
        setAdjustments({});
      } else {
        setPreview((old) => ({ ...old, status: result.status || old.status, ...result }));
      }
    }
  }

  const totals = preview?.totals || { basic: 0, commissions: 0, bonuses: 0, deductions: 0, advances: 0, net: 0 };
  const status = preview?.status || 'draft';
  const loading = api.loading || itemsQuery.loading;

  return (
    <section className="space-y-5 payroll-print-root" aria-label="مسير الرواتب">
      {error && <ErrorState title="تعذّر تنفيذ عملية المسير" error={error} onRetry={() => setError(null)} />}
      <Card className="p-4 sm:p-5 payroll-no-print">
        <div className="flex flex-col xl:flex-row xl:items-end gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">الشهر
              <input type="month" value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className={`mt-1 ${INPUT}`} />
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">بداية فترة الراتب
              <DateField value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </label>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">نهاية فترة الراتب
              <DateField value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canDraft || busy || locked} onClick={runPreview} className="sw-button sw-button--sm sw-button--secondary"><Eye size={16} /> معاينة</button>
            <button type="button" disabled={!canDraft || busy || locked || !preview?.lines?.length} onClick={saveDraft} className="sw-button sw-button--sm sw-button--primary"><Save size={16} /> حفظ المسودة</button>
          </div>
        </div>
        <div className="mt-4 grid md:grid-cols-3 gap-2 text-[11px] leading-relaxed">
          <p className="bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 rounded-control px-3 py-2"><strong>السياسة المعتمدة:</strong> {POLICY} · يوم المباشرة ونهاية الخدمة محسوبان.</p>
          <p className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-control px-3 py-2"><strong>موعد التوزيع:</strong> {formatDate(preview?.distributionDate || bounds.distribution)} عن الشهر السابق · بلا تحويل تلقائي.</p>
          <p className="bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 rounded-control px-3 py-2"><strong>المعادلة:</strong> {FORMULA}</p>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 payroll-print-header">
        <div>
          <p className="text-xs text-primary-600 dark:text-primary-400 font-bold">مسير رواتب البايكر</p>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{periodKey} · {formatDate(periodStart)} — {formatDate(periodEnd)}</h2>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto"><StatusChip status={status} />{preview?.estimated && <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">تقديري قبل اكتمال الشهر</span>}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard icon={Banknote} tone="primary" label="إجمالي الأساسي" value={formatCurrency(totals.basic)} />
        <StatCard icon={BadgeDollarSign} tone="indigo" label="العمولات" value={formatCurrency(totals.commissions)} />
        <StatCard icon={CheckCircle2} tone="emerald" label="البونص" value={formatCurrency(totals.bonuses)} />
        <StatCard icon={ShieldAlert} tone="rose" label="الخصومات" value={formatCurrency(totals.deductions)} />
        <StatCard icon={WalletCards} tone="amber" label="السلف المخصومة" value={formatCurrency(totals.advances)} />
        <StatCard icon={Landmark} tone="accent" label="صافي الرواتب" value={formatCurrency(totals.net)} />
      </div>

      <Card className="p-4 sm:p-6">
        <SectionHeader title="تفاصيل الاستحقاق" subtitle="كل مبلغ معروض من معاينة الخادم؛ عدّل المسودة ثم أعد المعاينة قبل الحفظ." action={preview?.lines?.length ? (
          <div className="flex gap-2 payroll-no-print">
            <button type="button" onClick={exportCsv} className="sw-button sw-button--sm sw-button--secondary"><Download size={16} /> CSV</button>
            <button type="button" onClick={() => window.print()} className="sw-button sw-button--sm sw-button--secondary"><Printer size={16} /> طباعة</button>
          </div>
        ) : null} />
        {loading && !preview ? <LoadingState message="جارٍ تحميل المسير…" /> : null}
        {!loading && !preview ? <p className="py-10 text-center text-sm text-slate-500">اختر الفترة واضغط «معاينة» لاحتساب المسير على الخادم.</p> : null}

        {preview?.lines?.length ? (
          <>
            <div className="hidden lg:block overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <table className="w-full min-w-[1900px] text-xs">
                <thead><tr className="text-right text-[10px] font-bold text-slate-500 uppercase border-b border-slate-100 dark:border-slate-800">
                  {['العامل','الراتب / المباشرة','الأيام','الأساسي','العمولة','البونص + السبب','الخصم + السبب','السلف القائمة','خصم السلفة','الصافي','الحالة'].map((h) => <th key={h} className="py-3 px-3">{h}</th>)}
                </tr></thead>
                <tbody>{preview.lines.map((line) => {
                  const adj = adjustments[line.bikerId] || adjustmentsFromLines([line])[line.bikerId];
                  return <tr key={line.bikerId} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-3 px-3 font-bold min-w-36">{line.name}</td>
                    <td className="py-3 px-3 min-w-44"><strong className="tabular-nums">{formatCurrency(line.monthlySalary)}</strong><span className="block text-[10px] text-slate-500 mt-1">{line.startDate ? `باشر ${formatDate(line.startDate)}` : 'بلا تاريخ مباشرة'}{line.endDate ? ` · انتهى ${formatDate(line.endDate)}` : ''}</span></td>
                    <td className="py-3 px-3 tabular-nums">{formatNumber(line.daysEntitled)} / {formatNumber(line.monthDays)}<span className="block text-[10px] text-slate-500 mt-1">{formatDate(line.eligibleStart)} — {formatDate(line.eligibleEnd)}</span></td>
                    <td className="py-3 px-3 font-bold tabular-nums">{formatCurrency(line.basicDue)}</td>
                    <td className="py-3 px-3 tabular-nums">{formatCurrency(line.commission)}</td>
                    <td className="py-3 px-3 min-w-40"><input type="number" min="0" step="0.01" disabled={locked} value={adj.bonus ?? 0} onChange={(e) => updateAdjustment(line, 'bonus', e.target.value)} className={INPUT} aria-label={`بونص ${line.name}`} />{(Number(adj.bonus) || 0) > 0 && <input disabled={locked} value={adj.bonusReason || ''} onChange={(e) => updateAdjustment(line, 'bonusReason', e.target.value)} className={`${INPUT} mt-1`} placeholder="سبب إلزامي" aria-label={`سبب بونص ${line.name}`} />}</td>
                    <td className="py-3 px-3 min-w-40"><input type="number" min="0" step="0.01" disabled={locked} value={adj.deduction ?? 0} onChange={(e) => updateAdjustment(line, 'deduction', e.target.value)} className={INPUT} aria-label={`خصم ${line.name}`} />{(Number(adj.deduction) || 0) > 0 && <input disabled={locked} value={adj.deductionReason || ''} onChange={(e) => updateAdjustment(line, 'deductionReason', e.target.value)} className={`${INPUT} mt-1`} placeholder="سبب إلزامي" aria-label={`سبب خصم ${line.name}`} />}</td>
                    <td className="py-3 px-3 font-semibold text-amber-700 tabular-nums">{formatCurrency(line.advanceOutstanding)}</td>
                    <td className="py-3 px-3"><input type="number" min="0" max={line.advanceOutstanding} step="0.01" disabled={locked} value={adj.advanceDeduction ?? 0} onChange={(e) => updateAdjustment(line, 'advanceDeduction', e.target.value)} className={`${INPUT} w-28`} aria-label={`خصم السلفة ${line.name}`} /></td>
                    <td className="py-3 px-3 font-extrabold text-primary-700 dark:text-primary-300 tabular-nums">{formatCurrency(line.netDue)}</td>
                    <td className="py-3 px-3"><StatusChip status={line.status || status} /></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>

            <div className="lg:hidden space-y-3">{preview.lines.map((line) => {
              const adj = adjustments[line.bikerId] || adjustmentsFromLines([line])[line.bikerId];
              return <article key={line.bikerId} className="border border-slate-100 dark:border-slate-800 rounded-smallcard p-4 space-y-3">
                <div className="flex justify-between gap-3"><div><h3 className="font-bold text-slate-900 dark:text-slate-100">{line.name}</h3><p className="text-[11px] text-slate-500">{formatCurrency(line.monthlySalary)} · {line.daysEntitled}/{line.monthDays} يوماً</p></div><StatusChip status={line.status || status} /></div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]"><div className="bg-slate-50 dark:bg-slate-800 rounded-control p-2"><span className="block text-slate-500">الأساسي</span><strong>{formatCurrency(line.basicDue)}</strong></div><div className="bg-slate-50 dark:bg-slate-800 rounded-control p-2"><span className="block text-slate-500">العمولة</span><strong>{formatCurrency(line.commission)}</strong></div><div className="bg-primary-50 dark:bg-primary-500/10 rounded-control p-2"><span className="block text-slate-500">الصافي</span><strong>{formatCurrency(line.netDue)}</strong></div></div>
                <p className="text-[10px] text-slate-500">الفترة المستحقة: {formatDate(line.eligibleStart)} — {formatDate(line.eligibleEnd)}{line.endDate ? ` · نهاية الخدمة ${formatDate(line.endDate)}` : ''}</p>
                <div className="grid grid-cols-1 gap-3"><AdjustmentInputs line={line} adjustment={adj} disabled={locked} onChange={(k, v) => updateAdjustment(line, k, v)} compact /></div>
              </article>;
            })}</div>
          </>
        ) : null}
      </Card>

      {preview?.runId && !previewMode && (
        <Card className="p-4 sm:p-5 payroll-no-print">
          <div className="flex flex-wrap items-center gap-2">
            {status === 'draft' && <button type="button" disabled={!isAdmin || busy} onClick={() => setAction('approve')} className="sw-button sw-button--sm sw-button--primary"><CheckCircle2 size={16} /> اعتماد المسير</button>}
            {status === 'draft' && <button type="button" disabled={!isAdmin || busy} onClick={() => setAction('cancel')} className="sw-button sw-button--sm sw-button--secondary"><Undo2 size={16} /> إلغاء المسودة</button>}
            {status === 'approved' && <button type="button" disabled={!isAdmin || busy} onClick={() => setAction('pay')} className="sw-button sw-button--sm sw-button--primary"><Landmark size={16} /> صرف نقدي/بنكي</button>}
            {status === 'approved' && <button type="button" disabled={!isAdmin || busy} onClick={() => setAction('unapprove')} className="sw-button sw-button--sm sw-button--secondary"><LockKeyhole size={16} /> إلغاء الاعتماد</button>}
            {status === 'paid' && <button type="button" disabled={!isAdmin || busy} onClick={() => setAction('reverse')} className="sw-button sw-button--sm sw-button--secondary"><RotateCcw size={16} /> عكس المسير</button>}
            <span className="text-[11px] text-slate-500 mr-auto">الاعتماد لا ينشئ قيداً. القيد وتسوية السلف يحدثان فقط عند الصرف وبعد تأكيد المستخدم.</span>
          </div>
        </Card>
      )}

      <PayrollActionDialog key={action || 'none'} action={action} run={preview} busy={busy !== null} onClose={() => setAction(null)} onSubmit={submitAction} />
      <Toast open={toast.open} message={toast.message} tone={toast.tone} duration={toast.tone === 'error' ? 8000 : 3000} onClose={() => setToast((t) => ({ ...t, open: false }))} />
    </section>
  );
}
