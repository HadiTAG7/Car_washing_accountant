#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// تصدير Firestore مرة واحدة للنقل إلى Supabase — قراءة محضة، قابل للاستئناف
// ═══════════════════════════════════════════════════════════════════════════
// زر النسخة الاحتياطية يصدّر 28 مجموعة فقط وبلا الدفاتر، فلا يصلح مصدراً
// للنقل. هذا السكربت يقرأ كل مجموعة مرة واحدة ويحفظها محلياً (NDJSON) خارج
// git، ولا يكتب في Firebase شيئاً.
//
// الحصة اليومية 50 ألف قراءة للمشروع كله، والموقع نفسه يستهلك منها. لذلك:
//   • `--plan` يعدّ المستندات بـcount() (قراءة لكل 1000) ويطبع التكلفة.
//   • التصدير صفحات من 500 بالترتيب بالمعرّف، وبعد كل صفحة يُحفظ الموضع في
//     manifest.json. إن نفدت الحصة يتوقف بهدوء، وتشغيله ثانيةً يكمل من
//     نفس الموضع بلا أي قراءة مكررة.
//   • المجموعات الصغيرة أولاً، فما يبقى لليوم التالي هو الكبير فقط.
//
// المستخدمون (Auth) وقائمة الملفات (Storage) لا تُحسب من حصة Firestore.
//
//   node scripts/migration/export-firestore.mjs --plan
//   node scripts/migration/export-firestore.mjs            # يكمل ما لم يكتمل
//   node scripts/migration/export-firestore.mjs --download-files
//
// المفتاح: FIREBASE_SERVICE_ACCOUNT (محتوى JSON) أو GOOGLE_APPLICATION_CREDENTIALS.
// المجلد: MIGRATION_DATA (الافتراضي migration-data/ في جذر المشروع، مستثنى من git).
// ═══════════════════════════════════════════════════════════════════════════

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, openSync, writeSync, fsyncSync, closeSync, truncateSync, statSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeValue } from './firestoreCodec.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = process.env.MIGRATION_DATA || join(ROOT, 'migration-data');
const PAGE = Number(process.env.EXPORT_PAGE_SIZE || 500);
// Subcollections the app writes (grep: payroll_runs/*/items|payments,
// *_reports/*/revisions, partner_worker_eligibility/*/audit).
const GROUPS = ['items', 'payments', 'revisions', 'audit'];
const args = new Set(process.argv.slice(2));
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean) || null;

function credential() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) return cert(JSON.parse(raw));
  return applicationDefault();
}
const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const app = initializeApp(emulated
  ? { projectId: process.env.GCLOUD_PROJECT || 'demo-sweater' }
  : { credential: credential(), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'gemini-eed4a.firebasestorage.app' });
const db = getFirestore(app);

mkdirSync(OUT, { recursive: true, mode: 0o700 });
chmodSync(OUT, 0o700);
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { version: 1, createdAt: new Date().toISOString(), emulated, collections: {}, groups: {}, reads: 0 };

