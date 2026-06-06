// ════════════════════════════════════════════════════════════════════════════
// Monster Wash — Mobile Car Wash ERP
// Seed data + helpers for the financial dashboard
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

export function getRecurringCategoryLabel(id) {
  const found = RECURRING_EXPENSE_CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
}

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

// ─── Startup Cost Items ─────────────────────────────────────────────────────
// Totals: budgeted 450,000 / actual 432,500 / variance 17,500
export const initialCostItems = [
  { id: 1,  category: 'vehicle-purchase',      itemName: 'شاحنة إيسوزو مجهزة',          budgeted: 120000, actual: 115000 },
  { id: 2,  category: 'vehicle-purchase',      itemName: 'فان هيونداي H1',               budgeted: 85000,  actual: 88000  },
  { id: 3,  category: 'vehicle-purchase',      itemName: 'بيك أب تويوتا هايلوكس',        budgeted: 95000,  actual: 92500  },
  { id: 4,  category: 'vehicle-customization', itemName: 'خزانات مياه داخلية (×3)',       budgeted: 36000,  actual: 34000  },
  { id: 5,  category: 'vehicle-customization', itemName: 'أنظمة صرف وتنقية',              budgeted: 24000,  actual: 22800  },
  { id: 6,  category: 'portable-equipment',    itemName: 'مولدات كهرباء متنقلة (×3)',     budgeted: 45000,  actual: 43500  },
  { id: 7,  category: 'portable-equipment',    itemName: 'غسالات ضغط عالي (×3)',          budgeted: 18000,  actual: 19200  },
  { id: 8,  category: 'portable-equipment',    itemName: 'مكانس صناعية (×3)',             budgeted: 10500,  actual: 10500  },
  { id: 9,  category: 'routing-software',      itemName: 'نظام GPS وإدارة مسارات',        budgeted: 7000,   actual: 6500   },
  { id: 10, category: 'mobile-permits',        itemName: 'رخص ومعالجات بيئية',            budgeted: 8500,   actual: 8200   },
  { id: 11, category: 'marketing',             itemName: 'تغليف المركبات والإعلانات',     budgeted: 15000,  actual: 14800  },
  { id: 12, category: 'supplies',              itemName: 'مستلزمات تشغيل (3 أشهر)',       budgeted: 12000,  actual: 12500  },
  { id: 13, category: 'other',                 itemName: 'احتياطي تشغيلي',                 budgeted: 74000,  actual: 65000  },
];

// ─── Depreciation Assets ────────────────────────────────────────────────────
export const initialAssets = [
  { id: 1, assetName: 'شاحنة إيسوزو مجهزة',       purchaseDate: '2025-01-15', purchaseCost: 115000, salvageValue: 20000, usefulLife: 7 },
  { id: 2, assetName: 'فان هيونداي H1',            purchaseDate: '2025-02-01', purchaseCost: 88000,  salvageValue: 15000, usefulLife: 7 },
  { id: 3, assetName: 'بيك أب تويوتا هايلوكس',     purchaseDate: '2025-02-20', purchaseCost: 92500,  salvageValue: 18000, usefulLife: 7 },
  { id: 4, assetName: 'مولد كهرباء 15kVA',         purchaseDate: '2025-03-10', purchaseCost: 14500,  salvageValue: 2000,  usefulLife: 5 },
  { id: 5, assetName: 'غسالة ضغط عالي صناعية',    purchaseDate: '2025-03-10', purchaseCost: 6800,   salvageValue: 800,   usefulLife: 4 },
  { id: 6, assetName: 'نظام تتبع GPS',             purchaseDate: '2025-04-01', purchaseCost: 6500,   salvageValue: 0,     usefulLife: 3 },
];

// ─── Unit Economics ─────────────────────────────────────────────────────────
// Targets: 42,850 monthly profit, 64% margin, 125 break-even
export const defaultUnitEconomics = {
  avgOrderPrice:        95,
  variableCostPerOrder: 34,
  monthlyFixedCosts:    7625,
};
export const defaultEstimatedOrders = 825;

// ─── Cash Flow ──────────────────────────────────────────────────────────────
export const initialCashSummary = {
  runwayMonths:  14.2,
  currentCash:   2840000,
  monthlyBurn:   200000,
  npv:           1240000,  // 1.24M
  irr:           0.324,    // 32.4 %
  paybackMonths: 18.4,
};

export const initialCashTransactions = [
  { id: 1, date: '2026-04-12', description: 'إيرادات مسار شمال الرياض',       type: 'in',  amount: 28400 },
  { id: 2, date: '2026-04-11', description: 'صيانة مضخات الأسطول',            type: 'out', amount: 4200  },
  { id: 3, date: '2026-04-10', description: 'إيرادات مسار شرق الرياض',        type: 'in',  amount: 22100 },
  { id: 4, date: '2026-04-09', description: 'رواتب الفريق التشغيلي',          type: 'out', amount: 18500 },
  { id: 5, date: '2026-04-08', description: 'إيرادات مسار جنوب الرياض',       type: 'in',  amount: 19600 },
  { id: 6, date: '2026-04-07', description: 'وقود الأسطول الأسبوعي',          type: 'out', amount: 6800  },
  { id: 7, date: '2026-04-06', description: 'اشتراك منصة إدارة المواعيد',      type: 'out', amount: 1200  },
  { id: 8, date: '2026-04-05', description: 'إيرادات عقد شركة — تأجير شهري',  type: 'in',  amount: 35000 },
];

