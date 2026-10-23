// ═══════════════════════════════════════════════════════════════════════════
// الأصول الثابتة والإهلاك — fixed assets and straight-line depreciation
// ═══════════════════════════════════════════════════════════════════════════
// Pure logic. The register lives in `fixed_assets`; posting lives in
// firestoreAssets.js.
//
// Why this exists: capitalising a purchase to 1500 without ever depreciating
// it overstates both the assets and the profit, every month, forever. The
// schedule below is what turns a fixed asset into an expense over its life.
//
// The policy, stated once and applied everywhere:
//   • Straight line — (cost − salvage) ÷ useful life in months.
//   • Full-month convention: an asset bought on the 3rd and one bought on the
//     28th both take a full month in the month they enter service. It is the
//     simplest defensible policy, and consistency across assets matters more
//     here than a few riyals of precision.
//   • The LAST month absorbs the rounding drift, so total depreciation equals
//     the depreciable base to the halala and the asset lands exactly on its
//     salvage value — never a riyal below it.
//   • A disposed asset stops depreciating in the month it leaves.
// ═══════════════════════════════════════════════════════════════════════════

import { round2, periodKeyOf } from './journal.js';
import { ACC } from './chartOfAccounts.js';

export const DEPRECIATION_METHODS = ['straight_line'];

/** Sensible default lives, in months — a starting point, always editable. */
export const USEFUL_LIFE_PRESETS = [
  { label: 'أجهزة ومعدات غسيل (5 سنوات)', months: 60 },
  { label: 'أثاث وتجهيزات (5 سنوات)',      months: 60 },
  { label: 'حاسبات وأجهزة (3 سنوات)',      months: 36 },
  { label: 'سيارات ومركبات (5 سنوات)',     months: 60 },
  { label: 'تحسينات على المأجور (10 سنوات)', months: 120 },
];

// ─── حساب الفترات ────────────────────────────────────────────────────────
/** Shifts a 'YYYY-MM' key by n months (n may be negative). '' when invalid. */
export function addMonths(periodKey, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
  if (!m) return '';
  const total = (+m[1]) * 12 + (+m[2] - 1) + Number(n || 0);
  const y = Math.floor(total / 12);
  const mo = total % 12 + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/** Whole months from `a` to `b` — negative when b precedes a. */
export function monthsBetween(a, b) {
  const x = /^(\d{4})-(\d{2})$/.exec(String(a || ''));
  const y = /^(\d{4})-(\d{2})$/.exec(String(b || ''));
  if (!x || !y) return 0;
  return ((+y[1]) - (+x[1])) * 12 + ((+y[2]) - (+x[2]));
}

/** Last day of a month, so an entry lands at the period end where it belongs. */
export function periodEndDate(periodKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
  if (!m) return '';
  const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
}

// ─── الأصل ───────────────────────────────────────────────────────────────
/** Fills the fields a schedule needs, without overwriting anything supplied. */
export function normalizeAsset(asset) {
  return {
    method: 'straight_line',
    salvageValue: 0,
    assetAccount: ACC.FIXED_ASSETS,
    accumulatedAccount: ACC.ACCUM_DEPRECIATION,
    expenseAccount: ACC.DEPRECIATION,
    disposalDate: null,
    disposalProceeds: 0,
    active: true,
    ...asset,
    cost: round2(Number(asset?.cost) || 0),
    usefulLifeMonths: Math.trunc(Number(asset?.usefulLifeMonths) || 0),
  };
}

/** Arabic problems with an asset; empty array = safe to schedule. */
export function validateAsset(asset) {
  const problems = [];
  const a = normalizeAsset(asset || {});
  if (!String(a.name || '').trim()) problems.push('اسم الأصل مطلوب.');
  if (!(a.cost > 0)) problems.push('تكلفة الأصل يجب أن تكون أكبر من صفر.');
  const salvage = round2(Number(a.salvageValue) || 0);
  if (salvage < 0) problems.push('القيمة التخريدية لا يمكن أن تكون سالبة.');
  if (salvage >= a.cost && a.cost > 0) {
    problems.push('القيمة التخريدية يجب أن تقل عن التكلفة، وإلا فلا يوجد ما يُهلك.');
  }
  if (!Number.isInteger(a.usefulLifeMonths) || a.usefulLifeMonths < 1) {
    problems.push('العمر الإنتاجي يجب أن يكون شهراً واحداً على الأقل.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.inServiceDate || ''))) {
    problems.push('تاريخ بدء التشغيل غير صالح (المطلوب YYYY-MM-DD).');
  }
  if (a.disposalDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.disposalDate))) {
      problems.push('تاريخ الاستبعاد غير صالح.');
    } else if (String(a.disposalDate) < String(a.inServiceDate)) {
      problems.push('تاريخ الاستبعاد قبل تاريخ التشغيل.');
    }
  }
  if (!DEPRECIATION_METHODS.includes(a.method)) {
    problems.push(`طريقة الإهلاك غير مدعومة: ${a.method}`);
  }
  return problems;
}

