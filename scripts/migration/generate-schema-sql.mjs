#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// يولّد ملف migration الجداول من سجل الجداول — لا يُكتب الجدول بيدين اثنتين
// ═══════════════════════════════════════════════════════════════════════════
//   node scripts/migration/generate-schema-sql.mjs          # يكتب الملف
//   node scripts/migration/generate-schema-sql.mjs --check  # يفشل إن لم يكن محدّثاً
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { modulePath, isMainModule } from '../module-paths.mjs';
import { SCHEMA } from '../../src/lib/data/schema/registry.js';
import { tableSecuritySql } from './generate-security-sql.mjs';

const ROOT = modulePath('../../', import.meta.url);
const FILE = `${ROOT}supabase/migrations/20261022000100_tables.sql`;
// Tables added after go-live carry their own migration; the baseline (already
// applied in production) never changes for them.
const BASELINE = SCHEMA.filter(t => !t.migration);
export const MIGRATIONS = [...new Set(SCHEMA.filter(t => t.migration).map(t => t.migration))];
export const migrationFile = name => `${ROOT}supabase/migrations/${name}.sql`;

const SQL_TYPES = {
  id: 'text collate "C"', text: 'text collate "C"', int: 'integer', big: 'bigint', money: 'numeric(14,2)',
  num: 'numeric', rate: 'numeric(9,6)', bool: 'boolean', day: 'text collate "C"', month: 'text collate "C"',
  ts: 'timestamptz', iso: 'timestamptz', json: 'jsonb',
};
const q = name => `"${name.replace(/"/g, '""')}"`;

/** One table's statements, as in the baseline file (then a blank line). */
function tableSql(t, out) {
  const cols = [`  id text collate "C" not null`];
  if (t.parentTable) cols.push(`  parent_ref text collate "C" not null`);
  for (const c of t.columns) cols.push(`  ${q(c.column)} ${SQL_TYPES[c.type]}`);
  cols.push(`  extra jsonb not null default '{}'::jsonb`);
  cols.push(`  shape jsonb`);
  const checks = [
    `  constraint ${q(`${t.table}_pk`)} primary key (${t.parentTable ? 'parent_ref, id' : 'id'})`,
    `  constraint ${q(`${t.table}_extra_object`)} check (jsonb_typeof(extra) = 'object')`,
    `  constraint ${q(`${t.table}_shape_object`)} check (shape is null or jsonb_typeof(shape) = 'object')`,
  ];
  for (const c of t.columns) {
    if (c.type === 'day') checks.push(`  constraint ${q(`${t.table}_${c.column}_day`)} check (app.is_day(${q(c.column)}))`);
    if (c.type === 'month') checks.push(`  constraint ${q(`${t.table}_${c.column}_month`)} check (app.is_month(${q(c.column)}))`);
    if (c.type === 'rate') checks.push(`  constraint ${q(`${t.table}_${c.column}_rate`)} check (${q(c.column)} is null or ${q(c.column)} between 0 and 1)`);
  }
  for (const [name, expression] of t.checks || []) {
    checks.push(`  constraint ${q(`${t.table}_${name}`)} check (${expression})`);
  }
  out.push(`-- ${t.collection}\ncreate table public.${q(t.table)} (\n${[...cols, ...checks].join(',\n')}\n);`);
  if (t.parentTable) {
    out.push(`alter table public.${q(t.table)} add constraint ${q(`${t.table}_parent_fk`)} foreign key (parent_ref) references public.${q(t.parentTable)}(id) deferrable initially deferred;`);
  }
  for (const c of t.columns.filter(c => c.indexed)) {
    out.push(`create index ${q(`${t.table}_${c.column}_idx`)} on public.${q(t.table)} (${q(c.column)}, id);`);
  }
  if (t.lines) {
    out.push(`-- ${t.collection}.lines — سطور القيد في جدولها، بترتيبها في المصفوفة
create table public.${q(t.lines)} (
  entry_id text collate "C" not null,
  line_no integer not null,
  account_id text collate "C",
  debit numeric(14,2),
  credit numeric(14,2),
  description text collate "C",
  extra jsonb not null default '{}'::jsonb,
  shape jsonb,
  constraint ${q(`${t.lines}_pk`)} primary key (entry_id, line_no),
  constraint ${q(`${t.lines}_entry_fk`)} foreign key (entry_id) references public.${q(t.table)}(id) deferrable initially deferred,
  constraint ${q(`${t.lines}_line_no`)} check (line_no >= 0),
  constraint ${q(`${t.lines}_extra_object`)} check (jsonb_typeof(extra) = 'object'),
  constraint ${q(`${t.lines}_shape_object`)} check (shape is null or jsonb_typeof(shape) = 'object')
);
create index ${q(`${t.lines}_account_idx`)} on public.${q(t.lines)} (account_id, entry_id);`);
  }
  out.push('');
}

export function tablesSql() {
  const out = [];
  out.push(`-- ═══════════════════════════════════════════════════════════════════════════
-- الجداول — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
--
-- كل جدول = مجموعة Firestore، وكل صف = مستند:
--   id     معرّف المستند كما هو (COLLATE "C": ترتيب البايت كما في Firestore)
--   أعمدة  الحقول المعروفة بأنواعها
--   extra  الحقول غير المعروفة كما هي، فلا يضيع شيء
--   shape  الاستثناءات (null صريح، قيمة أصلية لا يحفظها العمود حرفياً)
-- التواريخ نصوص 'YYYY-MM-DD' بقيد يضمن أنها تواريخ حقيقية: تاريخ عمل محلي
-- (الرياض) لا لحظة، فلا يتحوّل بمنطقة زمنية أبداً.
-- ═══════════════════════════════════════════════════════════════════════════
`);
  for (const t of BASELINE) tableSql(t, out);
  return `${out.join('\n')}\n`;
}

/** A table added after go-live: its table, then its security, in one migration. */
export function migrationSql(name) {
  const tables = SCHEMA.filter(t => t.migration === name);
  if (!tables.length) throw new Error(`لا جداول للـmigration ${name}`);
  const out = [`-- ═══════════════════════════════════════════════════════════════════════════
-- ${name} — مولَّد من src/lib/data/schema/registry.js بـ
--   node scripts/migration/generate-schema-sql.mjs
-- لا تعدّله بيدك: عدّل السجل وأعد التوليد (اختبار يفشل إن اختلفا).
-- جدول أُضيف بعد التشغيل: الجدول ثم صلاحياته، كما في الملفين الأساسيين.
-- ═══════════════════════════════════════════════════════════════════════════
`];
  for (const t of tables) { tableSql(t, out); out.push(tableSecuritySql(t)); }
  return `${out.join('\n')}\n`;
}

if (isMainModule(import.meta.url)) {
  const files = [[FILE, tablesSql()], ...MIGRATIONS.map(name => [migrationFile(name), migrationSql(name)])];
  if (process.argv.includes('--check')) {
    for (const [file, sql] of files) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (current.replace(/\r\n/g, '\n') !== sql) { console.error(`${file} ليس محدّثاً — شغّل generate-schema-sql.mjs`); process.exit(1); }
    }
    console.log('محدّث ✓');
  } else {
    for (const [file, sql] of files) { writeFileSync(file, sql); console.log(`كُتب ${file}`); }
  }
}
