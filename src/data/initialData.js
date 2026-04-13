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

// ─── Helper Functions ───────────────────────────────────────────────────────

export function getCategoryLabel(categoryId) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.label : categoryId;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
 * Book Value = Purchase Cost - (Annual Depreciation * Years Elapsed)
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