/** التكلفة القابلة للإهلاك — cost less what the asset is expected to fetch. */
export function depreciableBase(asset) {
  const a = normalizeAsset(asset);
  return round2(Math.max(0, a.cost - (Number(a.salvageValue) || 0)));
}

/** First month the asset is depreciated (full-month convention). */
export function firstDepreciationPeriod(asset) {
  return periodKeyOf(normalizeAsset(asset).inServiceDate);
}

/** Last month of the schedule, ignoring disposal. */
export function lastDepreciationPeriod(asset) {
  const a = normalizeAsset(asset);
  const first = firstDepreciationPeriod(a);
  return first ? addMonths(first, a.usefulLifeMonths - 1) : '';
}

/**
 * The full month-by-month schedule.
 *
 * Every row carries the running accumulated total and the resulting net book
 * value, because those are the two numbers an auditor asks for and deriving
 * them twice is how they drift apart.
 */
export function depreciationSchedule(asset) {
  const a = normalizeAsset(asset);
  if (validateAsset(a).length) return [];

  const base = depreciableBase(a);
  const months = a.usefulLifeMonths;
  const first = firstDepreciationPeriod(a);
  const perMonth = round2(base / months);
  // A disposed asset stops in the month BEFORE it leaves: it is not in use.
  const stopAfter = a.disposalDate ? addMonths(periodKeyOf(a.disposalDate), -1) : null;

  const rows = [];
  let accumulated = 0;
  for (let i = 0; i < months; i += 1) {
    const periodKey = addMonths(first, i);
    if (stopAfter && periodKey > stopAfter) break;
    const isLast = i === months - 1;
    // The final month takes whatever is left, so the schedule totals exactly
    // the depreciable base instead of drifting by the rounding of N months.
    const amount = isLast ? round2(base - accumulated) : perMonth;
    accumulated = round2(accumulated + amount);
    rows.push({
      periodKey,
      month: i + 1,
      amount,
      accumulated,
      netBookValue: round2(a.cost - accumulated),
    });
  }
  return rows;
}

/** Accumulated depreciation charged up to and including `periodKey`. */
export function accumulatedThrough(asset, periodKey) {
  const rows = depreciationSchedule(asset);
  let total = 0;
  for (const r of rows) {
    if (periodKey && r.periodKey > periodKey) break;
    total = r.accumulated;
  }
  return round2(total);
}

/** القيمة الدفترية — cost less accumulated depreciation at a point in time. */
export function netBookValue(asset, periodKey) {
  const a = normalizeAsset(asset);
  return round2(a.cost - accumulatedThrough(a, periodKey));
}

/**
 * What every asset owes for one month.
 *
 * Assets with nothing to charge are simply absent — an entry with zero-amount
 * lines would fail validation, and a zero line teaches a reader nothing.
 */
