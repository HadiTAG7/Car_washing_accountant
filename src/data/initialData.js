// ─── Cost Categories (for mobile laundry business) ──────────────────────────
export const CATEGORIES = [
  { id: 'vehicle-purchase', label: 'شراء المركبات' },
  { id: 'vehicle-customization', label: 'تجهيز المركبات' },
  { id: 'portable-equipment', label: 'معدات متنقلة' },
  { id: 'routing-software', label: 'أنظمة التتبع' },
  { id: 'mobile-permits', label: 'تراخيص متنقلة' },
  { id: 'marketing', label: 'التسويق' },
  { id: 'supplies', label: 'المستلزمات' },
  { id: 'other', label: 'أخرى' },
];

// ─── Initial Startup Cost Items ─────────────────────────────────────────────
export const initialCostItems = [
  {
    id: 1,
    category: 'vehicle-purchase',
    itemName: 'شاحنة إيسوزو مجهزة',
    budgeted: 120000,
    actual: 115000,
  },
  {
    id: 2,
    category: 'vehicle-purchase',
    itemName: 'فان هيونداي H1',
    budgeted: 85000,
    actual: 88000,
  },
  {
    id: 3,
    category: 'vehicle-customization',
    itemName: 'تجهيز خزان مياه داخلي',
    budgeted: 12000,
    actual: 13500,
  },
  {
    id: 4,
    category: 'vehicle-customization',
    itemName: 'تركيب نظام صرف وتنقية',
    budgeted: 8000,
    actual: 7200,
  },
  {
    id: 5,
    category: 'portable-equipment',
    itemName: 'مولد كهرباء متنقل',
    budgeted: 15000,
    actual: 14500,
  },
  {
    id: 6,
    category: 'portable-equipment',
    itemName: 'غسالة ضغط عالي متنقلة',
    budgeted: 6000,
    actual: 6800,
  },
  {
    id: 7,
    category: 'portable-equipment',
    itemName: 'مكنسة كهربائية صناعية',
    budgeted: 3500,
    actual: 3500,
  },
  {
    id: 8,
    category: 'routing-software',
    itemName: 'نظام تتبع GPS للمركبات',
    budgeted: 4000,
    actual: 3800,
  },
  {
    id: 9,
    category: 'routing-software',
    itemName: 'اشتراك تطبيق إدارة المواعيد',
    budgeted: 2400,
    actual: 2400,
  },
  {
    id: 10,
    category: 'mobile-permits',
    itemName: 'رخصة نشاط تجاري متنقل',
    budgeted: 5000,
    actual: 4500,
  },
  {
    id: 11,
    category: 'mobile-permits',
    itemName: 'تصريح بيئي للمياه',
    budgeted: 3000,
    actual: 3200,
  },
  {
    id: 12,
    category: 'marketing',
    itemName: 'تغليف المركبات (برندينق)',
    budgeted: 8000,
    actual: 7500,
  },
];

// ─── Initial Depreciation Assets ────────────────────────────────────────────
export const initialAssets = [
  {
    id: 1,
    assetName: 'شاحنة إيسوزو مجهزة',
    purchaseDate: '2025-01-15',
    purchaseCost: 115000,
    salvageValue: 20000,
    usefulLife: 7,
  },
  {
    id: 2,
    assetName: 'فان هيونداي H1',
    purchaseDate: '2025-02-01',
    purchaseCost: 88000,
    salvageValue: 15000,
    usefulLife: 7,
  },
  {
    id: 3,
    assetName: 'مولد كهرباء متنقل',
    purchaseDate: '2025-03-10',
    purchaseCost: 14500,
    salvageValue: 2000,
    usefulLife: 5,
  },
  {
    id: 4,
    assetName: 'غسالة ضغط عالي متنقلة',
    purchaseDate: '2025-03-10',
    purchaseCost: 6800,
    salvageValue: 800,
    usefulLife: 4,
  },
  {
    id: 5,
    assetName: 'نظام تتبع GPS',
    purchaseDate: '2025-04-01',
    purchaseCost: 3800,
    salvageValue: 0,
    usefulLife: 3,
  },
];

// ─── Fleet Maintenance Records ──────────────────────────────────────────────
export const MAINTENANCE_TYPES = [
  { id: 'oil', label: 'تغيير زيت' },
  { id: 'pumps', label: 'صيانة مضخات' },
  { id: 'filters', label: 'تغيير فلاتر' },
  { id: 'tires', label: 'إطارات' },
  { id: 'brakes', label: 'فرامل' },
  { id: 'generator', label: 'صيانة مولد' },
  { id: 'general', label: 'صيانة عامة' },
];

