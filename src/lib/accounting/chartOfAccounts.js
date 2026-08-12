// ═══════════════════════════════════════════════════════════════════════════
// دليل الحسابات — Chart of accounts
// ═══════════════════════════════════════════════════════════════════════════
// Pure data + helpers. No Firestore here: the seeder writes these into the
// `chart_of_accounts` collection, and every report resolves account metadata
// through the same shapes whether it read them from the database or from
// this default set.
//
// Account document shape:
//   { code, nameArabic, accountType, parentId?, normalBalance,
//     active, createdAt, updatedAt }
//
// `code` is the stable business key and the Firestore document id, so a
// posting rule can name an account by its number and never depend on a
// generated id.
// ═══════════════════════════════════════════════════════════════════════════

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

/**
 * Which side increases an account. Assets and expenses grow on the debit
 * side; liabilities, equity and revenue grow on the credit side. This is
 * derived rather than stored per-account so a seeded account can never
 * contradict its own type.
 */
export function normalBalanceFor(accountType) {
  return (accountType === 'asset' || accountType === 'expense') ? 'debit' : 'credit';
}

// Codes referenced by the posting rules. Using named constants means a
// renumbering is a single edit and a typo is a build-time symbol error
// rather than a silently mis-posted entry.
export const ACC = {
  CASH:              '1010', // الصندوق
  BANK:              '1020', // البنك
  RECEIVABLE:        '1100', // العملاء / الذمم المدينة
  INPUT_VAT:         '1200', // ضريبة مدخلات قابلة للاسترداد
  EMPLOYEE_ADVANCE:  '1300', // عهد ومصروفات قابلة للاسترداد
  FIXED_ASSETS:      '1500', // أصول ثابتة
  ACCUM_DEPRECIATION:'1510', // مجمع الإهلاك
  PAYABLE:           '2000', // الموردون / الذمم الدائنة
  OUTPUT_VAT:        '2100', // ضريبة مخرجات مستحقة
  PARTNER_CAPITAL:   '3000', // رأس مال الشركاء
  RETAINED_EARNINGS: '3100', // أرباح محتجزة
  WASH_REVENUE:      '4000', // إيرادات غسيل السيارات
  SALES_RETURNS:     '4010', // مردودات وخصومات المبيعات (حساب مقابل)
  ASSET_DISPOSAL_GAIN:'4100',// أرباح استبعاد أصول
  BIKER_COMMISSION:  '5000', // عمولات البايكرز
  VARIABLE_COSTS:    '5100', // مواد تشغيل ومصروفات متغيرة
  RENT_MONTHLY:      '5200', // الإيجار والمصروفات الشهرية
  ADMIN_EXPENSES:    '5300', // المصروفات الإدارية
  DEPRECIATION:      '5400', // الإهلاك
  ASSET_DISPOSAL_LOSS:'5500',// خسائر استبعاد أصول
};

/**
 * The default chart for a car wash. `parentId` refers to another account's
 * code; a sub-account rolls up into its parent in the reports.
 */
