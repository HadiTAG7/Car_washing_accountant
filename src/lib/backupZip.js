// ─── Minimal ZIP writer + full-data backup builder ──────────────────────
// Dependency-free "stored" (no compression) ZIP: local file headers +
// central directory + EOCD, per APPNOTE.TXT. Enough for a handful of CSV
// files; every mainstream unzipper (Windows Explorer, macOS, WinRAR,
// iOS Files) opens it. UTF-8 filename flag set so Arabic names survive.

import { fetchRows } from './firestoreCrud';
import { auth, dataSource } from './firebaseClient';
import { riyadhTodayISO } from './washesYesterday';

// CRC-32 (IEEE 802.3), table-driven.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// DOS date/time pair from a JS Date (ZIP's native timestamp format).
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Build a stored ZIP from [{ name, text }] entries → Uint8Array.
 */
export function buildZip(files, now = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const dataB = enc.encode(f.text);
    const crc = crc32(dataB);
    // flags bit 11 = UTF-8 filenames
    const common = [
      ...u16(20), ...u16(0x0800), ...u16(0), // version-needed, flags, method=stored
      ...u16(time), ...u16(date),
      ...u32(crc), ...u32(dataB.length), ...u32(dataB.length),
      ...u16(nameB.length), ...u16(0),
    ];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...nameB]);
    chunks.push(local, dataB);
    central.push({ nameB, common, offset });
    offset += local.length + dataB.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const rec = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), // central sig + version-made-by
      ...c.common,
      ...u16(0), ...u16(0), ...u16(0), // comment len, disk, internal attrs
      ...u32(0),                        // external attrs
      ...u32(c.offset),
      ...c.nameB,
    ]);
    chunks.push(rec);
    offset += rec.length;
  }
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(offset - cdStart), ...u32(cdStart), ...u16(0),
  ]);
  chunks.push(eocd);

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

// ── CSV serialization (same escaping contract as exportCsv.js) ──────────
function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return `"${value}"`;
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+@-]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function rowsToCsv(rows) {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  const lines = [
    cols.map(csvCell).join(','),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')),
  ];
  return '﻿' + lines.join('\r\n');
}

// Every business table, in dependency-ish order. `select('*')` is right
// here — a backup must capture columns the app doesn't map yet.
const BACKUP_TABLES = [
  'categories',
  'startup_costs',
  'startup_cost_entries',
  'annual_expense_categories',
  'annual_expenses',
  'annual_expense_entries',
  'monthly_expense_categories',
  'monthly_expenses',
  'variable_expense_categories',
  'variable_expenses',
  'washes',
  'bikers',
  'housing_units',
  'category_budgets',
  'partners',
  'partner_payments',
  'temporary_expenses',
  // تكامل سويتر — الخام أولاً: هو المصدر الذي يُعاد منه البناء لو ضاع غيره.
  'sweater_raw_payloads',
  'sweater_bookings',
  'sweater_price_list',
  'sweater_adjustment_types',
  'sweater_recognition_policy',
  'sweater_adjustments',
  'sweater_settlements',
  'sweater_variances',
  'sweater_import_runs',
  'app_settings',
];

// ── Supabase: every table, restorable ──────────────────────────────────
// The free plan keeps no backups of its own, so this file IS the backup:
// every collection as NDJSON in the export's tagged form (restored as is by
// scripts/migration/import-supabase.mjs --dir), the same readable CSVs as
// before, and a manifest with counts and SHA-256s. Pages come from the
// server (admin only), each under Vercel's response limit.
async function backupPage(input) {
  if (!auth?.currentUser) throw Object.assign(new Error('تسجيل الدخول مطلوب.'), { code: 'unauthenticated' });
  const res = await fetch('/api/ledger?backupEndpoint=export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) throw Object.assign(new Error(body?.error?.message || 'تعذّر إنشاء النسخة الاحتياطية.'), { code: body?.error?.code || 'internal' });
  return body.result;
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Tagged values (`{"$fs:ts":…}`) read as plain cells in the CSV copy.
const plainCell = v => (v && typeof v === 'object' && v['$fs:ts'] ? new Date(v['$fs:ts'].s * 1000).toISOString() : v);
async function buildSupabaseBackup() {
  const { collections } = await backupPage({ list: true });
  const files = []; const manifest = { version: 1, source: 'supabase-backup', createdAt: new Date().toISOString(), collections: {} };
  const groups = new Map(); const counts = [];
  for (const collection of collections) {
    const rows = [];
    for (let after = null; ;) {
      const page = await backupPage({ collection, after });
      rows.push(...page.rows);
      if (!page.next) break;
      after = page.next;
    }
    if (collection.includes('/*/')) {
      const group = collection.split('/*/')[1];
      groups.set(group, [...(groups.get(group) || []), ...rows]);
      counts.push(`${collection}: ${rows.length}`);
      continue;
    }
    const name = collection === 'firebase_uid_map' ? 'firebase-uid-map' : collection;
    const text = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    files.push({ name: `${name}.ndjson`, text });
    manifest.collections[name] = { count: rows.length, sha256: await sha256Hex(text) };
    counts.push(`${collection}: ${rows.length}`);
    if (BACKUP_TABLES.includes(collection)) {
      files.push({ name: `csv/${collection}.csv`, text: rowsToCsv(rows.map(r => ({ id: r.id, ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, plainCell(v)])) }))) });
    }
  }
  for (const [group, rows] of groups) {
    const text = rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    files.push({ name: `group__${group}.ndjson`, text });
    manifest.collections[`group__${group}`] = { count: rows.length, sha256: await sha256Hex(text) };
  }
  files.push({ name: 'manifest.json', text: JSON.stringify(manifest, null, 2) });
  const stamp = new Date();
  return {
    blob: new Blob([buildZip(files, stamp)], { type: 'application/zip' }),
    filename: `سويتر-نسخة-احتياطية-${riyadhTodayISO(stamp)}.zip`,
    counts,
  };
}

/**
 * Fetch every table and hand back { blob, filename, counts }. Admin-only
 * by construction: RLS returns zero rows to anyone else, and the button
 * is gated behind canMutate anyway.
 */
export async function buildFullBackup() {
  if (dataSource === 'supabase') return buildSupabaseBackup();
  const files = [];
  const counts = [];
  for (const table of BACKUP_TABLES) {
    let rows;
    try {
      rows = await fetchRows(table);
    } catch (err) {
      throw new Error(`تعذّر قراءة جدول ${table}: ${err?.message || err}`);
    }
    files.push({ name: `${table}.csv`, text: rowsToCsv(rows) });
    counts.push(`${table}: ${rows.length}`);
  }
  const stamp = new Date();
  const dateTag = riyadhTodayISO(stamp);
  files.push({
    name: 'manifest.txt',
    text: [
      `سويتر — نسخة احتياطية كاملة`,
      `التاريخ: ${stamp.toISOString()}`,
      `الجداول (${BACKUP_TABLES.length}):`,
      ...counts,
    ].join('\r\n'),
  });
  const zip = buildZip(files, stamp);
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    filename: `سويتر-نسخة-احتياطية-${dateTag}.zip`,
    counts,
  };
}

/** Trigger a browser download of the built backup. */
export async function downloadFullBackup() {
  const { blob, filename } = await buildFullBackup();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