export const initialMaintenanceRecords = [
  {
    id: 1,
    assetName: 'شاحنة إيسوزو مجهزة',
    maintenanceType: 'oil',
    lastServiceDate: '2026-02-10',
    nextServiceDate: '2026-05-10',
    estimatedCost: 450,
  },
  {
    id: 2,
    assetName: 'شاحنة إيسوزو مجهزة',
    maintenanceType: 'filters',
    lastServiceDate: '2026-01-20',
    nextServiceDate: '2026-04-20',
    estimatedCost: 300,
  },
  {
    id: 3,
    assetName: 'فان هيونداي H1',
    maintenanceType: 'oil',
    lastServiceDate: '2026-03-01',
    nextServiceDate: '2026-06-01',
    estimatedCost: 350,
  },
  {
    id: 4,
    assetName: 'فان هيونداي H1',
    maintenanceType: 'brakes',
    lastServiceDate: '2025-12-15',
    nextServiceDate: '2026-06-15',
    estimatedCost: 1200,
  },
  {
    id: 5,
    assetName: 'مولد كهرباء متنقل',
    maintenanceType: 'generator',
    lastServiceDate: '2026-03-05',
    nextServiceDate: '2026-04-05',
    estimatedCost: 600,
  },
  {
    id: 6,
    assetName: 'غسالة ضغط عالي متنقلة',
    maintenanceType: 'pumps',
    lastServiceDate: '2026-01-10',
    nextServiceDate: '2026-04-10',
    estimatedCost: 800,
  },
];

// ─── Unit Economics Defaults ────────────────────────────────────────────────
export const defaultUnitEconomics = {
  avgOrderPrice: 150,
  variableCostPerOrder: 35,
  monthlyFixedCosts: 18000,
};

// ─── Helper Functions ───────────────────────────────────────────────────────

export function getCategoryLabel(categoryId) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

export function getMaintenanceTypeLabel(typeId) {
  const t = MAINTENANCE_TYPES.find((m) => m.id === typeId);
  return t ? t.label : typeId;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(n) {
  return new Intl.NumberFormat('ar-SA').format(n);
}

export function getVariance(budgeted, actual) {
  return budgeted - actual;
}

export function getStatus(variance) {
  if (variance > 0) return 'under';
  if (variance < 0) return 'over';
  return 'on';
}

/**
 * Straight-line annual depreciation:
 * (Purchase Cost - Salvage Value) / Useful Life
 */
export function calcAnnualDepreciation(purchaseCost, salvageValue, usefulLife) {
  if (usefulLife <= 0) return 0;
  return (purchaseCost - salvageValue) / usefulLife;
}

/**
 * Current book value based on elapsed years since purchase.
 * Clamped so it never drops below salvage value.
 */
export function calcBookValue(purchaseCost, salvageValue, usefulLife, purchaseDate) {
  const annual = calcAnnualDepreciation(purchaseCost, salvageValue, usefulLife);
  const start = new Date(purchaseDate);
  const now = new Date();
  const yearsElapsed = (now - start) / (1000 * 60 * 60 * 24 * 365.25);
  const accumulatedDep = annual * yearsElapsed;
  const bookValue = purchaseCost - accumulatedDep;
  return Math.max(bookValue, salvageValue);
}

/**
 * Maintenance status based on next service date relative to today.
 * Returns 'overdue' | 'due-soon' (within 14 days) | 'good'
 */
export function getMaintenanceStatus(nextServiceDate) {
  const next = new Date(nextServiceDate);
  const now = new Date();
  const diffDays = (next - now) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 14) return 'due-soon';
  return 'good';
}

/**
 * Generate 12-month cash flow projection.
 * Starts with totalCapital and subtracts monthlyBurn each month.
 */
export function generateCashFlowProjection(totalCapital, monthlyBurn) {
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  const data = [];
  let remaining = totalCapital;
  for (let i = 0; i < 12; i++) {
    data.push({ month: months[i], remaining: Math.max(remaining, 0) });
    remaining -= monthlyBurn;
  }
  return data;
}

/**
 * Export arrays of objects to CSV and trigger browser download.
 */
export function exportToCSV(filename, headers, rows) {
  const bom = '\uFEFF';
  const headerLine = headers.join(',');
  const csvRows = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  const csv = bom + headerLine + '\n' + csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
