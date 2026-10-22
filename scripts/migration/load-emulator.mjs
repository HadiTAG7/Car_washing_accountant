#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// تحميل التصدير في محاكي Firestore — المرجع «Firebase» لتقرير المطابقة
// ═══════════════════════════════════════════════════════════════════════════
// كل مستند يُكتب في مساره بأنواعه الأصلية (Timestamp، مرجع، bytes)، فيصير
// المحاكي نسخة من الإنتاج بلا قراءة واحدة من Firebase الحقيقي. يرفض العمل إلا
// على محاكي ومشروع demo-.
//
//   firebase emulators:exec --only firestore --project demo-sweater \
//     "node scripts/migration/load-emulator.mjs --dir migration-data"
// ═══════════════════════════════════════════════════════════════════════════
import { initializeApp } from 'firebase-admin/app';
import { isMainModule } from '../module-paths.mjs';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { readExport } from './ndjson.mjs';
import { fromTagged } from '../../src/lib/data/schema/codec.js';

export async function loadIntoEmulator(dir, { projectId = process.env.GCLOUD_PROJECT || 'demo-sweater' } = {}) {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !String(projectId).startsWith('demo-')) {
    throw new Error('load-emulator: the Firestore emulator and a demo-* project only.');
  }
  const app = initializeApp({ projectId }, `load-${Date.now()}`);
  const db = getFirestore(app);
  const opts = {
    makeTimestamp: (s, n) => new Timestamp(s, n),
    makeRef: path => db.doc(path),
    makeBytes: b64 => Buffer.from(b64, 'base64'),
    makeGeo: (lat, lng) => new GeoPoint(lat, lng),
  };
  const data = readExport(dir);
  const writer = db.bulkWriter();
  let n = 0;
  for (const rows of [...Object.values(data.collections), ...Object.values(data.groups)]) {
    for (const row of rows) {
      const value = fromTagged(row.data, opts);
      writer.set(db.doc(row.path), value);
      n += 1;
    }
  }
  await writer.close();
  return { db, app, documents: n };
}

if (isMainModule(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  const dir = i > 0 ? process.argv[i + 1] : (process.env.MIGRATION_DATA || 'migration-data');
  loadIntoEmulator(dir).then(({ documents }) => { console.log(`حُمّل ${documents} مستنداً في المحاكي.`); process.exit(0); },
    (e) => { console.error(e.message); process.exit(1); });
}
