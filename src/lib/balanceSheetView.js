import { balanceSheet, postedLines } from './accounting/reports.js';
import { round2 } from './accounting/journal.js';
import { ledgerSourceIdentity } from './ledgerPresentation.js';
import { accountDisplayName } from './accountDisplay.js';

export function previousMonthEnd(day) {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}
const sum = rows => round2(rows.reduce((total, row) => total + row.amount, 0));
const assetType = label => /فرنشايز|انضمام|onboarding|franchise/i.test(label) ? 'intangible'
  : /دباب|دراجة|motorcycle/i.test(label) ? 'bikes'
    : /جوال|هاتف|phone/i.test(label) ? 'phones'
      : /تجهيز|أثاث|اثاث|سكن|equipment/i.test(label) ? 'equipment' : 'other';
const ASSET_LABELS = { bikes: 'الدبابات', phones: 'الجوالات', equipment: 'التجهيزات', other: 'أخرى حسب الدفتر', intangible: 'رسوم انضمام سويتر — أصول غير ملموسة' };

// Split only the posted 1500 movements. Never use purchase gross/parent
// budgets as balances, never drop reversals or unclassified/manual lines.
export function fixedAssetPresentation(entries, lines, asOf, startupEntries, startupItems) {
  const index = new Map(entries.map(entry => [entry.id, entry]));
  const documents = new Map(startupEntries.map(row => [row.id, row]));
  const parents = new Map(startupItems.map(row => [row.id, row]));
  const groups = new Map(Object.keys(ASSET_LABELS).map(key => [key, 0]));
  for (const line of postedLines(entries, lines, { to: asOf })) {
    if (String(line.accountId) !== '1500') continue;
    const entry = index.get(line.entryId), source = ledgerSourceIdentity(entry, index);
    const doc = source?.kind === 'startup' ? documents.get(source.id) : null;
    const parent = doc && parents.get(doc.startup_cost_id);
    // Missing source links stay visible as other; a label alone must not
    // silently move an unknown journal into an intangible asset.
    const type = parent ? assetType(parent.item_name || '') : 'other';
    groups.set(type, round2(groups.get(type) + Number(line.debit || 0) - Number(line.credit || 0)));
  }
  return [...groups].map(([key, amount]) => ({ key, label: ASSET_LABELS[key], amount }));
}

export function balanceSheetPresentation({ accounts, entries, lines, asOf, feeRules = [], startupEntries = [], startupItems = [], assetSourcesReady = false }) {
  const bs = balanceSheet(accounts, entries, lines, { asOf, feeRules });
  const prior = balanceSheet(accounts, entries, lines, { asOf: `${Number(asOf.slice(0, 4)) - 1}-12-31`, feeRules });
  const fixedGroups = fixedAssetPresentation(entries, lines, asOf, startupEntries, startupItems);
  const rows = [];
  const add = (key, label, amount, section, extra = {}) => rows.push({ key, label, amount, section, ...extra });
  for (const row of bs.assets) {
    if (['1500', '1510'].includes(row.code)) continue;
    const section = ['1010', '1020', '1100', '1101', '1200', '1300'].includes(row.code) ? 'currentAssets' : 'unclassifiedAssets';
    add(row.code, row.nameArabic, row.amount, section, { code: row.code, abnormal: row.balance < -.005 });
  }
  const fixedTotal = bs.assets.find(row => row.code === '1500')?.amount || 0;
  const intangible = assetSourcesReady ? fixedGroups.find(row => row.key === 'intangible').amount : null;
  add('fixed', assetSourcesReady ? 'الأصول الثابتة' : 'الأصول 1500 — التفصيل غير متاح', assetSourcesReady ? round2(fixedTotal - intangible) : fixedTotal,
    'noncurrentAssets', { children: assetSourcesReady ? fixedGroups.filter(row => row.key !== 'intangible') : [], code: '1500' });
  // An unavailable source is not a zero intangible balance. The unsplit
  // 1500 above still preserves the full ledger total while loading/failing.
  if (assetSourcesReady) add('intangible', ASSET_LABELS.intangible, intangible, 'noncurrentAssets', { code: '1500' });
  const depreciation = bs.assets.find(row => row.code === '1510');
  add('depreciation', 'مجمع الإهلاك', depreciation?.amount || 0, 'noncurrentAssets',
    { code: '1510', abnormal: Boolean(depreciation && depreciation.balance < -.005), note: !depreciation?.amount ? 'ما انسجل إهلاك' : '' });
  for (const row of bs.liabilities) {
    // Only the chart's known short-term control accounts are assumed current.
    // A new loan with no maturity does not acquire an invented due date.
    const section = ['2000', '2010', '2100'].includes(row.code) ? 'currentLiabilities' : 'unclassifiedLiabilities';
    add(row.code, row.nameArabic, row.amount, section, { code: row.code, abnormal: row.balance < -.005 });
  }
  const capital = bs.equity.filter(row => row.code === '3000' || row.code.startsWith('3000-'));
  add('capital', 'رأس مال الشركاء', sum(capital), 'equity', { children: capital.filter(row => row.code !== '3000').map(row => ({ ...row, key: row.code, label: accountDisplayName(row) })),
    abnormal: capital.some(row => row.balance < -.005) });
  const retained = bs.equity.filter(row => row.code === '3100');
  const retainedAmount = round2(sum(retained) + prior.periodResult);
  add('retained', retainedAmount > 0 ? 'الأرباح المتراكمة من السنوات السابقة' : 'الخسائر المتراكمة من السنوات السابقة', retainedAmount, 'equity');
  add('currentResult', 'نتيجة السنة الحالية', round2(bs.periodResult - prior.periodResult), 'equity');
  for (const row of bs.equity.filter(row => !capital.includes(row) && row.code !== '3100')) {
    add(row.code, row.nameArabic, row.amount, 'equity', { code: row.code, abnormal: row.balance < -.005 });
  }
  return { ...bs, rows, sections: Object.fromEntries(['currentAssets', 'noncurrentAssets', 'unclassifiedAssets', 'currentLiabilities', 'noncurrentLiabilities', 'unclassifiedLiabilities', 'equity']
    .map(key => [key, { rows: rows.filter(row => row.section === key), total: sum(rows.filter(row => row.section === key)) }])),
    abnormalRows: rows.filter(row => row.abnormal), fixedGroups, retainedAmount,
    currentResult: round2(bs.periodResult - prior.periodResult) };
}

export function comparisonRows(current, previous, section) {
  const currentRows = current.sections[section].rows, previousRows = previous.sections[section].rows;
  return [...new Set([...currentRows, ...previousRows].map(row => row.key))].map(key => {
    const now = currentRows.find(row => row.key === key), before = previousRows.find(row => row.key === key);
    return { ...(now || before), amount: now?.amount || 0, comparison: before?.amount || 0,
      abnormal: Boolean(now?.abnormal), comparisonAbnormal: Boolean(before?.abnormal),
      children: [...new Set([...(now?.children || []), ...(before?.children || [])].map(row => row.key))].map(childKey => {
        const a = now?.children?.find(row => row.key === childKey), b = before?.children?.find(row => row.key === childKey);
        return { ...(a || b), amount: a?.amount || 0, comparison: b?.amount || 0 };
      }) };
  });
}
