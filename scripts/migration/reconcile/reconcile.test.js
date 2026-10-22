// ═══════════════════════════════════════════════════════════════════════════
// تقرير المطابقة الشهري: Firebase (محاكي محمَّل بالتصدير) مقابل Supabase
// ═══════════════════════════════════════════════════════════════════════════
// لكل شهر فيه بيانات، يشغّل كود الموقع نفسه على الجهتين ويقارن بدقة JSON:
//   • مصادر قائمة الدخل كما يحمّلها المتصفح (loadScopedIncomeSources) —
//     عبر Firestore الحقيقي، وعبر pgstore (الخادم)، وعبر طبقة المتصفح على Supabase
//   • معاينات الرواتب من الخادم، ثم قائمة الدخل الحية (liveIncomeStatement)
//   • عدد الغسلات ومؤشرات النظرة العامة (التعادل، تكلفة الغسلة، الاستغلال،
//     التوقع، الخصومات، التنبيهات) بدوال الصفحة نفسها
//   • ميزان المراجعة: محرك JS على القيود ↔ مجاميع SQL في القاعدة
//   • تقرير كل شريك (partnerAllocationReport) حتى نهاية الشهر
// أي فرق ولو هللة يُسجَّل بمساره، والتقرير يفشل.
//
//   RECONCILE_DIR=migration-data npm run reconcile
//   RECONCILE_TODAY=2026-10-22 يثبّت «اليوم» (الافتراضي: اليوم الفعلي، كما في الصفحة)
// ═══════════════════════════════════════════════════════════════════════════
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FieldValue as AdminFieldValue, FieldPath as AdminFieldPath } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';
import { loadIntoEmulator } from '../load-emulator.mjs';
import { readExport } from '../ndjson.mjs';
import { createStore, FieldValue as PgFieldValue, FieldPath as PgFieldPath } from '../../../server/db/pgstore/index.js';
import { dispatch } from '../../../functions/src/handlers.js';
import { partnerAllocationReport } from '../../../functions/src/partnerAllocationReport.js';
import { loadScopedIncomeSources } from '../../../src/lib/accounting/incomeStatementScope.js';
import { firestoreScopeExecutor } from '../../../src/lib/accounting/firestoreScopeExecutor.js';
import { liveIncomeStatement } from '../../../src/lib/accounting/liveIncomeStatement.js';
import { trialBalance, trialBalanceFromSums, balanceSheet, balanceSheetFromTrialBalance } from '../../../src/lib/accounting/reports.js';
import { taxPolicyAt } from '../../../src/lib/accounting/taxPolicy.js';
import { overviewOperations } from '../../../src/lib/overviewDashboard.js';
import { overviewAttention, overviewBusinessMetrics, overviewSettlements } from '../../../src/lib/overviewInsights.js';
import { mapWash, mapBiker } from '../../../src/lib/mappers.js';
import { getAuth, signInWithEmailAndPassword } from '../../../src/lib/data/supabase/auth.js';

const DIR = process.env.RECONCILE_DIR;
const DB_URL = process.env.SUPABASE_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const d = DIR ? describe : describe.skip;

// ── The executor's primitives on an admin-style API (firebase-admin or pgstore) ──
const adminExec = (db, FieldPath, { notEquals = true } = {}) => {
  const rows = snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const c = name => db.collection(name);
  return {
    all: async name => rows(await c(name).get()),
    range: async (name, field, from, to) => rows(await c(name).where(field, '>=', from).where(field, '<', to).get()),
    equals: async (name, field, value) => rows(await c(name).where(field, '==', value).get()),
    // Firestore's own '!= null'; pgstore (no '!=' on the server) gives the same rows: present and not null.
    notNull: async (name, field) => (notEquals ? rows(await c(name).where(field, '!=', null).get())
      : rows(await c(name).get()).filter(r => r[field] !== undefined && r[field] !== null)),
    inValues: async (name, field, values) => rows(await c(name).where(field, 'in', values).get()),
    byIds: async (name, ids) => rows(await c(name).where(FieldPath.documentId(), 'in', ids).get()),
    count: async (name, field, values) => (await c(name).where(field, 'in', values).count().get()).data().count,
    probe: async name => !(await c(name).limit(1).get()).empty,
  };
};

