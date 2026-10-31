// ═══════════════════════════════════════════════════════════════════════════
// حساب هادي الجاري، كشوف الحساب، وتسوية فترة التأسيس — على الخادم
// ═══════════════════════════════════════════════════════════════════════════
// الحساب كله في src/lib/founding/foundingPlan.js (نفس الدالة تعرض وتقرر).
// هنا القراءة، والكتابات الصريحة فقط — كلها للإدارة وبتأكيد:
//   • سطور الكشف: لا يصل إلى الخادم إلا ما علّمه هادي للمشروع، ولا يُحفظ إلا
//     عند «تطبيق». المستند يتعدل عبر مسار صندوق العمل المالي نفسه (معاينة ثم
//     حفظ بضوابطه) — لا اعتماد ولا ترحيل تلقائي.
//   • القرارات والإعدادات: صف لكل قرار، بمن قرر ومتى.
//   • القيود: تُعاد حسبتها داخل المعاملة، ولا يُرحّل إلا ما وافق عليه هادي
//     ببصمته نفسها، بقفل ترحيل يمنع التكرار وسجل تدقيق.
// ═══════════════════════════════════════════════════════════════════════════
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { callerRole } from '../functions/src/handlers.js';
import { FINANCE_KINDS, financeHash, financeProblems, FinanceReviewError, statementLineRefOf, managerAttestationOf, journalMatchesFinanceSource } from '../functions/src/financeReview.js';
import { outstandingCustody, applyDocumentRecovery } from '../functions/src/custodyRecovery.js';
import { manualEntryProblems, MAX_MANUAL_LINES, SETTLEMENTS_ACCOUNT } from '../src/lib/founding/manualEntry.js';
import { normalizeEntry, normalizeLines, validateEntry, journalCounterUpdate, isRealDate, postingLockId } from '../functions/src/invariants.js';
import { legacyLockIdFor } from '../functions/src/posting.js';
import { postedLines } from '../src/lib/accounting/reports.js';
import { DEFAULT_CHART_OF_ACCOUNTS, ACC, partnerCapitalAccount } from '../src/lib/accounting/chartOfAccounts.js';
import { documentDay } from '../src/lib/financeWorkbenchView.js';
import {
  foundingPlan, documentCandidates, paymentCandidates, statementLinks, quarterOf, halala,
  FOUNDING_DEFAULTS, FILED_VAT_QUARTERS, DOC_DECISIONS, PAYMENT_ARRIVALS, RULE_DECISION, MATCH_WINDOW_DAYS, daysBetween, isAttested,
  ADJUSTMENT_DIRECTIONS,
} from '../src/lib/founding/foundingPlan.js';

const fail = (message, code = 'failed-precondition') => { throw new FinanceReviewError(message, code); };
const SETTINGS_ID = 'current';
const day = z.string().refine(isRealDate, 'التاريخ غير صالح.');
const money = z.number().finite().min(0).max(1e9);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9_:.-]{1,200}$/);
const text = max => z.string().trim().max(max);
const statementRow = z.object({
  txDate: day, direction: z.enum(['debit', 'credit']), amount: z.number().finite().positive().max(1e9),
  description: text(300).default(''), reference: text(300).default(''), balance: z.number().finite().nullable().default(null),
  occurrence: z.number().int().min(1).max(1000).default(1),
}).strict();
const newExpense = z.object({
  kind: z.enum(['variable', 'monthly', 'annual', 'startup']), classificationId: z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u),
  description: text(1000).pipe(z.string().min(2)), supplier: text(500).nullable().default(null),
}).strict();
const applyRow = statementRow.extend({
  decision: z.enum(['document', 'partner_payment', 'statement_expense', 'transfer']),
  linkKey: key.nullable().default(null), expense: newExpense.nullable().default(null),
}).strict();
const confirm = { confirm: z.literal(true) };
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('saveSettings'), revision: z.number().int().min(0), cutoffDate: day, threshold: money, noPersonalStatement: z.boolean().optional(),
    actuals: z.object({ bankOpen: z.boolean(), bankBalance: z.number().finite().min(-1e9).max(1e9).nullable(), cash: z.number().finite().min(-1e9).max(1e9),
      custody: z.array(z.object({ name: text(80).pipe(z.string().min(1)), amount: money }).strict()).max(50) }).strict().nullable(), ...confirm }).strict(),
  z.object({ action: z.literal('decide'), sourceKey: key, decision: z.string().max(40).nullable().optional(), partnerId: z.string().max(160).nullable().default(null),
    custodian: text(80).nullable().default(null),
    vatReviewed: z.boolean().optional(), note: text(500).nullable().default(null), ...confirm }).strict(),
  z.object({ action: z.literal('acceptSmall'), keys: z.array(key).min(1).max(500), ...confirm }).strict(),
  z.object({ action: z.literal('ensureAccounts'), ...confirm }).strict(),
  z.object({ action: z.literal('postEntries'), entries: z.array(z.object({ key, hash }).strict()).min(1).max(300),
    reason: text(1000).pipe(z.string().min(3)), ...confirm }).strict(),
  z.object({ action: z.literal('applyUpdate'), key, ...confirm }).strict(),
  z.object({ action: z.literal('applyUpdates'), keys: z.array(key).min(1).max(10), ...confirm }).strict(),
  z.object({ action: z.literal('applyRule'), hash, ...confirm }).strict(),
  z.object({ action: z.literal('decidePayments'), keys: z.array(key).min(1).max(200), arrival: z.enum(PAYMENT_ARRIVALS), ...confirm }).strict(),
  z.object({ action: z.literal('attestExpense'), requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), approxDate: day,
    amount: z.number().finite().positive().max(1e9).refine(v => Math.round(v * 100) === v * 100, 'المبلغ بالهللة.'),
    description: text(1000).pipe(z.string().min(2)), kind: z.enum(['variable', 'monthly', 'annual', 'startup']),
    classificationId: z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u),
    proofUrl: z.string().url().refine(v => v.startsWith('https://') && !/\/api\/mcp\//i.test(v)).nullable().default(null),
    note: text(500).nullable().default(null), ...confirm }).strict(),
  z.object({ action: z.literal('attestBalance'), hash, note: text(1000).pipe(z.string().min(3)), ...confirm }).strict(),
  z.object({ action: z.literal('attestDocument'), kind: z.enum(['variable', 'monthly', 'annual', 'startup']), sourceId: z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u),
    sourceHash: hash, reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('proposeAdjustment'), amount: z.number().finite().positive().max(1e9).refine(v => Math.round(v * 100) === v * 100, 'المبلغ بالهللة.'),
    direction: z.enum(ADJUSTMENT_DIRECTIONS), reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('removeAdjustment'), id: z.string().regex(/^adj_[a-f0-9]{16}$/), ...confirm }).strict(),
  z.object({ action: z.literal('proposeTransfer'), date: day, amount: z.number().finite().positive().max(1e9).refine(v => Math.round(v * 100) === v * 100, 'المبلغ بالهللة.'),
    description: text(300).pipe(z.string().min(2)), reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('removeTransfer'), id: z.string().regex(/^tr_[a-f0-9]{16}$/), ...confirm }).strict(),
  z.object({ action: z.literal('proposeReceipts'), keys: z.array(key).min(1).max(200), reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('removeReceipt'), key, ...confirm }).strict(),
  z.object({ action: z.literal('proposeDuplicate'), key, originalKey: key, reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('removeDuplicate'), id: z.string().regex(/^dup_[a-f0-9]{16}$/), ...confirm }).strict(),
  z.object({ action: z.literal('proposeCustodySettlement'), advanceId: z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u), accountId: z.string().regex(/^[0-9A-Za-z-]{2,40}$/),
    reason: text(500).pipe(z.string().min(5)), ...confirm }).strict(),
  z.object({ action: z.literal('removeCustodySettlement'), id: z.string().regex(/^cs_[a-f0-9]{16}$/), ...confirm }).strict(),
  z.object({ action: z.literal('proposeManualEntry'), date: day, description: text(300).pipe(z.string().min(2)), reason: text(500).pipe(z.string().min(5)),
    settlementReason: text(500).nullable().default(null),
    lines: z.array(z.object({ accountId: z.string().regex(/^[\p{L}\p{N}_.:-]{1,160}$/u), debit: money, credit: money,
      description: text(200).default('') }).strict()).min(2).max(MAX_MANUAL_LINES), ...confirm }).strict(),
  z.object({ action: z.literal('removeManualEntry'), id: z.string().regex(/^me_[a-f0-9]{16}$/), ...confirm }).strict(),
  z.object({ action: z.literal('manualEntries') }).strict(),
  z.object({ action: z.literal('statementSuggest'), account: z.enum(['personal', 'company']), rows: z.array(statementRow).min(1).max(2000) }).strict(),
  z.object({ action: z.literal('statementApply'), account: z.enum(['personal', 'company']), fileName: text(200), fileHash: z.string().max(128),
    rows: z.array(applyRow).min(1).max(500), ...confirm }).strict(),
]);

const authTx = (db, tx) => ({ collection: name => ({ doc: id => ({ get: () => tx.get(db.collection(name).doc(id)) }) }) });
async function adminOnly(db, auth, tx = null) {
  if (await callerRole(tx ? authTx(db, tx) : db, auth) !== 'admin') fail('حساب هادي الجاري وتسوية التأسيس للإدارة فقط.', 'permission-denied');
}
async function actorName(db, auth, tx = null) {
  const ref = db.collection('users').doc(auth.uid), snap = tx ? await tx.get(ref) : await ref.get();
  return (snap.exists && (snap.data().displayName || snap.data().email)) || auth.email || auth.uid;
}

/** معرّف ثابت لسطر الكشف: نفس الحركة في ملفين متداخلين = نفس السطر. */
export function statementLineId(account, row) {
  return `stmt_${financeHash({ account, txDate: row.txDate, direction: row.direction, amount: halala(row.amount),
    description: row.description || '', reference: row.reference || '', balance: row.balance == null ? null : halala(row.balance),
    occurrence: row.occurrence || 1 }).slice(0, 40)}`;
}
export const foundingEntryId = entryKey => `founding_${financeHash(entryKey).slice(0, 40)}`;
const entryHash = e => financeHash({ key: e.key, date: e.date, description: e.description, lines: e.lines });

