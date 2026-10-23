import { describe, it, expect } from 'vitest';
import { reconcileAssetCost, canPostAssetCharges } from '../assetReconciliation';
import { normalizeAsset, buildDepreciationEntry, validateAsset } from '../depreciation';

const entries = [{ id: 'buy', status: 'reversed', entryDate: '2026-05-01' },
  { id: 'reverse', status: 'posted', entryDate: '2026-05-02' },
  { id: 'new', status: 'posted', entryDate: '2026-05-02' },
  { id: 'draft', status: 'draft', entryDate: '2026-05-02' }];
const lines = [ ['buy', 115, 0], ['reverse', 0, 115], ['new', 100, 0], ['draft', 1000, 0] ]
  .map(([entryId, debit, credit]) => ({ entryId, accountId: '1500', debit, credit }));

describe('مطابقة تكلفة سجل الأصول', () => {
  it('يبين فرق السجل الفارغ ولا يحوّل غياب الأصل إلى مطابقة', () => {
    expect(reconcileAssetCost([], entries, lines)).toEqual({
      registerCost: 0, ledgerCost: 100, difference: -100, matched: false,
    });
  });
  it('يحتفظ بالأصل المعطل ويجمع الأصل وعكسه ولا يحسب المسودة', () => {
    expect(reconcileAssetCost([{ cost: 100, active: false }], entries, lines).matched).toBe(true);
  });
  it('الاستبعاد يحذف التكلفة في تاريخه فقط', () => {
    const asset = [{ cost: 100, disposalDate: '2026-06-01' }];
    expect(reconcileAssetCost(asset, entries, lines, { to: '2026-05-31' }).registerCost).toBe(100);
    expect(reconcileAssetCost(asset, entries, lines, { to: '2026-06-01' }).registerCost).toBe(0);
  });
  it('يقارن بالهللة، ولا يحسب مجمع الإهلاك ضمن تكلفة 1500', () => {
    const extra = [...lines, { entryId: 'new', accountId: '1510', credit: 20 }];
    expect(reconcileAssetCost([{ cost: 100.01 }], entries, extra).matched).toBe(false);
    expect(reconcileAssetCost([{ cost: 100 }], entries, extra).matched).toBe(true);
  });
  it('يعطل الترحيل عند التحميل والفشل والفرق وغياب الاستحقاق', () => {
    const ready = { loading: false, error: null, costReconciliation: { matched: true }, pendingCount: 1 };
    expect(canPostAssetCharges(ready)).toBe(true);
    for (const patch of [{ loading: true }, { error: new Error('read') },
      { costReconciliation: null }, { costReconciliation: { matched: false } }, { pendingCount: 0 }]) {
      expect(canPostAssetCharges({ ...ready, ...patch })).toBe(false);
    }
  });
});

it('الإطفاء منفصل عن الإهلاك ويتبع عدد أشهر العقد دون تغيير تكلفة الأصل', () => {
  const asset = { name: 'امتياز', cost: 1200, assetKind: 'intangible',
    usefulLifeMonths: 12, inServiceDate: '2026-01-01' };
  expect(normalizeAsset(asset)).toMatchObject({ assetAccount: '1500', expenseAccount: '5410', accumulatedAccount: '1511' });
  expect(buildDepreciationEntry('2026-01', [asset]).lines).toEqual([
    { accountId: '5410', debit: 100, credit: 0, description: 'إطفاء — امتياز' },
    { accountId: '1511', debit: 0, credit: 100, description: 'مجمع إطفاء — امتياز' },
  ]);
  expect(validateAsset({ ...asset, inServiceDate: '' })).toContain('تاريخ بدء التشغيل غير صالح (المطلوب YYYY-MM-DD).');
});