// ── Comparison at JSON precision ──
// Not data: the instant each side generated its payroll preview.
const WALL_CLOCK = new Set(['generatedAtIso']);
function normalize(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (typeof v.toMillis === 'function') return { $ts: [v.seconds ?? v._seconds, v.nanoseconds ?? v._nanoseconds] };
  if (typeof v.path === 'string' && (v.firestore || v.__docRef)) return { $ref: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(normalize);
  return Object.fromEntries(Object.keys(v).filter(k => !WALL_CLOCK.has(k)).sort().map(k => [k, normalize(v[k])]));
}
function differences(a, b, path = '', out = []) {
  if (out.length >= 10) return out;
  const x = normalize(a); const y = normalize(b);
  if (JSON.stringify(x) === JSON.stringify(y)) return out;
  if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
    if (Array.isArray(x) && x.length !== y.length) { out.push(`${path}: ${x.length} عنصراً ↔ ${y.length}`); return out; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) differences(x[k], y[k], `${path}.${k}`, out);
    return out;
  }
  out.push(`${path}: ${JSON.stringify(x)} ↔ ${JSON.stringify(y)}`);
  return out;
}

const FIGURES = ['netRevenue', 'directCosts', 'operatingExpenses', 'totalCosts', 'totalFees', 'netProfit'];
// The owner's October figures (Stage 5), checked when RECONCILE_EXPECT_OCTOBER=1 (the production export).
// Cost per wash, break-even and utilization are the overview's own (overviewBusinessMetrics).
const OCTOBER = { month: '2026-10', washes: 382, netRevenue: 7640, totalCosts: 30036.57, costPerWash: 78.63, breakEven: 1502, utilization: 48 };
// The page's «today» (Riyadh date); pinned for a reproducible reference run.
const TODAY = process.env.RECONCILE_TODAY || new Date().toISOString().slice(0, 10);
const monthEnd = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