// ─── Route / Fleet Profitability ────────────────────────────────────────────
// Most profitable: شمال الرياض — 84,200 ر.س
export const initialVehiclePerformance = [
  { id: 1, vehicleName: 'شاحنة إيسوزو #01', route: 'شمال الرياض',   monthlyRevenue: 84200, directCosts: 14800, allocatedFixedCosts: 12000, assetCost: 115000 },
  { id: 2, vehicleName: 'فان هيونداي #02',   route: 'شرق الرياض',    monthlyRevenue: 62100, directCosts: 11200, allocatedFixedCosts: 12000, assetCost: 88000  },
  { id: 3, vehicleName: 'بيك أب تويوتا #03', route: 'جنوب الرياض',   monthlyRevenue: 48300, directCosts: 9800,  allocatedFixedCosts: 12000, assetCost: 92500  },
  { id: 4, vehicleName: 'فان هيونداي #04',   route: 'غرب الرياض',    monthlyRevenue: 39500, directCosts: 9400,  allocatedFixedCosts: 12000, assetCost: 88000  },
];

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

export function getCategoryLabel(categoryId) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

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
  return SAR_FMT.format(amount || 0);
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
export function formatCompact(n) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}م`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}ك`;
  return formatNumber(n);
}
export function formatPercent(ratio, digits = 1) {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function getVariance(budgeted, actual) {
  return budgeted - actual;
}
export function getStatus(variance) {
  if (variance > 0) return 'under';
  if (variance < 0) return 'over';
  return 'on';
}

/** Straight-line annual depreciation */
export function calcAnnualDepreciation(purchaseCost, salvageValue, usefulLife) {
  if (usefulLife <= 0) return 0;
  return (purchaseCost - salvageValue) / usefulLife;
}

/** Current book value, clamped to salvage value */
export function calcBookValue(purchaseCost, salvageValue, usefulLife, purchaseDate) {
  const annual = calcAnnualDepreciation(purchaseCost, salvageValue, usefulLife);
  const start  = new Date(purchaseDate);
  const now    = new Date();
  const years  = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  const bv     = purchaseCost - annual * years;
  return Math.max(bv, salvageValue);
}

/** 12-month runway projection */
export function generateRunwayProjection(currentCash, monthlyBurn, months = 12) {
  const labels = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  const data = [];
  let remaining = currentCash;
  for (let i = 0; i < months; i++) {
    data.push({ month: labels[i % 12], cash: Math.max(remaining, 0) });
    remaining -= monthlyBurn;
  }
  return data;
}

/** 12-month break-even projection */
export function generateBreakEvenProjection(contributionMargin, monthlyFixedCosts, estimatedOrders, months = 12) {
  const labels = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  const data = [];
  for (let i = 0; i < months; i++) {
    const ramp   = Math.min(0.4 + (0.08 * i), 1.2);
    const orders = Math.round(estimatedOrders * ramp);
    const profit = contributionMargin * orders - monthlyFixedCosts;
    data.push({
      month:   labels[i % 12],
      profit,
      breakEven: 0,
      orders,
    });
  }
  return data;
}

/** CSV export with UTF-8 BOM */
export function exportToCSV(filename, headers, rows) {
  const bom = '\uFEFF';
  const esc = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const csv = bom + headers.map(esc).join(',') + '\n' +
    rows.map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Investment Metrics ─────────────────────────────────────────────────────

export function calcPaybackPeriod(initialInvestment, monthlyNetCashFlow) {
  if (monthlyNetCashFlow <= 0) return Infinity;
  return initialInvestment / monthlyNetCashFlow;
}

export function calcNPV(initialInvestment, monthlyCashFlows, annualDiscountRate) {
  const monthlyRate = annualDiscountRate / 12;
  let npv = -initialInvestment;
  for (let t = 0; t < monthlyCashFlows.length; t++) {
    npv += monthlyCashFlows[t] / Math.pow(1 + monthlyRate, t + 1);
  }
  return npv;
}

export function calcIRR(initialInvestment, monthlyCashFlows) {
  let rate = 0.01;
  const maxIter = 200;
  const tol = 1e-6;
  for (let i = 0; i < maxIter; i++) {
    let npv = -initialInvestment;
    let d   = 0;
    for (let t = 0; t < monthlyCashFlows.length; t++) {
      const dp = Math.pow(1 + rate, t + 1);
      npv += monthlyCashFlows[t] / dp;
      d   -= ((t + 1) * monthlyCashFlows[t]) / Math.pow(1 + rate, t + 2);
    }
    if (Math.abs(d) < 1e-12) break;
    const nr = rate - npv / d;
    if (Math.abs(nr - rate) < tol) return Math.pow(1 + nr, 12) - 1;
    rate = nr;
  }
  return null;
}
