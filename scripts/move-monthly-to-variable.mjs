#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// نقل مصروفٍ من «الشهرية» إلى «المتغيرة» — إعادة تصنيفٍ في الدفاتر، لا نقل صف
// ═══════════════════════════════════════════════════════════════════════════
// «سكن اول يوم» سُجّل شهرياً وهو مصروفٌ متغيّر. والمجموعتان لا تتشاركان
// حساباً في الدفاتر: الشهري يُرحَّل إلى «الإيجار والمصروفات الشهرية» (5200)
// والمتغيّر إلى «التكاليف المتغيرة» — فمصروفٌ مُرحَّل لا «يُنسخ» بين تبويبين،
// بل يُعكس قيده ويُرحَّل من جديد على حسابه الصحيح. لذلك الأداة تفعل الخمسة
// بترتيبها، بنفس دوال الخادم التي يستعملها التطبيق حرفياً:
//
//   ١) عكس القيد القديم بتاريخه نفسه — فيصفر حساب 5200 في شهره
//   ٢) إنشاء الصف في `variable_expenses` بنفس البيانات والفاتورة وطريقة الدفع
//   ٣) ترحيله بـ`postSource` — قيدٌ جديد على حساب التكاليف المتغيرة
//   ٤) حذف الصف الشهري — حرّره العكس
//   ٥) إعادة إقفال الفترة إن كانت فُتحت — والإقفال يعيد فحص التوازن
//
// المحصلة في قائمة الدخل: نفس المجموع، سطرٌ آخر — وهذا هو المطلوب بالضبط.
// صفٌّ غير مُرحَّل يُنقل بلا دفاتر: إنشاءٌ وحذفٌ فقط، ويُترك غير مُرحَّل كما كان.
//
//   --find "نص"                    ← قراءة محضة
//   --id <المعرّف> [--apply]       ← معاينة ثم تنفيذ
//   --reopen "السبب"               ← إن كانت فترة القيد مقفلة
//   --category "تسمية"             ← تصنيف المتغيرة (وإلا يُطابَق تصنيف الشهري بالاسم)
//
// يحتاج GOOGLE_APPLICATION_CREDENTIALS (سير العمل يكتبه من سرّ المستودع).
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { COL, postSource, reverseEntry, reopenPeriod, closePeriod } from '../functions/src/ledger.js';
import { tolerantArabicPattern } from '../src/lib/unitSuggest.js';
import { normalizeUnitName } from '../src/lib/accounting/startupMigration.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const find = arg('find');
const id = arg('id');
const apply = has('apply');
const reopenReason = arg('reopen');
const categoryWanted = arg('category');
const actor = process.env.MAINT_ACTOR || 'maintenance-script';

