#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// عدد المستندات في كل مجموعة — قراءةٌ محضة، أرقامٌ بلا بيانات
// ═══════════════════════════════════════════════════════════════════════════
// لقياس القراءات على المحاكي ببيانات تجريبية بحجم الإنتاج نحتاج أحجام
// المجموعات لا محتواها. `count()` تجميعٌ في الخادم: لا يُرجع أي مستند، ويُحسب
// قراءةً واحدة لكل 1000 مستند (وأقله قراءة)، فالتشغيل كله عشرات القراءات.
//
// لا يكتب شيئاً ولا يطبع حقلاً من أي مستند — أسماء المجموعات وأعدادها فقط.
//
//   node scripts/collection-counts.mjs            # جدول نصي
//   node scripts/collection-counts.mjs --json     # JSON لـ scripts/emulator/counts.json
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Subcollections are not listed by listCollections(); name them explicitly.
const SUBCOLLECTION_GROUPS = ['items', 'revisions'];
// Month-shaped fields, so the seed can spread documents over the same span.
const DATE_FIELDS = { washes: 'wash_date', journal_entries: 'entryDate', sweater_bookings: 'periodKey' };

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const top = (await db.listCollections()).map(c => c.id).sort();
const counts = {};
let reads = 1; // listCollections
for (const name of top) {
  const n = (await db.collection(name).count().get()).data().count;
  counts[name] = n;
  reads += Math.max(1, Math.ceil(n / 1000));
}
const groups = {};
for (const name of SUBCOLLECTION_GROUPS) {
  const n = (await db.collectionGroup(name).count().get()).data().count;
  groups[name] = n;
  reads += Math.max(1, Math.ceil(n / 1000));
}
// First and last month only: one document each, of which only the date is kept.
const spans = {};
for (const [name, field] of Object.entries(DATE_FIELDS)) {
  if (!counts[name]) continue;
  const edge = async dir => {
    const snap = await db.collection(name).where(field, '>=', '0000').orderBy(field, dir).limit(1).get();
    reads += 1;
    return snap.empty ? null : String(snap.docs[0].get(field)).slice(0, 7);
  };
  spans[name] = { from: await edge('asc'), to: await edge('desc') };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ collections: counts, collectionGroups: groups, spans, reads }, null, 2));
} else {
  const width = Math.max(...[...top, ...SUBCOLLECTION_GROUPS].map(n => n.length)) + 2;
  for (const name of top) console.log(`${name.padEnd(width)}${counts[name]}`);
  for (const name of SUBCOLLECTION_GROUPS) console.log(`${`*/${name}`.padEnd(width)}${groups[name]}`);
  for (const [name, span] of Object.entries(spans)) console.log(`${name} months: ${span.from} → ${span.to}`);
  console.log(`\nestimated billed reads: ${reads}`);
}
