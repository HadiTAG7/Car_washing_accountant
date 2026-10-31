import { useMemo, useState } from 'react';
import { servicePriceRow } from '../../functions/src/sweater/priceRow';
import { resolveDatedRow } from '../../functions/src/sweater/datedConfig';
import { formatNumber, todayISO } from '../data/initialData';
import { PrimaryButton, SecondaryButton } from './UI';

const MODE = { inclusive: 'شامل الضريبة', exclusive: 'قبل الضريبة' };
const blank = () => ({ serviceType: '', nameArabic: '', price: '', priceMode: '', vatPercent: '15', effectiveFrom: todayISO() });
const money = value => Number(value || 0).toFixed(2);
const vatRateOf = percent => (percent === '' ? '' : Math.round(Number(percent) * 100) / 10000);

/**
 * «أسعار الخدمات»: كل سعر صفٌّ مؤرخ يبدأ من تاريخ سريانه. سعرٌ جديد لا يعدّل صفًّا قائمًا،
 * والساري يوم الخدمة هو ما يدخل احتساب التسوية — ولا يتغيّر رقمُ تسويةٍ معتمدة.
 */
export default function SweaterServicePrices({ prices = [], serviceTypes = [], canEdit = false, onSave }) {
  const today = todayISO();
  const [form, setForm] = useState(blank), [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const rows = useMemo(() => [...prices].sort((a, b) => String(a.serviceType).localeCompare(String(b.serviceType))
    || String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))), [prices]);
  const stateOf = row => {
    if ((row.status ?? 'active') !== 'active') return 'موقوف';
    if (String(row.effectiveFrom) > today) return 'يبدأ لاحقًا';
    const hit = resolveDatedRow(prices, row.serviceType, today, { keyField: 'serviceType' });
    return hit.known && hit.row.id === row.id ? 'سارٍ اليوم' : 'سابق';
  };
  const priced = new Set(prices.map(p => String(p.serviceType)));
  const unpriced = serviceTypes.filter(t => t.serviceType && !priced.has(t.serviceType));
  const untyped = serviceTypes.find(t => !t.serviceType);
  const choices = [...new Set([...serviceTypes.map(t => t.serviceType).filter(Boolean), ...priced])];
  const input = { ...form, price: form.price === '' ? NaN : Number(form.price), vatRate: vatRateOf(form.vatPercent) };
  const { problems, row } = servicePriceRow(input);
  const touched = form.serviceType || form.price || form.priceMode;
  const set = patch => { setForm(f => ({ ...f, ...patch })); setAsking(false); setError(''); setNotice(''); };

  async function save() {
    setBusy(true); setError('');
    try {
      await onSave({ serviceType: row.serviceType, nameArabic: row.nameArabic, price: input.price, priceMode: row.priceMode, vatRate: row.vatRate, effectiveFrom: row.effectiveFrom });
      setForm(blank()); setAsking(false); setNotice(`حُفظ سعر «${row.serviceType}» من ${row.effectiveFrom} باسمك.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const field = 'block w-full rounded-control border p-2 bg-transparent';
  return <div role="region" aria-label="أسعار الخدمات">
    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">أسعار الخدمات</p>
    {rows.length === 0
      ? <p className="text-[12px] text-slate-500">لا أسعار مسجّلة بعد.</p>
      : <ul aria-label="سجل الأسعار">{rows.map(p => <li key={p.id} className="py-1.5 border-b border-slate-50 dark:border-slate-800/60 last:border-0 text-[12px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-slate-700 dark:text-slate-300">{p.nameArabic || p.serviceType} <span className="font-bold">· {stateOf(p)}</span></span>
          <span className="tabular-nums text-slate-600 dark:text-slate-400">{money(p.netRate)} + ضريبة {money(p.vatAmount ?? (p.grossRate - p.netRate))} = {money(p.grossRate)} · من <bdi>{p.effectiveFrom}</bdi></span>
        </div>
        <span className="block text-[11px] text-slate-500">{MODE[p.priceMode] || MODE.exclusive} · الضريبة {Math.round(Number(p.vatRate || 0) * 10000) / 100}%
          {p.nameArabic ? ` · ${p.serviceType}` : ''}{p.createdByName ? ` · أدخله ${p.createdByName}` : ''}{p.createdAtIso ? ` في ${String(p.createdAtIso).slice(0, 10)}` : ''}</span>
      </li>)}</ul>}
    {(unpriced.length > 0 || untyped) && <div className="mt-2 text-[12px] text-amber-700 dark:text-amber-300" role="note" aria-label="خدمات بلا سعر">
      {unpriced.map(t => <p key={t.serviceType}>«{t.serviceType}» في {formatNumber(t.bookings)} حجزًا بلا سعر{t.firstDate ? ` (${t.firstDate} إلى ${t.lastDate})` : ''}.</p>)}
      {untyped && <p>{formatNumber(untyped.bookings)} حجزًا بلا نوع خدمة — لا يُسعَّر حتى يصل نوعها من سويتر.</p>}
    </div>}

    {canEdit && <form className="mt-4 space-y-3 border-t pt-3 border-slate-100 dark:border-slate-800" aria-label="إدخال سعر خدمة" onSubmit={e => { e.preventDefault(); if (!problems.length) setAsking(true); }}>
      <p className="text-sm font-bold">إدخال سعر</p>
      <p className="text-[12px] text-slate-500">سعرٌ جديد صفٌّ يبدأ من تاريخ سريانه، والسابق يبقى لأيامه. سعرٌ بتاريخ ماضٍ يدخل أي احتساب لاحق لتسوية تلك الأيام، ولا يغيّر تسوية معتمدة.</p>
      <datalist id="sweater-service-types">{choices.map(c => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <label>الخدمة<input className={field} list="sweater-service-types" value={form.serviceType} onChange={e => set({ serviceType: e.target.value })} placeholder="كما تصل في الحجوزات" /></label>
        <label>الاسم بالعربي (اختياري)<input className={field} value={form.nameArabic} onChange={e => set({ nameArabic: e.target.value })} /></label>
        <label>السعر<input className={field} type="number" min="0" step="0.01" value={form.price} onChange={e => set({ price: e.target.value })} /></label>
        <label>السعر شامل الضريبة؟<select className={field} value={form.priceMode} onChange={e => set({ priceMode: e.target.value })}>
          <option value="">اختر</option><option value="inclusive">{MODE.inclusive}</option><option value="exclusive">{MODE.exclusive}</option></select></label>
        <label>نسبة الضريبة %<input className={field} type="number" min="0" max="100" step="0.01" value={form.vatPercent} onChange={e => set({ vatPercent: e.target.value })} /></label>
        <label>يسري من<input className={field} type="date" value={form.effectiveFrom} onChange={e => set({ effectiveFrom: e.target.value })} /></label>
      </div>
      {row && <p role="status" className="text-[12px] tabular-nums">يُحفظ: صافي {money(row.netRate)} + ضريبة {money(row.vatAmount)} = {money(row.grossRate)} لكل خدمة، من <bdi>{row.effectiveFrom}</bdi>.</p>}
      {problems.length > 0 && touched && <ul className="text-[12px] text-rose-700 dark:text-rose-300 list-disc ps-5" aria-label="ما يمنع حفظ السعر">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      {error && <p role="alert" className="text-[12px] text-rose-700">{error}</p>}
      {notice && <p role="status" className="text-[12px] text-emerald-700">{notice}</p>}
      {!asking
        ? <PrimaryButton type="submit" disabled={busy || problems.length > 0}>حفظ السعر</PrimaryButton>
        : <div role="group" aria-label="تأكيد حفظ السعر" className="flex flex-wrap gap-2 items-center text-[12px]">
          <span>يبدأ سعر «{row?.serviceType}» {money(row?.grossRate)} شاملًا الضريبة من {row?.effectiveFrom}، باسمك.</span>
          <PrimaryButton disabled={busy} onClick={save}>تأكيد</PrimaryButton>
          <SecondaryButton disabled={busy} onClick={() => setAsking(false)}>إلغاء</SecondaryButton>
        </div>}
    </form>}
  </div>;
}