// ── القراءة ──────────────────────────────────────────────────────────────
const COLLECTIONS = [...new Set([...Object.values(FINANCE_KINDS).map(s => s.collection), 'partner_payments', 'partners', 'journal_entries',
  'journal_lines', 'posting_locks', 'bank_statement_lines', 'founding_review', 'founding_decisions', 'chart_of_accounts',
  'accounting_periods', 'temporary_expenses', 'variable_expense_categories', 'monthly_expense_categories', 'annual_expenses', 'startup_costs',
  'categories', 'annual_expense_categories', 'bikers'])];

async function loadTables(db, tx = null) {
  const snaps = await Promise.all(COLLECTIONS.map(name => tx ? tx.get(db.collection(name)) : db.collection(name).get()));
  return Object.fromEntries(COLLECTIONS.map((name, i) => [name, snaps[i].docs.map(d => ({ ...d.data(), id: d.id }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))]));
}

/** أثر كل مصدر على الصندوق والبنك (بالهللة) من قيوده، ومن تصحيحات جهة الدفع المعتمدة سابقًا. */
export function ledgerEffects(entries) {
  const index = new Map(entries.map(e => [e.id, e])), byNumber = new Map(entries.map(e => [String(e.entryNumber), e]));
  const root = (entry, seen = new Set()) => {
    if (!entry || seen.has(entry.id)) return null;
    seen.add(entry.id);
    if (entry.sourceType === 'expense' && entry.sourceId) return `expense:${entry.sourceId}`;
    if (entry.sourceType === 'partner_payment' && entry.sourceId) return `partner_payment:${entry.sourceId}`;
    if (entry.reversalOf) return root(index.get(String(entry.reversalOf)) || byNumber.get(String(entry.reversalOf)), seen);
    return null;
  };
  const effects = new Map(), get = k => {
    if (!effects.has(k)) effects.set(k, { cash: 0, bank: 0, payable: 0, vat: 0, vatDate: null, journals: 0 });
    return effects.get(k);
  };
  for (const e of entries) {
    if (!['posted', 'reversed'].includes(e.status)) continue;
    const source = root(e);
    if (source) {
      const effect = get(source), sign = source.startsWith('partner_payment:') ? -1 : 1;
      effect.journals += 1;
      for (const l of e.lines || []) {
        const net = halala(l.credit) - halala(l.debit);
        if (String(l.accountId) === ACC.CASH) effect.cash += sign * net;
        if (String(l.accountId) === ACC.BANK) effect.bank += sign * net;
        if (String(l.accountId) === ACC.PAYABLE) effect.payable += sign * net;
        if (String(l.accountId) === ACC.INPUT_VAT && halala(l.debit) > 0) {
          effect.vat += halala(l.debit) - halala(l.credit);
          effect.vatDate = e.purchaseTaxSnapshot?.invoiceDate || e.entryDate;
        }
      }
    }
    // Owner-approved funding corrections name their sources: they move a
    // source's cash credit to the bank (Dr 1010 / Cr 1020) or back.
    const sources = e.cashBankCorrection?.sources || e.cashResidualCorrection?.sources;
    if (Array.isArray(sources) && e.status === 'posted') {
      const lines = e.lines || [], cashDebit = lines.some(l => String(l.accountId) === ACC.CASH && halala(l.debit) > 0);
      const accounts = new Set(lines.map(l => String(l.accountId)));
      if (accounts.size === 2 && accounts.has(ACC.CASH) && accounts.has(ACC.BANK)) {
        for (const s of sources) {
          const k = s.source || (s.sourceType === 'expense' && s.sourceId ? `expense:${s.sourceId}` : null);
          if (!k || !Number.isSafeInteger(s.netCashCreditHalala)) continue;
          const effect = get(k), shift = cashDebit ? s.netCashCreditHalala : -s.netCashCreditHalala;
          effect.cash -= shift; effect.bank += shift;
        }
      }
    }
  }
  return effects;
}

const liveEntry = e => e?.status === 'posted' && !e.reversalOf && !e.reversedBy;
/**
 * «إلغاء مستند مكرر»: what a document still moves in the books, entry by entry — its own live
 * entries, its founding «تصحيح جهة دفع», and its share of the cash/bank corrections that name it.
 * Lines in halala; reversing all of them leaves the document with no effect at all.
 */
export function documentLiveEffects(entries, kind, sourceId, legacyLines = new Map()) {
  const linesOf = e => (e.lines?.length ? e.lines : legacyLines.get(e.id) || [])
    .map(l => ({ accountId: String(l.accountId), debit: halala(l.debit), credit: halala(l.credit) }));
  const effects = [];
  for (const e of entries) {
    if (!liveEntry(e)) continue;
    if (e.sourceId === sourceId && journalMatchesFinanceSource(kind, e) && !e.foundingEntry) {
      effects.push({ entryId: e.id, entryNumber: e.entryNumber ?? null, role: 'own', lines: linesOf(e), custody: Boolean(e.custodyRecovery) });
      continue;
    }
    if (e.foundingEntry?.key === `doc:${kind}:${sourceId}`) {
      effects.push({ entryId: e.id, entryNumber: e.entryNumber ?? null, role: 'payment_correction', lines: linesOf(e) });
      continue;
    }
    const sources = e.cashBankCorrection?.sources || e.cashResidualCorrection?.sources;
    const accounts = new Set(linesOf(e).map(l => l.accountId));
    if (!Array.isArray(sources) || accounts.size !== 2 || !accounts.has(ACC.CASH) || !accounts.has(ACC.BANK)) continue;
    const share = sources.find(x => (x.source || (x.sourceType === 'expense' && x.sourceId ? `expense:${x.sourceId}` : null)) === `expense:${sourceId}`);
    if (!share || !Number.isSafeInteger(share.netCashCreditHalala) || share.netCashCreditHalala <= 0) continue;
    const cashDebit = linesOf(e).some(l => l.accountId === ACC.CASH && l.debit > 0), h = share.netCashCreditHalala;
    effects.push({ entryId: e.id, entryNumber: e.entryNumber ?? null, role: 'cash_bank_share', lines: cashDebit
      ? [{ accountId: ACC.CASH, debit: h, credit: 0 }, { accountId: ACC.BANK, debit: 0, credit: h }]
      : [{ accountId: ACC.BANK, debit: h, credit: 0 }, { accountId: ACC.CASH, debit: 0, credit: h }] });
  }
  return effects.sort((a, b) => (a.entryNumber ?? Infinity) - (b.entryNumber ?? Infinity));
}

/** اسم التصنيف كما يراه هادي: تصنيف المصروف، أو تصنيف البند الأب (أو اسمه). */
function categoryLabels(t) {
  const label = x => x?.label || x?.name || null;
  const byId = list => new Map(list.map(x => [x.id, x]));
  const variable = byId(t.variable_expense_categories), monthly = byId(t.monthly_expense_categories);
  const startup = byId(t.startup_costs), annual = byId(t.annual_expenses), startupCats = byId(t.categories), annualCats = byId(t.annual_expense_categories);
  return (kind, row) => {
    if (kind === 'variable') return label(variable.get(row.category_id));
    if (kind === 'monthly') return label(monthly.get(row.category_id));
    const parent = kind === 'startup' ? startup.get(row.startup_cost_id) : annual.get(row.annual_expense_id);
    const group = parent && (kind === 'startup' ? startupCats : annualCats).get(parent.category);
    return label(group) || parent?.item_name || parent?.expense_name || null;
  };
}
function attestationBrief(row) {
  const a = managerAttestationOf(row);
  return a ? { byName: a.byName || null, atIso: a.atIso, approxDate: a.approxDate, note: a.note || null } : null;
}

function isPayrollRow(kind, row) {
  return kind === 'monthly' && (row.recurrence === 'monthly' || row.biker_id || row.payrollSnapshot);
}

