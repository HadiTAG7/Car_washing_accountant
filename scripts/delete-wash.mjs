#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// حذف دفعة غسلات — بعد ثلاثة أسئلة تُسأل قبل الحذف لا بعده
// ═══════════════════════════════════════════════════════════════════════════
// حذف الغسلة من التطبيق ممكنٌ أصلاً، وقاعدة `notPosted('wash', id)` تمنعه إن
// كانت مُرحّلة. فلماذا أداة؟
//
// لأن رفض القواعد يصل المستخدم كـ`permission-denied` خام — لا يقول «مُرحّلة
// بالقيد رقم كذا» ولا يقول ماذا يفعل. ولأن القواعد **لا تفحص الفاتورة
// إطلاقاً**: غسلةٌ عُكس قيدها ثم صُحّحت فاتورتها تصير قابلةً للحذف بينما
// يبقى مستند `sales_documents` يحمل `washId` لغسلةٍ لم تعد موجودة — فاتورة
// ضريبية صادرة مقابل لا شيء. تلك الحالة يتيمةٌ لا يمنعها شيء اليوم.
//
// فالأداة تسأل الثلاثة صراحةً وتقول الجواب بالعربية:
//   ١) عليها فاتورة؟ ⇒ رفض، ويُسمّى رقمها، والمسار هو «التصحيح الذري».
//   ٢) مُرحّلة؟      ⇒ رفض، ويُسمّى رقم القيد.
//   ٣) شهرها مقفل؟  ⇒ يُقال (لا يمنع الحذف بذاته — الغسلة غير المُرحّلة
//                      ليست في دفاتر ذلك الشهر أصلاً — لكنه يُعرَض ليُقرَّر).
//
//   --find "نص"                ← قراءة محضة
//   --id <المعرّف> [--apply]   ← معاينة ثم حذف
//
// ── وتصحيحٌ داخل فترةٍ مقفلة، حين يكون هو الصواب ──
// `--reverse-date YYYY-MM-DD` يعكس قيد الغسلة بهذا التاريخ ثم يحذفها. وإن
// كانت فترة ذلك التاريخ مقفلة، `--reopen "السبب"` يفتحها قبل العكس ويعيد
// إقفالها بعده — بإعادة فحص التوازن التي يجريها الإقفال دائماً.
//
// ولماذا يُسمح بهذا أصلاً: عكسٌ في شهرٍ لاحق هو العلاج الصحيح لخطأ في حدثٍ
// وقع. لكن سجلاً تجريبياً لم يقع أصلاً ليس خطأً يُصحَّح بل ضجيجٌ يُزال — وترك
// شهرٍ مقفلاً على حدثٍ لم يحدث، مع إيرادٍ سالبٍ وهمي في شهرٍ حقيقي لاحق،
// يُشوّه شهرين بدل أن يُصلح واحداً. فالقرار يبقى للمالك، والأداة تنفّذ ما
// يختاره صراحةً — بسببٍ مكتوب يبقى في سجل التدقيق.
//
// يحتاج GOOGLE_APPLICATION_CREDENTIALS (سير العمل يكتبه من سرّ المستودع).
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { reverseEntry, closePeriod, reopenPeriod } from '../functions/src/ledger.js';
import { tolerantArabicPattern } from '../src/lib/unitSuggest.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const find = arg('find');
const id = arg('id');
const apply = has('apply');
const reverseDate = arg('reverse-date');
const reopenReason = arg('reopen');
const actor = process.env.MAINT_ACTOR || 'maintenance-script';

