// ════════════════════════════════════════════════════════════════════════════
// Sweater (سويتر) — Franchise Financial Dashboard
// Brand constants, demo-fallback category lists, and shared formatters.
//
// Everything here is verified-in-use. The legacy seed datasets and
// projection helpers that once backed the removed CashFlow / Routes /
// UnitEconomics pages were purged in the 2026-06 audit cleanup — resurrect
// them from git history if those modules ever return.
// ════════════════════════════════════════════════════════════════════════════

// ─── Brand ──────────────────────────────────────────────────────────────────
export const BRAND = {
  nameAr: 'سويتر',
  nameEn: 'Sweater',
  tagline: 'لوحة التحكم المالية — امتياز سويتر',
};

// ─── Cost Categories — franchise startup ────────────────────────────────────
export const CATEGORIES = [
  { id: 'legal-permits',      label: 'تراخيص ورسوم قانونية' },
  { id: 'franchise-sweater',  label: 'رسوم الامتياز لـ سويتر' },
  { id: 'branding-marketing', label: 'هوية بصرية وتسويق افتتاحي' },
  { id: 'other',              label: 'أخرى' },
];

// ─── Recurring Expense Categories (Module 2) ────────────────────────────────
export const RECURRING_EXPENSE_CATEGORIES = [
  { id: 'fleet-insurance',        label: 'تأمين شامل للأسطول' },
  { id: 'government-licenses',    label: 'تراخيص ورسوم حكومية' },
  { id: 'software-subscriptions', label: 'اشتراكات برمجية وأنظمة' },
  { id: 'annual-marketing',       label: 'تسويق وحملات سنوية' },
  { id: 'other',                  label: 'أخرى' },
];

// ─── Monthly Expense Categories (Module 3 — demo fallback) ──────────────────
export const MONTHLY_EXPENSE_CATEGORIES = [
  { id: 'salaries-wages',     label: 'رواتب وأجور' },
  { id: 'rent-utilities',     label: 'إيجار ومرافق' },
  { id: 'fuel',               label: 'محروقات' },
  { id: 'operating-supplies', label: 'مستلزمات تشغيلية' },
  { id: 'periodic-maintenance', label: 'صيانة دورية' },
  { id: 'other',              label: 'أخرى' },
];

// ─── Variable Expense Categories (Module 4 — demo fallback) ─────────────────
export const VARIABLE_EXPENSE_CATEGORIES = [
  { id: 'biker-commissions',   label: 'عمولات البايكرز والموزعين' },
  { id: 'per-wash-supplies',   label: 'مستلزمات لكل غسلة' },
  { id: 'performance-bonuses', label: 'مكافآت أداء وحوافز' },
  { id: 'transport',           label: 'نقل ومواصلات' },
  { id: 'other',               label: 'أخرى' },
];

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

// Western (Latin) digits everywhere — `numberingSystem: 'latn'` keeps the
// Arabic-locale formatting conventions (currency symbol, thousands
// separator) while forcing 0-9 instead of ٠-٩.
const SAR_FMT = new Intl.NumberFormat('ar-SA', {
  style: 'currency',
  currency: 'SAR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  numberingSystem: 'latn',
});
const NUM_FMT = new Intl.NumberFormat('ar-SA', { numberingSystem: 'latn' });

// Per-worker corporate capital fee. Each partner owes this × workersCount;
// what they've paid is tracked in `partners.paid_amount` (see schema.sql).
export const PER_WORKER_FEE = 20000;

export function formatCurrency(amount) {
  // Intl's ar-SA currency literal is "ر.س." (trailing period). Thmanyah
  // Sans' ss01 ligature swaps "ر.س" for the official Saudi Riyal symbol,
  // which left that period dangling after the glyph ("123 ⃀."). Strip it
  // so every amount renders a clean symbol.
  return SAR_FMT.format(amount || 0).replace('ر.س.', 'ر.س');
}
export function formatNumber(n) {
  return NUM_FMT.format(n || 0);
}

// ─── VAT (ضريبة القيمة المضافة) ──────────────────────────────────────────────
// KSA standard rate. Amounts the user enters on a tax invoice are
// VAT-INCLUSIVE, so the VAT portion is back-derived rather than added on
// top: for an inclusive total A, VAT = A × r / (1 + r). At 15% a 115
// invoice yields VAT 15 and a net good value of 100.
export const VAT_RATE = 0.15;
export function extractVat(inclusiveAmount, isTaxInvoice = true) {
  if (!isTaxInvoice) return 0;
  const a = Number(inclusiveAmount) || 0;
  return a * VAT_RATE / (1 + VAT_RATE);
}
export function netOfVat(inclusiveAmount, isTaxInvoice = true) {
  const a = Number(inclusiveAmount) || 0;
  return a - extractVat(a, isTaxInvoice);
}

// Local-zone ISO (YYYY-MM-DD). Avoids the UTC shift you get from
// `toISOString()` near midnight in non-UTC timezones. Shared by every
// modal that pre-fills a "today" date input.
export function todayISO() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

// Pretty-prints a YYYY-MM-DD into an Arabic-locale date with Latin digits.
// Used by every receipt / ledger table so all dates look uniform.
const DATE_FMT = new Intl.DateTimeFormat('ar-SA', {
  year: 'numeric', month: 'short', day: 'numeric',
  numberingSystem: 'latn',
});
export function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return DATE_FMT.format(d);
  } catch {
    return iso;
  }
}