/** كل ما تحتاجه foundingPlan، مبنيًا من الجداول المقروءة. */
export function foundingInputs(t) {
  const entries = t.journal_entries;
  const lines = entries.flatMap(e => (e.lines || []).map((l, i) => ({ ...l, entryId: e.id, id: `${e.id}:${i}` }))).concat(t.journal_lines);
  const effects = ledgerEffects(entries), locks = new Set(t.posting_locks.map(l => l.id));
  const review = t.founding_review.find(r => r.id === SETTINGS_ID) || null;
  const settings = { ...FOUNDING_DEFAULTS, ...(review ? { cutoffDate: review.cutoffDate, threshold: Number(review.threshold), actuals: review.actuals || null,
    lastRule: review.lastRule || null, noPersonalStatement: review.noPersonalStatement === true, hadiAttestation: review.hadiAttestation || null,
    adjustments: Array.isArray(review.adjustments) ? review.adjustments : [],
    manualTransfers: Array.isArray(review.manualTransfers) ? review.manualTransfers : [],
    receiptProposals: Array.isArray(review.receiptProposals) ? review.receiptProposals : [],
    duplicateCancellations: Array.isArray(review.duplicateCancellations) ? review.duplicateCancellations : [],
    custodySettlements: Array.isArray(review.custodySettlements) ? review.custodySettlements : [],
    manualEntries: Array.isArray(review.manualEntries) ? review.manualEntries : [] } : {}) };
  const categoryOf = categoryLabels(t);
  const decisions = Object.fromEntries(t.founding_decisions.map(d => [d.sourceKey, d]));
  const partners = t.partners.map(p => ({ id: p.id, name: p.partner_name || 'شريك' }));
  const docs = [];
  for (const [kind, spec] of Object.entries(FINANCE_KINDS)) {
    for (const row of t[spec.collection]) {
      if (isPayrollRow(kind, row)) continue;
      const effect = effects.get(`expense:${row.id}`) || { cash: 0, bank: 0, payable: 0, vat: 0, vatDate: null, journals: 0 };
      const lock = locks.has(postingLockId(kind, row.id)) || locks.has(legacyLockIdFor(kind, row.id));
      const date = documentDay(row[spec.date]) || documentDay(row.invoice_date);
      const unpostedVat = row.is_tax_invoice === true && row.vat_deductible !== false && (Number(row.vat_amount) > 0 || Number(row.vat_rate) > 0);
      const vatDay = effect.journals ? (effect.vat > 0 ? documentDay(effect.vatDate) : null) : unpostedVat ? documentDay(row.invoice_date) || date : null;
      docs.push({ key: `${kind}:${row.id}`, kind, sourceId: row.id, title: row[spec.title] || 'بلا عنوان', amount: Number(row[spec.amount]) || 0,
        date, paidDate: documentDay(row.paid_date), paymentStatus: row.payment_status || null,
        supplier: row.supplier || '', hasProof: typeof row.invoice_url === 'string' && /^https:\/\//.test(row.invoice_url),
        statementLineRef: statementLineRefOf(row), protected: lock || effect.journals > 0 || Boolean(row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted'),
        effect: { cash: effect.cash, bank: effect.bank, payable: effect.payable }, fundingType: row.finance_metadata?.fundingType || null,
        fundingPartnerId: row.finance_metadata?.fundingPartnerId || null, custodian: row.finance_metadata?.custodian || null,
        paymentMethod: row.payment_method || null, vatQuarter: vatDay ? quarterOf(vatDay) : null,
        category: categoryOf(kind, row), approval: row.approval_status || null,
        proofUrl: typeof row.invoice_url === 'string' && /^https:\/\//.test(row.invoice_url) ? row.invoice_url : null,
        attestation: attestationBrief(row), issues: financeProblems(kind, row, row.id) });
    }
  }
  const payments = t.partner_payments.map(p => {
    const effect = effects.get(`partner_payment:${p.id}`) || { cash: 0, bank: 0, journals: 0 };
    return { key: `partner_payment:${p.id}`, id: p.id, partnerId: p.partner_id, partnerName: partners.find(x => x.id === p.partner_id)?.name || 'شريك',
      amount: Number(p.amount) || 0, date: documentDay(p.payment_date), method: p.payment_method || null,
      protected: effect.journals > 0 || locks.has(postingLockId('partner_payment', p.id)), effect: { cash: effect.cash, bank: effect.bank } };
  });
  const posted = new Map(entries.filter(e => e.foundingEntry?.key && e.status === 'posted')
    .map(e => [e.foundingEntry.key, { entryId: e.id, entryNumber: e.entryNumber, postedReason: e.foundingEntry.reason || null, postedByName: e.foundingEntry.approvedByName || null,
      ...(e.foundingEntry.originalKey ? { originalKey: e.foundingEntry.originalKey } : {}),
      lines: (e.lines || []).map(l => ({ accountId: String(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || '' })) }]));
  const ledger = postedLines(entries, lines);
  const byId = new Map(entries.map(e => [e.id, e]));
  const book = {};
  for (const account of [ACC.CASH, ACC.BANK, ACC.EMPLOYEE_ADVANCE]) {
    book[account] = ledger.filter(l => String(l.accountId) === account && String(l.entryDate) < settings.cutoffDate)
      .reduce((n, l) => n + halala(l.debit) - halala(l.credit), 0);
  }
  const hadiLedger = ledger.filter(l => String(l.accountId) === ACC.HADI_CURRENT).map(l => ({ entryId: l.entryId, entryNumber: l.entryNumber,
    date: l.entryDate, description: l.entryDescription || l.description || '', lineDescription: l.description || '',
    debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, sourceType: l.sourceType, sourceKind: byId.get(l.entryId)?.sourceKind || null }));
  const closedMonths = new Set(t.accounting_periods.filter(p => p.status === 'closed').map(p => p.periodKey || p.id));
  const statementLines = t.bank_statement_lines.map(l => ({ id: l.id, account: l.account, txDate: l.txDate, direction: l.direction, amount: Number(l.amount) || 0,
    description: l.description || '', decision: l.decision, linkKind: l.linkKind || null, linkId: l.linkId || null, status: l.status,
    appliedByName: l.appliedByName || null, appliedAtIso: l.appliedAtIso || null }));
  const legacyLines = new Map();
  for (const l of t.journal_lines) legacyLines.set(String(l.entryId), [...(legacyLines.get(String(l.entryId)) || []), l]);
  const duplicateEffects = Object.fromEntries((settings.duplicateCancellations || []).map(p => {
    const [kind, ...rest] = String(p.key).split(':');
    return [p.key, FINANCE_KINDS[kind] ? documentLiveEffects(entries, kind, rest.join(':'), legacyLines) : []];
  }));
  // «تسوية مصروف مؤقت»: temporary items whose own live entry debited 1300.
  const temporaryEntries = new Map(entries.filter(e => liveEntry(e) && e.sourceType === 'temporary_expense' && e.sourceId)
    .map(e => [String(e.sourceId), e]));
  const bikerNames = new Map(t.bikers.map(b => [b.id, b.name || b.name_ar || b.id]));
  const advances = t.temporary_expenses.flatMap(a => {
    const e = temporaryEntries.get(a.id), lines = e ? (e.lines?.length ? e.lines : legacyLines.get(e.id) || []) : [];
    if (!lines.some(l => String(l.accountId) === ACC.EMPLOYEE_ADVANCE && halala(l.debit) > 0)) return [];
    return [{ id: a.id, title: a.title || a.description || 'مصروف مؤقت', holder: a.biker_id ? bikerNames.get(a.biker_id) || null : null,
      amount: Number(a.amount) || 0, outstanding: halala(outstandingCustody(a)), spentDate: documentDay(a.spent_date), status: a.status || null,
      entryId: e.id, entryNumber: e.entryNumber ?? null }];
  });
  return { docs, payments, lines: statementLines, decisions, settings, book, posted, closedMonths, hadiLedger, partners,
    review, chart: new Set(t.chart_of_accounts.map(a => a.id)), duplicateEffects, advances,
    custodyHint: t.temporary_expenses.filter(x => x.status !== 'recovered' && documentDay(x.spent_date) && documentDay(x.spent_date) < settings.cutoffDate)
      .reduce((n, x) => n + halala(x.amount) - halala(x.recovered_amount), 0) };
}

function planOf(t) {
  const input = foundingInputs(t), plan = foundingPlan(input);
  plan.entries = plan.entries.map(e => ({ ...e, hash: entryHash(e) }));
  if (plan.settlement.entry) plan.settlement.entry = plan.entries.find(e => e.key === plan.settlement.entry.key);
  if (plan.comparison.entry) plan.comparison.entry = plan.entries.find(e => e.key === plan.comparison.entry.key);
  // What «تطبيق القاعدة» was shown: the same documents, updates and entry lines, or nothing is saved.
  plan.rule.hash = financeHash({ cutoff: plan.settings.cutoffDate, keys: plan.rule.candidates.map(c => c.key),
    updates: plan.rule.updates.map(u => [u.key, u.patch, u.held, u.blocked]), entries: plan.rule.entries.map(entryHash) });
  // What «اعتماد الرصيد» was shown: these numbers, or nothing is saved.
  const b = plan.hadiBalance;
  b.hash = financeHash({ paid: b.paid, received: b.received, toCompany: b.toCompany, toHadi: b.toHadi, net: b.net, undecided: b.undecided });
  return { input, plan };
}

// ── الكتابات ─────────────────────────────────────────────────────────────
const stamp = (uid, name) => ({ updatedBy: uid, updatedByName: name, updatedAtIso: new Date().toISOString() });
function audit(db, tx, auth, action, documentId, value) {
  tx.create(db.collection('audit_logs').doc(), { action, collectionName: 'founding', documentId, userId: auth.uid, after: value ?? null,
    at: FieldValue.serverTimestamp() });
}
function ensureChartRows(db, tx, chart, codes) {
  const rows = DEFAULT_CHART_OF_ACCOUNTS.filter(a => codes.includes(a.code) && !chart.has(a.code));
  for (const a of rows) {
    tx.set(db.collection('chart_of_accounts').doc(a.code), { ...a, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    chart.add(a.code);
  }
  return rows.map(a => a.code);
}

async function postEntries(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t);
    const counterRef = db.collection('counters').doc('journal'), counter = await tx.get(counterRef);
    const highest = Math.max(0, ...t.journal_entries.map(e => Number(e.entryNumber) || 0));
    let next = counter.exists && Number.isSafeInteger(counter.data().nextNumber) ? counter.data().nextNumber : highest + 1;
    if (next <= highest) fail('عداد القيود يحتاج مراجعة.');
    const selected = r.entries.map(({ key: k, hash: h }) => {
      const e = plan.entries.find(x => x.key === k);
      if (!e) fail('قيد مقترح لم يعد موجودًا؛ أعد القراءة.');
      if (e.status !== 'proposed') fail(`القيد «${e.title}» ليس جاهزًا للترحيل الآن.`);
      if (e.hash !== h) fail('تغيرت أسطر القيد بعد عرضه؛ أعد القراءة ووافق من جديد.');
      return e;
    });
    if (new Set(selected.map(e => e.key)).size !== selected.length) fail('قيد مكرر في الطلب.', 'invalid-argument');
    // Every read before the first write (the chart rows below are writes).
    const locks = await Promise.all(selected.map(e => tx.get(db.collection('posting_locks').doc(postingLockId('founding', foundingEntryId(e.key))))));
    if (locks.some(l => l.exists)) fail('أحد القيود مرحّل سابقًا.');
    const name = await actorName(db, auth, tx);
    const created = ensureChartRows(db, tx, input.chart, [ACC.HADI_CURRENT, ACC.FOUNDING_SETTLEMENTS]);
    for (const e of selected) for (const l of e.lines) {
      const partner = /^3000-(.+)$/.exec(l.accountId)?.[1];
      if (partner && !input.chart.has(l.accountId)) {
        const p = input.partners.find(x => x.id === partner);
        if (!p) fail('حساب رأس مال الشريك غير معروف.');
        tx.set(db.collection('chart_of_accounts').doc(l.accountId), { ...partnerCapitalAccount(p.id, p.name), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        input.chart.add(l.accountId);
      }
    }
    const periods = new Map(t.accounting_periods.map(p => [p.periodKey || p.id, p]));
    const results = [], first = next;
    for (const e of selected) {
      if (periods.get(e.date.slice(0, 7))?.status === 'closed') fail(`الفترة ${e.date.slice(0, 7)} مقفلة.`);
      const entryId = foundingEntryId(e.key);
      // A partner receipt posts as that receipt's own entry, under its own lock: nothing posts it twice.
      const receipt = e.type === 'receipt';
      const entry = { ...normalizeEntry({ entryDate: e.date, sourceType: receipt ? 'partner_payment' : 'adjustment', sourceId: receipt ? e.paymentId : entryId,
        description: e.description }), sourceKind: `founding_${e.type}` };
      const lines = normalizeLines(e.lines);
      const problems = validateEntry(entry, lines, { knownAccountCodes: input.chart });
      if (problems.length) fail(problems[0]);
      const total = Math.round(lines.reduce((n, l) => n + halala(l.debit), 0)) / 100;
      // «تسوية مصروف مؤقت»: the item is settled by this entry — payroll and a cash recovery no longer count it; a reversal reopens it.
      const advance = e.type === 'custody_settlement' ? t.temporary_expenses.find(a => a.id === e.advanceId) : null;
      if (e.type === 'custody_settlement' && (!advance || halala(outstandingCustody(advance)) !== halala(e.amount))) fail('تغيّر المصروف المؤقت بعد عرضه؛ أعد القراءة.');
      // «قيد يدوي بموافقة»: checked again as it posts — the chart, the partners and the periods are today's.
      const manualProblems = e.type === 'manual' ? manualEntryProblems({ date: e.date, description: e.title, reason: e.reason, settlementReason: e.settlementReason,
        lines: e.lines }, { accounts: input.chart, partners: input.partners, closedMonths: input.closedMonths }) : [];
      if (manualProblems.length) fail(`القيد اليدوي «${e.title}»: ${manualProblems[0]}`);
      const journal = { ...entry, lines, lineCount: lines.length, totalDebit: total, totalCredit: total, entryNumber: next, createdBy: auth.uid,
        foundingEntry: { key: e.key, type: e.type, sourceKey: e.sourceKey, cutoffDate: input.settings.cutoffDate, approvedByName: name, reason: r.reason, hash: e.hash,
          ...(e.originalKey ? { originalKey: e.originalKey } : {}), ...(advance ? { advanceId: advance.id } : {}),
          ...(e.type === 'manual' ? { proposedByName: e.proposedByName || null, proposedAtIso: e.proposedAtIso || null, settlementReason: e.settlementReason || null } : {}) },
        ...(advance ? { custodyRecovery: { bikerId: advance.biker_id || null, amount: e.amount, excess: 0, allocations: [{ advanceId: advance.id, amount: e.amount }] } } : {}) };
      tx.create(db.collection('journal_entries').doc(entryId), { ...journal, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('posting_locks').doc(postingLockId('founding', entryId)), { kind: 'founding', sourceType: 'adjustment', sourceId: entryId,
        entryId, entryNumber: next, lockedBy: auth.uid, lockedAt: FieldValue.serverTimestamp() });
      if (receipt) tx.create(db.collection('posting_locks').doc(postingLockId('partner_payment', e.paymentId)), { kind: 'partner_payment',
        sourceType: 'partner_payment', sourceId: e.paymentId, entryId, entryNumber: next, lockedBy: auth.uid, lockedAt: FieldValue.serverTimestamp() });
      if (advance) tx.update(db.collection('temporary_expenses').doc(advance.id),
        applyDocumentRecovery(advance, { advanceId: advance.id, amount: e.amount }, { date: e.date, kind: 'founding', sourceId: e.key, entryId }));
      tx.create(db.collection('audit_logs').doc(), { action: 'founding-post', collectionName: 'journal_entries', documentId: entryId, userId: auth.uid,
        sourceId: e.key, reason: r.reason, after: { entryNumber: next, lines, date: e.date }, at: FieldValue.serverTimestamp() });
      results.push({ key: e.key, entryId, entryNumber: next });
      next += 1;
    }
    // One counter write: the last number used, and the earliest date posted.
    const earliest = selected.map(e => e.date).sort()[0];
    tx.set(counterRef, journalCounterUpdate(counter, next - 1, earliest, FieldValue), { merge: true });
    return { posted: results, accountsCreated: created, financialPosting: true, firstNumber: first };
  });
}

/** The saved review without its id; what a write keeps (the rule's record, the attestation, the adjustments). */
const reviewKept = review => (review ? Object.fromEntries(Object.entries(review).filter(([k]) => k !== 'id')) : {});

async function saveSettings(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const ref = db.collection('founding_review').doc(SETTINGS_ID), snap = await tx.get(ref);
    const revision = snap.exists ? Number(snap.data().revision) || 0 : 0;
    if (revision !== r.revision) fail('تغيرت الإعدادات من جلسة أخرى؛ أعد القراءة.');
    const kept = reviewKept(snap.exists ? snap.data() : null);
    const value = { ...kept, cutoffDate: r.cutoffDate, threshold: r.threshold, actuals: r.actuals,
      noPersonalStatement: r.noPersonalStatement ?? kept.noPersonalStatement === true, revision: revision + 1, ...stamp(auth.uid, await actorName(db, auth, tx)) };
    tx.set(ref, value);
    audit(db, tx, auth, 'founding-settings', SETTINGS_ID, value);
    return { saved: true, revision: value.revision };
  });
}

async function decide(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t);
    const doc = input.docs.find(d => d.key === r.sourceKey), payment = input.payments.find(p => p.key === r.sourceKey);
    if (!doc && !payment) fail('المصدر غير موجود.', 'not-found');
    const allowed = doc ? DOC_DECISIONS : PAYMENT_ARRIVALS;
    if (r.decision != null && !allowed.includes(r.decision)) fail('القرار غير صالح لهذا المصدر.', 'invalid-argument');
    if (r.decision === 'partner' && !input.partners.some(p => p.id === r.partnerId)) fail('اختر الشريك الذي دفع.', 'invalid-argument');
    if (r.decision === 'custody' && !r.custodian) fail('اكتب اسم صاحب العهدة.', 'invalid-argument');
    if (r.vatReviewed !== undefined && !plan.vatTouching.some(v => v.key === r.sourceKey)) fail('هذا المستند لا يمس إقرارًا مقدّمًا.', 'invalid-argument');
    const ref = db.collection('founding_decisions').doc(financeHash(r.sourceKey).slice(0, 40)), snap = await tx.get(ref);
    const before = snap.exists ? snap.data() : null;
    // Only what the request names changes: a «راجعته» click keeps the payer decision, and the reverse.
    const decision = r.decision === undefined ? (before?.decision === 'manager_attested' ? null : before?.decision ?? null) : r.decision;
    const keep = r.decision === undefined;
    const value = { sourceKey: r.sourceKey, decision,
      partnerId: decision === 'partner' ? (keep ? before?.partnerId ?? null : r.partnerId) : null,
      custodian: decision === 'custody' ? (keep ? before?.custodian ?? null : r.custodian) : null,
      attested: isAttested(before), note: r.note ?? before?.note ?? null, vatReviewed: r.vatReviewed ?? before?.vatReviewed ?? false,
      revision: (Number(before?.revision) || 0) + 1, decidedBy: auth.uid, decidedByName: await actorName(db, auth, tx), decidedAtIso: new Date().toISOString() };
    tx.set(ref, value);
    audit(db, tx, auth, 'founding-decision', r.sourceKey, value);
    return { saved: true, decision: value };
  });
}

