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
 * الصورة الكاملة: لكل بندٍ له تقسيمات — سكناته بساكنيها وتكلفتها وسعتها.
 *
 * Entries are filtered to THEIR item before grouping, so two items that
 * happen to name units alike never merge money across items. `benchmark` is
 * the item's own planned per-unit price (١٥٬٠٠٠ ÷ ٥٠ = ٣٠٠) — the estimate
 * the owner wants every measured figure compared against. Unassigned spend
 * («غير محدد») is returned as an explicit amount: money never hides behind
 * a grouping it did not fit.
 */
export function buildHousingRows({ items = [], entries = [], bikers = [], metaRows = [] } = {}) {
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
          return {
            key: g.key,
            name: g.label,
            residents,
            capacity: meta?.capacity ?? null,
            notes: meta?.notes || '',
            cost: g.total,
            entryCount: g.items.length,
            perResident: per,
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
