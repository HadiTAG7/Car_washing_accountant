// Read-only presentation. The ledger remains the authority for every balance.
import { isRealCalendarDate } from './vatFields.js';

export function ledgerLocationFilters(search) {
  const params = new URLSearchParams(search);
  const account = params.get('account') || '';
  const from = params.get('from') || '', to = params.get('to') || '';
  return { account: /^[\w-]{1,160}$/.test(account) ? account : '',
    from: isRealCalendarDate(from) ? from : '', to: isRealCalendarDate(to) ? to : '' };
}
export const LEDGER_SOURCE_LABELS = {
  wash: 'غسلة', expense: 'مصروف', partner_payment: 'دفعة شريك',
  temporary_expense: 'عهدة', recovery: 'استرداد', manual: 'يدوي',
  adjustment: 'تسوية', opening: 'رصيد افتتاحي', payroll: 'رواتب',
};

export const LEDGER_SOURCE_COLLECTIONS = {
  startup: 'startup_cost_entries', annual: 'annual_expense_entries',
  variable: 'variable_expenses', monthly: 'monthly_expenses',
  temporary_expense: 'temporary_expenses', partner_payment: 'partner_payments',
  wash: 'washes', expense_voucher: 'expense_vouchers',
};

const TYPES = [
  ['asset', 'أصول'], ['liability', 'التزامات'], ['equity', 'حقوق ملكية'],
  ['revenue', 'إيرادات'], ['expense', 'مصروفات'], ['other', 'حسابات أخرى'],
];

export function ledgerAccountGroups(accounts, usedCodes) {
  return [true, false].flatMap((used) => TYPES.map(([type, label]) => ({
    key: `${used ? 'used' : 'unused'}-${type}`,
    label: used ? label : `بلا حركة · ${label}`,
    accounts: accounts.filter((a) => (TYPES.some(([t]) => t === a.accountType) ? a.accountType : 'other') === type
      && usedCodes.has(String(a.code)) === used),
  })).filter((group) => group.accounts.length));
}

export function balanceNature(balance, account) {
  if (balance < -0.005) return { abnormal: true, label: 'رصيد غير طبيعي' };
  if (Math.abs(balance) < 0.005) return { abnormal: false, label: 'رصيد صفري' };
  return { abnormal: false, label: account?.normalBalance === 'credit' ? 'رصيد دائن طبيعي' : 'رصيد مدين طبيعي' };
}

export function originalEntryId(entry) {
  return entry?.reversalOf || entry?.reversesEntryId || entry?.adjustmentOf || entry?.settlementOf || null;
}

export function referencedLedgerEntry(reference, entryIndex) {
  if (reference == null) return null;
  return entryIndex.get(reference) || [...entryIndex.values()].find((entry) => String(entry.entryNumber) === String(reference)) || null;
}

export function ledgerSourceIdentity(entry, entryIndex, visited = new Set()) {
  if (!entry || visited.has(entry.id)) return null;
  visited.add(entry.id);
  const kind = entry.sourceKind || entry.reversedSourceKind || entry.sourceType || entry.reversedSourceType;
  if (entry.sourceId && LEDGER_SOURCE_COLLECTIONS[kind]) return { kind, id: entry.sourceId };
  const original = originalEntryId(entry);
  return original ? ledgerSourceIdentity(referencedLedgerEntry(original, entryIndex), entryIndex, visited) : null;
}

export function ledgerSourcePlan(entries, entryIndex) {
  const groups = new Map();
  for (const entry of entries) {
    const source = ledgerSourceIdentity(entry, entryIndex);
    if (!source) continue;
    const collection = LEDGER_SOURCE_COLLECTIONS[source.kind];
    if (!groups.has(collection)) groups.set(collection, new Set());
    groups.get(collection).add(source.id);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([collection, ids]) => {
    const sorted = [...ids].sort();
    return Array.from({ length: Math.ceil(sorted.length / 10) }, (_, i) => ({ collection, ids: sorted.slice(i * 10, i * 10 + 10) }));
  });
}

export function safeDocumentUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function ledgerMovementContext(row, entryIndex, sourceDocuments = new Map()) {
  const entry = entryIndex.get(row.entryId);
  const source = ledgerSourceIdentity(entry, entryIndex);
  const document = source ? sourceDocuments.get(`${LEDGER_SOURCE_COLLECTIONS[source.kind]}/${source.id}`) : null;
  const snapshot = entry?.purchaseTaxSnapshot;
  const supplier = snapshot?.supplier || document?.supplier || document?.supplier_name || '';
  const documentNumber = snapshot?.invoiceNumber || document?.invoice_number || document?.document_number || document?.voucher_number || '';
  const description = document?.description || entry?.description || row.description || '—';
  return {
    description, supplier, documentNumber,
    url: safeDocumentUrl(document?.invoice_url || document?.receipt_url || document?.receipt_link),
    originalId: originalEntryId(entry),
    reason: entry?.reversalReason || entry?.adjustmentReason || (entry?.sourceType === 'adjustment' ? entry.description : ''),
    sourceLabel: LEDGER_SOURCE_LABELS[row.sourceType] || row.sourceType || 'غير محدد',
  };
}

export function normalizeLedgerSearch(value) {
  return String(value ?? '').replace(/[٠-٩]/g, (n) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)))
    .replace(/[۰-۹]/g, (n) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(n)))
    .replace(/[,٬\u200e\u200f\u061c]/g, '').replace(/٫/g, '.').toLowerCase().trim();
}

export function matchesLedgerMovement(row, context, query, sourceType) {
  if (sourceType && row.sourceType !== sourceType) return false;
  const needle = normalizeLedgerSearch(query);
  if (!needle) return true;
  return [context.description, context.supplier, context.documentNumber, row.description,
    row.entryNumber, Number(row.debit).toFixed(2), Number(row.credit).toFixed(2)]
    .some((value) => normalizeLedgerSearch(value).includes(needle));
}