async function acceptSmall(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { plan } = planOf(t), name = await actorName(db, auth, tx);
    const small = new Map(plan.groups.small.filter(d => !d.attested).map(d => [d.key, d]));
    if (r.keys.some(k => !small.has(k))) fail('القائمة تغيرت؛ أعد القراءة قبل القبول.');
    for (const k of r.keys) {
      // The attestation accepts the proof; who paid stays whatever was decided (or the rule).
      const before = small.get(k).decision || {};
      const value = { ...before, sourceKey: k, decision: before.decision === 'manager_attested' ? null : before.decision ?? null, attested: true,
        revision: (Number(before.revision) || 0) + 1, attestedBy: auth.uid, attestedByName: name, attestedAtIso: new Date().toISOString(),
        decidedBy: before.decidedBy || auth.uid, decidedByName: before.decidedByName || name, decidedAtIso: before.decidedAtIso || new Date().toISOString() };
      tx.set(db.collection('founding_decisions').doc(financeHash(k).slice(0, 40)), value);
    }
    audit(db, tx, auth, 'founding-accept-small', 'small', { keys: r.keys, total: r.keys.reduce((n, k) => n + halala(small.get(k).amount), 0) / 100 });
    return { saved: true, count: r.keys.length };
  });
}

/**
 * «تطبيق القاعدة الافتراضية لفترة التأسيس»: يحفظ لكل مستند في المعاينة أن
 * دافعه هادي (قاعدة)، باسم من طبّق ووقته، ويضيف الحسابين للدليل. لا يعدّل
 * مستندًا هنا ولا يرحّل قيدًا: المستندات غير المرحّلة تتعدل بعده عبر صندوق
 * العمل المالي (applyUpdates)، وقيود المرحّلة تنتظر موافقة مستقلة.
 */
async function applyRule(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    if (!plan.rule.count) fail('لا مستندات تنطبق عليها القاعدة الآن.');
    if (plan.rule.hash !== r.hash) fail('تغيرت المستندات أو القيود بعد المعاينة؛ أعد القراءة ووافق من جديد.');
    const at = new Date().toISOString();
    for (const c of plan.rule.candidates) {
      const before = input.decisions[c.key] || {};
      tx.set(db.collection('founding_decisions').doc(financeHash(c.key).slice(0, 40)), { ...before, sourceKey: c.key, decision: RULE_DECISION,
        partnerId: null, custodian: null, attested: isAttested(before), vatReviewed: before.vatReviewed ?? false,
        revision: (Number(before.revision) || 0) + 1, decidedBy: auth.uid, decidedByName: name, decidedAtIso: at });
    }
    const created = ensureChartRows(db, tx, input.chart, [ACC.HADI_CURRENT, ACC.FOUNDING_SETTLEMENTS]);
    const lastRule = { atIso: at, by: auth.uid, byName: name, count: plan.rule.count, total: plan.rule.total, cutoffDate: plan.settings.cutoffDate,
      unposted: plan.rule.unposted, posted: plan.rule.posted, held: plan.rule.held, groups: plan.rule.groups, bankFees: plan.rule.bankFees.count, hash: plan.rule.hash };
    writeReview(db, tx, input.review, plan, { lastRule }, auth, name);
    tx.create(db.collection('audit_logs').doc(), { action: 'founding-rule', collectionName: 'founding_decisions', documentId: plan.settings.cutoffDate,
      userId: auth.uid, after: { ...lastRule, keys: plan.rule.candidates.map(c => c.key), accountsCreated: created }, at: FieldValue.serverTimestamp() });
    // The rule's unposted documents, and the exceptions/decisions saved before it, in one run.
    const updates = [...new Set([...plan.rule.updates, ...plan.updates].filter(u => !u.held && !u.blocked).map(u => u.key))];
    return { applied: plan.rule.count, updates, lastRule };
  });
}

