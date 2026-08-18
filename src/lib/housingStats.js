// ═══════════════════════════════════════════════════════════════════════════
// إحصاءات السكن — الساكنون يُربَطون ولا يُعَدّون، والتكلفة تُقرأ ولا تُخزَّن
// ═══════════════════════════════════════════════════════════════════════════
// The housing tab exists to answer one question the owner kept computing by
// hand: «كم كلّف السكن للساكن الواحد، مقابل تقديري؟». Every number here is
// DERIVED at read time from three sources that already exist:
//
//   • the unit list      — `units` on the startup item (the plan)
//   • the unit's cost    — `startup_cost_entries.unit` (the spend)
//   • the unit's people  — `bikers.residence` (the registry)
//
// ── ولماذا لا يُخزَّن «عدد السكان» ──
// A stored count next to a list of names is two answers to one question, and
// two answers drift: the biker moves out, the count stays 14. So the count is
// the length of the matched names — one source, no drift. What IS stored (in
// `housing_units`) is only what nothing else knows: the planned capacity and
// the free notes.
//
// ── والربط بالتطبيع لا بالمساواة الحرفية ──
// `biker.residence` is free text. The owner typed «سكن النزهه» on the biker
// and «سكن النزهة» on the plan — ه against ة. Compared raw they never meet
// and the resident silently vanishes from his unit; `normalizeUnitName` is
// the same equivalence the expense grouping already lives by.
// ═══════════════════════════════════════════════════════════════════════════

import { normalizeUnitName } from './accounting/startupMigration.js';
import { groupEntriesByUnit, UNASSIGNED } from './unitSuggest.js';

/**
 * معرّف وثيقة الميتا لسكنٍ ما — حتميٌّ من اسمه المطبَّع.
 *
 * Deterministic so two meta documents for one unit are impossible BY
 * CONSTRUCTION, not by a check that can race. `encodeURIComponent` because a
 * unit name is free text and `/` is forbidden in a Firestore document id —
 * and because the two spellings of one place must map to one document, the
 * NORMALIZED name is what gets encoded.
 */
export function housingUnitDocId(name) {
  const key = normalizeUnitName(name);
  return key ? encodeURIComponent(key) : '';
}

/** ساكنو هذا السكن — البايكرية الذين يطابق سكنُهم اسمَه، بالتطبيع. */
export function residentsOf(unitName, bikers = []) {
  const key = normalizeUnitName(unitName);
  if (!key) return [];
  return bikers.filter((b) => normalizeUnitName(b.residence) === key);
}

/**
 * من لا سكن معروفاً له — سكنُه فارغ، أو نصٌّ لا يطابق أي سكن مُدرَج.
 *
 * The raw residence text rides along on purpose: a biker whose field says
 * «حي النسيم» must show WHAT it says, not just that it matched nothing —
 * hiding the text would make the fix a guessing game.
 */
export function unhousedBikers(bikers = [], allUnitNames = []) {
  const known = new Set(allUnitNames.map(normalizeUnitName).filter(Boolean));
  return bikers
    .filter((b) => !known.has(normalizeUnitName(b.residence)))
    .map((b) => ({ biker: b, residenceText: b.residence || '' }));
}

/**
 * التكلفة للساكن — و`null` حين لا ساكن.
 *
 * Null, not Infinity and not 0: a unit with spend and no linked residents has
 * an UNANSWERABLE per-head cost, and the screen shows «—». Zero would claim
 * the housing was free; Infinity would claim the arithmetic worked.
 */
export function perResident(cost, count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (Number(cost) || 0) / n;
}

/**
 * الإيجار لكل سكن — من المصاريف السنوية، لا من رقمٍ يُكتب على البطاقة.
 *
 * الإيجار مسجَّل أصلاً في الدفاتر. فحقلٌ ثانٍ على السكن يعني رقمين لشيءٍ
 * واحد ينجرفان، وإيجاراً خارج قائمة الدخل. فيُقرأ من حيث هو.
 *
 * Keyed by NORMALIZED unit name, and deliberately flat across items: the
 * housing tab groups by the physical place, not by which annual item paid
 * for it, so two items naming the same unit add up into one figure for it.
 * That is the opposite of `buildHousingRows`, which keeps items apart on
 * purpose — there, two items sharing a unit name are two different budgets
 * and merging them would be a lie. Here they are the same rent for the same
 * roof.
 *
 * `unassigned` rides along because rent nobody has filed under a unit is the
 * normal starting state, and money that hides behind a grouping it did not
 * fit is money the owner cannot see.
 */
