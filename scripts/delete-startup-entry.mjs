#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// حذف مصروف تأسيس — بحثاً أولاً، ثم بمعرّفٍ صريح
// ═══════════════════════════════════════════════════════════════════════════
// الحذف لا رجعة فيه، فلا يُقاد بمطابقةٍ نصّية كما تُقاد التسمية: الاستبدال
// الخاطئ يُستبدَل مرةً أخرى، والصف المحذوف خطأً لا يعود. فالوضعان منفصلان:
//
//   --find "بنزين"   ← يقرأ فقط. يطبع كل مطابق بمعرّفه ومبلغه وتاريخه وبنده،
//                      وهل هو مُرحّل في الدفاتر.
//   --id <المعرّف>    ← معاينة الصف بعينه. و`--apply` وحده يحذف.
//
// ── ولا يكتب هذا السكربت في Firestore ──
// يستدعي `deleteStartupEntry` — نفس دالة الخادم. فترفض الحذف إن كان المصروف
// مُرحّلاً وتسمّي رقم قيده (العكس هو ما يفكّ القفل)، وتُعيد اشتقاق تجميعة
// البند في نفس المعاملة، وتكتب سجل تدقيق.
//
// يحتاج GOOGLE_APPLICATION_CREDENTIALS (سير العمل يكتبه من سرّ المستودع).
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { deleteStartupEntry } from '../functions/src/startupCosts.js';
import { tolerantArabicPattern } from '../src/lib/unitSuggest.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const find  = arg('find');
const id    = arg('id');
const apply = has('apply');
const actor = process.env.MAINT_ACTOR || 'maintenance-script';

if (!find && !id) {
  console.error('الاستعمال: --find "نص"   أو   --id <المعرّف> [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

/** اسم البند — ليُقرأ الصف في سياقه لا معرّفاً وحده. */
const parentNames = new Map(
  (await db.collection('startup_costs').get()).docs.map((d) => [d.id, d.data().item_name || d.id]),
);

/** القفل يقول: هل صار هذا المصروف قيداً في الدفاتر؟ */
async function lockOf(entryId) {
  const [own, legacy] = await Promise.all([
    db.collection('posting_locks').doc(`startup__${entryId}`).get(),
    db.collection('posting_locks').doc(`expense__${entryId}`).get(),
  ]);
  return (own.exists && own.data()) || (legacy.exists && legacy.data()) || null;
}

async function describe(docId, row) {
  const lock = await lockOf(docId);
  console.log(`  • ${docId}`);
  console.log(`      الوصف : ${row.description}`);
  console.log(`      المبلغ: ${row.amount} ر.س   ·   التاريخ: ${row.spent_date}`);
  console.log(`      البند : ${parentNames.get(row.startup_cost_id) || row.startup_cost_id}`);
  console.log(`      السكن : ${row.unit || '—'}`);
  console.log(`      الدفاتر: ${lock ? `مُرحّل بالقيد رقم ${lock.entryNumber ?? '—'}` : 'غير مُرحّل'}`);
  return lock;
}

// ── البحث: قراءةٌ محضة ──
if (find) {
  const pattern = tolerantArabicPattern(find);
  if (!pattern) { console.error('نص البحث فارغ.'); process.exit(2); }
  const snap = await db.collection('startup_cost_entries').get();
  const hits = snap.docs.filter((d) => pattern.test(d.data().description || ''));
  console.log(`\n🔎 بحث «${find}» — فُحص ${snap.size} مصروفاً · مطابق: ${hits.length}\n`);
  for (const d of hits) await describe(d.id, d.data());
  if (!hits.length) console.log('لا مطابق.');
  else console.log('\nللحذف: أعِد التشغيل بـ --id <المعرّف> --apply');
  process.exit(0);
}

// ── الحذف: بمعرّفٍ واحد، ومعاينةً ما لم يُطلب التطبيق ──
const snap = await db.collection('startup_cost_entries').doc(id).get();
if (!snap.exists) {
  console.error(`لا مصروف بهذا المعرّف: ${id}`);
  process.exit(1);
}
console.log(`\n${apply ? '⇉ الحذف' : '👁 معاينة (لا يُحذف شيء)'}\n`);
const lock = await describe(id, snap.data());

if (!apply) {
  console.log('\nمعاينة فقط. أعِد التشغيل بـ --apply للحذف.');
  process.exit(0);
}
if (lock) {
  // The server refuses this too; saying it here first makes the reason the
  // first thing read rather than a stack trace.
  console.error('\n✗ مُرحّل في الدفاتر — لا يُحذف. اعكس قيده أولاً؛ العكس هو ما يحرّر السجل.');
  process.exit(1);
}

const res = await deleteStartupEntry(db, FieldValue, { entryId: id }, { userId: actor, role: 'admin' });
console.log(`\n✓ حُذف. تجميعة البند الآن: ${res.actualAmount} ر.س · الحالة: ${res.status}`);
process.exit(0);
