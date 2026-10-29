// ═══════════════════════════════════════════════════════════════════════════
// حساب هادي الجاري وتسوية فترة التأسيس — حساب خالص بلا قراءة ولا كتابة
// ═══════════════════════════════════════════════════════════════════════════
// في فترة التأسيس كان حساب الشركة البنكي لا يعمل، فصُرفت المصاريف من حساب
// هادي الشخصي ووصلته دفعات الشركاء، بينما سُجّل كثير منها على البنك (1020)
// أو الصندوق (1010). هذا الملف يقرأ ما جمعه الخادم (المستندات، الدفعات،
// سطور الكشوف التي علّمها هادي، قراراته) ويرجع:
//   • المجموعات الأربع قبل تاريخ القطع،
//   • القيود المقترحة (نقل المدفوع/المستلم إلى حساب هادي الجاري 2300)،
//   • قيد تسوية واحد بتاريخ القطع للفرق الباقي على «تسويات فترة التأسيس»،
//   • كشف حساب هادي الجاري ورصيده ومعناه.
// لا شيء هنا يُرحَّل: الخادم يعيد الحساب نفسه ويرحّل فقط ما وافق عليه هادي.
// كل المبالغ الداخلية بالهللة (أعداد صحيحة) حتى لا يتراكم كسر.

export const FOUNDING_DEFAULTS = Object.freeze({ cutoffDate: '2026-09-30', threshold: 500 });
// الربعان اللذان قُدّم إقرارهما (حسب هادي): أي مستند انحسبت ضريبة مدخلاته
// فيهما لا يتغير إلا بعد مراجعته.
export const FILED_VAT_QUARTERS = Object.freeze(['2026-Q2', '2026-Q3']);
export const ACCOUNTS = Object.freeze({ CASH: '1010', BANK: '1020', ADVANCES: '1300', HADI: '2300', SETTLEMENTS: '3200' });
export const DOC_DECISIONS = Object.freeze(['hadi', 'partner', 'cash', 'unknown']);
export const PAYMENT_ARRIVALS = Object.freeze(['hadi', 'company']);
export const SMALL_DECISION = 'manager_attested';
export const MATCH_WINDOW_DAYS = 7;

