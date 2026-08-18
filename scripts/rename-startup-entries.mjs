#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// استبدالٌ جماعي في أسماء مصاريف التأسيس — معاينةً أولاً، ثم تطبيقاً
// ═══════════════════════════════════════════════════════════════════════════
// وُجد لأن المالك طلب: «كل فاتورة فيها سكن النزهة يصير سكن الشمال» — وهي عشرات
// الصفوف، وتعديلها واحدةً واحدةً من الجوال عملُ ساعة.
//
// ── ولماذا لا يكتب هذا السكربت في Firestore مباشرةً ──
// يستدعي `updateStartupEntry` — **نفس** دالة الخادم التي يستدعيها التطبيق. فكل
// ما بُني فيها يسري هنا حرفياً: المبلغ والتاريخ لا يتغيّران بعد الترحيل، ونصّ
// القيد المُرحّل يُبدَّل مع الوصف في نفس المعاملة، والفترة المقفلة تُرفض،
// والسكن يُتحقَّق من قائمة البند، ويُكتب سجل تدقيق لكل صف.
//
// سكربتٌ يكتب بنفسه كان سيصير باباً ثانياً إلى الدفاتر — والبابان يختلفان يوماً،
// والاختلاف لا يُرى إلا بعد أن يكتب أحدهما ما يرفضه الآخر.
//
// ── والمعاينة هي الوضع الافتراضي ──
// بلا `--apply` لا يُكتب حرف. يُطبع ما **سيتغيّر** بالضبط: الصف، والاسم قبل
// وبعد، والسكن. لأن استبدالاً نصّياً على بياناتٍ لا أراها هو تخمين، والتخمين
// يُراجَع قبل أن يُنفَّذ لا بعده.
//
//   node scripts/rename-startup-entries.mjs --from "سكن النزهة" --to "سكن الشمال" --unit "سكن الشمال"
//   … --apply     ← يكتب
//
// يحتاج GOOGLE_APPLICATION_CREDENTIALS (سير العمل يكتبه من سرّ المستودع).
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { updateStartupEntry } from '../functions/src/startupCosts.js';
import { replaceTolerant, tolerantArabicPattern } from '../src/lib/unitSuggest.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const from  = arg('from');
const to    = arg('to');
const unit  = arg('unit');            // اختياري: يُسنَد التقسيم مع الاسم
const apply = has('apply');
const actor = process.env.MAINT_ACTOR || 'maintenance-script';

if (!from || !to) {
  console.error('الاستعمال: --from "النص القديم" --to "النص الجديد" [--unit "سكن"] [--apply]');
  process.exit(2);
}
if (!tolerantArabicPattern(from)) {
  console.error('النص المطلوب فارغ بعد إسقاط الحركات.');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const snap = await db.collection('startup_cost_entries').get();
const targets = [];
for (const doc of snap.docs) {
  const row = doc.data();
  const next = replaceTolerant(row.description, from, to);
  const unitChanges = Boolean(unit) && (row.unit || '') !== unit;
  if (next === (row.description || '') && !unitChanges) continue;
  // A unit-only change on a row that never mentioned the name would sweep in
  // rows the owner never asked about, so the NAME is what selects.
  if (next === (row.description || '')) continue;
  targets.push({ id: doc.id, parentId: row.startup_cost_id, before: row.description, after: next, unitBefore: row.unit || '—' });
}

console.log(`\n${apply ? '⇉ التطبيق' : '👁 معاينة (لا يُكتب شيء)'} — «${from}» ⇦ «${to}»`
  + (unit ? ` · والتقسيم ⇦ «${unit}»` : '') + '\n');
console.log(`فُحص ${snap.size} مصروفاً · مطابقٌ للاستبدال: ${targets.length}\n`);
if (!targets.length) {
  console.log('لا شيء يطابق. لا تغيير.');
  process.exit(0);
}
for (const t of targets) {
  console.log(`  • ${t.id}`);
  console.log(`      قبل : ${t.before}`);
  console.log(`      بعد : ${t.after}`);
  console.log(`      السكن: ${t.unitBefore}${unit ? ` ⇦ ${unit}` : ' (بلا تغيير)'}`);
}

if (!apply) {
  console.log('\nمعاينة فقط. أعِد التشغيل بـ --apply للكتابة.');
  process.exit(0);
}

let ok = 0;
const failures = [];
for (const t of targets) {
  try {
    const res = await updateStartupEntry(db, FieldValue, {
      entryId: t.id,
      patch: { description: t.after, ...(unit ? { unit } : {}) },
    }, { userId: actor, role: 'admin' });
    ok += 1;
    console.log(`  ✓ ${t.id}${res.renarrated ? ` — وحُدِّث نصّ ${res.renarrated} قيد` : ''}`);
  } catch (e) {
    // Each row is its own transaction, so a refusal stops that row and no
    // other. The list of refusals is the output that matters: it names what
    // still needs a decision, instead of leaving a half-applied silence.
    failures.push({ id: t.id, why: e?.message || String(e) });
    console.log(`  ✗ ${t.id} — ${e?.message || e}`);
  }
}
console.log(`\nتمّ: ${ok} · رُفض: ${failures.length}`);
if (failures.length) {
  console.log('\nالمرفوضة تحتاج قراراً — غالباً فترة مقفلة أو سكن غير مُدرَج في البند:');
  for (const f of failures) console.log(`  • ${f.id}: ${f.why}`);
}
process.exit(0);