d('المطابقة الشهرية: Firebase ↔ Supabase', () => {
  const report = { months: [], problems: [] };
  let ref; let pg; let refAdmin; let pgAdmin; let months; let exported;

  beforeAll(async () => {
    exported = readExport(DIR);
    ({ db: ref } = await loadIntoEmulator(DIR));
    pg = createStore({ connectionString: DB_URL, role: 'ledger_server' });

    // An administrator on each side: the Firebase uid, and its Supabase account.
    refAdmin = exported.collections.app_admins?.[0]?.id;
    if (!refAdmin) throw new Error('لا مدير في التصدير.');
    const owner = createStore({ connectionString: DB_URL });
    pgAdmin = (await owner._read(q => q.query('select user_id::text as id, email from public.firebase_uid_map where firebase_uid = $1', [refAdmin]))).rows[0];
    await owner.close();
    if (!pgAdmin) throw new Error('المدير غير منقول إلى Supabase Auth.');

    // The browser path signs in as that administrator (a local-only password).
    const env = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(l => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter(Boolean).map(m => [m[1], m[2]]));
    const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const password = `reconcile-${Date.now()}`;
    await service.auth.admin.updateUserById(pgAdmin.id, { password });
    await signInWithEmailAndPassword(getAuth(), pgAdmin.email, password);

    const set = new Set();
    for (const w of exported.collections.washes || []) if (/^\d{4}-\d{2}/.test(w.data.wash_date || '')) set.add(w.data.wash_date.slice(0, 7));
    for (const e of exported.collections.journal_entries || []) if (/^\d{4}-\d{2}/.test(e.data.entryDate || '')) set.add(e.data.entryDate.slice(0, 7));
    months = [...set].filter(m => m <= TODAY.slice(0, 7)).sort();
  }, 600_000);

  afterAll(async () => {
    await pg?.close();
    writeFileSync(join(DIR, 'reconcile-report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(DIR, 'reconcile-report.md'), markdown(report));
  });

  it('كل شهر: نفس المصادر، نفس الرواتب، نفس قائمة الدخل، نفس الميزان، نفس حصص الشركاء', async () => {
    const backends = {
      firebase: { db: ref, FieldValue: AdminFieldValue, exec: adminExec(ref, AdminFieldPath), uid: refAdmin },
      pgstore: { db: pg, FieldValue: PgFieldValue, exec: adminExec(pg, PgFieldPath, { notEquals: false }), uid: pgAdmin.id },
      browser: { exec: firestoreScopeExecutor },
    };
    const settingsOf = async (db) => {
      const s = await db.collection('app_settings').doc('accounting').get();
      return s.exists ? (s.data().value || s.data()) : {};
    };
    const common = {};
    for (const side of ['firebase', 'pgstore']) {
      const { db } = backends[side];
      const all = async name => (await db.collection(name).get()).docs.map(x => ({ ...x.data(), id: x.id }));
      const entries = await all('journal_entries');
      common[side] = {
        accounts: await all('chart_of_accounts'),
        feeRules: (await all('fee_rules')).sort((a, b) => String(a.effective_from || '').localeCompare(String(b.effective_from || '')))
          .filter(r => r.active !== false).map(r => ({ id: r.id, key: r.key || r.id, label: r.label || 'رسوم', basis: r.basis === 'profit' ? 'profit' : 'revenue', rate: Number(r.rate) || 0, effectiveFrom: r.effective_from || null })),
        settings: await settingsOf(db),
        partners: (await all('partners')).map(p => p.id).sort(),
        entries,
        lines: entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` }))).concat(await all('journal_lines')),
      };
    }
    const today = TODAY;

    for (const month of months) {
      const row = { month, figures: {}, checks: {} };
      const flag = (what, diffs) => { row.checks[what] = diffs.length ? diffs : 'ok'; if (diffs.length) report.problems.push({ month, what, diffs }); };

      const sources = {};
      for (const [side, b] of Object.entries(backends)) {
        sources[side] = await loadScopedIncomeSources(b.exec, { statementMonths: [month], washMonths: [month], withBikers: true });
      }
      flag('مصادر (الخادم)', differences(sources.firebase, sources.pgstore));
      flag('مصادر (المتصفح)', differences(sources.firebase, sources.browser));

      const previews = {};
      for (const side of ['firebase', 'pgstore']) {
        const b = backends[side];
        previews[side] = await dispatch(b.db, b.FieldValue, 'payrollPreviews', { periodKeys: [month] }, { uid: b.uid }).catch(e => ({ error: e.message }));
      }
      flag('معاينة الرواتب', differences(previews.firebase, previews.pgstore));

      const statements = {};
      for (const side of ['firebase', 'pgstore']) {
        const c = common[side]; const src = side === 'firebase' ? sources.firebase : sources.browser;
        const entries = src.journalEntries; const lines = entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` }))).concat(src.legacyLines);
        try {
          statements[side] = liveIncomeStatement({ accounts: c.accounts, entries, lines, periodKey: month, feeRules: c.feeRules, scalingFactor: 1,
            sources: { ...src, payrollPreviews: Array.isArray(previews[side]) ? previews[side] : [] },
            policyAt: date => taxPolicyAt(date, c.settings) });
        } catch (e) { statements[side] = { error: e.message }; }
      }
      flag('قائمة الدخل', differences(statements.firebase, statements.pgstore));

      // As the overview builds them: the page's wash mapping (raw status and
      // quantity) and the page's «today», so complete days match the page.
      const ops = side => overviewOperations({ periodKey: month, today,
        washes: sources[side].washes.map(row => ({ ...mapWash(row), status: row.status, quantity: Math.max(0, Number(row.quantity) || 0) })),
        bikers: (sources[side].bikers || []).map(mapBiker) });
      const opsRef = ops('firebase'); const opsNew = ops('browser');
      flag('عدد الغسلات', differences(opsRef?.quantity, opsNew?.quantity));

      for (const [label, from, to] of [['ميزان الشهر', `${month}-01`, monthEnd(month)], ['ميزان حتى نهاية الشهر', null, monthEnd(month)]]) {
        const engine = trialBalance(common.firebase.accounts, common.firebase.entries, common.firebase.lines, { from, to });
        const sums = (await pg._read(q => q.query('select * from public.posted_line_sums($1, $2)', [from, to]))).rows;
        const sql = trialBalanceFromSums(common.pgstore.accounts, sums);
        flag(label, differences(engine, sql));
        if (label === 'ميزان حتى نهاية الشهر') {
          row.figures.trialBalance = { totalDebit: sql.totalDebit, totalCredit: sql.totalCredit, balanced: sql.balanced };
          const sheetRef = balanceSheet(common.firebase.accounts, common.firebase.entries, common.firebase.lines, { asOf: to, feeRules: common.firebase.feeRules });
          const sheetNew = balanceSheetFromTrialBalance(common.pgstore.accounts, sql, { asOf: to, feeRules: common.pgstore.feeRules });
          flag('المركز المالي', differences(sheetRef, sheetNew));
          row.figures.balanceSheet = { totalAssets: sheetNew.totalAssets, totalLiabilities: sheetNew.totalLiabilities, totalEquity: sheetNew.totalEquity, balanced: sheetNew.balanced };
        }
      }

      const partners = {};
      for (const partnerId of common.firebase.partners) {
        const out = {};
        for (const side of ['firebase', 'pgstore']) {
          out[side] = await partnerAllocationReport(backends[side].db, { partnerId, periodKey: month, today: new Date(`${today}T12:00:00Z`), includeCapitalJourney: true })
            .catch(e => ({ error: e.message }));
        }
        flag(`الشريك ${partnerId}`, differences(out.firebase, out.pgstore));
        partners[partnerId] = summarizePartner(out.pgstore);
      }

      // The overview's decisions on each side: break-even, cost per wash,
      // utilization and forecast from the statement; deductions and the
      // expected payment from the month's adjustments and settlements; the
      // attention list from bookings and bikers.
      const adjustments = {
        firebase: await backends.firebase.exec.equals('sweater_adjustments', 'periodKey', month),
        browser: await backends.browser.exec.equals('sweater_adjustments', 'periodKey', month),
      };
      const insights = {};
      for (const [side, opsSide, statement] of [['firebase', opsRef, statements.firebase], ['browser', opsNew, statements.pgstore]]) {
        const st = statement && !statement.error ? statement : null;
        insights[side] = {
          metrics: overviewBusinessMetrics(opsSide, st),
          settlements: opsSide ? overviewSettlements({ adjustments: adjustments[side], settlements: sources[side].settlements || [], periodKey: month, to: opsSide.to }) : null,
          attention: overviewAttention({ ops: opsSide, today, bikers: (sources[side].bikers || []).map(mapBiker), bookings: sources[side].bookings || [] }),
        };
      }
      flag('مؤشرات النظرة العامة', differences(insights.firebase, insights.browser));

      const s = statements.pgstore || {};
      const m = insights.browser.metrics;
      row.figures.washes = opsNew?.quantity ?? null;
      for (const k of FIGURES) if (typeof s[k] === 'number') row.figures[k] = s[k];
      if (m?.costPerWash != null) row.figures.costPerWash = Math.round(m.costPerWash * 100) / 100;
      if (m?.monthlyRequired != null) row.figures.breakEven = m.monthlyRequired;
      if (m?.capacityUtilization != null) row.figures.utilization = Math.round(m.capacityUtilization * 10) / 10;
      if (m?.forecastQuantity != null) row.figures.forecastWashes = Math.round(m.forecastQuantity);
      if (process.env.RECONCILE_EXPECT_OCTOBER === '1' && month === OCTOBER.month) {
        const got = { month, washes: row.figures.washes, netRevenue: row.figures.netRevenue, totalCosts: row.figures.totalCosts, costPerWash: row.figures.costPerWash,
          breakEven: row.figures.breakEven, utilization: row.figures.utilization == null ? null : Math.round(row.figures.utilization) };
        flag('أرقام أكتوبر المرجعية', differences(OCTOBER, got));
      }
      row.figures.partners = partners;
      if (s.error) row.figures.statementError = s.error;
      report.months.push(row);
    }
    expect(report.problems).toEqual([]);
  }, 3_600_000);
});

