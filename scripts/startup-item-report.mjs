#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// تقرير بندٍ من رسوم التأسيس — قراءةٌ محضة
// ═══════════════════════════════════════════════════════════════════════════
// لا يكتب شيئاً، ولا يملك وضع كتابة يُفعَّل بالخطأ: لا `--apply` ولا استدعاء
// خادمٍ يُغيّر. هذا وحده هو سبب وجوده ملفاً مستقلاً عن أدوات التعديل والحذف —
// أداةٌ للقراءة يجب أن يكون واضحاً من اسمها ومن شيفرتها أنها لا تمسّ شيئاً.
//
// يطبع الخطة (الميزانية والكمية وسعر الوحدة) مقابل الواقع (مجموع المصاريف)،
// ثم يقسم الواقع على التقسيمات — لأن رقماً واحداً للبند كله يُخفي أن سكناً
// كلّف ضعف آخر لكل ساكن، وهو بالضبط ما يُراد كشفه.
//
//   node scripts/startup-item-report.mjs --item "تجهيز السكن"
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizeUnitName } from '../src/lib/accounting/startupMigration.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const wanted = arg('item');
if (!wanted) {
  console.error('الاستعمال: --item "اسم البند"');
  process.exit(2);
}

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const items = (await db.collection('startup_costs').get()).docs;
const key = normalizeUnitName(wanted);
const item = items.find((d) => normalizeUnitName(d.data().item_name || '') === key)
  || items.find((d) => normalizeUnitName(d.data().item_name || '').includes(key));

if (!item) {
  console.error(`لا بند بهذا الاسم: ${wanted}`);
  console.error('البنود الموجودة:');
  for (const d of items) console.error(`  • ${d.data().item_name}`);
  process.exit(1);
}

const row = item.data();
const entries = (await db.collection('startup_cost_entries')
  .where('startup_cost_id', '==', item.id).get()).docs.map((d) => d.data());

const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US');
const planned  = Number(row.budgeted_amount) || 0;
const qty      = Math.max(1, Number(row.quantity) || 1);
const actual   = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

console.log(`\n📋 ${row.item_name}\n`);
console.log(`  الخطة  : ${money(planned)} ر.س   (${qty} × ${money(planned / qty)})`);
console.log(`  الواقع : ${money(actual)} ر.س   ·   ${entries.length} مصروفاً`);
console.log(`  الحالة : ${row.status}`);
console.log(`  الفرق  : ${money(planned - actual)} ر.س\n`);

// كل تقسيم مذكور في الخطة يظهر ولو بصفر — القائمة تصف الواقع لا ما صُرف فقط.
const units = Array.isArray(row.units) ? row.units : [];
const buckets = new Map(units.map((u) => [normalizeUnitName(u), { label: u, n: 0, sum: 0 }]));
for (const e of entries) {
  const k = e.unit ? normalizeUnitName(e.unit) : '__none__';
  if (!buckets.has(k)) buckets.set(k, { label: e.unit || 'غير محدد', n: 0, sum: 0 });
  const b = buckets.get(k);
  b.n += 1;
  b.sum += Number(e.amount) || 0;
}

console.log('  التقسيمات:');
if (!buckets.size) console.log('    (لا تقسيمات على هذا البند)');
for (const [k, b] of buckets) {
  const label = k === '__none__' ? 'غير محدد' : b.label;
  const share = actual ? ((b.sum / actual) * 100).toFixed(1) : '0.0';
  console.log(`    • ${label.padEnd(14)} ${String(money(b.sum)).padStart(10)} ر.س   ·   ${b.n} مصروفاً   ·   ${share}%`);
}

const sum = [...buckets.values()].reduce((s, b) => s + b.sum, 0);
console.log(`\n  مجموع التقسيمات: ${money(sum)} ر.س  ${Math.abs(sum - actual) < 0.005 ? '✓ يطابق الواقع' : '⚠ لا يطابق!'}`);
process.exit(0);