/** One write of the settings row, keeping whatever it holds. */
function writeReview(db, tx, review, plan, patch, auth, name) {
  const base = review ? reviewKept(review) : { cutoffDate: plan.settings.cutoffDate, threshold: plan.settings.threshold, actuals: plan.settings.actuals || null };
  tx.set(db.collection('founding_review').doc(SETTINGS_ID), { ...base, ...patch, revision: (Number(review?.revision) || 0) + 1, ...stamp(auth.uid, name) });
}

/** «وصلت لحسابي» (أو لحساب الشركة) لكل دفعة تأسيس لم تُحسم، دفعة واحدة. */
async function decidePayments(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const open = new Map(plan.groups.partners.filter(p => !p.arrival || p.arrivalSource === 'recorded').map(p => [p.key, p]));
    if (r.keys.some(k => !open.has(k))) fail('القائمة تغيرت؛ أعد القراءة قبل الحفظ.');
    const at = new Date().toISOString();
    for (const k of r.keys) {
      // Read with the tables above: a transaction reads everything before it writes.
      const before = Object.fromEntries(Object.entries(input.decisions[k] || {}).filter(([field]) => field !== 'id'));
      tx.set(db.collection('founding_decisions').doc(financeHash(k).slice(0, 40)), { ...before, sourceKey: k, decision: r.arrival, partnerId: null, custodian: null, attested: false, note: before.note ?? null,
        vatReviewed: before.vatReviewed ?? false, revision: (Number(before.revision) || 0) + 1, decidedBy: auth.uid, decidedByName: name, decidedAtIso: at });
    }
    audit(db, tx, auth, 'founding-payments-arrival', r.arrival, { keys: r.keys, arrival: r.arrival,
      total: r.keys.reduce((n, k) => n + halala(open.get(k).amount), 0) / 100 });
    return { saved: true, count: r.keys.length };
  });
}

/**
 * «مصروف تأسيس بإقرار المدير»: مصروف دفعه هادي ولا مستند له. يُسجّل عبر صندوق
 * العمل المالي (معاينة ثم تسجيل بضوابطه) بلا ضريبة مدخلات، باسم من أقرّه
 * ووقته، ويعود بانتظار الاعتماد. الشهر المقفل يبقى مقفلًا: يُسجّل بآخر يوم في
 * فترة التأسيس، ويُحفظ تاريخه التقريبي.
 */
async function attestExpense(db, auth, r, workbench) {
  const t = await loadTables(db), { input, plan } = planOf(t), name = await actorName(db, auth);
  const { cutoffDate: cutoff, foundingEnd } = plan.settings;
  if (r.approxDate >= cutoff) fail(`التاريخ قبل بدء البنك (${cutoff}) فقط: هذا مصروف لفترة التأسيس.`, 'invalid-argument');
  const recordDate = input.closedMonths.has(r.approxDate.slice(0, 7)) ? foundingEnd : r.approxDate;
  if (input.closedMonths.has(recordDate.slice(0, 7))) fail('آخر يوم في فترة التأسيس في شهر مقفل؛ لا يُسجّل قبل فتحه.');
  const parents = r.kind === 'annual' ? t.annual_expenses : r.kind === 'startup' ? t.startup_costs : t[FINANCE_KINDS[r.kind].category];
  if (!parents.some(x => x.id === r.classificationId)) fail('التصنيف غير موجود.', 'not-found');
  const description = r.description.trim();
  if (plan.attestedExpenses.some(e => halala(e.amount) === halala(r.amount) && e.approxDate === r.approxDate && e.title === description)) {
    fail('مصروف بإقرار المدير بنفس الوصف والمبلغ والتاريخ مسجّل.', 'already-exists');
  }
  const classification = ['annual', 'startup'].includes(r.kind) ? { parentId: r.classificationId } : { categoryId: r.classificationId };
  const managerAttestation = { by: auth.uid, byName: name, atIso: new Date().toISOString(), approxDate: r.approxDate, ...(r.note ? { note: r.note } : {}) };
  const patch = { description, amount: r.amount, date: recordDate, quantity: 1, ...classification, supplier: null, invoiceNumber: null, invoiceDate: null,
    invoiceUrl: r.proofUrl, isTaxInvoice: false, vatDeductible: false, vatAmount: null, vatRate: null, priceMode: 'inclusive',
    fundingType: 'owner_current', paymentMethod: 'founding_personal', paymentStatus: 'paid', paidDate: recordDate,
    fundingReference: `إقرار المدير — ${name}`, purpose: 'مصروف تأسيس بإقرار المدير', evidenceRefs: ['founding:attestation'], managerAttestation };
  const requestId = `attest_${r.requestId}`, reason = 'مصروف تأسيس بإقرار المدير';
  const preview = await workbench(db, auth, { action: 'previewCapture', kind: r.kind, requestId, patch });
  const saved = await workbench(db, auth, { action: 'capture', kind: r.kind, requestId, patch, previewHash: preview.previewHash, reason, confirm: true });
  return { saved: true, kind: r.kind, sourceId: saved.sourceId, recordDate, auditId: saved.auditId || null };
}

/**
 * «بلا إيصال، بإقرار المدير» على مستند فترة تأسيس قائم لم يُرحّل: يسقط شرط
 * رابط الإيصال (والمورد)، ويصير غير ضريبي بلا ضريبة مدخلات، ودفعه هادي من
 * حسابه الجاري (2300)، بسبب مكتوب وباسم من أقرّ ووقته (يختمهما الخادم). يُحفظ
 * عبر صندوق العمل المالي (معاينة ثم حفظ بضوابطه) ويعود بانتظار الاعتماد
 * والترحيل العاديين. لا يُحذف المستند ولا يُنشأ غيره.
 */
async function attestDocument(db, auth, r, workbench) {
  const detail = await workbench(db, auth, { action: 'read', kind: r.kind, sourceId: r.sourceId });
  if (detail.sourceHash !== r.sourceHash) fail('تغيّر المستند بعد عرضه؛ أعد القراءة.');
  if (detail.founding?.attestation) fail('المستند مسجّل بإقرار المدير.', 'already-exists');
  if (detail.protectedSource) fail('المستند مرحّل أو له قفل؛ لا يتغيّر.');
  if (!detail.founding?.attestable) fail('إقرار المدير لمستندات فترة التأسيس غير المرحّلة فقط، وغير المربوطة بسطر كشف حساب.');
  const row = detail.row, meta = row.finance_metadata || {}, spec = FINANCE_KINDS[r.kind], name = await actorName(db, auth);
  const docDay = documentDay(row[spec.date]), cutoff = detail.founding.cutoffDate;
  const paidDay = documentDay(row.paid_date), reason = r.reason.trim();
  const managerAttestation = { by: auth.uid, byName: name, atIso: new Date().toISOString(), approxDate: docDay, note: reason };
  const patch = { isTaxInvoice: false, vatDeductible: false, vatAmount: null, vatRate: null, priceMode: 'inclusive',
    fundingType: 'owner_current', paymentMethod: 'founding_personal', paymentStatus: 'paid', paidDate: paidDay && paidDay < cutoff ? paidDay : docDay,
    fundingPartnerId: null, custodian: null, fundingReference: `إقرار المدير — ${name}`,
    purpose: typeof meta.purpose === 'string' && meta.purpose.trim() ? meta.purpose : 'مصروف تأسيس بإقرار المدير',
    evidenceRefs: [...new Set([...(Array.isArray(meta.evidenceRefs) ? meta.evidenceRefs : []), 'founding:attestation'])].slice(-20), managerAttestation };
  const why = `بلا إيصال، بإقرار المدير: ${reason}`;
  const preview = await workbench(db, auth, { action: 'preview', kind: r.kind, sourceId: r.sourceId, sourceHash: r.sourceHash, patch });
  const saved = await workbench(db, auth, { action: 'save', kind: r.kind, sourceId: r.sourceId, sourceHash: r.sourceHash, patch,
    previewHash: preview.previewHash, reason: why, confirm: true });
  return { saved: true, kind: r.kind, sourceId: r.sourceId, sourceHash: saved.sourceHash, auditId: saved.auditId || null };
}

/** إقرار المدير على رصيد 2300 حسب المستندات، بملاحظة، باسمه ووقته — بلا قيد. */
async function attestBalance(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx), b = plan.hadiBalance;
    if (b.hash !== r.hash) fail('تغيّر الرصيد بعد عرضه؛ أعد القراءة واعتمد من جديد.');
    const hadiAttestation = { paid: b.paid, received: b.received, toCompany: b.toCompany, toHadi: b.toHadi, net: b.net, undecided: b.undecided,
      note: r.note, by: auth.uid, byName: name, atIso: new Date().toISOString(), cutoffDate: plan.settings.cutoffDate, hash: b.hash };
    writeReview(db, tx, input.review, plan, { hadiAttestation }, auth, name);
    audit(db, tx, auth, 'founding-attest-balance', SETTINGS_ID, hadiAttestation);
    return { saved: true, attestation: hadiAttestation };
  });
}

/** تسوية على 3200 يكتب هادي سببها: تُحفظ مقترحة، ولا تُرحّل إلا بموافقته من قسم القيود. */
async function proposeAdjustment(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.adjustments || [];
    if (list.length >= 50) fail('تسويات كثيرة؛ رحّل أو احذف بعضها أولًا.');
    const at = new Date().toISOString();
    const adjustment = { id: `adj_${financeHash({ uid: auth.uid, at, amount: r.amount, direction: r.direction, reason: r.reason }).slice(0, 16)}`,
      amount: r.amount, direction: r.direction, reason: r.reason, by: auth.uid, byName: name, atIso: at };
    writeReview(db, tx, input.review, plan, { adjustments: [...list, adjustment] }, auth, name);
    audit(db, tx, auth, 'founding-adjustment', adjustment.id, adjustment);
    return { saved: true, adjustment };
  });
}

async function removeAdjustment(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.adjustments || [], entry = plan.entries.find(e => e.key === `adjustment:${r.id}`);
    if (!list.some(a => a.id === r.id)) fail('التسوية غير موجودة.', 'not-found');
    if (entry?.status === 'posted') fail('التسوية مرحّلة؛ تصحيحها بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { adjustments: list.filter(a => a.id !== r.id) }, auth, name);
    audit(db, tx, auth, 'founding-adjustment-removed', r.id, { removed: list.find(a => a.id === r.id) });
    return { saved: true };
  });
}