function saveManifest() {
  manifest.updatedAt = new Date().toISOString();
  const tmp = `${manifestPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  renameSync(tmp, manifestPath);
}

const quotaError = e => e?.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(e?.message));
function stopOnQuota(e, where) {
  if (!quotaError(e)) throw e;
  saveManifest();
  console.error(`\nنفدت حصة القراءة اليومية عند ${where}. الموضع محفوظ؛ شغّل السكربت بعد تجدّد الحصة (10:00 بتوقيت الرياض) ليكمل.`);
  process.exit(3);
}

const stamp = t => (t ? { s: t.seconds, n: t.nanoseconds } : null);
function line(doc) {
  return `${JSON.stringify({ id: doc.id, path: doc.ref.path, ct: stamp(doc.createTime), ut: stamp(doc.updateTime), data: encodeValue(doc.data()) })}\n`;
}

/** Appends one page and records the new cursor only after the bytes are on disk. */
function appendPage(file, lines) {
  const fd = openSync(file, 'a', 0o600);
  try { writeSync(fd, lines.join('')); fsyncSync(fd); } finally { closeSync(fd); }
  return statSync(file).size;
}

async function plan() {
  let names;
  try { names = (await db.listCollections()).map(c => c.id).sort(); } catch (e) { stopOnQuota(e, 'listCollections'); }
  manifest.reads += 1;
  for (const name of names) {
    if (only && !only.includes(name)) continue;
    const entry = manifest.collections[name] ||= { exported: 0, bytes: 0, cursor: null, done: false };
    if (entry.count == null) {
      try { entry.count = (await db.collection(name).count().get()).data().count; } catch (e) { stopOnQuota(e, `count(${name})`); }
      manifest.reads += Math.max(1, Math.ceil(entry.count / 1000));
      saveManifest();
    }
  }
  for (const name of GROUPS) {
    const entry = manifest.groups[name] ||= { exported: 0, bytes: 0, cursor: null, done: false };
    if (entry.count == null) {
      try { entry.count = (await db.collectionGroup(name).count().get()).data().count; } catch (e) { stopOnQuota(e, `count(group ${name})`); }
      manifest.reads += Math.max(1, Math.ceil(entry.count / 1000));
      saveManifest();
    }
  }
  const total = Object.values(manifest.collections).reduce((s, c) => s + (c.count || 0), 0)
    + Object.values(manifest.groups).reduce((s, c) => s + (c.count || 0), 0);
  manifest.plannedDocuments = total;
  saveManifest();
  console.log(`${Object.keys(manifest.collections).length} مجموعة + ${GROUPS.length} مجموعات فرعية — ${total} مستند`);
  console.log(`تكلفة التصدير ≈ ${total} قراءة (قراءة لكل مستند)، والعدّ كلّف ${manifest.reads} حتى الآن.`);
}

async function exportQuery(kind, name, entry, makeQuery) {
  const file = join(OUT, kind === 'group' ? `group__${name}.ndjson` : `${name}.ndjson`);
  if (entry.done) return;
  // A crash between the write and the manifest save leaves extra bytes: cut
  // the file back to what the manifest vouches for, then continue.
  if (existsSync(file) && statSync(file).size !== entry.bytes) truncateSync(file, entry.bytes);
  if (!existsSync(file)) { writeFileSync(file, '', { mode: 0o600 }); entry.bytes = 0; entry.exported = 0; entry.cursor = null; }
  for (;;) {
    let q = makeQuery().limit(PAGE);
    if (entry.cursor) q = q.startAfter(kind === 'group' ? db.doc(entry.cursor) : entry.cursor);
    let snap;
    try { snap = await q.get(); } catch (e) { stopOnQuota(e, `${kind === 'group' ? 'group ' : ''}${name} بعد ${entry.exported}`); }
    manifest.reads += Math.max(1, snap.size);
    if (snap.empty) break;
    entry.bytes = appendPage(file, snap.docs.map(line));
    entry.exported += snap.size;
    entry.cursor = kind === 'group' ? snap.docs.at(-1).ref.path : snap.docs.at(-1).id;
    saveManifest();
    process.stdout.write(`\r${name.padEnd(40)} ${entry.exported}/${entry.count ?? '?'}`);
    if (snap.size < PAGE) break;
  }
  entry.done = true;
  entry.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  saveManifest();
  process.stdout.write(`\r${name.padEnd(40)} ${entry.exported}/${entry.count ?? '?'} ✓\n`);
}

async function exportAll() {
  if (!Object.keys(manifest.collections).length) await plan();
  const names = Object.keys(manifest.collections)
    .filter(n => !only || only.includes(n))
    .sort((a, b) => (manifest.collections[a].count ?? 0) - (manifest.collections[b].count ?? 0) || (a < b ? -1 : 1));
  for (const name of names) {
    await exportQuery('collection', name, manifest.collections[name], () => db.collection(name).orderBy(FieldPath.documentId()));
  }
  if (!only) {
    for (const name of GROUPS) {
      manifest.groups[name] ||= { exported: 0, bytes: 0, cursor: null, done: false };
      await exportQuery('group', name, manifest.groups[name], () => db.collectionGroup(name).orderBy(FieldPath.documentId()));
    }
  }
}

async function exportAuth() {
  if (manifest.auth?.done) return;
  const file = join(OUT, 'auth-users.ndjson');
  writeFileSync(file, '', { mode: 0o600 });
  let token; let n = 0;
  do {
    const page = await getAuth(app).listUsers(1000, token);
    // No password hashes: first login is through a password-recovery link.
    appendPage(file, page.users.map(u => `${JSON.stringify({
      uid: u.uid, email: u.email ?? null, emailVerified: u.emailVerified, disabled: u.disabled,
      displayName: u.displayName ?? null, phoneNumber: u.phoneNumber ?? null,
      providers: u.providerData.map(p => p.providerId), customClaims: u.customClaims ?? null,
      createdAt: u.metadata.creationTime ?? null, lastSignInAt: u.metadata.lastSignInTime ?? null,
    })}\n`));
    n += page.users.length; token = page.pageToken;
  } while (token);
  manifest.auth = { users: n, done: true };
  saveManifest();
  console.log(`المستخدمون: ${n}`);
}

async function exportStorageList() {
  if (emulated) return;
  const bucket = getStorage(app).bucket();
  // A project that never set up Storage has no bucket: nothing to copy, said so.
  const [exists] = await bucket.exists();
  if (!exists) {
    manifest.storage = { bucket: bucket.name, missing: true, files: 0, bytes: 0 };
    saveManifest();
    writeFileSync(join(OUT, 'storage-files.ndjson'), '', { mode: 0o600 });
    console.log(`ملفات الفواتير: لا حاوية ${bucket.name} في المشروع — لا ملفات تُنقل.`);
    return;
  }
  const [files] = await bucket.getFiles({ prefix: 'invoices/' });
  const file = join(OUT, 'storage-files.ndjson');
  writeFileSync(file, files.map(f => `${JSON.stringify({
    name: f.name, size: Number(f.metadata.size), md5Hash: f.metadata.md5Hash, contentType: f.metadata.contentType,
    updated: f.metadata.updated, tokens: f.metadata.metadata?.firebaseStorageDownloadTokens ?? null,
  })}\n`).join(''), { mode: 0o600 });
  manifest.storage = { ...(manifest.storage || {}), bucket: bucket.name, files: files.length, bytes: files.reduce((s, f) => s + Number(f.metadata.size), 0) };
  saveManifest();
  console.log(`ملفات الفواتير: ${files.length} (${(manifest.storage.bytes / 1e6).toFixed(1)} MB)`);
  if (!args.has('--download-files')) return;
  let got = 0;
  for (const f of files) {
    const target = join(OUT, 'storage', f.name);
    if (existsSync(target) && statSync(target).size === Number(f.metadata.size)) { got += 1; continue; }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await f.download({ destination: target, validation: 'md5' });
    chmodSync(target, 0o600);
    got += 1;
  }
  manifest.storage.downloaded = got;
  saveManifest();
  console.log(`نُزّل ${got}/${files.length} ملف`);
}

if (args.has('--plan')) {
  await plan();
} else {
  await exportAll();
  if (!only && !args.has('--no-auth') && (!emulated || process.env.FIREBASE_AUTH_EMULATOR_HOST)) await exportAuth();
  if (!only && !args.has('--no-storage')) await exportStorageList();
  console.log(`\nاكتمل. القراءات المحسوبة من Firestore: ${manifest.reads}. الملفات في ${OUT}`);
}
process.exit(0);