export function rentByUnit({ annualItems = [], annualEntries = [] } = {}) {
  const byUnit = new Map();
  let unassigned = 0;
  let unassignedCount = 0;

  for (const item of annualItems) {
    if (!Array.isArray(item.units) || item.units.length === 0) continue;
    const own = annualEntries.filter((e) => e.annualExpenseId === item.id);
    for (const g of groupEntriesByUnit(own, item.units)) {
      if (g.key === UNASSIGNED) {
        unassigned += g.total;
        unassignedCount += g.items.length;
        continue;
      }
      const prev = byUnit.get(g.key)
        || { key: g.key, name: g.label, total: 0, entryCount: 0, itemNames: [] };
      prev.total += g.total;
      prev.entryCount += g.items.length;
      if (!prev.itemNames.includes(item.expenseName)) prev.itemNames.push(item.expenseName);
      byUnit.set(g.key, prev);
    }
  }
  return { byUnit, unassigned, unassignedCount };
}

/**
 * سكناتٌ عليها إيجار ولا بطاقة لها — لأن التجهيز لم يُقسَّم عليها.
 *
 * The unit CARDS come from the startup item's `units`. A unit named only on
 * the rent item would therefore have rent and no card at all, and the money
 * would vanish from the screen while sitting in the books. Named instead, so
 * the owner sees the mismatch and can fix whichever list is wrong.
 */
export function rentOnlyUnits(rentIndex, coveredNames = []) {
  const covered = new Set(coveredNames.map(normalizeUnitName).filter(Boolean));
  if (!rentIndex?.byUnit) return [];
  return [...rentIndex.byUnit.values()].filter((u) => !covered.has(u.key));
}

/**
 * الصورة الكاملة: لكل بندٍ له تقسيمات — سكناته بساكنيها وتكلفتها وسعتها.
 *
 * Entries are filtered to THEIR item before grouping, so two items that
 * happen to name units alike never merge money across items. `benchmark` is
 * the item's own planned per-unit price (١٥٬٠٠٠ ÷ ٥٠ = ٣٠٠) — the estimate
 * the owner wants every measured figure compared against. Unassigned spend
 * («غير محدد») is returned as an explicit amount: money never hides behind
 * a grouping it did not fit.
 *
 * ── والإيجار سطرٌ ثانٍ، لا يُجمع مع التجهيز ──
 * `rent` arrives from `rentByUnit` and stays BESIDE the setup cost, never
 * added to it. The setup is capital spent once; the rent is an annual cost
 * that repeats. «٣٩١ للساكن تجهيزاً» and «١٬٧١٤ للساكن إيجاراً سنوياً» are
 * two facts with two different benchmarks — adding them yields a number
 * that answers no question and can be compared to no budget.
 */
export function buildHousingRows({
  items = [], entries = [], bikers = [], metaRows = [], rentIndex = null,
} = {}) {
  const metaByKey = new Map(
    metaRows.map((m) => [normalizeUnitName(m.name), m]).filter(([k]) => k),
  );

  return items
    .filter((i) => Array.isArray(i.units) && i.units.length > 0)
    .map((item) => {
      const own = entries.filter((e) => e.startupCostId === item.id);
      const groups = groupEntriesByUnit(own, item.units);
      const unassigned = groups.find((g) => g.key === UNASSIGNED);
      const benchmark = item.quantity > 0 ? item.plannedAmount / item.quantity : null;

      const units = groups
        .filter((g) => g.key !== UNASSIGNED)
        .map((g) => {
          const residents = residentsOf(g.label, bikers);
          const meta = metaByKey.get(g.key) || null;
          const per = perResident(g.total, residents.length);
          const rentRow = rentIndex?.byUnit?.get(g.key) || null;
          const rent = rentRow ? rentRow.total : 0;
          return {
            key: g.key,
            name: g.label,
            residents,
            capacity: meta?.capacity ?? null,
            notes: meta?.notes || '',
            cost: g.total,
            entryCount: g.items.length,
            perResident: per,
            // الإيجار السنوي لهذا السكن — صفرٌ يعني «لا دفعة موسومة به»،
            // وهو ما تعرضه الشاشة «—» لا «٠ ر.س».
            rent,
            rentEntryCount: rentRow ? rentRow.entryCount : 0,
            rentSources: rentRow ? rentRow.itemNames : [],
            rentPerResident: perResident(rent, residents.length),
            // نسبة الفارق عن التقدير — لا تُحسب إلا حين يكون الطرفان حقيقيين.
            vsBenchmarkPct: per !== null && benchmark
              ? ((per - benchmark) / benchmark) * 100
              : null,
          };
        });

      return {
        itemId: item.id,
        itemName: item.itemName,
        benchmark,
        units,
        unassignedCost: unassigned ? unassigned.total : 0,
        unassignedCount: unassigned ? unassigned.items.length : 0,
      };
    });
}
