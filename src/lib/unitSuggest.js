// ═══════════════════════════════════════════════════════════════════════════
// اقتراح السكن من وصف المصروف — يُعرَض ولا يُطبَّق
// ═══════════════════════════════════════════════════════════════════════════
// Twenty-seven expenses were recorded before the housing units existed, and
// most of them say where they went: «تزويد سكن النزهه بمروحة اضافية». Reading
// that back is a minute's work per row by hand and a second by machine — but
// the machine is GUESSING, so what it produces is a proposal on a review
// screen, never a write.
//
// The same limit as reading an amount off a photograph: nothing downstream can
// tell a right guess from a wrong one, so the person confirms.
//
// ── ولماذا التطبيع شرطٌ لا تحسين ──
// The owner typed «سكن النزهه» on the expense and may type «سكن النزهة» in the
// unit list — ه against ة. Compared raw, they never match and the tool finds
// nothing at all. Same for أ/ا, ى/ي, tatweel and doubled spaces.
// ═══════════════════════════════════════════════════════════════════════════

import { normalizeUnitName } from './accounting/startupMigration.js';

/** الكلمات التي تتكرر في كل اسم سكن فلا تميّز بينها. */
const GENERIC = new Set(['سكن', 'شقه', 'شقة', 'مقر', 'بيت']);

/**
 * الجزء المميّز من اسم السكن — «سكن النزهة» ⇒ «النزهة».
 *
 * Kept as its own step because most descriptions name the place, not the
 * full label: «مروحة لسكن النزهه» contains «النزهه» but not «سكن النزهة» in
 * that order.
 */
function distinctivePart(unit) {
  const words = normalizeUnitName(unit).split(' ').filter(Boolean);
  const kept = words.filter((w) => !GENERIC.has(w));
  // A unit called literally «سكن» has no distinctive part; using the generic
  // word would match every description that mentions housing at all.
  return kept.length ? kept.join(' ') : '';
}

/**
 * السكن الذي يذكره هذا الوصف — أو `null`.
 *
 * Ambiguity yields NOTHING rather than a winner. Two units named in one
 * description is a row the person must read; picking the longer match would
 * be the machine deciding a question it cannot answer, and the wrong half of
 * those decisions is invisible once written.
 */
export function suggestUnitFor(description, units = []) {
  const text = normalizeUnitName(description);
  if (!text) return null;

  const hits = [];
  for (const unit of units) {
    const full = normalizeUnitName(unit);
    if (!full) continue;
    const part = distinctivePart(unit);
    // ── اسمٌ كله كلمات عامة لا يُطابَق أصلاً ──
    // A unit named literally «سكن» matches every description that mentions
    // housing, which is all of them. Worse, alongside «سكن الشمال» it makes
    // the obvious answer AMBIGUOUS and throws it away. A name carrying no
    // distinguishing word carries no signal, so it is assigned by hand.
    if (!part) continue;
    if (text.includes(full) || text.includes(part)) hits.push(unit);
  }
  // De-duplicate by normalised name: «النزهة» and «النزهه» listed twice are
  // one place, and one place matching is not ambiguity.
  const distinct = [...new Set(hits.map((h) => normalizeUnitName(h)))];
  if (distinct.length !== 1) return null;
  return hits[0];
}

/**
 * اقتراحٌ لكل مصروف بلا سكن.
 *
 * Entries that already carry a unit are left alone — re-suggesting over an
 * answer the person gave is how a tool overwrites a correction with the
 * mistake it was correcting.
 */
export function suggestUnitAssignments(entries = [], units = []) {
  return entries
    .filter((e) => !e.unit)
    .map((e) => ({
      entryId: e.id,
      description: e.description || '',
      amount: Number(e.amount) || 0,
      suggested: suggestUnitFor(e.description, units),
    }));
}

