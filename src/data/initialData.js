export const CATEGORIES = [
  { id: 'equipment', label: 'المعدات' },
  { id: 'rent', label: 'الإيجار' },
  { id: 'licenses', label: 'التراخيص' },
  { id: 'marketing', label: 'التسويق' },
  { id: 'decor', label: 'الديكور' },
  { id: 'utilities', label: 'المرافق' },
  { id: 'supplies', label: 'المستلزمات' },
  { id: 'other', label: 'أخرى' },
];

export const initialCostItems = [
  {
    id: 1,
    category: 'equipment',
    itemName: 'غسالة صناعية',
    budgeted: 25000,
    actual: 23500,
  },
  {
    id: 2,
    category: 'equipment',
    itemName: 'مجفف صناعي',
    budgeted: 18000,
    actual: 19200,
  },
  {
    id: 3,
    category: 'rent',
    itemName: 'إيجار المحل (٣ أشهر مقدماً)',
    budgeted: 15000,
    actual: 15000,
  },
  {
    id: 4,
    category: 'licenses',
    itemName: 'رخصة تجارية',
    budgeted: 3000,
    actual: 2800,
  },
  {
    id: 5,
    category: 'licenses',
    itemName: 'رخصة بلدية',
    budgeted: 2000,
    actual: 2500,
  },
  {
    id: 6,
    category: 'marketing',
    itemName: 'لوحة إعلانية خارجية',
    budgeted: 5000,
    actual: 4200,
  },
  {
    id: 7,
    category: 'marketing',
    itemName: 'تصميم هوية بصرية',
    budgeted: 3000,
    actual: 3000,
  },
  {
    id: 8,
    category: 'decor',
    itemName: 'تجهيز وتشطيب المحل',
    budgeted: 20000,
    actual: 22000,
  },
  {
    id: 9,
    category: 'supplies',
    itemName: 'مواد تنظيف (مخزون أولي)',
    budgeted: 4000,
    actual: 3800,
  },
  {
    id: 10,
    category: 'utilities',
    itemName: 'تركيب كهرباء وسباكة',
    budgeted: 8000,
    actual: 9500,
  },
];

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
