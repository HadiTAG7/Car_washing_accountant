#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// فحص بيانات التصدير قبل تصميم الجداول — قراءة محلية فقط، لا يكتب في أي قاعدة
// ═══════════════════════════════════════════════════════════════════════════
// نوع كل عمود يُقرَّر من البيانات لا من التخمين: هل كل المبالغ بخانتين؟ هل
// كل التواريخ YYYY-MM-DD صحيحة؟ هل فيه مراجع لسجلات محذوفة؟ هل كل قيد
// متوازن؟ والنتيجة ورقة قرارات المخطط (profile.json + profile.md).
//
//   node scripts/migration/profile.mjs [dir]
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { modulePath } from '../module-paths.mjs';
import { readExport } from './ndjson.mjs';
import { tagOf } from './firestoreCodec.mjs';
import { financeSourceHash, FINANCE_KINDS } from '../../functions/src/financeReview.js';

const ROOT = modulePath('../../', import.meta.url);
const DIR = process.argv[2] || process.env.MIGRATION_DATA || join(ROOT, 'migration-data');
const data = readExport(DIR);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v) => {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
function stringShape(v) {
  if (realDay(v)) return 'date';
  if (DAY.test(v)) return 'date-invalid';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return 'month';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) return 'datetime';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) return 'date-loose';
  return 'text';
}
function numberShape(v) {
  if (Number.isInteger(v)) return 'int';
  const cents = Math.round(v * 100) / 100;
  if (Number(v.toFixed(2)) === v) return 'dec2';
  if (Math.abs(v - cents) < 1e-9) return 'dec2-noise';
  return 'decN';
}
function kindOf(v) {
  if (v === null) return 'null';
  const tag = tagOf(v);
  if (tag) return tag;
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'map';
  if (typeof v === 'number') return `num:${numberShape(v)}`;
  if (typeof v === 'string') return `str:${stringShape(v)}`;
  return typeof v;
}
function idShape(id) {
  if (/^[A-Za-z0-9]{20}$/.test(id)) return 'auto20';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'uuid';
  if (/^[0-9a-f]{64}$/.test(id)) return 'sha256';
  if (/^\d{4}-\d{2}$/.test(id)) return 'month';
  if (id.includes('__')) return 'compound';
  if (/%[0-9A-F]{2}/.test(id)) return 'encoded';
  return 'other';
}

function profileRows(rows) {
  const fields = {}; const ids = {}; let bytes = 0;
  for (const row of rows) {
    bytes += Buffer.byteLength(JSON.stringify(row.data));
    ids[idShape(row.id)] = (ids[idShape(row.id)] || 0) + 1;
    for (const [key, value] of Object.entries(row.data || {})) {
      const f = fields[key] ||= { present: 0, kinds: {}, enum: new Map(), maxLen: 0, min: null, max: null, negatives: 0, samplesDecN: [] };
      f.present += 1;
      const k = kindOf(value);
      f.kinds[k] = (f.kinds[k] || 0) + 1;
      if (typeof value === 'string') {
        f.maxLen = Math.max(f.maxLen, value.length);
        if (f.enum.size <= 12) f.enum.set(value, (f.enum.get(value) || 0) + 1);
      }
      if (typeof value === 'number') {
        f.min = f.min == null ? value : Math.min(f.min, value);
        f.max = f.max == null ? value : Math.max(f.max, value);
        if (value < 0) f.negatives += 1;
        if (k === 'num:decN' && f.samplesDecN.length < 5) f.samplesDecN.push({ id: row.id, value });
      }
      if (typeof value === 'boolean' && f.enum.size <= 12) f.enum.set(String(value), (f.enum.get(String(value)) || 0) + 1);
    }
  }
  for (const f of Object.values(fields)) {
    f.absent = rows.length - f.present;
    f.enum = f.enum.size <= 12 ? Object.fromEntries(f.enum) : null;
  }
  return { count: rows.length, bytes, ids, fields };
}

