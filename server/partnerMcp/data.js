// ═══════════════════════════════════════════════════════════════════════════
// القراءة — بـ Admin SDK، مرشَّحةً بالشريك قبل أن تبلغ أي أداة
// ═══════════════════════════════════════════════════════════════════════════
// ما يُجلب هنا هو ما تجلبه صفحة الشريك في الواجهة، لا أكثر: الشركاء (للمجموع
// وحده)، وسنداته هو، ودليل الحسابات، وقيود المدى المطلوب، وقواعد الرسوم،
// والأشهر التي للدفاتر فيها قول. وزيادةٌ واحدة طُلبت صراحةً: الغسلات — عدداً
// ومبلغاً — لتُقسَم بحصّته.
//
// ── ما لا يُجلب أصلاً ──
// `biker_name` لا يُقرأ من Firestore: الاستعلام يسمّي حقوله بـ `select`،
// فالاسم لا يصل الذاكرة ولا يحتاج مصفاةً تُسقطه. والمصاريف الخام
// (`monthly_expenses` وأخواتها) لا تُقرأ: تفصيلها يأتي من الدفاتر — صفوف
// قائمة الدخل بالحساب — وهي ما تعرضه صفحة الشريك أصلاً، ومقسومةٌ جاهزةً.
//
// ── الذاكرة لكل طلب ──
// `makeLoader` يحفظ كل قراءة مرةً واحدة داخل الطلب: أداةُ الملخّص تسأل عن
// الهوية ورأس المال والقائمة معاً، ولا معنى لأن تُقرأ `partners` ثلاث مرات.
// ═══════════════════════════════════════════════════════════════════════════

import { monthRange } from '../../src/lib/accounting/monthlyStatement.js';

const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** السطور داخل قيدها — نفس `embeddedLinesOf` في `firestoreLedger.js`. */
export function embeddedLinesOf(entry) {
  const list = Array.isArray(entry?.lines) ? entry.lines : [];
  return list.map((l, i) => ({ ...l, entryId: entry.id, id: `${entry.id}:${i}` }));
}

export const todayMonth = () => new Date().toISOString().slice(0, 7);

/**
 * الشركاء — الحقول الأربعة التي يحتاجها الحساب، لا الصفّ كاملاً.
 * `contact_number` لا يُطلب فلا يصل.
 */
export async function loadPartners(db) {
  const snap = await db.collection('partners')
    .select('partner_name', 'workers_count', 'user_id', 'status')
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    partnerName: d.get('partner_name') ?? '',
    workersCount: Number(d.get('workers_count')) || 0,
    status: d.get('status') ?? 'active',
  }));
}

/** سندات هذا الشريك وحده — المرشّح الوحيد الذي يهمّ، وهو في الاستعلام نفسه. */
export async function loadOwnReceipts(db, partnerId) {
  const snap = await db.collection('partner_payments')
    .where('partner_id', '==', String(partnerId))
    .get();
  return rowsOf(snap)
    .map((r) => ({
      id: r.id,
      amount: Number(r.amount) || 0,
      paymentDate: String(r.payment_date || ''),
      paymentMethod: ['bank_transfer', 'cash', 'mada_pos'].includes(r.payment_method) ? r.payment_method : 'bank_transfer',
      notes: String(r.notes || ''),
    }))
    .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : a.paymentDate > b.paymentDate ? -1 : 0));
}

/** قواعد الرسوم — نفس ترشيح `useFeeRules.js`: الفعّالة، و`effective_from` مُعادة التسمية. */
export async function loadFeeRules(db) {
  const snap = await db.collection('fee_rules').get();
  return rowsOf(snap)
    .filter((r) => r.active !== false)
    .map((r) => ({
      key: r.key ?? r.id,
      label: r.label ?? r.key ?? r.id,
      basis: r.basis === 'profit' ? 'profit' : 'revenue',
      rate: Number(r.rate) || 0,
      effectiveFrom: r.effective_from ?? r.effectiveFrom ?? null,
    }));
}

/**
 * الأشهر التي للدفاتر فيها قول — من `accounting_periods` لا من مسح القيود:
 * الترحيل ينشئ مستند الفترة عند أول قيدٍ في الشهر، فهي مستندٌ لكل شهر.
 */
export async function loadAvailableMonths(db) {
  const snap = await db.collection('accounting_periods').select().get();
  const months = snap.docs.map((d) => d.id).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  return months.length ? months : [todayMonth()];
}

export async function loadAccounts(db) {
  return rowsOf(await db.collection('chart_of_accounts').get());
}

/**
 * قيود مدى من الأشهر — بتاريخ القيد لا بـ `periodKey`: التقارير ترشّح
 * بالتاريخ، وقيودٌ قديمة قد تخلو من مفتاح الفترة.
 *
 * السطور القديمة (`journal_lines`) تُستكشف بـ `limit(1)`: إن كانت المجموعة
 * فارغة — وهي كذلك في كل تركيبٍ بعد نقل السطور داخل قيودها — لا تُقرأ أصلاً.
 */
export async function loadLedgerRange(db, { fromKey, toKey }) {
  const { from } = monthRange(fromKey);
  const { to } = monthRange(toKey);
  const entriesSnap = await db.collection('journal_entries')
    .where('entryDate', '>=', from)
    .where('entryDate', '<=', to)
    .get();
  const entries = rowsOf(entriesSnap);
  let legacy = [];
  const probe = await db.collection('journal_lines').limit(1).get();
  if (!probe.empty) {
    const ids = new Set(entries.map((e) => e.id));
    legacy = rowsOf(await db.collection('journal_lines').get()).filter((l) => ids.has(String(l.entryId)));
  }
  return { entries, lines: entries.flatMap(embeddedLinesOf).concat(legacy) };
}

/**
 * غسلات شهر — بلا اسمٍ ولا معرّف بايكر: `select` يسمّي الحقول التي تُقرأ،
 * وما لا يُسمّى لا يُنقل عبر الشبكة أصلاً.
 */
export async function loadWashes(db, periodKey) {
  const { from, to } = monthRange(periodKey);
  if (!from) return [];
  const snap = await db.collection('washes')
    .where('wash_date', '>=', from)
    .where('wash_date', '<=', to)
    .select('quantity', 'price', 'status', 'wash_date', 'price_mode')
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    quantity: Math.max(0, Math.floor(Number(d.get('quantity')) || 0)),
    price: Number(d.get('price')) || 0,
    status: d.get('status') ?? '',
    washDate: String(d.get('wash_date') || ''),
    priceMode: d.get('price_mode') ?? null,
  }));
}

export async function loadAccountingSettings(db) {
  const snap = await db.collection('app_settings').doc('accounting').get();
  return snap.exists ? snap.data() : {};
}

/**
 * قارئٌ لطلبٍ واحد، بذاكرة. كل دالة تُقرأ مرةً وتُعاد النتيجة نفسها بعدها.
 */
export function makeLoader(db, { partnerId }) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };
  return {
    partners: () => once('partners', () => loadPartners(db)),
    receipts: () => once('receipts', () => loadOwnReceipts(db, partnerId)),
    feeRules: () => once('feeRules', () => loadFeeRules(db)),
    months:   () => once('months', () => loadAvailableMonths(db)),
    accounts: () => once('accounts', () => loadAccounts(db)),
    settings: () => once('settings', () => loadAccountingSettings(db)),
    ledger:   (fromKey, toKey) => once(`ledger:${fromKey}..${toKey}`, () => loadLedgerRange(db, { fromKey, toKey })),
    washes:   (periodKey) => once(`washes:${periodKey}`, () => loadWashes(db, periodKey)),
  };
}