/** تحويل هادي لحساب الشركة بلا كشف: يُحفظ قيدًا مقترحًا (مدين 1020 / دائن 2300) بسبب مكتوب. */
async function proposeTransfer(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.manualTransfers || [];
    if (list.length >= 100) fail('تحويلات كثيرة؛ رحّل أو احذف بعضها أولًا.');
    const at = new Date().toISOString();
    const transfer = { id: `tr_${financeHash({ uid: auth.uid, at, date: r.date, amount: r.amount, description: r.description }).slice(0, 16)}`,
      date: r.date, amount: r.amount, description: r.description, reason: r.reason, by: auth.uid, byName: name, atIso: at };
    writeReview(db, tx, input.review, plan, { manualTransfers: [...list, transfer] }, auth, name);
    audit(db, tx, auth, 'founding-transfer', transfer.id, transfer);
    return { saved: true, transfer };
  });
}

async function removeTransfer(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.manualTransfers || [];
    if (!list.some(x => x.id === r.id)) fail('التحويل غير موجود.', 'not-found');
    if (plan.entries.find(e => e.key === `manual_transfer:${r.id}`)?.status === 'posted') fail('التحويل مرحّل؛ تصحيحه بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { manualTransfers: list.filter(x => x.id !== r.id) }, auth, name);
    audit(db, tx, auth, 'founding-transfer-removed', r.id, { removed: list.find(x => x.id === r.id) });
    return { saved: true };
  });
}

/** سندات قبض وصلت لحساب هادي بلا قيد: تُحفظ قيودًا مقترحة بسبب مكتوب، وتُرحّل بالموافقة. */
async function proposeReceipts(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const open = new Map(plan.receipts.map(x => [x.key, x]));
    if (r.keys.some(k => !open.has(k))) fail('القائمة تغيرت؛ أعد القراءة قبل الحفظ.');
    const at = new Date().toISOString(), added = r.keys.map(k => ({ id: open.get(k).id, reason: r.reason, by: auth.uid, byName: name, atIso: at }));
    writeReview(db, tx, input.review, plan, { receiptProposals: [...(plan.settings.receiptProposals || []), ...added] }, auth, name);
    audit(db, tx, auth, 'founding-receipts', 'receipts', { keys: r.keys, reason: r.reason,
      total: r.keys.reduce((n, k) => n + halala(open.get(k).amount), 0) / 100 });
    return { saved: true, count: added.length };
  });
}

async function removeReceipt(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const payment = input.payments.find(p => p.key === r.key), list = plan.settings.receiptProposals || [];
    if (!payment || !list.some(x => x.id === payment.id)) fail('القيد المقترح غير موجود.', 'not-found');
    if (plan.entries.find(e => e.key === `receipt:${r.key}`)?.status === 'posted') fail('السند مرحّل؛ تصحيحه بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { receiptProposals: list.filter(x => x.id !== payment.id) }, auth, name);
    audit(db, tx, auth, 'founding-receipt-removed', r.key, { removed: list.find(x => x.id === payment.id) });
    return { saved: true };
  });
}

/**
 * «إلغاء مستند مكرر»: مستند مرحّل يكرر مستندًا أصليًا. يُحفظ اقتراحًا بسبب مكتوب، وقيده يعكس كل أثره
 * السارية (قيوده، و«تصحيح جهة دفع»، وحصته من تصحيحات الصندوق والبنك) ولا يُرحّل إلا بموافقة هادي.
 * لا يعدّل أي قيد أصلي. بعد ترحيله يصير المستند «ملغى — مكرر» ويخرج من الملخص ومن 2300 حسب المستندات.
 */
async function proposeDuplicate(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.duplicateCancellations || [];
    if (list.length >= 100) fail('مستندات مكررة كثيرة؛ رحّل أو احذف بعضها أولًا.');
    if (r.key === r.originalKey) fail('المستند لا يكرر نفسه؛ اختر الأصلي.', 'invalid-argument');
    const doc = input.docs.find(d => d.key === r.key), original = input.docs.find(d => d.key === r.originalKey);
    if (!doc || !original) fail('المستند أو الأصلي غير موجود.', 'not-found');
    if (list.some(p => p.key === r.key)) fail('هذا المستند مقترح إلغاؤه مكررًا أصلًا.');
    if (list.some(p => p.key === r.originalKey)) fail('الأصلي نفسه مقترح إلغاؤه مكررًا؛ اختر مستندًا باقيًا.');
    const [kind, ...rest] = r.key.split(':');
    const legacy = new Map();
    for (const l of t.journal_lines) legacy.set(String(l.entryId), [...(legacy.get(String(l.entryId)) || []), l]);
    const effects = documentLiveEffects(t.journal_entries, kind, rest.join(':'), legacy);
    if (!effects.some(x => x.role === 'own')) fail('المستند غير مرحّل بقيد سارٍ؛ المكرر غير المرحّل يُعالج من صندوق العمل المالي.');
    if (effects.some(x => x.custody)) fail('قيد المستند سوّى عهدة موظف؛ اعكسه من دفتر القيود لتعود العهدة مفتوحة.');
    const at = new Date().toISOString();
    const proposal = { id: `dup_${financeHash({ uid: auth.uid, at, key: r.key, originalKey: r.originalKey }).slice(0, 16)}`, key: r.key, originalKey: r.originalKey,
      title: doc.title, originalTitle: original.title, reason: r.reason, by: auth.uid, byName: name, atIso: at };
    writeReview(db, tx, input.review, plan, { duplicateCancellations: [...list, proposal] }, auth, name);
    audit(db, tx, auth, 'founding-duplicate', r.key, proposal);
    return { saved: true, proposal };
  });
}

async function removeDuplicate(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.duplicateCancellations || [], proposal = list.find(p => p.id === r.id);
    if (!proposal) fail('الاقتراح غير موجود.', 'not-found');
    if (input.posted.has(`duplicate:${proposal.key}`)) fail('الإلغاء مرحّل؛ تصحيحه بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { duplicateCancellations: list.filter(p => p.id !== r.id) }, auth, name);
    audit(db, tx, auth, 'founding-duplicate-removed', proposal.key, { removed: proposal });
    return { saved: true };
  });
}

/**
 * «تسوية مصروف مؤقت»: بند مؤقت مرحّل على 1300 يُحمّل على حساب مصروف يختاره هادي — مدين المصروف، دائن 1300،
 * بتاريخ آخر يوم في فترة التأسيس لو البند قبل القطع. يُحفظ اقتراحًا بسبب مكتوب ولا يُرحّل إلا بموافقته.
 */
async function proposeCustodySettlement(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.custodySettlements || [];
    if (list.length >= 200) fail('تسويات كثيرة؛ رحّل أو احذف بعضها أولًا.');
    const advance = input.advances.find(a => a.id === r.advanceId);
    if (!advance) fail('البند غير مرحّل على 1300 بقيد سارٍ.', 'not-found');
    if (advance.outstanding <= 0) fail('البند مسوّى أو مسترد كله؛ لا باقي عليه.');
    if (list.some(p => p.advanceId === r.advanceId)) fail('هذا البند مقترحة تسويته أصلًا.');
    const account = t.chart_of_accounts.find(a => a.id === r.accountId);
    if (!account || account.accountType !== 'expense' || account.active === false) fail('اختر حساب مصروف فعّالًا من الدليل.', 'invalid-argument');
    const at = new Date().toISOString();
    const proposal = { id: `cs_${financeHash({ uid: auth.uid, at, advanceId: r.advanceId, accountId: r.accountId }).slice(0, 16)}`, advanceId: r.advanceId,
      accountId: r.accountId, title: advance.title, holder: advance.holder, reason: r.reason, by: auth.uid, byName: name, atIso: at };
    writeReview(db, tx, input.review, plan, { custodySettlements: [...list, proposal] }, auth, name);
    audit(db, tx, auth, 'founding-custody-settlement', r.advanceId, proposal);
    return { saved: true, proposal };
  });
}

async function removeCustodySettlement(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.custodySettlements || [], proposal = list.find(p => p.id === r.id);
    if (!proposal) fail('الاقتراح غير موجود.', 'not-found');
    if (input.posted.has(`custody_settlement:${proposal.advanceId}`)) fail('التسوية مرحّلة؛ تصحيحها بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { custodySettlements: list.filter(p => p.id !== r.id) }, auth, name);
    audit(db, tx, auth, 'founding-custody-settlement-removed', proposal.advanceId, { removed: proposal });
    return { saved: true };
  });
}

/**
 * «قيد يدوي بموافقة» من دفتر الأستاذ: أسطر مدين ودائن على أي حساب في الدليل أو حساب فرعي لشريك، بتاريخ
 * وبيان وسبب إلزامي. يُحفظ مقترحًا باسم من أنشأه، ولا يُرحّل إلا بموافقة من «قيود التصحيح والتسوية».
 * غير المتوازن مرفوض، و3200 لا يُستخدم بلا سبب مكتوب له، ولا تاريخ في فترة مقفلة.
 */
async function proposeManualEntry(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.manualEntries || [];
    if (list.length >= 200) fail('قيود يدوية مقترحة كثيرة؛ رحّل أو احذف بعضها أولًا.');
    const problems = manualEntryProblems(r, { accounts: input.chart, partners: input.partners, closedMonths: input.closedMonths });
    if (problems.length) fail(problems.join(' '), 'invalid-argument');
    const at = new Date().toISOString(), touches3200 = r.lines.some(l => l.accountId === SETTLEMENTS_ACCOUNT);
    const entry = { id: `me_${financeHash({ uid: auth.uid, at, date: r.date, lines: r.lines, reason: r.reason }).slice(0, 16)}`, date: r.date,
      description: r.description, reason: r.reason, settlementReason: touches3200 ? r.settlementReason : null,
      lines: r.lines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description || '' })),
      by: auth.uid, byName: name, atIso: at };
    writeReview(db, tx, input.review, plan, { manualEntries: [...list, entry] }, auth, name);
    audit(db, tx, auth, 'founding-manual-entry', entry.id, entry);
    return { saved: true, entry };
  });
}

async function removeManualEntry(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = planOf(t), name = await actorName(db, auth, tx);
    const list = plan.settings.manualEntries || [], entry = list.find(m => m.id === r.id);
    if (!entry) fail('القيد المقترح غير موجود.', 'not-found');
    if (input.posted.has(`manual:${r.id}`)) fail('القيد مرحّل؛ تصحيحه بقيد عكسي.');
    writeReview(db, tx, input.review, plan, { manualEntries: list.filter(m => m.id !== r.id) }, auth, name);
    audit(db, tx, auth, 'founding-manual-entry-removed', r.id, { removed: entry });
    return { saved: true };
  });
}