export const halala = value => Math.round(Number(value || 0) * 100);
const riyal = h => Math.round(h) / 100;
const dayMs = 86400000;
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs);
export const quarterOf = day => /^\d{4}-\d{2}/.test(day || '') ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}` : null;

// ── المطابقة ─────────────────────────────────────────────────────────────
/** خصم: مستند بنفس المبلغ، وتاريخ الحركة من يوم المستند إلى 7 أيام بعده. */
export function documentCandidates(line, docs, linkedKeys = new Set()) {
  if (line.direction !== 'debit') return [];
  const amount = halala(line.amount);
  return docs.filter(d => !linkedKeys.has(d.key) && halala(d.amount) === amount && d.date
    && line.txDate >= d.date && daysBetween(d.date, line.txDate) <= MATCH_WINDOW_DAYS)
    .map(d => ({ ...d, days: daysBetween(d.date, line.txDate) }))
    .sort((a, b) => a.days - b.days || String(a.key).localeCompare(String(b.key)));
}
/** إيداع: دفعة شريك بنفس المبلغ وتاريخ قريب (7 أيام قبل أو بعد). */
export function paymentCandidates(line, payments, linkedKeys = new Set()) {
  if (line.direction !== 'credit') return [];
  const amount = halala(line.amount);
  return payments.filter(p => !linkedKeys.has(p.key) && halala(p.amount) === amount && p.date
    && Math.abs(daysBetween(p.date, line.txDate)) <= MATCH_WINDOW_DAYS)
    .map(p => ({ ...p, days: Math.abs(daysBetween(p.date, line.txDate)) }))
    .sort((a, b) => a.days - b.days || String(a.key).localeCompare(String(b.key)));
}

// ── من دفع؟ ──────────────────────────────────────────────────────────────
const linkKey = line => line.linkKind && line.linkId ? `${line.linkKind}:${line.linkId}` : null;
export function statementLinks(lines) {
  const map = new Map();
  for (const line of lines || []) {
    const key = linkKey(line);
    if (key && ['applied', 'applying'].includes(line.status)) map.set(key, line);
  }
  return map;
}

/** الجهة التي دفعت المستند فعلًا: من الكشف أولًا، ثم من قرار هادي. */
export function payerOf(doc, links, decisions) {
  const line = links.get(doc.key);
  if (line) return { payer: line.account === 'personal' ? 'hadi' : 'company_bank', source: 'statement', line };
  const decision = decisions[doc.key];
  if (decision && [...DOC_DECISIONS, SMALL_DECISION].includes(decision.decision)) {
    return { payer: decision.decision, source: 'decision', partnerId: decision.partnerId || null, decision };
  }
  return { payer: null, source: null };
}

function targetAccount(payer, partnerId) {
  if (payer === 'hadi') return ACCOUNTS.HADI;
  if (payer === 'cash') return ACCOUNTS.CASH;
  if (payer === 'company_bank' || payer === 'company') return ACCOUNTS.BANK;
  if (payer === 'partner') return partnerId ? `3000-${partnerId}` : null;
  return null;
}

/** ما يحتاجه مستند غير مرحّل ليطابق الجهة التي دفعته (يُطبّق عبر صندوق العمل المالي). */
function documentPatchFor(payer) {
  if (payer === 'hadi') return { fundingType: 'owner_current', paymentMethod: 'owner_current' };
  if (payer === 'cash') return { fundingType: 'company_cash', paymentMethod: 'cash' };
  if (payer === 'company_bank') return { fundingType: 'company_bank', paymentMethod: 'transfer' };
  return null;
}

// ── المخطط كله ───────────────────────────────────────────────────────────
/**
 * @param input.docs        مستندات المصاريف: { key, kind, sourceId, title, amount, date, supplier, hasProof,
 *                          protected, effect:{cash,bank} (دائن بالهللة), fundingType, paymentMethod, vatQuarter, issues }
 * @param input.payments    دفعات الشركاء: { key, id, partnerId, partnerName, amount, date, method, protected, effect:{cash,bank} (مدين بالهللة) }
 * @param input.lines       سطور الكشوف المحفوظة (المعلّمة فقط)
 * @param input.decisions   { [sourceKey]: { decision, partnerId, vatReviewed, ... } }
 * @param input.settings    { cutoffDate, threshold, actuals }
 * @param input.book        أرصدة الدفاتر المرحّلة يوم القطع بالهللة (مدين − دائن): { '1010', '1020', '1300' }
 * @param input.posted      Map مفتاح القيد → { entryId, entryNumber } لما رُحّل سابقًا
 * @param input.closedMonths Set أشهر مقفلة 'YYYY-MM'
 * @param input.hadiLedger  أسطر الحساب 2300 المرحّلة
 * @param input.partners    [{ id, name }]
 */
export function foundingPlan(input) {
  const settings = { ...FOUNDING_DEFAULTS, ...(input.settings || {}) };
  const cutoff = settings.cutoffDate, threshold = halala(settings.threshold);
  const decisions = input.decisions || {}, links = statementLinks(input.lines);
  const posted = input.posted || new Map(), closed = input.closedMonths || new Set();
  const partnerName = id => (input.partners || []).find(p => p.id === id)?.name || 'شريك';
  const dateFor = sourceDate => (!sourceDate || sourceDate <= cutoff ? cutoff : sourceDate);
  const status = (key, date, held) => posted.has(key) ? 'posted' : held ? 'held_vat' : closed.has(date.slice(0, 7)) ? 'blocked_period' : 'proposed';
  const entries = [], updates = [];
  const groups = { matched: [], small: [], large: [], withProof: [], partners: [] };

  // ── المستندات ──
  for (const doc of input.docs || []) {
    // Employee custody is funded through the advance, not by a direct payment
    // of each invoice from Hadi or the company. Its own receipt controls the
    // posted source, including any input VAT claimed in an earlier quarter.
    const custodyScoped = doc.fundingType === 'employee' || Boolean(doc.custodySettlementId);
    const pay = custodyScoped ? { payer: null, source: 'custody' } : payerOf(doc, links, decisions);
    const vatHeld = Boolean(!custodyScoped && doc.vatQuarter && FILED_VAT_QUARTERS.includes(doc.vatQuarter) && !decisions[doc.key]?.vatReviewed);
    const row = { ...doc, payer: pay.payer, payerSource: pay.source, statementLine: pay.line || null,
      partnerId: pay.partnerId || null, vatHeld, decision: decisions[doc.key] || null, custodyScoped };
    if (doc.date && doc.date <= cutoff) {
      if (pay.line) groups.matched.push(row);
      else if (doc.hasProof) groups.withProof.push(row);
      else if (halala(doc.amount) < threshold) groups.small.push(row);
      else groups.large.push(row);
    }
    if (custodyScoped) continue;
    const target = targetAccount(pay.payer, pay.partnerId);
    if (!target) continue;
    if (!doc.protected) {
      const patch = documentPatchFor(pay.payer);
      if (patch && (doc.fundingType !== patch.fundingType || doc.paymentMethod !== patch.paymentMethod)) {
        updates.push({ key: doc.key, type: 'document', kind: doc.kind, sourceId: doc.sourceId, title: doc.title, amount: doc.amount,
          payer: pay.payer, patch, held: vatHeld });
      }
      continue;
    }
    const key = `doc:${doc.key}`, date = dateFor(doc.date), lines = [];
    for (const [account, amount] of [[ACCOUNTS.CASH, doc.effect?.cash || 0], [ACCOUNTS.BANK, doc.effect?.bank || 0]]) {
      if (account === target || amount <= 0) continue;
      lines.push({ accountId: account, debit: riyal(amount), credit: 0, description: `رد أثر الدفع المسجل — ${doc.title}` });
      lines.push({ accountId: target, debit: 0, credit: riyal(amount), description: payerLineText(pay.payer, partnerName(pay.partnerId)) });
    }
    if (!lines.length && !posted.has(key)) continue;
    entries.push({ key, type: 'document', sourceKey: doc.key, title: doc.title, amount: doc.amount, date,
      originalDate: doc.date, payer: pay.payer, lines, status: status(key, date, vatHeld),
      description: `تصحيح جهة دفع «${doc.title}» (${doc.date || 'بلا تاريخ'}) — ${payerLabel(pay.payer, partnerName(pay.partnerId))}`,
      ...(posted.get(key) || {}) });
  }

  // ── دفعات الشركاء ──
  for (const payment of input.payments || []) {
    const line = links.get(payment.key), decision = decisions[payment.key];
    const arrival = line ? (line.account === 'personal' ? 'hadi' : 'company') : PAYMENT_ARRIVALS.includes(decision?.decision) ? decision.decision : null;
    if (payment.date && payment.date <= cutoff) groups.partners.push({ ...payment, arrival, arrivalSource: line ? 'statement' : decision ? 'decision' : null, statementLine: line || null });
    const target = targetAccount(arrival);
    if (!target) continue;
    if (!payment.protected) {
      const method = arrival === 'hadi' ? 'owner_current' : 'bank_transfer';
      if (payment.method !== method) updates.push({ key: payment.key, type: 'partner_payment', id: payment.id, title: `دفعة ${payment.partnerName}`,
        amount: payment.amount, payer: arrival, patch: { paymentMethod: method }, held: false });
      continue;
    }
    const key = `payment:${payment.key}`, date = dateFor(payment.date), lines = [];
    for (const [account, amount] of [[ACCOUNTS.CASH, payment.effect?.cash || 0], [ACCOUNTS.BANK, payment.effect?.bank || 0]]) {
      if (account === target || amount <= 0) continue;
      lines.push({ accountId: target, debit: riyal(amount), credit: 0, description: arrival === 'hadi' ? 'دفعة شريك وصلت لحساب هادي' : 'دفعة شريك وصلت لحساب الشركة' });
      lines.push({ accountId: account, debit: 0, credit: riyal(amount), description: `رد أثر الاستلام المسجل — دفعة ${payment.partnerName}` });
    }
    if (!lines.length && !posted.has(key)) continue;
    entries.push({ key, type: 'payment', sourceKey: payment.key, title: `دفعة ${payment.partnerName}`, amount: payment.amount, date,
      originalDate: payment.date, payer: arrival, lines, status: status(key, date, false),
      description: `تصحيح جهة استلام دفعة ${payment.partnerName} (${payment.date}) — ${arrival === 'hadi' ? 'وصلت لحساب هادي' : 'وصلت لحساب الشركة'}`,
      ...(posted.get(key) || {}) });
  }

  // ── التحويلات بين هادي وحساب الشركة ──
  for (const line of input.lines || []) {
    if (line.decision !== 'transfer' || line.account !== 'personal' || !['applied', 'applying'].includes(line.status)) continue;
    const key = `transfer:${line.id}`, date = closed.has(line.txDate.slice(0, 7)) ? dateFor(line.txDate) : line.txDate;
    const toCompany = line.direction === 'debit', amount = halala(line.amount);
    const lines = toCompany
      ? [{ accountId: ACCOUNTS.BANK, debit: riyal(amount), credit: 0, description: 'تحويل من حساب هادي إلى حساب الشركة' },
        { accountId: ACCOUNTS.HADI, debit: 0, credit: riyal(amount), description: line.description || 'تحويل من هادي' }]
      : [{ accountId: ACCOUNTS.HADI, debit: riyal(amount), credit: 0, description: line.description || 'تحويل إلى هادي' },
        { accountId: ACCOUNTS.BANK, debit: 0, credit: riyal(amount), description: 'تحويل من حساب الشركة إلى حساب هادي' }];
    entries.push({ key, type: 'transfer', sourceKey: `statement:${line.id}`, title: line.description || 'تحويل', amount: line.amount, date,
      originalDate: line.txDate, payer: 'hadi', lines, status: status(key, date, false),
      description: `${toCompany ? 'تحويل من هادي إلى حساب الشركة' : 'تحويل من حساب الشركة إلى هادي'} (${line.txDate})`,
      ...(posted.get(key) || {}) });
  }

  // A client-writable marker or status is never proof that the historical
  // source was settled. Only the server-verified receipt/ledger/lock path may
  // remove a source from this cutoff guard. A verified later funding date is
  // the sole exception for an earlier founding cutoff.
  const unresolvedCustody = (input.docs || []).filter(d => (d.fundingType === 'employee' || d.custodySettlementId)
    && !d.custodySettled && !d.custodyFundingAfterCutoff);
  const settlement = settlementFor({ settings, book: input.book || {}, entries, posted, closed,
    custodyBridge: input.custodyBridge, unresolvedCustody });
  if (settlement.entry) entries.push(settlement.entry);
  const vatTouching = (input.docs || []).filter(d => !d.custodySettlementId && d.vatQuarter && FILED_VAT_QUARTERS.includes(d.vatQuarter))
    .map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date, quarter: d.vatQuarter,
      reviewed: Boolean(decisions[d.key]?.vatReviewed), protected: d.protected }));
  const postCutoff = (input.docs || []).filter(d => d.date && d.date > cutoff && !d.protected && d.issues?.length)
    .map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date, missing: completenessGaps(d) }))
    .filter(d => d.missing.length);
  const totals = Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, { count: rows.length, amount: riyal(rows.reduce((n, r) => n + halala(r.amount), 0)) }]));
  return { settings, groups, totals, entries, updates, settlement, vatTouching, postCutoff,
    hadi: hadiStatement({ hadiLedger: input.hadiLedger || [], docs: input.docs || [], payments: input.payments || [], entries }) };
}

function payerLabel(payer, partner) {
  return payer === 'hadi' ? 'من حساب هادي' : payer === 'partner' ? `من جيب الشريك ${partner}` : payer === 'cash' ? 'كاش من الصندوق' : 'من حساب الشركة';
}
function payerLineText(payer, partner) {
  return payer === 'hadi' ? 'دفعه هادي من حسابه الشخصي' : payer === 'partner' ? `دفعه الشريك ${partner} من جيبه` : payer === 'cash' ? 'دُفع كاش من الصندوق' : 'دُفع من حساب الشركة';
}

/** الحقول الأربعة المطلوبة بعد القطع قبل الاعتماد. */
export function completenessGaps(doc) {
  const gaps = [];
  if (!doc.supplier || !String(doc.supplier).trim()) gaps.push('المورد');
  if (!(Number(doc.amount) > 0)) gaps.push('المبلغ');
  if (!doc.hasProof && !doc.statementLineRef) gaps.push('الإثبات');
  if (!['company_cash', 'company_bank', 'vendor_liability', 'owner_current'].includes(doc.fundingType)) gaps.push('الحساب المقابل');
  return gaps;
}

// ── قيد التسوية يوم القطع ────────────────────────────────────────────────
function settlementFor({ settings, book, entries, posted, closed, custodyBridge = null, unresolvedCustody = [] }) {
  const cutoff = settings.cutoffDate, key = `settlement:${cutoff}`;
  const actuals = settings.actuals || null;
  const accounts = [ACCOUNTS.BANK, ACCOUNTS.CASH, ACCOUNTS.ADVANCES];
  const bookAt = Object.fromEntries(accounts.map(a => [a, Math.round(book[a] || 0)]));
  const timingBridge = Object.fromEntries(accounts.map(a => [a, Math.round(custodyBridge?.amounts?.[a] || 0)]));
  const bookAfterTimingBridge = Object.fromEntries(accounts.map(a => [a, bookAt[a] + timingBridge[a]]));
  // The proposed corrections dated on or before the cutoff move these balances too.
  const pending = Object.fromEntries(accounts.map(a => [a, 0]));
  const waiting = entries.filter(e => e.status === 'proposed' && e.date <= cutoff);
  for (const e of waiting) for (const l of e.lines) if (accounts.includes(l.accountId)) pending[l.accountId] += halala(l.debit) - halala(l.credit);
  const after = Object.fromEntries(accounts.map(a => [a, bookAfterTimingBridge[a] + pending[a]]));
  const custodyIssues = custodyBridge?.issues || [];
  const result = { cutoffDate: cutoff, book: bookAt, timingBridge, bookAfterTimingBridge,
    custodyBridgeGroups: custodyBridge?.groups || [], custodyIssues,
    unresolvedCustodyCount: unresolvedCustody.length, afterCorrections: after, actual: null, differences: null, entry: null,
    status: posted.has(key) ? 'posted' : actuals ? 'proposed' : 'needs_actuals', waitingCorrections: waiting.length };
  if (!actuals) return result;
  const custody = (actuals.custody || []).reduce((n, c) => n + halala(c.amount), 0);
  const actual = { [ACCOUNTS.BANK]: actuals.bankOpen ? halala(actuals.bankBalance) : 0, [ACCOUNTS.CASH]: halala(actuals.cash), [ACCOUNTS.ADVANCES]: custody };
  const differences = Object.fromEntries(accounts.map(a => [a, actual[a] - after[a]]));
  const names = { [ACCOUNTS.BANK]: 'حساب الشركة', [ACCOUNTS.CASH]: 'الصندوق', [ACCOUNTS.ADVANCES]: 'العهد' };
  const lines = [];
  for (const a of accounts) {
    const d = differences[a];
    if (d > 0) lines.push({ accountId: a, debit: riyal(d), credit: 0, description: `تسوية ${names[a]} على الواقع يوم القطع` });
    if (d < 0) lines.push({ accountId: a, debit: 0, credit: riyal(-d), description: `تسوية ${names[a]} على الواقع يوم القطع` });
  }
  const net = Object.values(differences).reduce((n, d) => n + d, 0);
  if (net > 0) lines.push({ accountId: ACCOUNTS.SETTLEMENTS, debit: 0, credit: riyal(net), description: 'فرق فترة التأسيس' });
  if (net < 0) lines.push({ accountId: ACCOUNTS.SETTLEMENTS, debit: riyal(-net), credit: 0, description: 'فرق فترة التأسيس' });
  Object.assign(result, { actual, differences });
  if (!lines.length && !posted.has(key)) {
    result.status = custodyIssues.length || unresolvedCustody.length ? 'waiting_custody' : 'balanced';
    return result;
  }
  const entryStatus = posted.has(key) ? 'posted' : custodyIssues.length || unresolvedCustody.length ? 'waiting_custody'
    : waiting.length ? 'waiting' : closed.has(cutoff.slice(0, 7)) ? 'blocked_period' : 'proposed';
  result.status = entryStatus;
  result.entry = { key, type: 'settlement', sourceKey: key, title: 'تسوية فترة التأسيس', date: cutoff, lines, status: entryStatus,
    amount: riyal(Math.abs(net)), description: `تسوية فترة التأسيس يوم القطع ${cutoff} — الفرق الباقي بين الدفاتر والواقع`,
    ...(posted.get(key) || {}) };
  return result;
}

// ── كشف حساب هادي الجاري ────────────────────────────────────────────────
const KIND_LABEL = {
  expense: 'مصروف دفعه هادي', partner_payment: 'دفعة شريك استلمها هادي',
  founding_document: 'تصحيح: مصروف دفعه هادي', founding_payment: 'تصحيح: دفعة شريك استلمها هادي',
  founding_transfer: 'تحويل بين هادي وحساب الشركة', founding_settlement: 'تسوية فترة التأسيس',
};
export function movementLabel(sourceType, sourceKind) {
  return KIND_LABEL[sourceKind] || KIND_LABEL[sourceType] || 'حركة أخرى';
}

/** الرصيد الدائن (موجب) = المشروع مدين لهادي؛ المدين (سالب) = عند هادي للمشروع. */
export function balanceMeaning(balanceHalala) {
  if (balanceHalala > 0) return { kind: 'owed_to_hadi', amount: riyal(balanceHalala) };
  if (balanceHalala < 0) return { kind: 'held_by_hadi', amount: riyal(-balanceHalala) };
  return { kind: 'zero', amount: 0 };
}

function hadiStatement({ hadiLedger, docs, payments, entries }) {
  let running = 0;
  const posted = [...hadiLedger].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.entryNumber || 0) - (b.entryNumber || 0))
    .map(l => {
      running += halala(l.credit) - halala(l.debit);
      return { ...l, label: movementLabel(l.sourceType, l.sourceKind), balance: riyal(running) };
    });
  const pending = [];
  for (const d of docs) if (!d.protected && d.paymentMethod === 'owner_current') {
    pending.push({ key: d.key, date: d.date, label: 'مصروف دفعه هادي — لم يُعتمد ويُرحّل بعد', description: d.title, debit: 0, credit: d.amount, status: 'unposted' });
  }
  for (const p of payments) if (!p.protected && p.method === 'owner_current') {
    pending.push({ key: p.key, date: p.date, label: 'دفعة شريك استلمها هادي — لم تُرحّل بعد', description: `دفعة ${p.partnerName}`, debit: p.amount, credit: 0, status: 'unposted' });
  }
  for (const e of entries) if (e.status !== 'posted') for (const l of e.lines) if (l.accountId === ACCOUNTS.HADI) {
    pending.push({ key: e.key, date: e.date, label: `${movementLabel(null, `founding_${e.type}`)} — ${e.status === 'held_vat' ? 'بانتظار مراجعة الإقرار' : 'بانتظار موافقتك'}`,
      description: e.title, debit: l.debit, credit: l.credit, status: e.status });
  }
  pending.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const postedBalance = running;
  const projected = pending.reduce((n, p) => n + halala(p.credit) - halala(p.debit), postedBalance);
  return { posted, pending, postedBalance: riyal(postedBalance), projectedBalance: riyal(projected),
    meaning: balanceMeaning(postedBalance), projectedMeaning: balanceMeaning(projected) };
}