// A partner's balance as the app shows it: capital paid (receipts), the
// capital account's ledger balance, and what is received but not yet posted.
function summarizePartner(r) {
  if (!r || r.error) return r;
  const c = r.capital || {};
  return { paid: c.paid, ledgerBalance: c.ledgerBalance, unposted: c.unposted, receipts: c.receiptsCount };
}

function markdown(report) {
  const fmt = v => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v ?? '—');
  const out = ['# تقرير المطابقة الشهري — Firebase ↔ Supabase', '',
    `«اليوم» في هذا التقرير: ${TODAY}`, '',
    '| الشهر | الغسلات | الإيراد | المصاريف | تكلفة الغسلة | غسلات التعادل | الاستغلال % | صافي الربح | الميزان | المركز المالي | الفحوص |', '|---|---:|---:|---:|---:|---:|---:|---:|:-:|:-:|:-:|'];
  for (const m of report.months) {
    const bad = Object.values(m.checks).filter(v => v !== 'ok').length;
    const bs = m.figures.balanceSheet;
    const sheet = !bs ? '—' : bs.balanced ? '✓' : `غير متوازن (${fmt(Math.round((bs.totalAssets - bs.totalLiabilities - bs.totalEquity) * 100) / 100)})`;
    out.push(`| ${m.month} | ${fmt(m.figures.washes)} | ${fmt(m.figures.netRevenue)} | ${fmt(m.figures.totalCosts)} | ${fmt(m.figures.costPerWash)} | ${fmt(m.figures.breakEven)} | ${fmt(m.figures.utilization)} | ${fmt(m.figures.netProfit)} | ${m.figures.trialBalance?.balanced ? '✓' : '✗'} | ${sheet} | ${bad ? `✗ ${bad}` : '✓'} |`);
  }
  out.push('', 'الفحوص ✓ = Firebase وSupabase متطابقان في كل ما سبق. «غير متوازن» في المركز المالي حالة في البيانات نفسها، بنفس الفرق على الجهتين.');
  const partners = report.months.at(-1)?.figures.partners || {};
  if (Object.keys(partners).length) {
    out.push('', `## الشركاء — حتى نهاية ${report.months.at(-1).month}`, '', '| الشريك | الأرقام |', '|---|---|');
    for (const [id, p] of Object.entries(partners)) out.push(`| ${id} | ${Object.entries(p || {}).map(([k, v]) => `${k}: ${fmt(v)}`).join(' · ')} |`);
  }
  out.push('', report.problems.length ? '## الفروقات' : '## لا فرق — كل الأرقام متطابقة بالهللة', '');
  for (const p of report.problems) out.push(`- **${p.month} · ${p.what}**`, ...p.diffs.map(x => `  - \`${x}\``));
  return `${out.join('\n')}\n`;
}