/** The manual entries and their state, for the ledger page — a light read, not the whole settlement. */
async function readManualEntries(db) {
  const [review, partners, periods] = await Promise.all([db.collection('founding_review').doc(SETTINGS_ID).get(), db.collection('partners').get(),
    db.collection('accounting_periods').get()]);
  const list = review.exists && Array.isArray(review.data().manualEntries) ? review.data().manualEntries : [];
  const closed = new Set(periods.docs.filter(p => p.data().status === 'closed').map(p => p.data().periodKey || p.id));
  const journals = await Promise.all(list.map(m => db.collection('journal_entries').doc(foundingEntryId(`manual:${m.id}`)).get()));
  return {
    entries: list.map((m, i) => {
      const j = journals[i].exists && journals[i].data().status === 'posted' ? journals[i].data() : null;
      return { ...m, key: `manual:${m.id}`, status: j ? 'posted' : closed.has(String(m.date).slice(0, 7)) ? 'blocked_period' : 'proposed',
        entryNumber: j?.entryNumber ?? null, approvedByName: j?.foundingEntry?.approvedByName || null, approvalReason: j?.foundingEntry?.reason || null };
    }).sort((a, b) => String(b.atIso).localeCompare(String(a.atIso))),
    partners: partners.docs.map(p => ({ id: p.id, name: p.data().partner_name || 'شريك' })),
    closedMonths: [...closed].sort(),
  };
}

async function ensureAccounts(db, auth) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const chart = new Set((await tx.get(db.collection('chart_of_accounts'))).docs.map(d => d.id));
    const created = ensureChartRows(db, tx, chart, [ACC.HADI_CURRENT, ACC.FOUNDING_SETTLEMENTS]);
    if (created.length) audit(db, tx, auth, 'founding-accounts', created.join(','), { created });
    return { created };
  });
}

// ── تحديث مستند عبر صندوق العمل المالي (نفس المعاينة والضوابط) ─────────
async function workbenchSave(workbench, db, auth, kind, sourceId, patch, reason) {
  const read = await workbench(db, auth, { action: 'read', kind, sourceId });
  const preview = await workbench(db, auth, { action: 'preview', kind, sourceId, patch, sourceHash: read.sourceHash });
  return workbench(db, auth, { action: 'save', kind, sourceId, patch, sourceHash: read.sourceHash, previewHash: preview.previewHash, reason, confirm: true });
}
function fundingPatch(row, { fundingType, paymentMethod, paidDate, reference, evidence, statementLineRef, fundingPartnerId, custodian }) {
  const meta = row.finance_metadata || {};
  const refs = [...new Set([...(Array.isArray(meta.evidenceRefs) ? meta.evidenceRefs : []), ...(evidence ? [evidence] : [])])].slice(0, 20);
  return { fundingType, paymentMethod, paymentStatus: 'paid', paidDate: row.paid_date && isRealDate(row.paid_date) ? row.paid_date : paidDate,
    fundingReference: reference, evidenceRefs: refs, ...(statementLineRef ? { statementLineRef } : {}),
    fundingPartnerId: fundingPartnerId || null, custodian: custodian || null };
}

const UPDATE_REFERENCE = { rule: 'قاعدة فترة التأسيس', decision: 'قرار تسوية التأسيس', statement: 'كشف الحساب' };
async function applyOneUpdate(db, auth, t, plan, input, key, workbench) {
  const update = plan.updates.find(u => u.key === key);
  if (!update) fail('لا يوجد تحديث مقترح لهذا المصدر الآن.');
  if (update.held) fail('المستند يمس إقرارًا مقدّمًا؛ علّمه «راجعته» أولًا.');
  if (update.blocked) fail('تاريخ المستند في فترة مقفلة؛ لا يتعدل إلا بفتحها.');
  if (update.type === 'document') {
    const spec = FINANCE_KINDS[update.kind], row = t[spec.collection].find(x => x.id === update.sourceId);
    if (update.patch.fundingPartnerId && !input.chart.has(`3000-${update.patch.fundingPartnerId}`)) {
      const partner = input.partners.find(p => p.id === update.patch.fundingPartnerId);
      if (!partner) fail('الشريك الذي دفع غير موجود.');
      await db.runTransaction(async tx => {
        const ref = db.collection('chart_of_accounts').doc(`3000-${partner.id}`);
        if (!(await tx.get(ref)).exists) tx.set(ref, { ...partnerCapitalAccount(partner.id, partner.name), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      });
      input.chart.add(`3000-${partner.id}`);
    }
    const reference = `${UPDATE_REFERENCE[update.source] || UPDATE_REFERENCE.decision} (قبل ${plan.settings.cutoffDate})`;
    const patch = fundingPatch(row, { ...update.patch, paidDate: update.patch.paidDate || documentDay(row[spec.date]), reference, evidence: `founding:${update.source}` });
    const saved = await workbenchSave(workbench, db, auth, update.kind, update.sourceId, patch,
      update.source === 'rule' ? 'تطبيق القاعدة الافتراضية لفترة التأسيس' : 'تطبيق قرار هادي في تسوية فترة التأسيس');
    return { saved: true, key, auditId: saved.auditId };
  }
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const ref = db.collection('partner_payments').doc(update.id), snap = await tx.get(ref);
    const lock = await tx.get(db.collection('posting_locks').doc(postingLockId('partner_payment', update.id)));
    const journals = await tx.get(db.collection('journal_entries').where('sourceId', '==', update.id));
    if (!snap.exists || lock.exists || journals.docs.some(d => d.data().sourceType === 'partner_payment')) fail('الدفعة مرحّلة أو غير موجودة؛ التصحيح بقيد.');
    const period = await tx.get(db.collection('accounting_periods').doc(String(snap.data().payment_date).slice(0, 7)));
    if (period.exists && period.data().status === 'closed') fail('فترة الدفعة مقفلة.');
    tx.update(ref, { payment_method: update.patch.paymentMethod });
    audit(db, tx, auth, 'founding-payment-method', update.id, { before: snap.data().payment_method, after: update.patch.paymentMethod });
    return { saved: true, key };
  });
}

async function applyUpdate(db, auth, r, workbench) {
  const t = await loadTables(db), { input, plan } = planOf(t);
  return applyOneUpdate(db, auth, t, plan, input, r.key, workbench);
}

/** A few updates per request (each is a full workbench preview/save), so a long list never outlives the function. */
async function applyUpdates(db, auth, r, workbench) {
  const t = await loadTables(db), { input, plan } = planOf(t), started = Date.now(), results = [];
  for (const key of r.keys) {
    if (Date.now() - started > 40000) { results.push({ key, ok: false, skipped: true }); continue; }
    try { results.push({ ...(await applyOneUpdate(db, auth, t, plan, input, key, workbench)), ok: true }); }
    catch (error) {
      if (!(error instanceof FinanceReviewError) && !error?.code) throw error;
      results.push({ key, ok: false, error: error.message });
    }
  }
  return { results, applied: results.filter(x => x.ok).length };
}

// ── كشوف الحساب ──────────────────────────────────────────────────────────
function options(t) {
  const label = x => x.label || x.item_name || x.expense_name || x.name || x.description || 'بلا اسم';
  return {
    variable: t.variable_expense_categories.map(x => ({ id: x.id, label: label(x) })),
    monthly: t.monthly_expense_categories.map(x => ({ id: x.id, label: label(x) })),
    annual: t.annual_expenses.map(x => ({ id: x.id, label: label(x) })),
    startup: t.startup_costs.map(x => ({ id: x.id, label: label(x) })),
  };
}

async function statementSuggest(db, auth, r) {
  const t = await loadTables(db), { input, plan } = planOf(t);
  const saved = new Map(t.bank_statement_lines.map(l => [l.id, l]));
  const linked = new Set(statementLinks(input.lines).keys());
  const held = new Set(plan.vatTouching.filter(v => !v.reviewed).map(v => v.key));
  const brief = d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date, supplier: d.supplier,
    protected: d.protected, hasProof: d.hasProof, vatHeld: held.has(d.key), days: d.days });
  return {
    account: r.account,
    rows: r.rows.map(row => {
      const id = statementLineId(r.account, row), existing = saved.get(id);
      return { id, existing: existing ? { status: existing.status, decision: existing.decision, linkKind: existing.linkKind, linkId: existing.linkId,
        appliedByName: existing.appliedByName, appliedAtIso: existing.appliedAtIso } : null,
      documents: documentCandidates(row, input.docs, linked).slice(0, 5).map(brief),
      payments: paymentCandidates(row, input.payments, linked).slice(0, 5).map(p => ({ key: p.key, id: p.id, partnerName: p.partnerName, amount: p.amount, date: p.date, protected: p.protected, days: p.days })) };
    }),
    expenseOptions: options(t), windowDays: MATCH_WINDOW_DAYS,
  };
}

async function statementApply(db, auth, r, workbench) {
  const name = await actorName(db, auth);
  const results = [];
  for (const row of r.rows) {
    const id = statementLineId(r.account, row);
    try { results.push({ id, ...(await applyOne(db, auth, r, row, id, name, workbench)) }); }
    catch (error) {
      if (!(error instanceof FinanceReviewError) && !error?.code) throw error;
      await markLine(db, id, { status: 'failed', result: { error: error.message } }).catch(() => {});
      results.push({ id, ok: false, error: error.message });
    }
  }
  return { results, applied: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length };
}

async function markLine(db, id, patch) {
  const ref = db.collection('bank_statement_lines').doc(id);
  if ((await ref.get()).exists) await ref.update(patch);
}