if (!find && !id) {
  console.error('الاستعمال: --find "نص"   أو   --id <المعرّف> [--apply] [--reopen "السبب"] [--category "تسمية"]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

/** قفل الترحيل — بالمفتاح الجديد أو القديم، كما تفحصهما القواعد. */
async function lockOf(rowId) {
  for (const key of [`monthly__${rowId}`, `expense__${rowId}`]) {
    const snap = await db.collection(COL.LOCKS).doc(key).get();
    if (snap.exists) return snap.data();
  }
  return null;
}

/** حالة الصف كاملةً: القفل، وقيده، وفترته. */
async function statusOf(rowId) {
  const lock = await lockOf(rowId);
  if (!lock?.entryId) return { lock, journal: null, periodKey: null, periodClosed: false };
  const jSnap = await db.collection(COL.ENTRIES).doc(lock.entryId).get();
  const journal = jSnap.exists ? jSnap.data() : null;
  const periodKey = journal?.periodKey || null;
  let periodClosed = false;
  if (periodKey) {
    const pSnap = await db.collection(COL.PERIODS).doc(periodKey).get();
    periodClosed = pSnap.exists && pSnap.data().status === 'closed';
  }
  return { lock, journal, periodKey, periodClosed };
}

function describe(rowId, row, st) {
  console.log(`  • ${rowId}`);
  console.log(`      المصروف : ${row.expense_name || '—'}`);
  console.log(`      المبلغ  : ${row.total_monthly_cost} ر.س · التاريخ: ${row.logged_date || '—'} · التكرار: ${row.recurrence === 'one_time' ? 'مرة واحدة' : 'شهري'}`);
  console.log(`      الحالة  : ${row.payment_status || '—'} · الدفع: ${row.payment_method || 'cash'}`);
  console.log(`      الدفاتر : ${st.lock ? `مُرحَّل بالقيد رقم ${st.lock.entryNumber ?? '—'} — فترة ${st.periodKey ?? '—'} ${st.periodClosed ? `(مقفلة — ${reopenReason ? 'ستُفتح ثم تُقفل' : 'سيُرفض بلا --reopen'})` : '(مفتوحة)'}` : 'غير مُرحَّل'}`);
}

// ── البحث: قراءةٌ محضة ──
if (find) {
  const pattern = tolerantArabicPattern(find);
  if (!pattern) { console.error('نص البحث فارغ.'); process.exit(2); }
  const snap = await db.collection('monthly_expenses').get();
  const hits = snap.docs.filter((d) => pattern.test(d.data().expense_name || ''));
  console.log(`\n🔎 بحث «${find}» — فُحص ${snap.size} مصروفاً شهرياً · مطابق: ${hits.length}\n`);
  for (const d of hits) describe(d.id, d.data(), await statusOf(d.id));
  if (!hits.length) console.log('لا مطابق.');
  else console.log('\nللنقل: أعِد التشغيل بـ --id <المعرّف> --apply');
  process.exit(0);
}

// ── النقل: بمعرّفٍ واحد، ومعاينةً ما لم يُطلب التطبيق ──
const snap = await db.collection('monthly_expenses').doc(id).get();
if (!snap.exists) {
  console.error(`لا مصروف شهري بهذا المعرّف: ${id}`);
  process.exit(1);
}
const row = snap.data();
const st = await statusOf(id);

// التصنيفان مجموعتان منفصلتان — يُطابَق بالاسم المطبَّع، أو بما سُمّي صراحةً.
let targetCategoryId = null;
let categoryNote = 'بلا تصنيف — تُصنَّف لاحقاً من التطبيق';
{
  let wantedLabel = categoryWanted;
  if (!wantedLabel && row.category_id) {
    const mc = await db.collection('monthly_expense_categories').doc(row.category_id).get();
    wantedLabel = mc.exists ? mc.data().label : null;
  }
  if (wantedLabel) {
    const cats = await db.collection('variable_expense_categories').get();
    const hit = cats.docs.find((c) => normalizeUnitName(c.data().label) === normalizeUnitName(wantedLabel));
    if (hit) { targetCategoryId = hit.id; categoryNote = `«${hit.data().label}»`; }
    else categoryNote = `لا تصنيف متغيّر باسم «${wantedLabel}» — سيُنشأ الصف بلا تصنيف`;
  }
}

console.log(`\n${apply ? '⇉ النقل إلى المصاريف المتغيرة' : '👁 معاينة (لا يُكتب شيء)'}\n`);
describe(id, row, st);
console.log(`      التصنيف : ${categoryNote}`);
if (st.lock) {
  console.log(`\nالخطة: يُعكس القيد رقم ${st.lock.entryNumber ?? '—'} بتاريخه نفسه (${st.journal?.entryDate || row.logged_date})`
    + `، يُنشأ الصف في المتغيرة ويُرحَّل على حسابها، ثم يُحذف الشهري`
    + `${st.periodClosed ? `${reopenReason ? `، وفترة ${st.periodKey} تُفتح («${reopenReason}») وتُقفل بعده` : ' — لكن الفترة مقفلة: أضِف --reopen'}` : ''}.`);
} else {
  console.log('\nالخطة: غير مُرحَّل — يُنشأ في المتغيرة ويُحذف من الشهرية، ويبقى غير مُرحَّل كما كان.');
}

if (!apply) {
  console.log('\nمعاينة فقط. أعِد التشغيل بـ --apply للتنفيذ.');
  process.exit(0);
}
if (st.lock && st.periodClosed && !reopenReason) {
  console.error(`\n✗ فترة ${st.periodKey} مقفلة. أضِف --reopen "السبب".`);
  process.exit(1);
}

// ── التنفيذ، بالترتيب الذي شرحه الرأس ──
if (st.periodClosed) {
  await reopenPeriod(db, FieldValue, st.periodKey, { userId: actor, reason: reopenReason });
  console.log(`\n↺ فُتحت الفترة ${st.periodKey} — ${reopenReason}`);
}

if (st.lock) {
  const rev = await reverseEntry(db, FieldValue, st.lock.entryId, {
    entryDate: st.journal?.entryDate || row.logged_date,
    description: `عكس قيد رقم ${st.lock.entryNumber ?? '—'} — نُقل «${row.expense_name}» إلى المصاريف المتغيرة`,
    userId: actor,
  });
  console.log(`✓ عُكس القيد رقم ${st.lock.entryNumber ?? '—'} بقيدٍ عكسي رقم ${rev.entryNumber ?? '—'}.`);
}

// نفس الأعمدة التي يكتبها `toVariableExpenseInsert`، وكتلة الفاتورة تُنسخ حرفياً.
const TAX_COLS = ['is_tax_invoice', 'invoice_url', 'invoice_number', 'invoice_date',
  'supplier', 'vat_amount', 'vat_rate', 'price_mode', 'vat_deductible', 'payment_method'];
const newId = randomUUID();
const newRow = {
  expense_name:        row.expense_name,
  category_id:         targetCategoryId,
  quantity:            row.quantity ?? 1,
  unit_cost:           row.unit_cost ?? row.total_monthly_cost ?? 0,
  total_variable_cost: row.total_monthly_cost ?? 0,
  logged_date:         row.logged_date || null,
  created_at:          new Date().toISOString(),
};
for (const c of TAX_COLS) if (row[c] !== undefined) newRow[c] = row[c];
await db.collection('variable_expenses').doc(newId).set(newRow);
console.log(`✓ أُنشئ في المصاريف المتغيرة: ${newId}`);

if (st.lock) {
  const posted = await postSource(db, FieldValue, { kind: 'variable', sourceId: newId }, { userId: actor });
  console.log(`✓ رُحِّل على حساب التكاليف المتغيرة بالقيد رقم ${posted.entryNumber ?? '—'} بتاريخ ${row.logged_date}.`);
}

await db.collection('monthly_expenses').doc(id).delete();
console.log('✓ حُذف الصف من المصاريف الشهرية.');

await db.collection(COL.AUDIT).doc().set({
  action: 'maintenance.moveMonthlyToVariable',
  collectionName: 'monthly_expenses',
  documentId: id,
  userId: actor,
  note: `نُقل «${row.expense_name}» (${row.total_monthly_cost} ر.س · ${row.logged_date || '—'}) إلى variable_expenses/${newId}`
    + (st.lock ? ` — بعكس القيد رقم ${st.lock.entryNumber ?? '—'} وترحيلٍ جديد` : ' — ولم يكن مُرحَّلاً'),
  before: { collection: 'monthly_expenses', id, ...row },
  after: { collection: 'variable_expenses', id: newId, ...newRow },
  at: FieldValue.serverTimestamp(),
  atIso: new Date().toISOString(),
});

if (st.periodClosed) {
  // الإقفال يعيد فحص التوازن — عكسٌ وترحيلٌ بنفس المبلغ يصفران، فإن رُفض
  // الإقفال هنا فذلك اكتشافٌ يستحق الوقوف، لا عرَض يُتجاوز.
  await closePeriod(db, FieldValue, st.periodKey, { userId: actor });
  console.log(`↻ أُعيد إقفال الفترة ${st.periodKey}.`);
}
console.log('\nتمّ النقل.');
process.exit(0);