export function depreciationForPeriod(assets, periodKey) {
  const rows = [];
  for (const raw of assets || []) {
    const a = normalizeAsset(raw);
    if (a.active === false) continue;
    const hit = depreciationSchedule(a).find((r) => r.periodKey === periodKey);
    if (!hit || hit.amount <= 0) continue;
    rows.push({
      assetId: a.id ?? null,
      name: a.name || 'أصل ثابت',
      amount: hit.amount,
      accumulated: hit.accumulated,
      netBookValue: hit.netBookValue,
      expenseAccount: a.expenseAccount || ACC.DEPRECIATION,
      accumulatedAccount: a.accumulatedAccount || ACC.ACCUM_DEPRECIATION,
    });
  }
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return { periodKey, rows, total };
}

/**
 * قيد إهلاك الشهر.
 *   مدين  مصروف الإهلاك      لكل أصل على حدة
 *   دائن  مجمع الإهلاك       لكل أصل على حدة
 *
 * Per-asset lines on BOTH sides: the general ledger for 1510 then reads as a
 * per-asset history, which is exactly what a fixed-asset note needs. The
 * entry is dated on the LAST day of the month it covers, so it lands in the
 * period it belongs to rather than the day someone happened to run it.
 *
 * `sourceId` is the period key, which is what makes re-running the month a
 * no-op instead of a second charge.
 */