async function applyOne(db, auth, r, row, id, name, workbench) {
  const now = new Date().toISOString();
  const base = { account: r.account, txDate: row.txDate, direction: row.direction, amount: row.amount, balance: row.balance, description: row.description,
    reference: row.reference, occurrence: row.occurrence, fileName: r.fileName, fileHash: r.fileHash, decision: row.decision,
    appliedBy: auth.uid, appliedByName: name, appliedAt: FieldValue.serverTimestamp(), appliedAtIso: now };
  // Reserve the line (and its link) first, in one transaction with the checks.
  const reserved = await db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const ref = db.collection('bank_statement_lines').doc(id), snap = await tx.get(ref);
    if (snap.exists && snap.data().status === 'applied') return { done: true, line: snap.data() };
    const t = await loadTables(db, tx), { input, plan } = planOf(t);
    const links = statementLinks(input.lines.filter(l => l.id !== id));
    let link = { linkKind: null, linkId: null, partnerId: null }, mode = 'recorded', target = null;
    if (row.decision === 'transfer') {
      // From Hadi's statement, or the company's: a deposit there is Hadi funding the company.
    } else if (row.decision === 'document') {
      const doc = input.docs.find(d => d.key === row.linkKey);
      if (row.direction !== 'debit' || !doc) fail('اختر مستندًا لهذا الخصم.', 'invalid-argument');
      if (halala(doc.amount) !== halala(row.amount)) fail('مبلغ المستند لا يطابق الحركة.');
      if (!doc.date || row.txDate < doc.date || daysBetween(doc.date, row.txDate) > MATCH_WINDOW_DAYS) fail('تاريخ الحركة خارج نافذة المستند (من يومه إلى 7 أيام بعده).');
      if (links.has(doc.key)) fail('المستند مربوط بسطر كشف آخر.');
      const held = plan.vatTouching.some(v => v.key === doc.key && !v.reviewed);
      if (!doc.protected && held) fail('المستند يمس إقرارًا مقدّمًا؛ راجعه أولًا في تسوية فترة التأسيس.');
      link = { linkKind: doc.kind, linkId: doc.sourceId, partnerId: null };
      mode = doc.protected ? 'linked_posted' : 'document_updated';
      target = doc;
    } else if (row.decision === 'partner_payment') {
      const payment = input.payments.find(p => p.key === row.linkKey);
      if (row.direction !== 'credit' || !payment) fail('اختر دفعة شريك لهذا الإيداع.', 'invalid-argument');
      if (halala(payment.amount) !== halala(row.amount) || Math.abs(daysBetween(payment.date, row.txDate)) > MATCH_WINDOW_DAYS) fail('الدفعة لا تطابق مبلغ الحركة وتاريخها القريب.');
      if (links.has(payment.key)) fail('الدفعة مربوطة بسطر كشف آخر.');
      link = { linkKind: 'partner_payment', linkId: payment.id, partnerId: payment.partnerId };
      mode = payment.protected ? 'linked_posted' : 'payment_updated';
      target = payment;
    } else {
      if (row.direction !== 'debit' || !row.expense) fail('مصروف من الكشف يحتاج خصمًا ونوعًا وتصنيفًا.', 'invalid-argument');
      const spec = FINANCE_KINDS[row.expense.kind], parents = row.expense.kind === 'annual' ? t.annual_expenses : row.expense.kind === 'startup' ? t.startup_costs : t[spec.category];
      if (!parents.some(x => x.id === row.expense.classificationId)) fail('التصنيف غير موجود.', 'not-found');
      const sourceId = `finance_${financeHash({ uid: auth.uid, kind: row.expense.kind, requestId: id }).slice(0, 40)}`;
      link = { linkKind: row.expense.kind, linkId: sourceId, partnerId: null };
      mode = 'expense_created';
    }
    if (r.account === 'personal') ensureChartRows(db, tx, input.chart, [ACC.HADI_CURRENT, ACC.FOUNDING_SETTLEMENTS]);
    const status = ['document_updated', 'payment_updated', 'expense_created'].includes(mode) ? 'applying' : 'applied';
    tx.set(ref, { ...base, ...link, status, result: { mode } });
    tx.create(db.collection('audit_logs').doc(), { action: 'statement-apply', collectionName: 'bank_statement_lines', documentId: id, userId: auth.uid,
      after: { ...base, appliedAt: now, ...link, mode }, at: FieldValue.serverTimestamp() });
    return { done: false, mode, link, target, status };
  });
  if (reserved.done) return { ok: true, mode: 'already_applied', linkKind: reserved.line.linkKind, linkId: reserved.line.linkId };
  const { mode, link, target } = reserved;
  if (reserved.status === 'applied') return { ok: true, mode, ...link };
  const personal = r.account === 'personal';
  const funding = personal ? { fundingType: 'owner_current', paymentMethod: 'owner_current' } : { fundingType: 'company_bank', paymentMethod: 'transfer' };
  const reference = `statement:${id}`;
  const reason = `تطبيق ${personal ? 'كشف هادي الشخصي' : 'كشف حساب الشركة'} — ${row.txDate} — ${row.amount}`;
  let saved;
  if (mode === 'document_updated') {
    const spec = FINANCE_KINDS[target.kind], snap = await db.collection(spec.collection).doc(target.sourceId).get();
    const patch = fundingPatch(snap.data(), { ...funding, paidDate: row.txDate, reference, evidence: reference, statementLineRef: target.hasProof ? null : id });
    saved = await workbenchSave(workbench, db, auth, target.kind, target.sourceId, patch, reason);
  } else if (mode === 'payment_updated') {
    const method = personal ? 'owner_current' : 'bank_transfer';
    saved = await db.runTransaction(async tx => {
      const ref = db.collection('partner_payments').doc(target.id), snap = await tx.get(ref);
      const lock = await tx.get(db.collection('posting_locks').doc(postingLockId('partner_payment', target.id)));
      if (!snap.exists || lock.exists) fail('الدفعة رُحّلت أثناء التطبيق؛ أعد المحاولة.');
      const period = await tx.get(db.collection('accounting_periods').doc(String(snap.data().payment_date).slice(0, 7)));
      if (period.exists && period.data().status === 'closed') fail('فترة الدفعة مقفلة.');
      tx.update(ref, { payment_method: method, statementLineId: id });
      return { auditId: null };
    });
  } else {
    const kind = row.expense.kind, classification = ['annual', 'startup'].includes(kind) ? { parentId: row.expense.classificationId } : { categoryId: row.expense.classificationId };
    const patch = { description: row.expense.description, amount: row.amount, date: row.txDate, quantity: 1, ...classification,
      supplier: row.expense.supplier || null, invoiceNumber: null, invoiceDate: null, invoiceUrl: null, isTaxInvoice: false, vatDeductible: false,
      vatAmount: null, vatRate: null, priceMode: 'inclusive', ...funding, paymentStatus: 'paid', paidDate: row.txDate,
      fundingReference: reference, purpose: 'مصروف من كشف الحساب', evidenceRefs: [reference], statementLineRef: id };
    // A retry after the record was created reuses it rather than capturing twice.
    if ((await db.collection(FINANCE_KINDS[kind].collection).doc(link.linkId).get()).exists) saved = { sourceId: link.linkId, auditId: null };
    else {
      const preview = await workbench(db, auth, { action: 'previewCapture', kind, requestId: id, patch });
      saved = await workbench(db, auth, { action: 'capture', kind, requestId: id, patch, previewHash: preview.previewHash, reason, confirm: true });
    }
    if (saved.sourceId !== link.linkId) fail('معرّف المصروف الجديد لا يطابق المحجوز.');
  }
  await markLine(db, id, { status: 'applied', result: { mode, auditId: saved?.auditId || null } });
  return { ok: true, mode, ...link, auditId: saved?.auditId || null };
}

// ── المدخل ───────────────────────────────────────────────────────────────
export async function foundingSettlement(db, auth, input, { workbench }) {
  await adminOnly(db, auth);
  const parsed = requestSchema.safeParse(input?.request);
  if (!parsed.success) fail(parsed.error.issues.map(i => i.message).join(' '), 'invalid-argument');
  const r = parsed.data;
  if (r.action === 'read') {
    const t = await loadTables(db), { input: data, plan } = planOf(t);
    return { plan, partners: data.partners, review: data.review, filedQuarters: FILED_VAT_QUARTERS,
      accounts: { hadi: data.chart.has(ACC.HADI_CURRENT), settlements: data.chart.has(ACC.FOUNDING_SETTLEMENTS) },
      custodyHint: data.custodyHint / 100, statementLines: data.lines, readAt: new Date().toISOString(), expenseOptions: options(t),
      closedMonths: [...data.closedMonths].sort(),
      expenseAccounts: t.chart_of_accounts.filter(a => a.accountType === 'expense' && a.active !== false)
        .map(a => ({ code: a.id, name: a.nameArabic || a.id })).sort((a, b) => a.code.localeCompare(b.code)),
      accountNames: Object.fromEntries([...DEFAULT_CHART_OF_ACCOUNTS.map(x => [x.code, x.nameArabic]), ...t.chart_of_accounts.map(x => [x.id, x.nameArabic || x.id])]) };
  }
  if (r.action === 'saveSettings') return saveSettings(db, auth, r);
  if (r.action === 'decide') return decide(db, auth, r);
  if (r.action === 'acceptSmall') return acceptSmall(db, auth, r);
  if (r.action === 'ensureAccounts') return ensureAccounts(db, auth);
  if (r.action === 'postEntries') return postEntries(db, auth, r);
  if (r.action === 'applyUpdate') return applyUpdate(db, auth, r, workbench);
  if (r.action === 'applyUpdates') return applyUpdates(db, auth, r, workbench);
  if (r.action === 'applyRule') return applyRule(db, auth, r);
  if (r.action === 'decidePayments') return decidePayments(db, auth, r);
  if (r.action === 'attestExpense') return attestExpense(db, auth, r, workbench);
  if (r.action === 'attestBalance') return attestBalance(db, auth, r);
  if (r.action === 'attestDocument') return attestDocument(db, auth, r, workbench);
  if (r.action === 'proposeAdjustment') return proposeAdjustment(db, auth, r);
  if (r.action === 'removeAdjustment') return removeAdjustment(db, auth, r);
  if (r.action === 'proposeTransfer') return proposeTransfer(db, auth, r);
  if (r.action === 'removeTransfer') return removeTransfer(db, auth, r);
  if (r.action === 'proposeReceipts') return proposeReceipts(db, auth, r);
  if (r.action === 'removeReceipt') return removeReceipt(db, auth, r);
  if (r.action === 'proposeDuplicate') return proposeDuplicate(db, auth, r);
  if (r.action === 'removeDuplicate') return removeDuplicate(db, auth, r);
  if (r.action === 'proposeCustodySettlement') return proposeCustodySettlement(db, auth, r);
  if (r.action === 'removeCustodySettlement') return removeCustodySettlement(db, auth, r);
  if (r.action === 'proposeManualEntry') return proposeManualEntry(db, auth, r);
  if (r.action === 'removeManualEntry') return removeManualEntry(db, auth, r);
  if (r.action === 'manualEntries') return readManualEntries(db);
  if (r.action === 'statementSuggest') return statementSuggest(db, auth, r);
  return statementApply(db, auth, r, workbench);
}
