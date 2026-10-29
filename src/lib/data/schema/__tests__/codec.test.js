// المستند ← الصف ← المستند: يجب أن يعود حرفياً، مهما كان نوع القيمة أو عمودها.
import { describe, expect, it } from 'vitest';
import { SCHEMA, tableFor, groupTables } from '../registry.js';
import { encodeDocument, decodeDocument, toTagged, plainTimestamp, isoToTs, tsToIso } from '../codec.js';

const opts = { makeTimestamp: plainTimestamp };
// Compare in tagged form with keys sorted: exactly what a hash or a deep-equal would see.
const canon = v => JSON.stringify(sortDeep(toTagged(v)));
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]));
  return v;
}
// What the row looks like after a trip through Postgres: numeric/int8 come back as
// text, jsonb re-orders keys, timestamptz comes back as text.
function throughPostgres(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : (typeof v === 'number' ? String(v) : v);
  return out;
}
const roundTrip = (collection, id, data) => {
  const { table } = tableFor(collection);
  const { row, lines } = encodeDocument(table, id, data);
  return decodeDocument(table, throughPostgres(row), (lines || []).map(throughPostgres), opts);
};

describe('سجل الجداول', () => {
  it('round-trips the server-owned advance balance and opening journal in existing extra JSON', () => {
    const advance = { amount: 150, status: 'pending', recovered_amount: 0, custody_expense_used_halala: 10000,
      custody_balance_opened_journal_id: 'test-funding' };
    expect(roundTrip('temporary_expenses', 'test-advance', advance)).toEqual(advance);
    const journal = { sourceType: 'expense', sourceId: 'test-expense', status: 'posted',
      employeeAdvanceConsumption: { advanceId: 'test-advance', amountHalala: 10000, usedAfterHalala: 10000,
        fundingJournalId: 'test-funding' } };
    expect(roundTrip('journal_entries', 'test-journal', journal)).toEqual(journal);
  });
  it('round-trips display-only biker tips in the existing snapshot extra JSON without schema changes', () => {
    const document = { periodKey: '2026-10', metrics: { tipsNet: 73.13 }, tipsByBiker: [{ driverExternalId: '1984', netAmount: 73.125 }] };
    expect(roundTrip('sweater_metric_snapshots', 'tips-test', document)).toEqual(document);
  });
  it('كل جدول باسم فريد وأعمدة بلا تكرار', () => {
    const names = SCHEMA.map(t => t.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it('كل حقل يُستعلم عنه في الكود عمودٌ له نوع (لا تصفية على extra)', () => {
    const queried = {
      washes: ['wash_date', 'ssp_booking_id', 'biker_id', 'status', 'driver_external_id'],
      journal_entries: ['entryDate', 'periodKey', 'sourceId', 'sourceType', 'sourceKind', 'reversedSourceType', 'reversedSourceKind', 'reversalOf', 'status'],
      variable_expenses: ['invoice_date', 'logged_date', 'spent_date', 'is_tax_invoice'],
      annual_expense_entries: ['invoice_date', 'logged_date', 'spent_date', 'annual_expense_id', 'is_tax_invoice'],
      expense_vouchers: ['invoiceDate', 'dueDate', 'periodKey'],
      monthly_expenses: ['logged_date', 'invoice_date', 'is_tax_invoice'],
      startup_cost_entries: ['startup_cost_id', 'is_tax_invoice', 'spent_date'],
      sweater_bookings: ['processingStatus', 'postedEntryId', 'periodKey', 'serviceDate'],
      partners: ['user_id', 'partner_name'], partner_payments: ['partner_id'], partner_mcp_keys: ['ownerUid', 'partnerId'],
      users: ['email'], temporary_expenses: ['biker_id', 'status'], sales_documents: ['referenceNumber', 'linkedJournalEntryId', 'referenceDocumentId', 'journalEntryId'],
      agent_command_reports: ['reportedAt'], agent_command_alerts: ['active'], agent_command_approvals: ['status'], agent_command_activity: ['occurredAt'],
      agent_command_ingestion: ['expiresAt'], password_reset_throttle: ['expiresAt'], biker_quality_reports: ['bikerUID', 'periodKey'],
      executive_reports: ['dateRiyadh'],
    };
    for (const [collection, fields] of Object.entries(queried)) {
      const { table } = tableFor(collection);
      const typed = new Set(table.columns.map(c => c.field));
      for (const f of fields) expect(typed.has(f), `${collection}.${f}`).toBe(true);
    }
  });
  it('المجموعات الفرعية تجد جدولها ومعرّف الأب', () => {
    expect(tableFor('payroll_runs/2026-10__r1/items')).toMatchObject({ parentId: '2026-10__r1', table: { table: 'payroll_run_items' } });
    expect(groupTables('revisions').map(t => t.table).sort()).toEqual(['executive_report_revisions', 'finance_report_revisions', 'finance_review_revisions', 'operations_report_revisions']);
    expect(() => tableFor('no_such_collection')).toThrow(/لا جدول/);
  });
});

describe('اللحظات', () => {
  it('ميكروثانية ونانوثانية تمرّ عبر النص', () => {
    expect(isoToTs(tsToIso({ s: 1760000000, n: 123456000 }))).toEqual({ s: 1760000000, n: 123456000 });
    expect(isoToTs('2026-10-21 10:00:00.5+00')).toEqual({ s: Date.parse('2026-10-21T10:00:00Z') / 1000, n: 500000000 });
    expect(isoToTs('2026-10-21T13:00:00+03:00')).toEqual({ s: Date.parse('2026-10-21T10:00:00Z') / 1000, n: 0 });
  });
});

describe('حالات حدية تعود حرفياً', () => {
  const cases = [
    ['washes', 'w1', { wash_date: '2026-10-05', price: 23, quantity: 1, status: 'مكتملة', created_at: '2026-10-05T09:00:00.000Z' }],
    ['washes', 'w2', { wash_date: '2026-10-05T09:00', price: 0.30000000000000004, quantity: 1.5, created_at: { seconds: 1, nanoseconds: 2 } }],
    ['washes', 'w3', { wash_date: null, price: -0, biker_id: 42, owner_tax_snapshot: { b: 1, a: [1, null, { z: NaN }] }, notes: undefined }],
    ['washes', 'w4', { wash_date: '2026-1-5', price: '23', status: 'قيد التنفيذ', created_at: '2026-10-05T09:00:00Z' }],
    ['washes', 'w5', { extra_field: { $fs: 1 }, id: 'legacy-id', shape: 'x', extra: [1] }],
    ['monthly_expenses', 'm1', { total_monthly_cost: 1e15, vat_rate: 0.15, quantity: 3, unit_cost: 33.333333333333336, payment_day: 2.5 }],
    ['temporary_expenses', 't1', { status: 'pending', recovered_date: null, payroll_lock_id: null, assignment_month: '2026-13' }],
    ['journal_entries', 'e1', { entryDate: '2026-10-01', status: 'posted', lines: [{ accountId: '1000', debit: 10, credit: 0, description: 'x' }, { accountId: '4000', debit: 0, credit: 10, memo: 'y' }], totalDebit: 10 }],
    ['journal_entries', 'e2', { entryDate: '2026-10-01', status: 'posted' }],
    ['journal_entries', 'e3', { entryDate: '2026-10-01', lines: [] }],
    ['journal_entries', 'e4', { lines: 'not-an-array' }],
    ['journal_entries', 'e5', { lines: [{ accountId: '1', debit: 0.1 + 0.2, credit: null }, 7] }],
    ['users', 'u1', { email: 'a@b.c', role: null, created_at: new Date('2026-01-02T03:04:05.678Z') }],
    ['payroll_runs/2026-10__r1/items', 'b1', { bikerId: 'b1', netDue: 1234.56, formula: { values: [1, 2.5] } }],
  ];
  for (const [collection, id, data] of cases) {
    it(`${collection}/${id}`, () => expect(canon(roundTrip(collection, id, data))).toBe(canon(data)));
  }
  it('العمود يحمل التمثيل الصحيح والأصل في shape عند الاختلاف', () => {
    const { table } = tableFor('washes');
    const { row } = encodeDocument(table, 'w', { price: 0.30000000000000004, wash_date: '2026-1-5', quantity: 2 });
    expect(row).toMatchObject({ price: '0.30', wash_date: null, quantity: 2 });
    expect(row.shape).toEqual({ r: { price: 0.30000000000000004, wash_date: '2026-1-5' } });
  });
});

// ── Property: random documents on every table, every type into every column ──
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randomValue(r, depth = 0) {
  const pick = Math.floor(r() * 22);
  switch (pick) {
    case 0: return null;
    case 1: return Math.floor(r() * 1000);
    case 2: return Math.round(r() * 100000) / 100;
    case 3: return r() * 1000;
    case 4: return 0.1 + 0.2;
    case 5: return -Math.round(r() * 100) / 100;
    case 6: return '2026-10-' + String(1 + Math.floor(r() * 28)).padStart(2, '0');
    case 7: return '2026-' + String(1 + Math.floor(r() * 12)).padStart(2, '0');
    case 8: return new Date(Date.UTC(2026, 9, 1 + Math.floor(r() * 28), 3, 4, 5, Math.floor(r() * 1000))).toISOString();
    case 9: return { seconds: 1760000000 + Math.floor(r() * 1e6), nanoseconds: Math.floor(r() * 1e9) };
    case 10: return { seconds: 1760000000, nanoseconds: Math.floor(r() * 1e6) * 1000 };
    case 11: return r() < 0.5;
    case 12: return 'نص ' + Math.floor(r() * 100);
    case 13: return '';
    case 14: return depth < 2 ? { a: randomValue(r, depth + 1), [`k${Math.floor(r() * 5)}`]: randomValue(r, depth + 1) } : 1;
    case 15: return depth < 2 ? [randomValue(r, depth + 1), randomValue(r, depth + 1)] : [];
    case 16: return Number.NaN;
    case 17: return -0;
    case 18: return 1e-7;
    case 19: return '2026-02-30';
    case 20: return 2 ** 40;
    default: return 'pending';
  }
}
describe('خاصية: 3000 مستند عشوائي على كل الجداول', () => {
  it('ذهاب وإياب حرفي', () => {
    const r = rng(20261022);
    for (let i = 0; i < 3000; i += 1) {
      const t = SCHEMA[i % SCHEMA.length];
      const fields = [...t.columns.map(c => c.field), 'unknown_a', 'unknownB'];
      const data = {};
      for (const f of fields) if (r() < 0.45) data[f] = randomValue(r);
      if (t.lines && r() < 0.8) data.lines = [{ accountId: '1000', debit: randomValue(r), credit: 0 }, { accountId: '4000', debit: 0, credit: randomValue(r), memo: randomValue(r) }];
      const path = t.parentTable ? t.collection.replace('*', 'parent1') : t.collection;
      expect(canon(roundTrip(path, `d${i}`, data)), `${t.table} #${i}`).toBe(canon(data));
    }
  });
});
