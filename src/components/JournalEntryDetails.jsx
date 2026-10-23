import { X } from 'lucide-react';
import ModalSurface from './ModalSurface';
import ScrollableTable from './ScrollableTable';
import { accountDisplayLabel } from '../lib/accountDisplay';
import { formatCurrency, formatDate } from '../data/initialData';
import { ledgerMovementContext, LEDGER_SOURCE_LABELS, originalEntryId, referencedLedgerEntry } from '../lib/ledgerPresentation';

function timestamp(value) {
  const date = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return value && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'غير محفوظ';
}

export default function JournalEntryDetails({ entry, entryIndex, lines, accountIndex, documents, onOpen, onClose }) {
  const context = ledgerMovementContext({ entryId: entry.id, sourceType: entry.sourceType }, entryIndex, documents);
  const originalId = originalEntryId(entry);
  const original = referencedLedgerEntry(originalId, entryIndex);
  const creator = documents.get(`users/${entry.createdBy}`);
  const creatorName = creator?.displayName || creator?.display_name || creator?.name || creator?.full_name || creator?.email;
  return (
    <ModalSurface onClose={onClose}>
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
      <div dir="rtl" className="space-y-5 w-full max-w-5xl max-h-[90dvh] overflow-y-auto rounded-card bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 sm:p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-xl font-bold">القيد #{entry.entryNumber}</h2><p className="text-sm mt-1">{formatDate(entry.entryDate)} · {LEDGER_SOURCE_LABELS[entry.sourceType] || entry.sourceType || 'غير محدد'}</p></div>
          <button type="button" aria-label="إغلاق تفاصيل القيد" onClick={onClose} className="p-2 rounded-control hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
        </div>
        <p className="break-words">{entry.description || context.description}</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">المورد</dt><dd>{context.supplier || 'غير محفوظ'}</dd></div>
          <div><dt className="text-slate-500">المستند</dt><dd>{context.documentNumber || 'رقم المستند غير محفوظ'} {context.url && <a className="text-primary-600 underline" href={context.url} target="_blank" rel="noreferrer">فتح المستند</a>}</dd></div>
          <div><dt className="text-slate-500">سجّله</dt><dd className="break-all">{creatorName || entry.createdBy || 'غير محفوظ'}{!creatorName && entry.createdBy && !entry.createdBy.includes('@') && <small className="block text-slate-500">معرّف المسجّل؛ الاسم غير متاح</small>}</dd></div>
          <div><dt className="text-slate-500">وقت التسجيل · الرياض</dt><dd dir="ltr" className="text-right">{timestamp(entry.createdAt)}</dd></div>
        </dl>
        {(context.reason || originalId) && <section className="rounded-control border border-amber-300 dark:border-amber-700 p-3 space-y-2">
          <h3 className="font-bold">سبب التسوية والقيد الأصلي</h3>
          <p>{context.reason || entry.description || 'السبب غير محفوظ'}</p>
          {original ? <button type="button" className="text-primary-600 underline" onClick={() => onOpen(original.id)}>فتح القيد الأصلي #{original.entryNumber}</button>
            : originalId ? <p>القيد الأصلي غير متاح في البيانات المقروءة</p> : <p>لم يُحفظ رابط لقيد أصلي</p>}
        </section>}
        <ScrollableTable className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm text-right">
          <caption className="text-right font-bold py-2">كل أسطر القيد</caption>
          <thead><tr><th className="p-2">الحساب</th><th className="p-2">البيان</th><th className="p-2">مدين</th><th className="p-2">دائن</th></tr></thead>
          <tbody>{lines.map((line, i) => <tr key={line.id || i} className="border-t border-slate-200 dark:border-slate-700">
            <td className="p-2">{accountDisplayLabel(accountIndex.get(String(line.accountId)) || { code: line.accountId })}</td>
            <td className="p-2">{line.description || '—'}</td><td className="p-2 tabular-nums">{formatCurrency(line.debit)}</td><td className="p-2 tabular-nums">{formatCurrency(line.credit)}</td>
          </tr>)}</tbody>
        </table></ScrollableTable>
        {!lines.length && <p role="status">أسطر هذا القيد غير متاحة</p>}
        <p className="text-xs text-slate-500">عرض فقط؛ لا يمكن تعديل أو ترحيل قيود من هذه النافذة.</p>
      </div>
      </div>
    </ModalSurface>
  );
}
