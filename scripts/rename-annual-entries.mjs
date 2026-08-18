#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// استبدالٌ في أوصاف المصاريف السنوية — معاينةً أولاً، ثم تطبيقاً
// ═══════════════════════════════════════════════════════════════════════════
// شقيق `rename-startup-entries.mjs`، لمجموعة `annual_expense_entries`. وُجد
// لأن دفعة إيجارٍ قديمة ما زالت باسم «سكن النزهة» بعد أن صار «سكن الشمال».
//
// ── ولماذا لا يستدعي دالة خادم كما يفعل شقيقه ──
// لأن لا دالة خادم للمصاريف السنوية أصلاً: التطبيق يكتبها من العميل تحت
// القواعد، والقاعدة تمنع تعديل قيدٍ مُرحَّل إلا حقل السكن. هذا السكربت يؤدي
// التعديل الوحيد الذي تمنعه القواعد وتجيزه سياسة الدفاتر — **الوصف** على صفٍّ
// مُرحَّل — وبنفس الضمانتين اللتين تفرضهما دالة التأسيس حرفياً:
//   ١) نصّ القيد المُرحَّل يُبدَّل مع الوصف في **نفس المعاملة** — فلا يفترق
//      المصدر عن دفتره ولو للحظة.
//   ٢) قيدٌ في فترةٍ مقفلة لا يُمَسّ نصُّه — يُرفض الصف ويُسمّى شهره.
// ولا يعدّل غير الوصف أبداً: لا مبلغ ولا تاريخ ولا سكن ولا ضريبة.
//
// المعاينة هي الوضع الافتراضي، وتطبع لكل صفٍّ حالته: مُرحَّل بأي قيد، وفي
// أي فترة، ومفتوحةٌ هي أم مقفلة — فيُعرف قبل الكتابة ما سيمرّ وما سيُرفض.
//
//   node scripts/rename-annual-entries.mjs --from "سكن النزهة" --to "سكن الشمال"
//   … --apply     ← يكتب
//
// يحتاج GOOGLE_APPLICATION_CREDENTIALS (سير العمل يكتبه من سرّ المستودع).
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { COL } from '../functions/src/ledger.js';
import { replaceTolerant, tolerantArabicPattern } from '../src/lib/unitSuggest.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const from  = arg('from');
const to    = arg('to');
const apply = has('apply');
const actor = process.env.MAINT_ACTOR || 'maintenance-script';