export function buildDepreciationEntry(periodKey, assets, { createdBy = null } = {}) {
  const { rows, total } = depreciationForPeriod(assets, periodKey);
  if (rows.length === 0) return null;

  const lines = [];
  for (const r of rows) {
    lines.push({ accountId: r.expenseAccount, debit: r.amount, credit: 0,
      description: `إهلاك — ${r.name}` });
  }
  for (const r of rows) {
    lines.push({ accountId: r.accumulatedAccount, debit: 0, credit: r.amount,
      description: `مجمع إهلاك — ${r.name}` });
  }

  const entryDate = periodEndDate(periodKey);
  return {
    entry: {
      entryDate,
      periodKey,
      sourceType:  'depreciation',
      sourceId:    periodKey,
      description: `إهلاك الشهر ${periodKey} — ${rows.length} أصل`,
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines,
    total,
    assetCount: rows.length,
  };
}

/**
 * قيد استبعاد أصل — sale or scrapping.
 *   مدين  الصندوق/البنك        بالمتحصل
 *   مدين  مجمع الإهلاك          بما تراكم
 *   دائن  الأصول الثابتة        بالتكلفة
 *   والفرق ربح أو خسارة استبعاد
 *
 * The gain/loss is the balancing figure, and it is computed rather than
 * entered — a typed "loss" that does not equal cost − accumulated − proceeds
 * is just an unbalanced entry waiting to be rejected.
 */
export function buildDisposalEntry(asset, {
  disposalDate, proceeds = 0, settlementAccount = ACC.CASH, createdBy = null,
} = {}) {
  const a = normalizeAsset(asset);
  const date = String(disposalDate || a.disposalDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('تاريخ الاستبعاد غير صالح.');
  }
  const cash = round2(Math.max(0, Number(proceeds) || 0));
  // Everything charged up to the month before it left — the same cut-off the
  // schedule uses, so the two can never disagree.
  const accumulated = accumulatedThrough(
    { ...a, disposalDate: date }, addMonths(periodKeyOf(date), -1),
  );
  const bookValue = round2(a.cost - accumulated);
  const result = round2(cash - bookValue);      // + ربح، − خسارة

  const lines = [];
  if (cash > 0) {
    lines.push({ accountId: settlementAccount, debit: cash, credit: 0, description: 'متحصلات بيع أصل' });
  }
  if (accumulated > 0) {
    lines.push({ accountId: a.accumulatedAccount, debit: accumulated, credit: 0,
      description: `إقفال مجمع إهلاك — ${a.name}` });
  }
  lines.push({ accountId: a.assetAccount, debit: 0, credit: a.cost,
    description: `استبعاد أصل — ${a.name}` });
  if (result > 0) {
    lines.push({ accountId: ACC.ASSET_DISPOSAL_GAIN, debit: 0, credit: result,
      description: 'ربح استبعاد أصل' });
  } else if (result < 0) {
    lines.push({ accountId: ACC.ASSET_DISPOSAL_LOSS, debit: round2(-result), credit: 0,
      description: 'خسارة استبعاد أصل' });
  }

  return {
    entry: {
      entryDate:   date,
      periodKey:   periodKeyOf(date),
      sourceType:  'disposal',
      sourceId:    a.id ?? null,
      description: `استبعاد أصل — ${a.name}`,
      status:      'posted',
      createdBy,
      reversalOf:  null,
    },
    lines,
    accumulated,
    bookValue,
    result,
  };
}

/**
 * Register-wide totals for the fixed-asset note: cost, accumulated and net
 * book value as at a period.
 */
export function registerSummary(assets, periodKey) {
  let cost = 0, accumulated = 0, disposed = 0, count = 0;
  for (const raw of assets || []) {
    const a = normalizeAsset(raw);
    if (a.disposalDate && periodKeyOf(a.disposalDate) <= periodKey) { disposed += 1; continue; }
    count += 1;
    cost += a.cost;
    accumulated += accumulatedThrough(a, periodKey);
  }
  return {
    count,
    disposed,
    cost: round2(cost),
    accumulated: round2(accumulated),
    netBookValue: round2(cost - accumulated),
  };
}

/**
 * True when at least one month of THIS asset's schedule has already been
 * charged. Restating a cost or a life after that would leave the schedule
 * disagreeing with the ledger, and the ledger is the record.
 */
export function hasChargedPeriods(asset, postedPeriods) {
  if (!postedPeriods || postedPeriods.size === 0) return false;
  return depreciationSchedule(normalizeAsset(asset))
    .some((r) => r.amount > 0 && postedPeriods.has(r.periodKey));
}

/**
 * Months of THIS asset's schedule that have not been charged yet, up to and
 * including `through`.
 *
 * Disposal depends on this: the disposal entry debits accumulated
 * depreciation by what the SCHEDULE says has built up, so if some of those
 * months were never posted, that credit is not actually sitting in 1510 and
 * the entry would drive the account negative and misstate the gain or loss.
 */
export function missingChargedPeriods(asset, postedPeriods, { through = null } = {}) {
  const posted = postedPeriods || new Set();
  return depreciationSchedule(normalizeAsset(asset))
    .filter((r) => r.amount > 0 && (!through || r.periodKey <= through))
    .map((r) => r.periodKey)
    .filter((p) => !posted.has(p));
}

/**
 * Compares what the register says each charged month should have been against
 * what the ledger actually holds.
 *
 * This is the check that catches a back-dated asset: one added after its
 * first months were already posted would never be picked up by the backlog
 * sweep (those periods are "done"), and its depreciation would silently go
 * missing. A difference here is a real finding, not a rounding artefact.
 */
export function reconcileDepreciation(assets, entries, lines) {
  const linesByEntry = new Map();
  for (const l of lines || []) {
    if (!linesByEntry.has(l.entryId)) linesByEntry.set(l.entryId, []);
    linesByEntry.get(l.entryId).push(l);
  }
  const differences = [];
  for (const e of entries || []) {
    if (e.sourceType !== 'depreciation' || e.status !== 'posted') continue;
    const periodKey = String(e.sourceId);
    const postedAmount = round2((linesByEntry.get(e.id) || [])
      .reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const expected = depreciationForPeriod(assets, periodKey).total;
    const difference = round2(expected - postedAmount);
    if (Math.abs(difference) >= 0.01) {
      differences.push({ periodKey, expected, posted: postedAmount, difference });
    }
  }
  return differences.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

/**
 * Which months still need a depreciation entry, oldest first.
 *
 * `postedPeriods` is the set already charged. A month is only offered when
 * some asset actually has a charge in it, so an empty register never invites
 * an empty entry.
 */
export function unpostedDepreciationPeriods(assets, { postedPeriods = new Set(), through } = {}) {
  const periods = new Set();
  for (const raw of assets || []) {
    for (const r of depreciationSchedule(normalizeAsset(raw))) {
      if (through && r.periodKey > through) break;
      if (r.amount > 0) periods.add(r.periodKey);
    }
  }
  return [...periods].filter((p) => !postedPeriods.has(p)).sort();
}