// ── Checks that decide constraints ──
const byId = name => new Set((data.collections[name] || []).map(r => r.id));
function dangling(from, field, to) {
  const targets = byId(to); const misses = [];
  for (const row of data.collections[from] || []) {
    const v = row.data?.[field];
    if (v == null || v === '') continue;
    if (!targets.has(String(v))) misses.push({ id: row.id, [field]: v });
  }
  return { from, field, to, rows: (data.collections[from] || []).length, dangling: misses.length, samples: misses.slice(0, 5) };
}
const cents = v => Math.round((Number(v) || 0) * 100);
function journalChecks() {
  const entries = data.collections.journal_entries || [];
  const legacy = data.collections.journal_lines || [];
  const accounts = byId('chart_of_accounts');
  const numbers = new Map(); const unbalanced = []; const shortEntries = []; const badAccounts = []; const bothSides = [];
  let debit = 0; let credit = 0;
  const legacyByEntry = new Set(legacy.map(l => l.data?.entryId));
  for (const { id, data: e } of entries) {
    if (e.entryNumber != null) numbers.set(e.entryNumber, [...(numbers.get(e.entryNumber) || []), id]);
    const lines = Array.isArray(e.lines) ? e.lines : null;
    if (!lines) continue;
    let d = 0; let c = 0;
    for (const l of lines) {
      d += cents(l.debit); c += cents(l.credit);
      if (!accounts.has(String(l.accountId))) badAccounts.push({ entry: id, accountId: l.accountId });
      if (cents(l.debit) && cents(l.credit)) bothSides.push(id);
    }
    if (d !== c) unbalanced.push({ id, debit: d / 100, credit: c / 100 });
    if (lines.length < 2) shortEntries.push(id);
    if (e.status === 'posted' || e.status === 'reversed') { debit += d; credit += c; }
  }
  const dupNumbers = [...numbers].filter(([, ids]) => ids.length > 1).map(([n, ids]) => ({ n, ids }));
  return {
    entries: entries.length, legacyLines: legacy.length,
    entriesWithEmbeddedAndLegacy: entries.filter(e => Array.isArray(e.data?.lines) && legacyByEntry.has(e.id)).map(e => e.id),
    unbalanced, shortEntries, badAccounts: badAccounts.slice(0, 20), badAccountCount: badAccounts.length, bothSides,
    duplicateNumbers: dupNumbers, totalDebit: debit / 100, totalCredit: credit / 100, ledgerBalanced: debit === credit,
  };
}
function lockChecks() {
  const entries = byId('journal_entries');
  const locks = data.collections.posting_locks || [];
  const missing = locks.filter(l => l.data?.entryId && !entries.has(l.data.entryId)).map(l => l.id);
  return { locks: locks.length, pointingAtMissingEntry: missing.length, samples: missing.slice(0, 10) };
}
// A Timestamp-like stand-in: the hash only calls toDate().toISOString().
function decodeForHash(value) {
  const tag = tagOf(value);
  if (tag === 'ts') return { toDate: () => new Date(value['$fs:ts'].s * 1000 + Math.floor(value['$fs:ts'].n / 1e6)) };
  if (tag === 'num') return Number(value['$fs:num']);
  if (tag) return value;
  if (Array.isArray(value)) return value.map(decodeForHash);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeForHash(v)]));
  return value;
}
function financeHashChecks() {
  const reviews = data.collections.finance_reviews || [];
  const out = { reviews: reviews.length, matches: 0, mismatches: [], sourceMissing: [] };
  for (const { id, data: r } of reviews) {
    const spec = FINANCE_KINDS[r.kind];
    const source = spec && (data.collections[spec.collection] || []).find(s => s.id === r.sourceId);
    if (!source) { out.sourceMissing.push(id); continue; }
    const hash = financeSourceHash({ ...decodeForHash(source.data), id: source.id });
    if (hash === r.sourceHash) out.matches += 1; else out.mismatches.push({ id, kind: r.kind, sourceId: r.sourceId, status: r.status });
  }
  return out;
}
function uidOccurrences() {
  const uids = new Set([...(data.collections.users || []).map(r => r.id), ...data.authUsers.map(u => u.uid)]);
  const hits = {};
  const walk = (name, path, value) => {
    if (typeof value === 'string') { if (uids.has(value)) hits[`${name}.${path}`] = (hits[`${name}.${path}`] || 0) + 1; return; }
    if (Array.isArray(value)) { value.forEach(v => walk(name, `${path}[]`, v)); return; }
    if (value && typeof value === 'object' && !tagOf(value)) for (const [k, v] of Object.entries(value)) walk(name, path ? `${path}.${k}` : k, v);
  };
  for (const [name, rows] of [...Object.entries(data.collections), ...Object.entries(data.groups).map(([g, r]) => [`group:${g}`, r])]) {
    for (const row of rows) { if (uids.has(row.id)) hits[`${name}.<id>`] = (hits[`${name}.<id>`] || 0) + 1; walk(name, '', row.data); }
  }
  return { uids: uids.size, fields: hits };
}
function idFieldMismatch() {
  const out = {};
  for (const [name, rows] of Object.entries(data.collections)) {
    const n = rows.filter(r => r.data && 'id' in r.data && String(r.data.id) !== r.id).length;
    if (n) out[name] = n;
  }
  return out;
}