if (!from || !to) {
  console.error('الاستعمال: --from "النص القديم" --to "النص الجديد" [--apply]');
  process.exit(2);
}
if (!tolerantArabicPattern(from)) {
  console.error('النص المطلوب فارغ بعد إسقاط الحركات.');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

/** قفل الترحيل — بالمفتاح الجديد `annual__` أو القديم `expense__`، كما تفحصهما القواعد. */
async function lockOf(entryId, reader = db) {
  for (const key of [`annual__${entryId}`, `expense__${entryId}`]) {
    const ref = db.collection(COL.LOCKS).doc(key);
    const snap = reader === db ? await ref.get() : await reader.get(ref);
    if (snap.exists) return snap.data();
  }
  return null;
}

// ── المسح: الوصف يطابق بالتسامح الإملائي، والحالة تُقرأ لكل مطابق ──
const snap = await db.collection('annual_expense_entries').get();
const targets = [];
for (const doc of snap.docs) {
  const row = doc.data();
  const next = replaceTolerant(row.description, from, to);
  if (next === (row.description || '')) continue;
  const lock = await lockOf(doc.id);
  let periodKey = null;
  let periodClosed = false;
  if (lock?.entryId) {
    const jSnap = await db.collection(COL.ENTRIES).doc(lock.entryId).get();
    periodKey = jSnap.exists ? jSnap.data().periodKey || null : null;
    if (periodKey) {
      const pSnap = await db.collection(COL.PERIODS).doc(periodKey).get();
      periodClosed = pSnap.exists && pSnap.data().status === 'closed';
    }
  }
  targets.push({
    id: doc.id, before: row.description, after: next,
    unit: row.unit || '—', amount: row.amount, date: row.spent_date || '—',
    lock, periodKey, periodClosed,
  });
}

console.log(`\n${apply ? '⇉ التطبيق' : '👁 معاينة (لا يُكتب شيء)'} — «${from}» ⇦ «${to}»\n`);
console.log(`فُحص ${snap.size} دفعةً سنوية · مطابقٌ للاستبدال: ${targets.length}\n`);
if (!targets.length) {
  console.log('لا شيء يطابق. لا تغيير.');
  process.exit(0);
}
for (const t of targets) {
  console.log(`  • ${t.id}`);
  console.log(`      قبل : ${t.before}`);
  console.log(`      بعد : ${t.after}`);
  console.log(`      المبلغ: ${t.amount} ر.س · التاريخ: ${t.date} · السكن: ${t.unit}`);
  console.log(`      الدفاتر: ${t.lock ? `مُرحَّلة بالقيد رقم ${t.lock.entryNumber ?? '—'} — فترة ${t.periodKey ?? '—'} ${t.periodClosed ? '(مقفلة — سيُرفض)' : '(مفتوحة — سيُزامَن نصّ القيد)'}` : 'غير مُرحَّلة'}`);
}

if (!apply) {
  console.log('\nمعاينة فقط. أعِد التشغيل بـ --apply للكتابة.');
  process.exit(0);
}

let ok = 0;
const failures = [];
for (const t of targets) {
  try {
    await db.runTransaction(async (tx) => {
      // كل القراءات أولاً — Firestore يمنع قراءةً بعد كتابة في نفس المعاملة.
      const entryRef = db.collection('annual_expense_entries').doc(t.id);
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists) throw new Error('الدفعة لم تعد موجودة.');
      const before = String(entrySnap.data().description || '');
      const after = replaceTolerant(before, from, to);
      if (after === before) return; // سبقت كتابته — إعادة تشغيل آمنة

      const lock = await lockOf(t.id, tx);
      const renarrations = [];
      if (lock) {
        const journalIds = [lock.entryId, lock.settlementEntryId].filter(Boolean);
        for (const jid of journalIds) {
          const jRef = db.collection(COL.ENTRIES).doc(jid);
          const jSnap = await tx.get(jRef);
          if (!jSnap.exists) continue;
          const j = jSnap.data();
          const pSnap = await tx.get(db.collection(COL.PERIODS).doc(String(j.periodKey || '')));
          if (pSnap.exists && pSnap.data().status === 'closed') {
            throw new Error(`قيدها في فترة ${j.periodKey} وهي مقفلة — لا يتغيّر نصّه. افتح الفترة أو اتركها.`);
          }
          // السرد يحمل الوصف حرفياً (label = «الوصف — التاريخ»)، فالاستبدال دقيق.
          renarrations.push([jRef, {
            description: String(j.description || '').split(before).join(after),
            lines: (j.lines || []).map((l) => ({
              ...l,
              description: String(l.description || '').split(before).join(after),
            })),
          }]);
        }
      }

      tx.update(entryRef, {
        description: after,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actor,
      });
      for (const [ref, payload] of renarrations) tx.update(ref, payload);
      // سجل تدقيق بنفس شكل سجلات الخادم — ما حدث يُقرأ لاحقاً لا يُستنتج.
      tx.set(db.collection(COL.AUDIT).doc(), {
        action: 'maintenance.renameAnnualEntry',
        collectionName: 'annual_expense_entries',
        documentId: t.id,
        userId: actor,
        note: `«${before}» ⇦ «${after}»${renarrations.length ? ` — وزُومن نصّ ${renarrations.length} قيد` : ''}`,
        before: { description: before },
        after: { description: after },
        at: FieldValue.serverTimestamp(),
        atIso: new Date().toISOString(),
      });
    });
    ok += 1;
    console.log(`  ✓ ${t.id}${t.lock ? ' — وزُومن نصّ قيده' : ''}`);
  } catch (e) {
    // كل صفٍّ معاملته المستقلة — رفضُ واحدٍ لا يوقف غيره، وقائمة المرفوض
    // هي المخرج المهم: تسمّي ما يحتاج قراراً بدل صمتٍ نصفَ مُطبَّق.
    failures.push({ id: t.id, why: e?.message || String(e) });
    console.log(`  ✗ ${t.id} — ${e?.message || e}`);
  }
}
console.log(`\nتمّ: ${ok} · رُفض: ${failures.length}`);
if (failures.length) {
  console.log('\nالمرفوضة تحتاج قراراً:');
  for (const f of failures) console.log(`  • ${f.id}: ${f.why}`);
}
process.exit(0);
