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
import { FINANCE_KINDS, financeHash, financeSourceHash, financeProblems, FinanceReviewError, statementLineRefOf } from '../functions/src/financeReview.js';
import { financeSourceEvidence } from '../functions/src/financeSourceEvidence.js';
import { verifyEmployeeAdvanceLink } from '../functions/src/financeEmployeeAdvance.js';
import { historicalSettlementProof } from './custodyHistoricalProof.js';
import { normalizeEntry, normalizeLines, validateEntry, journalCounterUpdate, isRealDate, postingLockId } from '../functions/src/invariants.js';
import { legacyLockIdFor } from '../functions/src/posting.js';
import { postedLines } from '../src/lib/accounting/reports.js';
import { DEFAULT_CHART_OF_ACCOUNTS, ACC, partnerCapitalAccount } from '../src/lib/accounting/chartOfAccounts.js';
import { documentDay } from '../src/lib/financeWorkbenchView.js';
import {
  foundingPlan, documentCandidates, paymentCandidates, statementLinks, quarterOf, halala,
  FOUNDING_DEFAULTS, FILED_VAT_QUARTERS, DOC_DECISIONS, PAYMENT_ARRIVALS, SMALL_DECISION, MATCH_WINDOW_DAYS, daysBetween,
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
  z.object({ action: z.literal('saveSettings'), revision: z.number().int().min(0), cutoffDate: day, threshold: money,
    actuals: z.object({ bankOpen: z.boolean(), bankBalance: z.number().finite().min(-1e9).max(1e9).nullable(), cash: z.number().finite().min(-1e9).max(1e9),
      custody: z.array(z.object({ name: text(80).pipe(z.string().min(1)), amount: money }).strict()).max(50) }).strict().nullable(), ...confirm }).strict(),
  z.object({ action: z.literal('decide'), sourceKey: key, decision: z.string().max(40).nullable().optional(), partnerId: z.string().max(160).nullable().default(null),
    vatReviewed: z.boolean().optional(), note: text(500).nullable().default(null), ...confirm }).strict(),
  z.object({ action: z.literal('acceptSmall'), keys: z.array(key).min(1).max(500), ...confirm }).strict(),
  z.object({ action: z.literal('ensureAccounts'), ...confirm }).strict(),
  z.object({ action: z.literal('postEntries'), entries: z.array(z.object({ key, hash }).strict()).min(1).max(300),
    reason: text(1000).pipe(z.string().min(3)), ...confirm }).strict(),
  z.object({ action: z.literal('applyUpdate'), key, ...confirm }).strict(),
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
const entryHash = (e, stateHash) => financeHash({ key: e.key, date: e.date, description: e.description,
  lines: e.lines, stateHash });

// ── القراءة ──────────────────────────────────────────────────────────────
const COLLECTIONS = [...new Set([...Object.values(FINANCE_KINDS).map(s => s.collection), 'partner_payments', 'partners', 'journal_entries',
  'journal_lines', 'posting_locks', 'finance_workbench_receipts', 'bank_statement_lines', 'founding_review', 'founding_decisions', 'chart_of_accounts',
  'accounting_periods', 'temporary_expenses', 'variable_expense_categories', 'monthly_expense_categories', 'annual_expenses', 'startup_costs'])];

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
    if (!effects.has(k)) effects.set(k, { cash: 0, bank: 0, vat: 0, vatDate: null, journals: 0 });
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

/** Current-dated custody corrections whose delivery and spending preceded the
 * founding cutoff are a timing bridge, not another 3200 journal. An incomplete
 * or unverified group blocks the founding settlement rather than opening a
 * guessed balance. All figures are integer halala. */
export function custodyCutoffBridge(t, cutoff) {
  const amounts = { [ACC.BANK]: 0, [ACC.CASH]: 0, [ACC.EMPLOYEE_ADVANCE]: 0 };
  const groups = [], issues = [];
  const entries = t.journal_entries || [], byId = new Map(entries.map(e => [e.id, e]));
  const receipts = new Map((t.finance_workbench_receipts || []).map(r => [r.id, r]));
  const locks = new Map((t.posting_locks || []).map(l => [l.id, l]));
  for (const funding of entries) {
    if (funding.sourceKind !== 'custody_reconciliation' || funding.custodyAnchorMode !== 'independent_historical_tranche'
      || funding.status !== 'posted' || funding.entryDate <= cutoff) continue;
    const groupId = funding.custodyHistoricalSettlementId;
    const receipt = receipts.get(`custody_h_${String(groupId || '').slice(0, 40)}`);
    const result = receipt?.result, members = result?.journalIds?.map(id => byId.get(id)) || [];
    const evidence = result?.fundingEvidence, sourceHashes = receipt?.sourceHashes;
    const funded = (funding.lines || []).filter(l => String(l.accountId) === ACC.BANK)
      .reduce((n, l) => n + halala(l.credit) - halala(l.debit), 0);
    const advanceDebit = (funding.lines || []).filter(l => String(l.accountId) === ACC.EMPLOYEE_ADVANCE)
      .reduce((n, l) => n + halala(l.debit) - halala(l.credit), 0);
    const spent = members.slice(1).reduce((n, e) => n + (e?.lines || [])
      .filter(l => String(l.accountId) === ACC.EMPLOYEE_ADVANCE)
      .reduce((m, l) => m + halala(l.credit) - halala(l.debit), 0), 0);
    const valid = /^[a-f0-9]{64}$/.test(groupId || '') && result?.groupId === groupId
      && result?.fundingJournalId === funding.id && result?.anchorMode === 'independent_historical_tranche'
      && result?.sourceCount > 0 && members.length === result.sourceCount + 1 && members[0]?.id === funding.id
      && members.every(e => e?.status === 'posted' && e.custodyHistoricalSettlementId === groupId)
      && locks.has(`custody_reconciliation__${groupId}`)
      && Array.isArray(sourceHashes) && sourceHashes.length === result.sourceCount
      && sourceHashes.every(item => {
        const [kind, ...idParts] = item.key.split(':'), sourceId = idParts.join(':');
        const source = (t[FINANCE_KINDS[kind]?.collection] || []).find(row => row.id === sourceId);
        const lock = locks.get(`${kind}__${sourceId}`), journal = byId.get(lock?.entryId);
        return source && financeSourceHash(source) === item.after
          && source.finance_metadata?.custodyHistoricalSettlementId === groupId
          && lock?.custodyHistoricalSettlementId === groupId
          && journal?.status === 'posted' && journal.custodyHistoricalSettlementId === groupId
          && journal.sourceKind === kind && journal.sourceId === sourceId
          && journal.sourceSnapshotHash === item.before;
      })
      && Array.isArray(evidence) && evidence.length > 0
      && evidence.every(d => isRealDate(d.deliveryDate) && Number.isSafeInteger(halala(d.allocatedAmount)) && d.allocatedAmount > 0)
      && evidence.every(d => {
        const lock = locks.get(`custody_deposit__${financeHash(d.depositRowId).slice(0, 40)}`);
        return lock?.depositRowId === d.depositRowId && lock.evidenceRef === d.evidenceRef
          && lock.deliveryDate === d.deliveryDate && lock.depositAmountHalala === halala(d.depositAmount)
          && lock.consumedHalala >= halala(d.allocatedAmount);
      })
      && evidence.reduce((n, d) => n + halala(d.allocatedAmount), 0) === funded
      && funded > 0 && advanceDebit === funded && spent === funded
      && result.fundedHalala === funded && result.consumedHalala === spent
      && members.slice(1).every(e => isRealDate(e.originalPaidDate));
    if (!valid) { issues.push('إيصال تسوية العهدة لا يثبت جسر التوقيت يوم القطع؛ أوقف قيد 3200.'); continue; }
    const delivered = evidence.filter(d => d.deliveryDate <= cutoff).reduce((n, d) => n + halala(d.allocatedAmount), 0);
    const consumed = members.slice(1).filter(e => e.originalPaidDate <= cutoff).reduce((n, e) => n + (e.lines || [])
      .filter(l => String(l.accountId) === ACC.EMPLOYEE_ADVANCE)
      .reduce((m, l) => m + halala(l.credit) - halala(l.debit), 0), 0);
    if (consumed > delivered) { issues.push('استهلاك عهدة يوم القطع يتجاوز التمويل المسلّم قبله؛ أوقف قيد 3200.'); continue; }
    amounts[ACC.BANK] -= delivered;
    amounts[ACC.EMPLOYEE_ADVANCE] += delivered - consumed;
    groups.push({ groupId, fundingJournalId: funding.id, deliveredHalala: delivered,
      consumedHalala: consumed, outstandingHalala: delivered - consumed });
  }
  // Reused legacy funding has no independent bank correction journal to bridge.
  // Until its cutoff movement is reconciled separately, do not let 3200 absorb
  // a historical spend that was posted only on the later correction day.
  for (const receipt of receipts.values()) {
    const result = receipt.result;
    if (result?.anchorMode === 'independent_historical_tranche' || !result?.groupId
      || !Array.isArray(result.journalIds)) continue;
    const members = result.journalIds.map(id => byId.get(id));
    if (members.some(entry => entry?.status === 'posted' && entry.entryDate > cutoff
      && (entry.originalPaidDate <= cutoff || result.historicalFundingDate <= cutoff)))
      issues.push('تسوية عهدة تاريخية قديمة تحتاج مطابقة حركة يوم القطع قبل قيد 3200.');
  }
  return { amounts, groups, issues };
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
  const settings = { ...FOUNDING_DEFAULTS, ...(review ? { cutoffDate: review.cutoffDate, threshold: Number(review.threshold), actuals: review.actuals || null } : {}) };
  const decisions = Object.fromEntries(t.founding_decisions.map(d => [d.sourceKey, d]));
  const partners = t.partners.map(p => ({ id: p.id, name: p.partner_name || 'شريك' }));
  const docs = [];
  for (const [kind, spec] of Object.entries(FINANCE_KINDS)) {
    for (const row of t[spec.collection]) {
      if (isPayrollRow(kind, row)) continue;
      const effect = effects.get(`expense:${row.id}`) || { cash: 0, bank: 0, vat: 0, vatDate: null, journals: 0 };
      const lock = locks.has(postingLockId(kind, row.id)) || locks.has(legacyLockIdFor(kind, row.id));
      const date = documentDay(row[spec.date]) || documentDay(row.invoice_date);
      const unpostedVat = row.is_tax_invoice === true && row.vat_deductible !== false && (Number(row.vat_amount) > 0 || Number(row.vat_rate) > 0);
      const vatDay = effect.journals ? (effect.vat > 0 ? documentDay(effect.vatDate) : null) : unpostedVat ? documentDay(row.invoice_date) || date : null;
      docs.push({ key: `${kind}:${row.id}`, kind, sourceId: row.id, title: row[spec.title] || 'بلا عنوان', amount: Number(row[spec.amount]) || 0,
        date, supplier: row.supplier || '', hasProof: typeof row.invoice_url === 'string' && /^https:\/\//.test(row.invoice_url),
        statementLineRef: statementLineRefOf(row), protected: lock || effect.journals > 0 || Boolean(row.journal_entry_id || row.posted_entry_id || row.posting_status === 'posted'),
        effect: { cash: effect.cash, bank: effect.bank }, fundingType: row.finance_metadata?.fundingType || null,
        custodySettlementId: row.finance_metadata?.custodyHistoricalSettlementId || null,
        paymentMethod: row.payment_method || null, vatQuarter: vatDay ? quarterOf(vatDay) : null,
        issues: financeProblems(kind, row, row.id) });
    }
  }
  const payments = t.partner_payments.map(p => {
    const effect = effects.get(`partner_payment:${p.id}`) || { cash: 0, bank: 0, journals: 0 };
    return { key: `partner_payment:${p.id}`, id: p.id, partnerId: p.partner_id, partnerName: partners.find(x => x.id === p.partner_id)?.name || 'شريك',
      amount: Number(p.amount) || 0, date: documentDay(p.payment_date), method: p.payment_method || null,
      protected: effect.journals > 0 || locks.has(postingLockId('partner_payment', p.id)), effect: { cash: effect.cash, bank: effect.bank } };
  });
  const posted = new Map(entries.filter(e => e.foundingEntry?.key && e.status === 'posted')
    .map(e => [e.foundingEntry.key, { entryId: e.id, entryNumber: e.entryNumber, lines: (e.lines || []).map(l => ({ accountId: String(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || '' })) }]));
  const ledger = postedLines(entries, lines);
  const byId = new Map(entries.map(e => [e.id, e]));
  const book = {};
  for (const account of [ACC.CASH, ACC.BANK, ACC.EMPLOYEE_ADVANCE]) {
    book[account] = ledger.filter(l => String(l.accountId) === account && String(l.entryDate) <= settings.cutoffDate)
      .reduce((n, l) => n + halala(l.debit) - halala(l.credit), 0);
  }
  const hadiLedger = ledger.filter(l => String(l.accountId) === ACC.HADI_CURRENT).map(l => ({ entryId: l.entryId, entryNumber: l.entryNumber,
    date: l.entryDate, description: l.entryDescription || l.description || '', lineDescription: l.description || '',
    debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, sourceType: l.sourceType, sourceKind: byId.get(l.entryId)?.sourceKind || null }));
  const closedMonths = new Set(t.accounting_periods.filter(p => p.status === 'closed').map(p => p.periodKey || p.id));
  const statementLines = t.bank_statement_lines.map(l => ({ id: l.id, account: l.account, txDate: l.txDate, direction: l.direction, amount: Number(l.amount) || 0,
    description: l.description || '', decision: l.decision, linkKind: l.linkKind || null, linkId: l.linkId || null, status: l.status,
    appliedByName: l.appliedByName || null, appliedAtIso: l.appliedAtIso || null }));
  return { docs, payments, lines: statementLines, decisions, settings, book, posted, closedMonths, hadiLedger, partners,
    custodyBridge: custodyCutoffBridge(t, settings.cutoffDate),
    review, chart: new Set(t.chart_of_accounts.map(a => a.id)),
    custodyHint: t.temporary_expenses.filter(x => x.status !== 'recovered' && documentDay(x.spent_date) && documentDay(x.spent_date) <= settings.cutoffDate)
      .reduce((n, x) => n + halala(x.amount) - halala(x.recovered_amount), 0) };
}

async function planOf(db, tx, t) {
  const input = foundingInputs(t);
  const readTx = tx || { get: ref => ref.get() };
  const groupProofs = new Map();
  const receipts = new Map(t.finance_workbench_receipts.map(item => [item.id, item]));
  for (const doc of input.docs.filter(d => d.fundingType === 'employee' || d.custodySettlementId)) {
    const row = t[FINANCE_KINDS[doc.kind].collection].find(source => source.id === doc.sourceId);
    if (!row) continue;
    if (doc.custodySettlementId) {
      const context = await financeSourceEvidence(db, readTx, doc.kind, doc.sourceId, row);
      const receipt = receipts.get(`custody_h_${doc.custodySettlementId.slice(0, 40)}`);
      if (!groupProofs.has(doc.custodySettlementId)) groupProofs.set(doc.custodySettlementId,
        await historicalSettlementProof(db, readTx, doc.kind, doc.sourceId, row, context));
      const proof = groupProofs.get(doc.custodySettlementId);
      const member = receipt?.sourceHashes?.find(item => item.key === doc.key);
      if (proof && !context.issues.length && member?.sourceContextHash === (context.contextHash || null)) {
        doc.custodySettled = true;
        const funding = receipt?.result?.fundingEvidence;
        doc.custodyFundingAfterCutoff = Array.isArray(funding) && funding.length > 0
          && funding.every(item => isRealDate(item.deliveryDate) && item.deliveryDate > input.settings.cutoffDate);
      }
      continue;
    }
    if (!row.finance_metadata?.employeeAdvanceLink) continue;
    const verified = await verifyEmployeeAdvanceLink(db, readTx, doc.kind, doc.sourceId, row,
      Number(row[FINANCE_KINDS[doc.kind].amount]));
    if (!verified.proof || verified.issues.length) continue;
    const funding = t.journal_entries.find(entry => entry.id === verified.proof.fundingJournalId);
    doc.custodyFundingAfterCutoff = Boolean(funding && funding.entryDate > input.settings.cutoffDate);
    const lock = t.posting_locks.find(item => item.id === postingLockId(doc.kind, doc.sourceId));
    const posted = t.journal_entries.find(entry => entry.id === lock?.entryId);
    doc.custodySettled = Boolean(posted?.status === 'posted' && posted.sourceType === 'expense'
      && posted.sourceKind === doc.kind && posted.sourceId === doc.sourceId);
  }
  const plan = foundingPlan(input);
  // Approval binds to the source and ledger snapshot as well as the displayed
  // lines. A later custody correction, statement decision or source edit must
  // require a fresh founding preview even if the rounded entry lines match.
  const stateHash = financeHash(t);
  plan.entries = plan.entries.map(e => ({ ...e, hash: entryHash(e, stateHash) }));
  if (plan.settlement.entry) plan.settlement.entry = plan.entries.find(e => e.key === plan.settlement.entry.key);
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
    const t = await loadTables(db, tx), { input, plan } = await planOf(db, tx, t);
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
    const locks = await Promise.all(selected.map(e => tx.get(db.collection('posting_locks').doc(postingLockId('founding', foundingEntryId(e.key))))));
    if (locks.some(l => l.exists)) fail('أحد القيود مرحّل سابقًا.');
    const results = [], first = next;
    for (const e of selected) {
      if (periods.get(e.date.slice(0, 7))?.status === 'closed') fail(`الفترة ${e.date.slice(0, 7)} مقفلة.`);
      const entryId = foundingEntryId(e.key);
      const entry = { ...normalizeEntry({ entryDate: e.date, sourceType: 'adjustment', sourceId: entryId, description: e.description }), sourceKind: `founding_${e.type}` };
      const lines = normalizeLines(e.lines);
      const problems = validateEntry(entry, lines, { knownAccountCodes: input.chart });
      if (problems.length) fail(problems[0]);
      const total = Math.round(lines.reduce((n, l) => n + halala(l.debit), 0)) / 100;
      const journal = { ...entry, lines, lineCount: lines.length, totalDebit: total, totalCredit: total, entryNumber: next, createdBy: auth.uid,
        foundingEntry: { key: e.key, type: e.type, sourceKey: e.sourceKey, cutoffDate: input.settings.cutoffDate, approvedByName: name, reason: r.reason, hash: e.hash } };
      tx.create(db.collection('journal_entries').doc(entryId), { ...journal, createdAt: FieldValue.serverTimestamp(), postedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('posting_locks').doc(postingLockId('founding', entryId)), { kind: 'founding', sourceType: 'adjustment', sourceId: entryId,
        entryId, entryNumber: next, lockedBy: auth.uid, lockedAt: FieldValue.serverTimestamp() });
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

async function saveSettings(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const ref = db.collection('founding_review').doc(SETTINGS_ID), snap = await tx.get(ref);
    const revision = snap.exists ? Number(snap.data().revision) || 0 : 0;
    if (revision !== r.revision) fail('تغيرت الإعدادات من جلسة أخرى؛ أعد القراءة.');
    const value = { cutoffDate: r.cutoffDate, threshold: r.threshold, actuals: r.actuals, revision: revision + 1, ...stamp(auth.uid, await actorName(db, auth, tx)) };
    tx.set(ref, value);
    audit(db, tx, auth, 'founding-settings', SETTINGS_ID, value);
    return { saved: true, revision: value.revision };
  });
}

async function decide(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { input, plan } = await planOf(db, tx, t);
    const doc = input.docs.find(d => d.key === r.sourceKey), payment = input.payments.find(p => p.key === r.sourceKey);
    if (!doc && !payment) fail('المصدر غير موجود.', 'not-found');
    const allowed = doc ? [...DOC_DECISIONS, SMALL_DECISION] : PAYMENT_ARRIVALS;
    if (r.decision != null && !allowed.includes(r.decision)) fail('القرار غير صالح لهذا المصدر.', 'invalid-argument');
    if (r.decision === 'partner' && !input.partners.some(p => p.id === r.partnerId)) fail('اختر الشريك الذي دفع.', 'invalid-argument');
    if (r.vatReviewed !== undefined && !plan.vatTouching.some(v => v.key === r.sourceKey)) fail('هذا المستند لا يمس إقرارًا مقدّمًا.', 'invalid-argument');
    const ref = db.collection('founding_decisions').doc(financeHash(r.sourceKey).slice(0, 40)), snap = await tx.get(ref);
    const before = snap.exists ? snap.data() : null;
    if (doc && (doc.fundingType === 'employee' || doc.custodySettlementId) && r.decision !== undefined) {
      // An old, unposted founding decision can be cleared explicitly so the
      // custody review can proceed. Never create another payer decision, or
      // erase one after either route has posted a financial effect.
      const postedForSource = t.journal_entries.some(e => e.status === 'posted' && !e.reversedBy
        && (e.foundingEntry?.sourceKey === r.sourceKey
          || (e.custodyHistoricalSettlementId && e.sourceId === doc.sourceId)));
      const sourceLocked = t.posting_locks.some(lock => lock.id === postingLockId(doc.kind, doc.sourceId)
        || lock.id === legacyLockIdFor(doc.kind, doc.sourceId));
      const custodyReceipt = doc.custodySettlementId && t.finance_workbench_receipts.some(receipt =>
        receipt.id === `custody_h_${doc.custodySettlementId.slice(0, 40)}`);
      if (r.decision !== null || before?.decision == null || sourceLocked || custodyReceipt
        || postedForSource || r.vatReviewed !== undefined || r.partnerId != null)
        fail('مستند العهدة يُسوّى من تمويلها ولا يُعاد تصنيف جهة دفعه في التأسيس.');
    }
    // Only what the request names changes: a «راجعته» click keeps the payer decision, and the reverse.
    const decision = r.decision === undefined ? before?.decision ?? null : r.decision;
    const value = { sourceKey: r.sourceKey, decision, partnerId: decision === 'partner' ? (r.decision === undefined ? before?.partnerId ?? null : r.partnerId) : null,
      note: r.note ?? before?.note ?? null, vatReviewed: r.vatReviewed ?? before?.vatReviewed ?? false,
      revision: (Number(before?.revision) || 0) + 1, decidedBy: auth.uid, decidedByName: await actorName(db, auth, tx), decidedAtIso: new Date().toISOString() };
    tx.set(ref, value);
    audit(db, tx, auth, 'founding-decision', r.sourceKey, value);
    return { saved: true, decision: value };
  });
}

async function acceptSmall(db, auth, r) {
  return db.runTransaction(async tx => {
    await adminOnly(db, auth, tx);
    const t = await loadTables(db, tx), { plan } = await planOf(db, tx, t), name = await actorName(db, auth, tx);
    const small = new Map(plan.groups.small.filter(d => !d.custodyScoped && !d.decision?.decision).map(d => [d.key, d]));
    if (r.keys.some(k => !small.has(k))) fail('القائمة تغيرت؛ أعد القراءة قبل القبول.');
    for (const k of r.keys) {
      const value = { sourceKey: k, decision: SMALL_DECISION, partnerId: null, note: null, vatReviewed: false, revision: 1,
        decidedBy: auth.uid, decidedByName: name, decidedAtIso: new Date().toISOString() };
      tx.set(db.collection('founding_decisions').doc(financeHash(k).slice(0, 40)), value);
    }
    audit(db, tx, auth, 'founding-accept-small', 'small', { keys: r.keys, total: r.keys.reduce((n, k) => n + halala(small.get(k).amount), 0) / 100 });
    return { saved: true, count: r.keys.length };
  });
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
function fundingPatch(row, { fundingType, paymentMethod, paidDate, reference, evidence, statementLineRef }) {
  const meta = row.finance_metadata || {};
  const refs = [...new Set([...(Array.isArray(meta.evidenceRefs) ? meta.evidenceRefs : []), ...(evidence ? [evidence] : [])])].slice(0, 20);
  return { fundingType, paymentMethod, paymentStatus: 'paid', paidDate: row.paid_date && isRealDate(row.paid_date) ? row.paid_date : paidDate,
    fundingReference: reference, evidenceRefs: refs, ...(statementLineRef ? { statementLineRef } : {}) };
}

async function applyUpdate(db, auth, r, workbench) {
  const t = await loadTables(db), { plan } = await planOf(db, null, t);
  const update = plan.updates.find(u => u.key === r.key);
  if (!update) fail('لا يوجد تحديث مقترح لهذا المصدر الآن.');
  if (update.held) fail('المستند يمس إقرارًا مقدّمًا؛ علّمه «راجعته» أولًا.');
  if (update.type === 'document') {
    const spec = FINANCE_KINDS[update.kind], row = t[spec.collection].find(x => x.id === update.sourceId);
    const patch = fundingPatch(row, { ...update.patch, paidDate: documentDay(row[spec.date]), reference: row.finance_metadata?.fundingReference || `قرار تسوية التأسيس ${update.key}` });
    const saved = await workbenchSave(workbench, db, auth, update.kind, update.sourceId, patch, 'تطبيق قرار هادي في تسوية فترة التأسيس');
    return { saved: true, key: r.key, auditId: saved.auditId };
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
    return { saved: true, key: r.key };
  });
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
  const t = await loadTables(db), { input, plan } = await planOf(db, null, t);
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
      documents: documentCandidates(row, input.docs.filter(d => d.fundingType !== 'employee' && !d.custodySettlementId), linked).slice(0, 5).map(brief),
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
    const t = await loadTables(db, tx), { input, plan } = await planOf(db, tx, t);
    const links = statementLinks(input.lines.filter(l => l.id !== id));
    let link = { linkKind: null, linkId: null, partnerId: null }, mode = 'recorded', target = null;
    if (row.decision === 'transfer') {
      if (r.account !== 'personal') fail('التحويل بين هادي والشركة يُعلّم من كشف هادي الشخصي.', 'invalid-argument');
    } else if (row.decision === 'document') {
      const doc = input.docs.find(d => d.key === row.linkKey);
      if (row.direction !== 'debit' || !doc) fail('اختر مستندًا لهذا الخصم.', 'invalid-argument');
      if (doc.fundingType === 'employee' || doc.custodySettlementId)
        fail('مستند العهدة يُسوّى من تمويلها ولا يُربط مباشرة بخصم كشف البنك.');
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
    const t = await loadTables(db), { input: data, plan } = await planOf(db, null, t);
    return { plan, partners: data.partners, review: data.review, filedQuarters: FILED_VAT_QUARTERS,
      accounts: { hadi: data.chart.has(ACC.HADI_CURRENT), settlements: data.chart.has(ACC.FOUNDING_SETTLEMENTS) },
      custodyHint: data.custodyHint / 100, statementLines: data.lines, readAt: new Date().toISOString(),
      accountNames: Object.fromEntries([...DEFAULT_CHART_OF_ACCOUNTS.map(x => [x.code, x.nameArabic]), ...t.chart_of_accounts.map(x => [x.id, x.nameArabic || x.id])]) };
  }
  if (r.action === 'saveSettings') return saveSettings(db, auth, r);
  if (r.action === 'decide') return decide(db, auth, r);
  if (r.action === 'acceptSmall') return acceptSmall(db, auth, r);
  if (r.action === 'ensureAccounts') return ensureAccounts(db, auth);
  if (r.action === 'postEntries') return postEntries(db, auth, r);
  if (r.action === 'applyUpdate') return applyUpdate(db, auth, r, workbench);
  if (r.action === 'statementSuggest') return statementSuggest(db, auth, r);
  return statementApply(db, auth, r, workbench);
}