const profile = {
  dir: DIR, generatedAt: new Date().toISOString(),
  collections: Object.fromEntries(Object.entries(data.collections).map(([n, rows]) => [n, profileRows(rows)])),
  groups: Object.fromEntries(Object.entries(data.groups).map(([n, rows]) => [n, { ...profileRows(rows), parents: [...new Set(rows.map(r => r.path.split('/').slice(0, -2).join('/').split('/')[0]))] }])),
  authUsers: data.authUsers.length,
  storage: { files: data.storageFiles.length, bytes: data.storageFiles.reduce((s, f) => s + (f.size || 0), 0) },
  checks: {
    journal: journalChecks(), locks: lockChecks(), financeHashes: financeHashChecks(), uids: uidOccurrences(), idFieldMismatch: idFieldMismatch(),
    references: [
      dangling('washes', 'biker_id', 'bikers'), dangling('temporary_expenses', 'biker_id', 'bikers'),
      dangling('partner_payments', 'partner_id', 'partners'), dangling('annual_expense_entries', 'annual_expense_id', 'annual_expenses'),
      dangling('startup_cost_entries', 'startup_cost_id', 'startup_costs'), dangling('startup_costs', 'category', 'categories'),
      dangling('monthly_expenses', 'category_id', 'monthly_expense_categories'), dangling('variable_expenses', 'category_id', 'variable_expense_categories'),
      dangling('annual_expenses', 'category', 'annual_expense_categories'), dangling('expense_vouchers', 'templateId', 'monthly_expenses'),
      dangling('partners', 'user_id', 'users'), dangling('fixed_assets', 'sourceId', 'startup_costs'),
    ],
  },
};
writeFileSync(join(DIR, 'profile.json'), JSON.stringify(profile, null, 2), { mode: 0o600 });

// ── Human summary ──
const md = [];
md.push(`# فحص بيانات التصدير\n\n${Object.keys(profile.collections).length} مجموعة · ${Object.values(profile.collections).reduce((s, c) => s + c.count, 0)} مستند · مستخدمون ${profile.authUsers} · ملفات ${profile.storage.files}\n`);
md.push('| المجموعة | العدد | الحجم KB | شكل المعرّف |\n|---|---:|---:|---|');
for (const [n, c] of Object.entries(profile.collections).sort((a, b) => b[1].bytes - a[1].bytes)) {
  md.push(`| ${n} | ${c.count} | ${(c.bytes / 1024).toFixed(0)} | ${Object.entries(c.ids).map(([k, v]) => `${k}:${v}`).join(' ')} |`);
}
for (const [n, c] of Object.entries(profile.groups)) md.push(`| ${n} (فرعية: ${c.parents.join(',')}) | ${c.count} | ${(c.bytes / 1024).toFixed(0)} | |`);
const j = profile.checks.journal;
md.push(`\n## الدفاتر\n- قيود: ${j.entries} · سطور قديمة: ${j.legacyLines} · غير متوازنة: ${j.unbalanced.length} · أقل من سطرين: ${j.shortEntries.length} · أرقام مكررة: ${j.duplicateNumbers.length} · حسابات غير موجودة: ${j.badAccountCount}`);
md.push(`- مجموع المدين ${j.totalDebit} · الدائن ${j.totalCredit} · ${j.ledgerBalanced ? 'متوازن ✓' : 'غير متوازن ✗'}`);
md.push(`- أقفال تشير لقيد غير موجود: ${profile.checks.locks.pointingAtMissingEntry}`);
const fh = profile.checks.financeHashes;
md.push(`- بصمات الاعتماد: ${fh.reviews} · تطابق ${fh.matches} · لا تطابق ${fh.mismatches.length} · المصدر محذوف ${fh.sourceMissing.length}`);
md.push('\n## مراجع معلّقة\n| من | الحقل | إلى | معلّقة |\n|---|---|---|---:|');
for (const r of profile.checks.references) md.push(`| ${r.from} | ${r.field} | ${r.to} | ${r.dangling}/${r.rows} |`);
md.push('\n## حقول تحتاج قراراً (أكثر من خانتين، تواريخ غير قياسية، أنواع مختلطة)');
for (const [n, c] of Object.entries(profile.collections)) {
  for (const [f, s] of Object.entries(c.fields)) {
    const kinds = Object.keys(s.kinds);
    const flags = [];
    if (kinds.includes('num:decN')) flags.push(`أكثر من خانتين ×${s.kinds['num:decN']} مثل ${s.samplesDecN.map(x => x.value).join(', ')}`);
    if (kinds.includes('num:dec2-noise')) flags.push(`كسر ثنائي ×${s.kinds['num:dec2-noise']}`);
    if (kinds.some(k => ['str:date-loose', 'str:date-invalid'].includes(k))) flags.push(`تاريخ غير قياسي ×${(s.kinds['str:date-loose'] || 0) + (s.kinds['str:date-invalid'] || 0)}`);
    const nonNull = kinds.filter(k => k !== 'null');
    if (new Set(nonNull.map(k => k.split(':')[0])).size > 1) flags.push(`أنواع مختلطة: ${nonNull.join(' ')}`);
    if (flags.length) md.push(`- **${n}.${f}**: ${flags.join(' · ')}`);
  }
}
md.push(`\n## معرّفات المستخدمين داخل البيانات\n${Object.entries(profile.checks.uids.fields).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- لا شيء'}`);
md.push(`\n## مستندات حقل id فيها يختلف عن مفتاحها\n${Object.entries(profile.checks.idFieldMismatch).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- لا شيء'}`);
writeFileSync(join(DIR, 'profile.md'), `${md.join('\n')}\n`, { mode: 0o600 });
console.log(md.slice(0, 60).join('\n'));
