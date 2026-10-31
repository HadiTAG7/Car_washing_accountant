import { useMemo, useState } from 'react';
import { FilePenLine, Plus, Trash2 } from 'lucide-react';
import { Card, PrimaryButton, SecondaryButton } from './UI';
import { useFinanceRead } from '../hooks/useFinanceRead';
import { callFinanceApi } from '../lib/financeApi';
import { formatCurrency, todayISO } from '../data/initialData';
import { manualEntryProblems, manualEntryTotals, partnerOfAccount, SETTLEMENTS_ACCOUNT, MAX_MANUAL_LINES } from '../lib/founding/manualEntry';

const STATUS = { proposed: 'بانتظار موافقتك', posted: 'مرحّل', blocked_period: 'الفترة مقفلة' };
const blankLine = () => ({ accountId: '', debit: '', credit: '', description: '' });
const blank = () => ({ date: todayISO(), description: '', reason: '', settlementReason: '', lines: [blankLine(), blankLine()] });
const amount = value => (value === '' ? 0 : Number(value));

/**
 * «قيد يدوي بموافقة»: الأدمن يكتب الأسطر والتاريخ والبيان والسبب، فيُحفظ مقترحًا باسمه. لا يُرحّل إلا
 * بموافقة من «قيود التصحيح والتسوية» في «تسوية فترة التأسيس»، باسم من وافق.
 */