export const DEFAULT_CHART_OF_ACCOUNTS = [
  // ── الأصول ──────────────────────────────────────────────────────────
  { code: ACC.CASH,               nameArabic: 'الصندوق',                       accountType: 'asset' },
  { code: ACC.BANK,               nameArabic: 'البنك',                          accountType: 'asset' },
  { code: ACC.RECEIVABLE,         nameArabic: 'العملاء / الذمم المدينة',        accountType: 'asset' },
  { code: ACC.INPUT_VAT,          nameArabic: 'ضريبة مدخلات قابلة للاسترداد',   accountType: 'asset' },
  { code: ACC.EMPLOYEE_ADVANCE,   nameArabic: 'عهد ومصروفات قابلة للاسترداد',   accountType: 'asset' },
  { code: ACC.FIXED_ASSETS,       nameArabic: 'أصول ثابتة',                     accountType: 'asset' },
  // Contra-asset: it lives under assets but carries a credit balance, which
  // is why normalBalance is stated explicitly here instead of derived.
  { code: ACC.ACCUM_DEPRECIATION, nameArabic: 'مجمع الإهلاك',                   accountType: 'asset',
    parentId: ACC.FIXED_ASSETS, normalBalance: 'credit', contra: true },

  // ── الالتزامات ──────────────────────────────────────────────────────
  { code: ACC.PAYABLE,            nameArabic: 'الموردون / الذمم الدائنة',       accountType: 'liability' },
  { code: ACC.OUTPUT_VAT,         nameArabic: 'ضريبة مخرجات مستحقة',            accountType: 'liability' },

  // ── حقوق الملكية ────────────────────────────────────────────────────
  { code: ACC.PARTNER_CAPITAL,    nameArabic: 'رأس مال الشركاء',                accountType: 'equity' },
  { code: ACC.RETAINED_EARNINGS,  nameArabic: 'أرباح محتجزة',                   accountType: 'equity' },

  // ── الإيرادات ───────────────────────────────────────────────────────
  { code: ACC.WASH_REVENUE,       nameArabic: 'إيرادات غسيل السيارات',          accountType: 'revenue' },
  // Contra-revenue: a credit note reduces sales, and netting it into 4000
  // would hide the return. Debit-side, under revenue.
  { code: ACC.SALES_RETURNS,      nameArabic: 'مردودات وخصومات المبيعات',       accountType: 'revenue',
    parentId: ACC.WASH_REVENUE, normalBalance: 'debit', contra: true },
  // Disposing of an asset is not trading income, so it gets its own account
  // and never inflates the wash revenue line.
  { code: ACC.ASSET_DISPOSAL_GAIN, nameArabic: 'أرباح استبعاد أصول',            accountType: 'revenue' },

  // ── المصروفات ───────────────────────────────────────────────────────
  { code: ACC.BIKER_COMMISSION,   nameArabic: 'عمولات البايكرز',                accountType: 'expense' },
  { code: ACC.VARIABLE_COSTS,     nameArabic: 'مواد تشغيل ومصروفات متغيرة',     accountType: 'expense' },
  { code: ACC.RENT_MONTHLY,       nameArabic: 'الإيجار والمصروفات الشهرية',     accountType: 'expense' },
  { code: ACC.ADMIN_EXPENSES,     nameArabic: 'المصروفات الإدارية',             accountType: 'expense' },
  { code: ACC.DEPRECIATION,       nameArabic: 'الإهلاك',                        accountType: 'expense' },
  { code: ACC.ASSET_DISPOSAL_LOSS, nameArabic: 'خسائر استبعاد أصول',            accountType: 'expense' },
].map((a) => ({
  parentId: null,
  contra: false,
  active: true,
  ...a,
  normalBalance: a.normalBalance || normalBalanceFor(a.accountType),
}));

/** Per-partner capital sub-account code: 3000 → 3000-<partnerId>. */
export function partnerCapitalCode(partnerId) {
  const id = String(partnerId || '').trim();
  return id ? `${ACC.PARTNER_CAPITAL}-${id}` : ACC.PARTNER_CAPITAL;
}

/** Builds the sub-account document for one partner. */
export function partnerCapitalAccount(partnerId, partnerName) {
  return {
    code: partnerCapitalCode(partnerId),
    nameArabic: `رأس مال — ${partnerName || 'شريك'}`,
    accountType: 'equity',
    parentId: ACC.PARTNER_CAPITAL,
    normalBalance: 'credit',
    contra: false,
    active: true,
  };
}

/** Index a chart array by code for O(1) lookups in the report engines. */
export function indexAccounts(accounts) {
  const map = new Map();
  for (const a of accounts || []) map.set(String(a.code), a);
  return map;
}

/**
 * Validates a chart before it is written. Returns a list of Arabic problems;
 * an empty list means the chart is safe to seed.
 */
export function validateChart(accounts) {
  const problems = [];
  const seen = new Set();
  for (const a of accounts || []) {
    const code = String(a.code || '').trim();
    if (!code) { problems.push('حساب بلا رقم.'); continue; }
    if (seen.has(code)) problems.push(`رقم الحساب مكرر: ${code}`);
    seen.add(code);
    if (!a.nameArabic) problems.push(`الحساب ${code} بلا اسم عربي.`);
    if (!ACCOUNT_TYPES.includes(a.accountType)) {
      problems.push(`الحساب ${code} نوعه غير صالح: ${a.accountType}`);
    }
    if (a.normalBalance !== 'debit' && a.normalBalance !== 'credit') {
      problems.push(`الحساب ${code} رصيده الطبيعي غير صالح.`);
    }
  }
  // Parents must exist, and only after every code is known.
  for (const a of accounts || []) {
    if (a.parentId && !seen.has(String(a.parentId))) {
      problems.push(`الحساب ${a.code} يشير إلى حساب أب غير موجود: ${a.parentId}`);
    }
  }
  return problems;
}
