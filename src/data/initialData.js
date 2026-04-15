// ════════════════════════════════════════════════════════════════════════════
// Monster Wash — Mobile Car Wash ERP
// Seed data + helpers for the financial dashboard
// ════════════════════════════════════════════════════════════════════════════

// ─── Brand ──────────────────────────────────────────────────────────────────
export const BRAND = {
  nameAr: 'مونستر واش',
  nameEn: 'Monster Wash',
  tagline: 'لوحة التحكم المالية — الأسطول المتنقل',
};

// ─── Cost Categories ────────────────────────────────────────────────────────
export const CATEGORIES = [
  { id: 'vehicle-purchase',      label: 'شراء المركبات' },
  { id: 'vehicle-customization', label: 'تجهيز المركبات' },
  { id: 'portable-equipment',    label: 'معدات متنقلة' },
  { id: 'routing-software',      label: 'أنظمة التتبع' },
  { id: 'mobile-permits',        label: 'تراخيص متنقلة' },
  { id: 'marketing',             label: 'التسويق' },
  { id: 'supplies',              label: 'المستلزمات' },
  { id: 'other',                 label: 'أخرى' },
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

// ─── Fleet Maintenance ──────────────────────────────────────────────────────
export const MAINTENANCE_TYPES = [
  { id: 'oil',       label: 'تغيير زيت' },
  { id: 'pumps',     label: 'صيانة مضخات' },
  { id: 'filters',   label: 'تغيير فلاتر' },
  { id: 'tires',     label: 'إطارات' },
  { id: 'brakes',    label: 'فرامل' },
  { id: 'generator', label: 'صيانة مولد' },
  { id: 'general',   label: 'صيانة عامة' },
];

// Crafted so exactly 3 are critical (>14d overdue) and total cost ≈ 12,450 (today 2026-04-15)
export const initialMaintenanceRecords = [
  { id: 1, assetName: 'شاحنة إيسوزو مجهزة',       maintenanceType: 'oil',       lastServiceDate: '2026-01-10', nextServiceDate: '2026-03-10', estimatedCost: 900  },
  { id: 2, assetName: 'شاحنة إيسوزو مجهزة',       maintenanceType: 'filters',   lastServiceDate: '2026-01-20', nextServiceDate: '2026-04-20', estimatedCost: 600  },
  { id: 3, assetName: 'فان هيونداي H1',            maintenanceType: 'oil',       lastServiceDate: '2026-01-01', nextServiceDate: '2026-03-20', estimatedCost: 700  },
  { id: 4, assetName: 'فان هيونداي H1',            maintenanceType: 'brakes',    lastServiceDate: '2025-12-15', nextServiceDate: '2026-06-15', estimatedCost: 2400 },
  { id: 5, assetName: 'بيك أب تويوتا هايلوكس',     maintenanceType: 'tires',     lastServiceDate: '2025-10-20', nextServiceDate: '2026-03-20', estimatedCost: 4550 },
  { id: 6, assetName: 'مولد كهرباء 15kVA',         maintenanceType: 'generator', lastServiceDate: '2026-03-05', nextServiceDate: '2026-04-28', estimatedCost: 1200 },
  { id: 7, assetName: 'غسالة ضغط عالي صناعية',    maintenanceType: 'pumps',     lastServiceDate: '2026-01-10', nextServiceDate: '2026-05-10', estimatedCost: 1600 },
  { id: 8, assetName: 'نظام تتبع GPS',             maintenanceType: 'general',   lastServiceDate: '2026-02-01', nextServiceDate: '2026-08-01', estimatedCost: 500  },
];

// Parts efficiency (Fleet page dark card progress bars)
export const initialPartsEfficiency = [
  { partName: 'فلاتر الهواء',    lifeRatio: 92 },
  { partName: 'زيت المحرك',      lifeRatio: 78 },
  { partName: 'مضخات الضغط',     lifeRatio: 65 },
  { partName: 'الإطارات',        lifeRatio: 48 },
  { partName: 'الفرامل',         lifeRatio: 86 },
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

export function getMaintenanceTypeLabel(typeId) {
  const t = MAINTENANCE_TYPES.find((m) => m.id === typeId);
  return t ? t.label : typeId;
}

const SAR_FMT = new Intl.NumberFormat('ar-SA', {
  style: 'currency',
  currency: 'SAR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const NUM_FMT = new Intl.NumberFormat('ar-SA');

export function formatCurrency(amount) {
  return SAR_FMT.format(amount || 0);
}
export function formatNumber(n) {
  return NUM_FMT.format(n || 0);
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

export function getMaintenanceStatus(nextServiceDate) {
  const next = new Date(nextServiceDate);
  const now  = new Date();
  const diffDays = (next - now) / (1000 * 60 * 60 * 24);
  if (diffDays < -14) return 'critical';
  if (diffDays < 0)   return 'overdue';
  if (diffDays <= 14) return 'due-soon';
  return 'good';
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