export default function ManualJournalEntryCard({ accounts = [], onPosted }) {
  const read = useFinanceRead('finance-workbench', { kind: 'founding', request: { action: 'manualEntries' } });
  const [form, setForm] = useState(blank), [busy, setBusy] = useState(false), [asking, setAsking] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const partners = useMemo(() => read.data?.partners || [], [read.data]);
  const options = useMemo(() => {
    const chart = accounts.filter(a => a.active !== false).map(a => ({ code: String(a.code), label: `${a.code} ${a.nameArabic || ''}` }));
    const known = new Set(chart.map(a => a.code));
    const partnerAccounts = partners.filter(p => !known.has(`3000-${p.id}`)).map(p => ({ code: `3000-${p.id}`, label: `3000 رأس مال ${p.name}` }));
    return [...chart, ...partnerAccounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [accounts, partners]);
  if (!read.allowed) return null;
  const lines = form.lines.map(l => ({ ...l, debit: amount(l.debit), credit: amount(l.credit) }));
  const totals = manualEntryTotals(lines), touches3200 = lines.some(l => l.accountId === SETTLEMENTS_ACCOUNT);
  const problems = manualEntryProblems({ ...form, lines }, { accounts: new Set(accounts.map(a => String(a.code))), partners,
    closedMonths: new Set(read.data?.closedMonths || []) });
  const set = patch => { setForm(f => ({ ...f, ...patch })); setAsking(false); setError(''); setNotice(''); };
  const setLine = (index, patch) => set({ lines: form.lines.map((l, i) => i === index ? { ...l, ...patch } : l) });
  const nameOf = code => options.find(o => o.code === code)?.label || (partnerOfAccount(code) ? `رأس مال شريك (${code})` : code);
  async function save() {
    setBusy(true); setError('');
    try {
      await callFinanceApi('finance-workbench', { kind: 'founding', request: { action: 'proposeManualEntry', date: form.date, description: form.description.trim(),
        reason: form.reason.trim(), settlementReason: touches3200 ? form.settlementReason.trim() : null,
        lines: lines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description.trim() })), confirm: true } });
      setForm(blank()); setAsking(false); setNotice('حُفظ القيد مقترحًا باسمك. يُرحّل بعد موافقتك من «قيود التصحيح والتسوية».'); read.refresh(); onPosted?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true); setError('');
    try { await callFinanceApi('finance-workbench', { kind: 'founding', request: { action: 'removeManualEntry', id, confirm: true } }); read.refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const input = 'block w-full rounded-control border p-2 bg-transparent';
  return <Card role="region" className="p-4 sm:p-5 space-y-4" aria-label="قيد يدوي بموافقة">
    <h2 className="font-bold text-lg flex items-center gap-2"><FilePenLine size={18} /> قيد يدوي بموافقة</h2>
    <p className="text-sm">أسطر مدين ودائن على أي حساب في الدليل أو حساب فرعي لشريك، بتاريخ وبيان وسبب. يُحفظ مقترحًا باسمك، ولا يُرحّل إلا بموافقة من
      «<a className="underline" href="?page=founding_settlement">قيود التصحيح والتسوية</a>» باسم من وافق. القيد غير المتوازن مرفوض، و3200 يحتاج سببًا مكتوبًا له، ولا تاريخ في فترة مقفلة.</p>
    <div className="grid sm:grid-cols-3 gap-3">
      <label className="text-sm">التاريخ<input type="date" className={input} value={form.date} onChange={e => set({ date: e.target.value })} /></label>
      <label className="text-sm sm:col-span-2">البيان<input className={input} value={form.description} onChange={e => set({ description: e.target.value })} placeholder="مثلًا: إعادة تصنيف مصروف" /></label>
      <label className="text-sm sm:col-span-3">السبب<input className={input} value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="لماذا هذا القيد؟" /></label>
      {touches3200 && <label className="text-sm sm:col-span-3">سبب استخدام 3200<input className={input} value={form.settlementReason}
        onChange={e => set({ settlementReason: e.target.value })} placeholder="لماذا على تسويات فترة التأسيس؟" /></label>}
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm" aria-label="أسطر القيد">
      <thead><tr><th className="p-2 text-start">الحساب</th><th className="p-2 text-start">البيان</th><th className="p-2 text-start">مدين</th><th className="p-2 text-start">دائن</th><th className="p-2" /></tr></thead>
      <tbody>{form.lines.map((l, i) => <tr key={i}>
        <td className="p-1"><select aria-label={`حساب السطر ${i + 1}`} className={input} value={l.accountId} onChange={e => setLine(i, { accountId: e.target.value })}>
          <option value="">اختر الحساب</option>{options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select></td>
        <td className="p-1"><input aria-label={`بيان السطر ${i + 1}`} className={input} value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></td>
        <td className="p-1"><input aria-label={`مدين السطر ${i + 1}`} type="number" min="0" step="0.01" className={input} value={l.debit} onChange={e => setLine(i, { debit: e.target.value })} /></td>
        <td className="p-1"><input aria-label={`دائن السطر ${i + 1}`} type="number" min="0" step="0.01" className={input} value={l.credit} onChange={e => setLine(i, { credit: e.target.value })} /></td>
        <td className="p-1">{form.lines.length > 2 && <button type="button" aria-label={`حذف السطر ${i + 1}`} onClick={() => set({ lines: form.lines.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>}</td>
      </tr>)}</tbody>
      <tfoot><tr className="font-bold"><th className="p-2 text-start" colSpan={2}>الإجمالي</th><td className="p-2">{formatCurrency(totals.debit)}</td><td className="p-2">{formatCurrency(totals.credit)}</td><td /></tr></tfoot>
    </table></div>
    <div className="flex flex-wrap gap-2 items-center">
      <SecondaryButton icon={Plus} disabled={form.lines.length >= MAX_MANUAL_LINES} onClick={() => set({ lines: [...form.lines, blankLine()] })}>سطر</SecondaryButton>
      {(totals.debit > 0 || totals.credit > 0) && <span role="status" className={totals.balanced ? 'text-emerald-700 dark:text-emerald-300 text-sm' : 'text-rose-700 dark:text-rose-300 text-sm'}>
        {totals.balanced ? 'متوازن' : `غير متوازن — الفرق ${formatCurrency(Math.abs(totals.difference))}`}</span>}
    </div>
    {problems.length > 0 && (form.description || form.reason || lines.some(l => l.accountId || l.debit || l.credit))
      && <ul className="text-sm text-rose-700 dark:text-rose-300 list-disc ps-5" aria-label="ما يمنع الحفظ">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {!asking ? <PrimaryButton disabled={busy || problems.length > 0} onClick={() => setAsking(true)}>حفظ القيد مقترحًا</PrimaryButton>
      : <div role="group" aria-label="تأكيد حفظ القيد" className="flex flex-wrap gap-2 items-center text-sm">
        <span>يحفظ قيدًا مقترحًا بـ {formatCurrency(totals.debit)} بتاريخ {form.date} باسمك. لا ترحيل حتى توافق عليه.</span>
        <PrimaryButton disabled={busy} onClick={save}>تأكيد</PrimaryButton><SecondaryButton disabled={busy} onClick={() => setAsking(false)}>إلغاء</SecondaryButton></div>}
    {read.error && <p role="alert" className="text-sm">{read.error}</p>}
    {(read.data?.entries || []).length > 0 && <details className="border-t pt-3 border-slate-200 dark:border-slate-700" open>
      <summary className="font-bold cursor-pointer">القيود اليدوية ({read.data.entries.length})</summary>
      <ul className="space-y-3 mt-3">{read.data.entries.map(e => <li key={e.id} className="text-sm">
        <strong>{e.description}</strong> · {e.date} · {formatCurrency(manualEntryTotals(e.lines).debit)} · <span className="font-bold">{STATUS[e.status] || e.status}</span>
        {e.entryNumber ? ` · قيد رقم ${e.entryNumber}` : ''}
        <span className="block">أنشأه {e.byName}{e.status === 'posted' ? ` · وافق عليه ${e.approvedByName || '—'}` : ''} · السبب: {e.reason}{e.settlementReason ? ` · سبب 3200: ${e.settlementReason}` : ''}</span>
        <span className="block text-xs text-slate-500">{e.lines.map(l => `${nameOf(l.accountId)}: ${l.debit ? `مدين ${formatCurrency(l.debit)}` : `دائن ${formatCurrency(l.credit)}`}`).join(' · ')}</span>
        {e.status !== 'posted' && <button type="button" className="underline text-xs" disabled={busy} onClick={() => remove(e.id)}>حذف المقترح</button>}
      </li>)}</ul>
    </details>}
  </Card>;
}