if (!find && !id) {
  console.error('الاستعمال: --find "نص"   أو   --id <المعرّف> [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

/** الحالة الكاملة لغسلةٍ ما: القفل، الفاتورة، والفترة. */
async function statusOf(washId, row) {
  const periodKey = String(row.wash_date || '').slice(0, 7);
  const [lockSnap, docsSnap, periodSnap] = await Promise.all([
    db.collection('posting_locks').doc(`wash__${washId}`).get(),
    db.collection('sales_documents').where('washId', '==', washId).get(),
    periodKey
      ? db.collection('accounting_periods').doc(periodKey).get()
      : Promise.resolve({ exists: false }),
  ]);
  return {
    lock: lockSnap.exists ? lockSnap.data() : null,
    // كل مستند يحمل هذا المعرّف، ملغىً كان أو ساري — الملغى لا يمنع الحذف
    // لكنه يُعرَض، لأن حذف الغسلة يترك `washId` فيه معلّقاً في الحالين.
    docs: docsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    periodKey,
    periodClosed: periodSnap.exists && periodSnap.data().status === 'closed',
  };
}

function describe(washId, row, st) {
  const total = (Number(row.quantity) || 0) * (Number(row.price) || 0);
  console.log(`  • ${washId}`);
  console.log(`      البايكر : ${row.biker_name || '—'}${row.biker_id ? `  (مرتبط: ${row.biker_id})` : '  (بلا ربط)'}`);
  console.log(`      العدد   : ${row.quantity} × ${row.price} ر.س = ${total} ر.س`);
  console.log(`      التاريخ : ${row.wash_date || '—'}   ·   الحالة: ${row.status || '—'}`);
  console.log(`      الدفاتر : ${st.lock ? `مُرحّلة بالقيد رقم ${st.lock.entryNumber ?? '—'}` : 'غير مُرحّلة'}`);
  const live = st.docs.filter((d) => d.status !== 'cancelled');
  console.log(`      الفاتورة: ${st.docs.length === 0 ? 'لا فاتورة'
    : st.docs.map((d) => `${d.documentNumber || d.id} (${d.status})`).join('، ')}`);
  console.log(`      الفترة  : ${st.periodKey || '—'} ${st.periodClosed ? '— مقفلة' : '— مفتوحة'}`);
  return { live };
}

// ── البحث: قراءةٌ محضة ──
if (find) {
  const pattern = tolerantArabicPattern(find);
  if (!pattern) { console.error('نص البحث فارغ.'); process.exit(2); }
  const snap = await db.collection('washes').get();
  const hits = snap.docs.filter((d) => pattern.test(d.data().biker_name || ''));
  console.log(`\n🔎 بحث «${find}» — فُحصت ${snap.size} دفعة · مطابق: ${hits.length}\n`);
  for (const d of hits) describe(d.id, d.data(), await statusOf(d.id, d.data()));
  if (!hits.length) console.log('لا مطابق.');
  else console.log('\nللحذف: أعِد التشغيل بـ --id <المعرّف> --apply');
  process.exit(0);
}

// ── الحذف: بمعرّفٍ واحد، ومعاينةً ما لم يُطلب التطبيق ──
const snap = await db.collection('washes').doc(id).get();
if (!snap.exists) {
  console.error(`لا غسلة بهذا المعرّف: ${id}`);
  process.exit(1);
}
const row = snap.data();
const st = await statusOf(id, row);

console.log(`\n${apply ? '⇉ الحذف' : '👁 معاينة (لا يُحذف شيء)'}\n`);
const { live } = describe(id, row, st);

if (!apply) {
  if (st.lock && reverseDate) {
    console.log(`\nسيُعكس القيد رقم ${st.lock.entryNumber ?? '—'} بتاريخ ${reverseDate}`
      + `${reopenReason ? `، بعد فتح فترته وإعادة إقفالها («${reopenReason}»)` : ''}، ثم تُحذف الدفعة.`);
  }
  console.log('\nمعاينة فقط. أعِد التشغيل بـ --apply للحذف.');
  process.exit(0);
}

// ── الفاتورة أولاً: حذفها يترك مستنداً ضريبياً بلا سند ──
if (live.length) {
  console.error(
    `\n✗ على هذه الغسلة فاتورة سارية (${live.map((d) => d.documentNumber || d.id).join('، ')}) — لا تُحذف.`,
  );
  console.error('  استخدم «تصحيح فاتورة الغسلة»: يلغي المستند ويعكس القيد ويحرّر السجل في عملية واحدة.');
  process.exit(1);
}

// ── ثم الترحيل: القواعد ترفضه أيضاً، لكنها لا تقول لماذا ──
if (st.lock && !reverseDate) {
  console.error(`\n✗ مُرحّلة بالقيد رقم ${st.lock.entryNumber ?? '—'} — لا تُحذف. يُعكس القيد أولاً؛ العكس هو ما يحرّر السجل.`);
  console.error('  أضِف --reverse-date YYYY-MM-DD (ومعه --reopen "السبب" إن كانت فترته مقفلة).');
  process.exit(1);
}

if (st.lock) {
  const revPeriod = String(reverseDate).slice(0, 7);
  const revSnap = await db.collection('accounting_periods').doc(revPeriod).get();
  const revClosed = revSnap.exists && revSnap.data().status === 'closed';

  if (revClosed && !reopenReason) {
    console.error(`\n✗ فترة العكس ${revPeriod} مقفلة. أضِف --reopen "السبب" لفتحها ثم إعادة إقفالها، أو اختر تاريخاً في فترة مفتوحة.`);
    process.exit(1);
  }
  if (revClosed) {
    await reopenPeriod(db, FieldValue, revPeriod, { userId: actor, reason: reopenReason });
    console.log(`\n↺ فُتحت الفترة ${revPeriod} — ${reopenReason}`);
  }

  const rev = await reverseEntry(db, FieldValue, st.lock.entryId, {
    entryDate: reverseDate,
    description: `عكس قيد رقم ${st.lock.entryNumber ?? '—'} — غسلة سُجّلت خطأً: ${row.biker_name || ''}`.trim(),
    userId: actor,
  });
  console.log(`✓ عُكس القيد رقم ${st.lock.entryNumber ?? '—'} بقيدٍ عكسي رقم ${rev.entryNumber ?? '—'} بتاريخ ${reverseDate}.`);

  await db.collection('washes').doc(id).delete();
  console.log('✓ حُذفت الدفعة.');

  if (revClosed) {
    // الإقفال يعيد فحص التوازن على البيانات الطازجة — فلو ترك العكس شيئاً
    // غير متوازن، يُرفض الإقفال هنا ويُقال، بدل أن يُقفل على خلل.
    await closePeriod(db, FieldValue, revPeriod, { userId: actor });
    console.log(`↻ أُعيد إقفال الفترة ${revPeriod}.`);
  }
  process.exit(0);
}

if (st.periodClosed) {
  // ليس مانعاً: غسلةٌ غير مُرحّلة ليست في دفاتر تلك الفترة أصلاً، فحذفها لا
  // يغيّر رقماً مقفلاً. لكنه يُقال، لأن «حذفتُ من شهرٍ مقفل» جملةٌ يجب أن
  // يعرفها صاحب الدفاتر لا أن يكتشفها.
  console.log(`\nملاحظة: شهر ${st.periodKey} مقفل — لكن هذه الغسلة غير مُرحّلة، فلا رقم في دفاتره يتغيّر.`);
}

await db.collection('washes').doc(id).delete();
console.log('\n✓ حُذفت الدفعة.');
if (st.docs.length) {
  console.log(`  تنبيه: بقي ${st.docs.length} مستند ملغى يحمل معرّفها — للسجل، ولا أثر محاسبياً له.`);
}
process.exit(0);