/** كم مصروفاً بلا سكن — يقرّر ظهور زر الاقتراح أصلاً. */
export function unassignedCount(entries = []) {
  return entries.filter((e) => !e.unit).length;
}

/**
 * تجميع المصاريف بسكناتها، مع مجاميعها.
 *
 * Units with no spend still appear — a housing unit budgeted for and not yet
 * spent on is information, and hiding it would make the list look complete
 * when it is not. Unknown units (renamed since, say) get their own group
 * rather than vanishing: a value the lookup does not recognise must never
 * hide money. «غير محدد» is always last.
 */
export const UNASSIGNED = '__unassigned__';

export function groupEntriesByUnit(entries = [], units = []) {
  const buckets = new Map(units.map((u) => [normalizeUnitName(u), { label: u, items: [] }]));

  for (const e of entries) {
    const key = e.unit ? normalizeUnitName(e.unit) : UNASSIGNED;
    if (!buckets.has(key)) {
      buckets.set(key, { label: key === UNASSIGNED ? 'غير محدد' : e.unit, items: [] });
    }
    buckets.get(key).items.push(e);
  }

  const rows = [...buckets.entries()]
    .filter(([key]) => key !== UNASSIGNED)
    .map(([key, b]) => ({
      key,
      label: b.label,
      items: b.items,
      total: b.items.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    }));

  const unassigned = buckets.get(UNASSIGNED);
  if (unassigned) {
    rows.push({
      key: UNASSIGNED,
      label: 'غير محدد',
      items: unassigned.items,
      total: unassigned.items.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// نمطٌ عربيٌّ متسامح — للبحث والاستبدال في النص الأصلي
// ═══════════════════════════════════════════════════════════════════════════
// `normalizeUnitName` تُجيب عن «هل يتطابقان؟» وتكفي للمطابقة. لكنها لا تكفي
// للاستبدال: التطبيع يحذف حركات ويطوي مسافات، فيتغيّر الطول وتضيع خريطة
// المواضع بين النص المطبَّع والنص الأصلي — فلا يُعرف أين يقع البديل.
//
// فبدل تطبيع النص، يُطبَّع **المطلوب** إلى نمطٍ يقبل كل إملاءاته: «سكن النزهة»
// يصير نمطاً يطابق «سِكن  النزهه» في مكانه من الجملة، فيحلّ البديل محلّه
// بالضبط وما حوله لا يُمَسّ.
const EQUIVALENTS = ['أإآٱا', 'ةه', 'ىي'];
const MARKS = '[\u064B-\u0652\u0640]*';

function escapeRegex(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** فئة الحرف: كل ما يُعامَل مثله حرفاً واحداً. */
function charClass(ch) {
  const cls = EQUIVALENTS.find((c) => c.includes(ch));
  return cls ? `[${cls}]` : escapeRegex(ch);
}

/**
 * نمطٌ يطابق هذا النص بأي إملاءٍ من إملاءاته — أو `null` إن لم يبقَ منه شيء.
 *
 * The needle's own diacritics are dropped and the haystack's are tolerated
 * between letters, spaces match any run of whitespace, and ة/ه · أإآٱ/ا · ى/ي
 * are one letter each — the same equivalences `normalizeUnitName` applies,
 * expressed as a pattern instead of a transformation.
 */
export function tolerantArabicPattern(text) {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim();
  const parts = [];
  for (const ch of src) {
    if (/[\u064B-\u0652\u0640]/.test(ch)) continue;
    parts.push(/\s/.test(ch) ? '\\s+' : charClass(ch));
  }
  if (!parts.length) return null;
  return new RegExp(parts.join(MARKS), 'g');
}

/** يستبدل كل ظهورٍ للنص المطلوب — ويُرجع النص كما هو إن لم يظهر. */
export function replaceTolerant(text, from, to) {
  const pattern = tolerantArabicPattern(from);
  if (!pattern) return String(text ?? '');
  return String(text ?? '').replace(pattern, to);
}
