// ═══════════════════════════════════════════════════════════════════════════
// حساب هادي الجاري وتسوية فترة التأسيس — حساب خالص بلا قراءة ولا كتابة
// ═══════════════════════════════════════════════════════════════════════════
// قبل أن يعمل حساب الشركة البنكي صُرفت المصاريف من حساب هادي الشخصي (وبعضها
// كاش أو من جيب شريك أو من عهدة)، ووصلته دفعات الشركاء، والتسجيل كان عشوائيًا.
// هذا الملف يقرأ ما جمعه الخادم (المستندات، الدفعات، سطور الكشوف المعلّمة،
// القرارات) ويرجع:
//   • المجموعات قبل تاريخ القطع (= يوم بدء عمل البنك؛ فترة التأسيس قبله)،
//   • القاعدة الافتراضية: كل مستند تأسيس ناقص التمويل، أو مسجّل على البنك أو
//     الصندوق ولم يطابق كشف الشركة، يُنسب لهادي (إلا رسوم البنك نفسه)،
//   • القيود المقترحة (نقل أثر 1010/1020/2000 إلى الجهة التي دفعت فعلًا)،
//   • مقارنة الحساب الجاري حسب المستندات بسطور كشف هادي، وقيد الفرق على 3200 —
//     أو، بلا كشف شخصي، تفصيل رصيد 2300 وإقرار المدير عليه وتسويات يكتب سببها،
//   • ملخص فترة التأسيس للشركاء،
//   • قيد تسوية الواقع يوم القطع (البنك والصندوق والعهد) على 3200،
//   • كشف حساب هادي الجاري ورصيده ومعناه.
// لا شيء هنا يُرحَّل: الخادم يعيد الحساب نفسه ويرحّل فقط ما وافق عليه هادي.
// كل المبالغ الداخلية بالهللة (أعداد صحيحة) حتى لا يتراكم كسر.

// تاريخ القطع = أول يوم عمل فيه حساب البنك. الافتراضي يُبقي فترة التأسيس حتى
// 2026-09-30 إلى أن يحدد هادي اليوم الفعلي.
export const FOUNDING_DEFAULTS = Object.freeze({ cutoffDate: '2026-10-01', threshold: 500 });
// الربعان اللذان قُدّم إقرارهما (حسب هادي): أي مستند انحسبت ضريبة مدخلاته
// فيهما لا يتغير إلا بعد مراجعته.
export const FILED_VAT_QUARTERS = Object.freeze(['2026-Q2', '2026-Q3']);
export const ACCOUNTS = Object.freeze({ CASH: '1010', BANK: '1020', ADVANCES: '1300', PAYABLE: '2000', HADI: '2300', SETTLEMENTS: '3200' });
// من دفع المستند — قرار يدوي. «founding_rule» تكتبه القاعدة الافتراضية وحدها.
export const DOC_DECISIONS = Object.freeze(['hadi', 'partner', 'custody', 'cash', 'company_bank', 'unknown']);
export const RULE_DECISION = 'founding_rule';
export const PAYMENT_ARRIVALS = Object.freeze(['hadi', 'company']);
// قديم: «مقبولة بإقرار المدير» كانت تُحفظ كقرار؛ صارت علامة `attested` مستقلة عن الدافع.
export const SMALL_DECISION = 'manager_attested';
export const MATCH_WINDOW_DAYS = 7;
// ما يكفي ليُعد المستند «محسوم الدفع» (نفس قائمة financeProblems في الخادم).
const RESOLVED_FUNDING = ['company_cash', 'company_bank', 'vendor_liability', 'owner_current', 'custody', 'partner'];
const KNOWN_METHODS = ['cash', 'transfer', 'card', 'credit', 'owner_current', 'founding_personal', 'custody', 'partner_paid'];
// من دفع مستندًا مكتملًا كما سُجّل (بلا كشف ولا قرار).
const RECORDED_PAYER = { owner_current: 'hadi', company_bank: 'company_bank', company_cash: 'cash', partner: 'partner', custody: 'custody', vendor_liability: 'vendor' };
// تسويات 3200 اليدوية: اتجاهها على 2300.
export const ADJUSTMENT_DIRECTIONS = Object.freeze(['debit_2300', 'credit_2300']);

export const halala = value => Math.round(Number(value || 0) * 100);
const riyal = h => Math.round(h) / 100;
const dayMs = 86400000;
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / dayMs);
export const quarterOf = day => /^\d{4}-\d{2}/.test(day || '') ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}` : null;
/** آخر يوم في فترة التأسيس: اليوم السابق لبدء البنك. قيود التأسيس تؤرَّخ به. */
export const dayBefore = day => new Date(Date.parse(`${day}T12:00:00Z`) - dayMs).toISOString().slice(0, 10);
export const isAttested = decision => Boolean(decision?.attested || decision?.decision === SMALL_DECISION);

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
const appliedLine = line => ['applied', 'applying'].includes(line.status);
export function statementLinks(lines) {
  const map = new Map();
  for (const line of lines || []) {
    const key = linkKey(line);
    if (key && appliedLine(line)) map.set(key, line);
  }
  return map;
}

/**
 * الجهة التي دفعت المستند فعلًا: من الكشف أولًا، ثم القرار اليدوي أو القاعدة،
 * ثم ما سُجّل في مستند مكتمل (حساب تمويل وتاريخ دفع وطريقة دفع).
 */
export function payerOf(doc, links, decisions) {
  const line = links.get(doc.key);
  if (line) return { payer: line.account === 'personal' ? 'hadi' : 'company_bank', source: 'statement', line };
  const decision = decisions[doc.key];
  if (decision?.decision === RULE_DECISION) return { payer: 'hadi', source: 'rule', decision };
  if (DOC_DECISIONS.includes(decision?.decision)) {
    return { payer: decision.decision, source: 'decision', partnerId: decision.partnerId || null, custodian: decision.custodian || null, decision };
  }
  const recorded = !ruleGaps(doc).length && RECORDED_PAYER[doc.fundingType];
  if (recorded) return { payer: recorded, source: 'recorded', partnerId: doc.fundingPartnerId || null, custodian: doc.custodian || null };
  return { payer: null, source: null };
}

// رسوم البنك نفسه (إصدار بطاقة مدى، إرسالية بطاقة، حوالة...) تبقى على البنك:
// المورد بنك أو مصرف، أو الوصف رسوم/عمولة بطاقة أو حوالة أو حساب.
const BANK_SUPPLIER = /(مصرف|بنك|\bbank\b)/i;
const BANK_FEE_TEXT = /(رسوم|عمولة)[^—]*(بطاقة|مدى|إرسالية|ارسالية|حوالة|فتح حساب|الحساب الجاري|بنكي|بنكية)/;
export function isBankFee(doc) {
  return BANK_SUPPLIER.test(String(doc.supplier || '')) || BANK_FEE_TEXT.test(String(doc.title || ''));
}

function targetAccount(pay) {
  if (pay.payer === 'hadi') return ACCOUNTS.HADI;
  if (pay.payer === 'cash') return ACCOUNTS.CASH;
  if (pay.payer === 'company_bank' || pay.payer === 'company') return ACCOUNTS.BANK;
  if (pay.payer === 'custody') return ACCOUNTS.ADVANCES;
  if (pay.payer === 'partner') return pay.partnerId ? `3000-${pay.partnerId}` : null;
  return null;
}

/** ما يحتاجه مستند غير مرحّل ليطابق من دفعه (يُطبّق عبر صندوق العمل المالي). */
function documentPatchFor(pay) {
  if (pay.payer === 'hadi') return pay.source === 'statement'
    ? { fundingType: 'owner_current', paymentMethod: 'owner_current' }
    // بلا كشف: «دفع شخصي - فترة التأسيس» — بقاعدة أو بقرار يدوي.
    : { fundingType: 'owner_current', paymentMethod: 'founding_personal' };
  if (pay.payer === 'partner') return pay.partnerId ? { fundingType: 'partner', paymentMethod: 'partner_paid', fundingPartnerId: pay.partnerId } : null;
  if (pay.payer === 'custody') return pay.custodian ? { fundingType: 'custody', paymentMethod: 'custody', custodian: pay.custodian } : null;
  if (pay.payer === 'cash') return { fundingType: 'company_cash', paymentMethod: 'cash' };
  if (pay.payer === 'company_bank') return { fundingType: 'company_bank', paymentMethod: 'transfer' };
  return null;
}
function needsPatch(doc, patch) {
  return doc.fundingType !== patch.fundingType || doc.paymentMethod !== patch.paymentMethod || !doc.paidDate
    || (patch.fundingPartnerId && doc.fundingPartnerId !== patch.fundingPartnerId) || (patch.custodian && doc.custodian !== patch.custodian);
}

/** مستند تأسيس ناقصه حساب التمويل أو تاريخ الدفع أو طريقة الدفع. */
export function ruleGaps(doc) {
  const gaps = [];
  if (!RESOLVED_FUNDING.includes(doc.fundingType)) gaps.push('حساب التمويل');
  // An unpaid supplier liability has no payment date yet, and lacks nothing.
  if (!doc.paidDate && !(doc.fundingType === 'vendor_liability' && doc.paymentStatus === 'unpaid')) gaps.push('تاريخ الدفع');
  if (!KNOWN_METHODS.includes(doc.paymentMethod)) gaps.push('طريقة الدفع');
  return gaps;
}

// ── المخطط كله ───────────────────────────────────────────────────────────
/**
 * @param input.docs        مستندات المصاريف: { key, kind, sourceId, title, amount, date, paidDate, supplier, hasProof,
 *                          protected, effect:{cash,bank,payable} (دائن بالهللة), fundingType, paymentMethod,
 *                          fundingPartnerId, custodian, vatQuarter, issues }
 * @param input.payments    دفعات الشركاء: { key, id, partnerId, partnerName, amount, date, method, protected, effect:{cash,bank} (مدين بالهللة) }
 * @param input.lines       سطور الكشوف المحفوظة (المعلّمة فقط)
 * @param input.decisions   { [sourceKey]: { decision, partnerId, custodian, attested, vatReviewed, ... } }
 * @param input.settings    { cutoffDate, threshold, actuals, lastRule }
 * @param input.book        أرصدة الدفاتر المرحّلة قبل يوم القطع بالهللة (مدين − دائن): { '1010', '1020', '1300' }
 * @param input.posted      Map مفتاح القيد → { entryId, entryNumber, lines } لما رُحّل سابقًا
 * @param input.closedMonths Set أشهر مقفلة 'YYYY-MM'
 * @param input.hadiLedger  أسطر الحساب 2300 المرحّلة
 * @param input.partners    [{ id, name }]
 */
export function foundingPlan(input) {
  const core = planCore(input);
  return { ...core, rule: ruleProposal(input, core) };
}

function planCore(input) {
  const settings = { ...FOUNDING_DEFAULTS, ...(input.settings || {}) };
  const cutoff = settings.cutoffDate, foundingEnd = dayBefore(cutoff), threshold = halala(settings.threshold);
  const inFounding = day => Boolean(day) && day < cutoff;
  const decisions = input.decisions || {}, links = statementLinks(input.lines);
  const posted = input.posted || new Map(), closed = input.closedMonths || new Set();
  const partnerName = id => (input.partners || []).find(p => p.id === id)?.name || 'شريك';
  const dateFor = sourceDate => (!sourceDate || sourceDate < cutoff ? foundingEnd : sourceDate);
  const status = (key, date, held) => posted.has(key) ? 'posted' : held ? 'held_vat' : closed.has(date.slice(0, 7)) ? 'blocked_period' : 'proposed';
  const entries = [], updates = [], rows = [];
  const groups = { matched: [], small: [], large: [], withProof: [], partners: [] };
  // A founding-period document in a closed month is edited and posted on the
  // period's last day (the month stays closed) — unless that day's month is closed too.
  const endClosed = closed.has(foundingEnd.slice(0, 7));
  const blockedDoc = doc => [doc.date, doc.paidDate].some(d => d && closed.has(d.slice(0, 7)) && (!inFounding(doc.date) || d >= cutoff || endClosed));

  // ── المستندات ──
  for (const doc of input.docs || []) {
    const pay = payerOf(doc, links, decisions);
    const decision = decisions[doc.key] || null;
    const vatHeld = Boolean(doc.vatQuarter && FILED_VAT_QUARTERS.includes(doc.vatQuarter) && !decision?.vatReviewed);
    const row = { ...doc, payer: pay.payer, payerSource: pay.source, statementLine: pay.line || null, partnerId: pay.partnerId || null,
      custodian: pay.custodian || null, vatHeld, decision, attested: isAttested(decision), founding: inFounding(doc.date) };
    rows.push(row);
    // «مصروف تأسيس بإقرار المدير» له قائمته؛ لا يدخل مجموعات الإثبات.
    if (row.founding && !doc.attestation) {
      if (pay.line) groups.matched.push(row);
      else if (doc.hasProof) groups.withProof.push(row);
      else if (halala(doc.amount) < threshold) groups.small.push(row);
      else groups.large.push(row);
    }
    const target = targetAccount(pay);
    // As recorded: nothing to change, and no correction is inferred from it.
    if (!target || pay.source === 'recorded') continue;
    if (!doc.protected) {
      const patch = documentPatchFor(pay);
      if (patch && needsPatch(doc, patch)) {
        const blocked = blockedDoc(doc);
        updates.push({ key: doc.key, type: 'document', kind: doc.kind, sourceId: doc.sourceId, title: doc.title, amount: doc.amount,
          date: doc.date, payer: pay.payer, source: pay.source, patch: { ...patch, ...(doc.paidDate ? {} : { paidDate: doc.date }) },
          held: vatHeld, blocked });
      }
      continue;
    }
    const key = `doc:${doc.key}`, date = dateFor(doc.date), lines = [];
    const label = payerLabel(pay, partnerName(pay.partnerId));
    for (const [account, amount, text] of [[ACCOUNTS.CASH, doc.effect?.cash || 0, 'رد أثر الدفع المسجل'],
      [ACCOUNTS.BANK, doc.effect?.bank || 0, 'رد أثر الدفع المسجل'], [ACCOUNTS.PAYABLE, doc.effect?.payable || 0, 'إقفال ذمة المورد المسجلة']]) {
      if (account === target || amount <= 0) continue;
      lines.push({ accountId: account, debit: riyal(amount), credit: 0, description: `${text} — ${doc.title}` });
      lines.push({ accountId: target, debit: 0, credit: riyal(amount), description: payerLineText(pay, partnerName(pay.partnerId)) });
    }
    if (!lines.length && !posted.has(key)) continue;
    entries.push({ key, type: 'document', sourceKey: doc.key, title: doc.title, amount: doc.amount, date, originalDate: doc.date,
      payer: pay.payer, payerSource: pay.source, lines, status: status(key, date, vatHeld),
      description: `تصحيح جهة دفع «${doc.title}» (${doc.date || 'بلا تاريخ'}) — ${label}`, ...(posted.get(key) || {}) });
  }

  // ── دفعات الشركاء ──
  const paymentRows = [];
  for (const payment of input.payments || []) {
    const line = links.get(payment.key), decision = decisions[payment.key];
    const decided = line ? (line.account === 'personal' ? 'hadi' : 'company') : PAYMENT_ARRIVALS.includes(decision?.decision) ? decision.decision : null;
    // Recorded as received by Hadi: counts for his account, changes nothing.
    const arrival = decided || (payment.method === 'owner_current' ? 'hadi' : null);
    const row = { ...payment, arrival, arrivalSource: line ? 'statement' : decided ? 'decision' : arrival ? 'recorded' : null,
      statementLine: line || null, founding: inFounding(payment.date) };
    paymentRows.push(row);
    if (row.founding) groups.partners.push(row);
    const target = targetAccount({ payer: decided });
    if (!target) continue;
    if (!payment.protected) {
      const method = arrival === 'hadi' ? 'owner_current' : 'bank_transfer';
      if (payment.method !== method) updates.push({ key: payment.key, type: 'partner_payment', id: payment.id, title: `دفعة ${payment.partnerName}`,
        amount: payment.amount, date: payment.date, payer: arrival, patch: { paymentMethod: method }, held: false,
        blocked: Boolean(payment.date && closed.has(payment.date.slice(0, 7))) });
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

  // ── التحويلات بين هادي وحساب الشركة: من كشفه أو من كشف الشركة ──
  const transferLines = (input.lines || []).filter(l => l.decision === 'transfer' && appliedLine(l));
  const personalTransfers = transferLines.filter(l => l.account === 'personal');
  for (const line of transferLines) {
    const company = line.account === 'company';
    // The same transfer marked on both statements counts once (Hadi's line).
    if (company && personalTransfers.some(p => p.direction !== line.direction && halala(p.amount) === halala(line.amount)
      && Math.abs(daysBetween(p.txDate, line.txDate)) <= MATCH_WINDOW_DAYS)) continue;
    const key = `transfer:${line.id}`, date = closed.has(line.txDate.slice(0, 7)) ? dateFor(line.txDate) : line.txDate;
    // Out of Hadi's account, or into the company's: Hadi funded the company.
    const toCompany = company ? line.direction === 'credit' : line.direction === 'debit', amount = halala(line.amount);
    const lines = toCompany
      ? [{ accountId: ACCOUNTS.BANK, debit: riyal(amount), credit: 0, description: 'تحويل من حساب هادي إلى حساب الشركة' },
        { accountId: ACCOUNTS.HADI, debit: 0, credit: riyal(amount), description: line.description || 'تحويل من هادي' }]
      : [{ accountId: ACCOUNTS.HADI, debit: riyal(amount), credit: 0, description: line.description || 'تحويل إلى هادي' },
        { accountId: ACCOUNTS.BANK, debit: 0, credit: riyal(amount), description: 'تحويل من حساب الشركة إلى حساب هادي' }];
    entries.push({ key, type: 'transfer', sourceKey: `statement:${line.id}`, title: line.description || 'تحويل', amount: line.amount, date,
      originalDate: line.txDate, payer: 'hadi', account: line.account, toCompany, lines, status: status(key, date, false),
      description: `${toCompany ? 'تحويل من هادي إلى حساب الشركة' : 'تحويل من حساب الشركة إلى هادي'} (${line.txDate})`,
      ...(posted.get(key) || {}) });
  }

  // ── تحويل هادي لحساب الشركة بلا كشف: قيد مقترح بسبب يكتبه ──
  for (const t of settings.manualTransfers || []) {
    const key = `manual_transfer:${t.id}`, amount = riyal(halala(t.amount));
    const date = closed.has(String(t.date).slice(0, 7)) ? dateFor(t.date) : t.date;
    // A marked statement deposit of the same amount within a week may be this very transfer.
    const twin = transferLines.find(l => halala(l.amount) === halala(t.amount) && Math.abs(daysBetween(l.txDate, t.date)) <= MATCH_WINDOW_DAYS
      && (l.account === 'company' ? l.direction === 'credit' : l.direction === 'debit'));
    entries.push({ key, type: 'transfer', sourceKey: key, id: t.id, title: t.description, amount, date, originalDate: t.date, payer: 'hadi',
      account: 'manual', toCompany: true, reason: t.reason, proposedByName: t.byName || null, proposedAtIso: t.atIso || null,
      possibleTwin: twin ? { txDate: twin.txDate, account: twin.account, description: twin.description } : null,
      lines: [{ accountId: ACCOUNTS.BANK, debit: amount, credit: 0, description: `تحويل من هادي إلى حساب الشركة — ${t.description}` },
        { accountId: ACCOUNTS.HADI, debit: 0, credit: amount, description: t.description }],
      status: status(key, date, false), description: `تحويل من هادي إلى حساب الشركة بلا كشف (${t.date}) — ${t.reason}`, ...(posted.get(key) || {}) });
  }

  // ── سندات قبض وصلت لحساب هادي بلا قيد: مدين 2300 ودائن رأس مال الشريك ──
  const proposals = new Map((settings.receiptProposals || []).map(r => [r.id, r]));
  const receiptDate = p => (closed.has(String(p.date).slice(0, 7)) ? dateFor(p.date) : p.date);
  for (const [id, proposal] of proposals) {
    const p = paymentRows.find(x => x.id === id), key = p ? `receipt:${p.key}` : null;
    // Posted some other way, or no longer Hadi's: nothing left to propose.
    if (!p || (!posted.has(key) && (p.protected || p.arrival !== 'hadi' || !p.partnerId || !p.date))) continue;
    const amount = riyal(halala(p.amount)), date = receiptDate(p);
    entries.push({ key, type: 'receipt', sourceKey: p.key, paymentId: p.id, partnerId: p.partnerId, title: `سند قبض ${p.partnerName}`, amount, date,
      originalDate: p.date, payer: 'hadi', reason: proposal.reason, proposedByName: proposal.byName || null, proposedAtIso: proposal.atIso || null,
      lines: [{ accountId: ACCOUNTS.HADI, debit: amount, credit: 0, description: `دفعة ${p.partnerName} وصلت لحساب هادي` },
        { accountId: `3000-${p.partnerId}`, debit: 0, credit: amount, description: `رأس مال ${p.partnerName}` }],
      status: status(key, date, false), description: `سند قبض ${p.partnerName} (${p.date}) وصل لحساب هادي — ${proposal.reason}`, ...(posted.get(key) || {}) });
  }
  const receipts = paymentRows.filter(p => p.arrival === 'hadi' && !p.protected && p.partnerId && p.date && !proposals.has(p.id))
    .map(p => ({ key: p.key, id: p.id, partnerId: p.partnerId, partnerName: p.partnerName, amount: p.amount, date: p.date, method: p.method,
      arrivalSource: p.arrivalSource, postingDate: receiptDate(p), blocked: closed.has(receiptDate(p).slice(0, 7)) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const comparison = statementComparison({ rows, payments: groups.partners, lines: input.lines || [], cutoff, foundingEnd, posted, closed,
    off: Boolean(settings.noPersonalStatement) });
  if (comparison.entry) entries.push(comparison.entry);
  for (const a of settings.adjustments || []) entries.push(adjustmentEntry(a, { cutoff, foundingEnd, posted, closed }));
  const settlement = settlementFor({ settings, foundingEnd, book: input.book || {}, entries, posted, closed });
  if (settlement.entry) entries.push(settlement.entry);
  const vatTouching = rows.filter(d => d.vatQuarter && FILED_VAT_QUARTERS.includes(d.vatQuarter))
    .map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date, quarter: d.vatQuarter,
      reviewed: Boolean(d.decision?.vatReviewed), protected: d.protected }));
  const postCutoff = rows.filter(d => d.date && d.date >= cutoff && !d.protected && d.issues?.length)
    .map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date, missing: completenessGaps(d) }))
    .filter(d => d.missing.length);
  const exceptions = rows.filter(d => d.founding && d.payerSource === 'decision')
    .map(d => ({ key: d.key, kind: d.kind, title: d.title, amount: d.amount, date: d.date, payer: d.payer, partnerId: d.partnerId,
      partnerName: d.partnerId ? partnerName(d.partnerId) : null, custodian: d.custodian, decidedByName: d.decision?.decidedByName || null }));
  const totals = Object.fromEntries(Object.entries(groups).map(([name, list]) => [name, { count: list.length, amount: riyal(list.reduce((n, r) => n + halala(r.amount), 0)) }]));
  const attestedExpenses = rows.filter(d => d.attestation).map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount,
    date: d.date, category: d.category || null, approxDate: d.attestation.approxDate || d.date, byName: d.attestation.byName || null,
    atIso: d.attestation.atIso || null, proofUrl: d.proofUrl || null, protected: d.protected, approval: d.approval || null }))
    .sort((a, b) => String(a.approxDate).localeCompare(String(b.approxDate)));
  const hadiBalance = hadiBalanceOf({ rows, payments: paymentRows, entries, cutoff, saved: settings.hadiAttestation || null });
  return { settings: { ...settings, foundingEnd }, groups, totals, rows, entries, updates, settlement, comparison, vatTouching, postCutoff, exceptions,
    attestedExpenses, hadiBalance, receipts,
    summary: foundingSummary({ rows, payments: paymentRows, entries, hadiBalance, attestedExpenses, settings: { ...settings, foundingEnd } }),
    hadi: hadiStatement({ hadiLedger: input.hadiLedger || [], rows, payments: paymentRows, entries }) };
}

// ── رصيد حساب هادي الجاري من المستندات (بلا كشف شخصي) ─────────────────
const HALALA_SUM = list => list.reduce((n, r) => n + halala(r.amount), 0);
const BALANCE_FIELDS = ['paid', 'received', 'toCompany', 'toHadi', 'net'];
/**
 * ما دفعه هادي من مستندات، وما وصله من دفعات الشركاء، وتحويلاته مع حساب
 * الشركة (من أي كشف)، والصافي: موجب = المشروع مدين لهادي. كل التواريخ: هذا
 * رصيد الحساب 2300 حسب المستندات، لا فترة التأسيس وحدها.
 */
function hadiBalanceOf({ rows, payments, entries, cutoff, saved }) {
  const paidRows = rows.filter(d => d.payer === 'hadi'), attestedRows = paidRows.filter(d => d.attestation);
  const receivedRows = payments.filter(p => p.arrival === 'hadi'), undecided = payments.filter(p => p.founding && !p.arrival);
  const transfers = entries.filter(e => e.type === 'transfer').map(e => ({ key: e.key, date: e.originalDate, amount: e.amount, toCompany: e.toCompany,
    account: e.account, title: e.title, status: e.status })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const paid = HALALA_SUM(paidRows), received = HALALA_SUM(receivedRows);
  const toCompany = HALALA_SUM(transfers.filter(t => t.toCompany)), toHadi = HALALA_SUM(transfers.filter(t => !t.toCompany));
  const net = paid + toCompany - toHadi - received;
  const adjusted = entries.filter(e => e.type === 'adjustment')
    .reduce((n, e) => n + e.lines.filter(l => l.accountId === ACCOUNTS.HADI).reduce((m, l) => m + halala(l.credit) - halala(l.debit), 0), 0);
  const numbers = { paid: riyal(paid), received: riyal(received), toCompany: riyal(toCompany), toHadi: riyal(toHadi), net: riyal(net) };
  return { cutoffDate: cutoff, ...numbers, paidCount: paidRows.length, paidFounding: riyal(HALALA_SUM(paidRows.filter(d => d.founding))),
    attested: riyal(HALALA_SUM(attestedRows)), attestedCount: attestedRows.length, receivedCount: receivedRows.length,
    undecided: { count: undecided.length, amount: riyal(HALALA_SUM(undecided)) }, transfers, meaning: balanceMeaning(net),
    adjustments: riyal(adjusted), afterAdjustments: riyal(net + adjusted), afterMeaning: balanceMeaning(net + adjusted),
    // Hadi's attestation is of these exact numbers; any change after it shows.
    attestation: saved ? { ...saved, changed: BALANCE_FIELDS.some(k => halala(saved[k]) !== halala(numbers[k])) } : null };
}

/** تسوية يكتب هادي سببها وينقل بها مبلغًا بين 2300 و3200 — قيد مقترح ينتظر موافقته. */
function adjustmentEntry(a, { cutoff, foundingEnd, posted, closed }) {
  const key = `adjustment:${a.id}`, amount = riyal(halala(a.amount)), text = `تسوية فترة التأسيس — ${a.reason}`;
  const lines = a.direction === 'debit_2300'
    ? [{ accountId: ACCOUNTS.HADI, debit: amount, credit: 0, description: 'تسوية حساب هادي الجاري' },
      { accountId: ACCOUNTS.SETTLEMENTS, debit: 0, credit: amount, description: text }]
    : [{ accountId: ACCOUNTS.SETTLEMENTS, debit: amount, credit: 0, description: text },
      { accountId: ACCOUNTS.HADI, debit: 0, credit: amount, description: 'تسوية حساب هادي الجاري' }];
  const status = posted.has(key) ? 'posted' : closed.has(foundingEnd.slice(0, 7)) ? 'blocked_period' : 'proposed';
  return { key, type: 'adjustment', sourceKey: key, id: a.id, title: `تسوية على 3200: ${a.reason}`, amount, date: foundingEnd, lines, status,
    reason: a.reason, direction: a.direction, proposedByName: a.byName || null, proposedAtIso: a.atIso || null,
    description: `تسوية على 3200 بقرار هادي (قبل ${cutoff}) — ${a.reason}`, ...(posted.get(key) || {}) };
}

// ── ملخص فترة التأسيس للشركاء ───────────────────────────────────────────
function foundingSummary({ rows, payments, entries, hadiBalance, attestedExpenses, settings }) {
  const partners = new Map();
  for (const p of payments.filter(x => x.founding)) {
    const t = partners.get(p.partnerId) || { partnerId: p.partnerId, name: p.partnerName, count: 0, total: 0, hadi: 0, company: 0, undecided: 0 };
    const h = halala(p.amount);
    t.count += 1; t.total += h; t[p.arrival === 'hadi' ? 'hadi' : p.arrival === 'company' ? 'company' : 'undecided'] += h;
    partners.set(p.partnerId, t);
  }
  const money = t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, ['total', 'hadi', 'company', 'undecided'].includes(k) ? riyal(v) : v]));
  const founding = rows.filter(d => d.founding), documented = founding.filter(d => !d.attestation);
  const categories = new Map();
  for (const d of documented) {
    const k = `${d.kind}|${d.category || ''}`;
    const t = categories.get(k) || { kind: d.kind, category: d.category || null, count: 0, amount: 0, byHadi: 0 };
    t.count += 1; t.amount += halala(d.amount); if (d.payer === 'hadi') t.byHadi += halala(d.amount);
    categories.set(k, t);
  }
  const after = payments.filter(p => !p.founding && p.date);
  const settlements = entries.filter(e => e.lines.some(l => l.accountId === ACCOUNTS.SETTLEMENTS)).map(e => ({ key: e.key, type: e.type, title: e.title,
    date: e.date, status: e.status, entryNumber: e.entryNumber || null, reason: e.postedReason || e.reason || null, approvedByName: e.postedByName || null,
    // Positive: into 3200 (founding settlements); negative: out of it.
    amount: riyal(e.lines.filter(l => l.accountId === ACCOUNTS.SETTLEMENTS).reduce((n, l) => n + halala(l.credit) - halala(l.debit), 0)) }));
  return {
    cutoffDate: settings.cutoffDate, foundingEnd: settings.foundingEnd,
    partners: [...partners.values()].sort((a, b) => b.total - a.total).map(money),
    partnersTotal: riyal(HALALA_SUM(payments.filter(x => x.founding))), afterCutoff: { count: after.length, amount: riyal(HALALA_SUM(after)) },
    categories: [...categories.values()].sort((a, b) => b.amount - a.amount).map(t => ({ ...t, amount: riyal(t.amount), byHadi: riyal(t.byHadi) })),
    documented: { count: documented.length, amount: riyal(HALALA_SUM(documented)) },
    attested: { count: founding.length - documented.length, amount: riyal(HALALA_SUM(founding.filter(d => d.attestation))) },
    attestedRows: attestedExpenses.filter(e => e.date && e.date < settings.cutoffDate),
    transfers: hadiBalance.transfers, balance: hadiBalance, settlements,
  };
}

// ── القاعدة الافتراضية لفترة التأسيس ───────────────────────────────────
const runnable = u => !u.held && !u.blocked;
/**
 * مجموعتان قبل القطع، بلا كشف ولا قرار:
 *   «missing»  ناقصه حساب التمويل أو تاريخ الدفع أو طريقة الدفع،
 *   «recorded» مسجّل على البنك (1020) أو الصندوق (1010) — ما طابق سطرًا في
 *              كشف الشركة محسوم بالكشف فلا يدخل.
 * رسوم البنك نفسه تبقى على البنك ولا تدخل أيًّا منهما.
 */
export function ruleGroupOf(d) {
  if (!d.founding || d.attestation) return null;
  if (!d.payer && ruleGaps(d).length) return 'missing';
  if (d.payerSource === 'recorded' && ['company_bank', 'cash'].includes(d.payer)) return 'recorded';
  return null;
}
/**
 * القاعدة: كل مستند في المجموعتين ← دفعه هادي من حسابه («دفع شخصي - فترة
 * التأسيس»، الحساب المقابل 2300، تاريخ الدفع = تاريخ المستند). المعاينة تحسب
 * المخطط كأن القاعدة طُبّقت، ولا تحفظ شيئًا.
 */
function ruleProposal(input, core) {
  const inGroup = core.rows.filter(d => ruleGroupOf(d));
  const bankFees = inGroup.filter(isBankFee);
  const candidates = inGroup.filter(d => !isBankFee(d));
  const keys = new Set(candidates.map(d => d.key));
  const simulated = keys.size ? planCore({ ...input, decisions: { ...(input.decisions || {}),
    ...Object.fromEntries(candidates.map(d => [d.key, { ...(input.decisions?.[d.key] || {}), decision: RULE_DECISION }])) } }) : null;
  const entries = simulated ? simulated.entries.filter(e => keys.has(e.sourceKey)) : [];
  const updates = simulated ? simulated.updates.filter(u => keys.has(u.key)) : [];
  const sum = list => riyal(list.reduce((n, r) => n + halala(r.amount), 0));
  const byAccount = new Map();
  for (const e of entries) for (const l of e.lines) {
    const t = byAccount.get(l.accountId) || { accountId: l.accountId, debit: 0, credit: 0 };
    t.debit += halala(l.debit); t.credit += halala(l.credit); byAccount.set(l.accountId, t);
  }
  const rowsOut = candidates.map(d => ({ key: d.key, kind: d.kind, sourceId: d.sourceId, title: d.title, amount: d.amount, date: d.date,
    group: ruleGroupOf(d), recordedAs: d.payerSource === 'recorded' ? d.payer : null, supplier: d.supplier || '',
    protected: d.protected, vatHeld: d.vatHeld, gaps: ruleGaps(d), attested: d.attested,
    action: d.protected ? (entries.some(e => e.sourceKey === d.key) ? 'entry' : 'none') : updates.find(u => u.key === d.key)?.blocked ? 'blocked' : 'update' }));
  const byGroup = name => { const list = rowsOut.filter(r => r.group === name); return { count: list.length, amount: sum(list) }; };
  return {
    candidates: rowsOut, count: rowsOut.length, total: sum(rowsOut), groups: { missing: byGroup('missing'), recorded: byGroup('recorded') },
    bankFees: { count: bankFees.length, amount: sum(bankFees), rows: bankFees.map(d => ({ key: d.key, kind: d.kind, title: d.title, amount: d.amount,
      date: d.date, supplier: d.supplier || '', protected: d.protected })) },
    unposted: { count: rowsOut.filter(r => !r.protected).length, amount: sum(rowsOut.filter(r => !r.protected)) },
    posted: { count: rowsOut.filter(r => r.protected).length, amount: sum(rowsOut.filter(r => r.protected)) },
    held: rowsOut.filter(r => r.vatHeld).length, blocked: rowsOut.filter(r => r.action === 'blocked').length,
    entries, updates,
    lines: [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId))
      .map(t => ({ accountId: t.accountId, debit: riyal(t.debit), credit: riyal(t.credit) })),
    applied: input.settings?.lastRule || null,
    // What «تطبيق» changes in unposted records: the rule's documents and every
    // saved decision or exception still to apply — not what is held or closed.
    toUpdate: [...new Set([...updates, ...core.updates].filter(runnable).map(u => u.key))].length,
    pendingUpdates: core.updates.filter(runnable).map(u => u.key),
  };
}

// ── الحساب الجاري حسب المستندات مقابل كشف هادي ─────────────────────────
function statementComparison({ rows, payments, lines, cutoff, foundingEnd, posted, closed, off = false }) {
  const key = `hadi_statement:${cutoff}`;
  const before = day => Boolean(day) && day < cutoff;
  const paid = rows.filter(d => d.founding && d.payer === 'hadi').reduce((n, d) => n + halala(d.amount), 0);
  const received = payments.filter(p => p.arrival === 'hadi').reduce((n, p) => n + halala(p.amount), 0);
  const personal = lines.filter(l => l.account === 'personal' && appliedLine(l) && before(l.txDate));
  const transfers = personal.filter(l => l.decision === 'transfer').reduce((n, l) => n + (l.direction === 'debit' ? 1 : -1) * halala(l.amount), 0);
  const byDocuments = paid + transfers - received;
  const byStatement = personal.reduce((n, l) => n + (l.direction === 'debit' ? 1 : -1) * halala(l.amount), 0);
  const difference = byDocuments - byStatement;
  const result = { cutoffDate: cutoff, paid: riyal(paid), received: riyal(received), transfers: riyal(transfers), byDocuments: riyal(byDocuments),
    statementLines: personal.length, statementOut: riyal(personal.filter(l => l.direction === 'debit').reduce((n, l) => n + halala(l.amount), 0)),
    statementIn: riyal(personal.filter(l => l.direction === 'credit').reduce((n, l) => n + halala(l.amount), 0)),
    byStatement: riyal(byStatement), difference: riyal(difference), entry: null,
    status: posted.has(key) ? 'posted' : off ? 'off' : !personal.length ? 'needs_statement' : difference === 0 ? 'balanced' : 'proposed' };
  if (result.status !== 'proposed' && result.status !== 'posted') return result;
  const amount = riyal(Math.abs(difference));
  // Documents say the project owes Hadi more than his statement shows → reduce 2300; less → raise it.
  const lines2300 = difference > 0
    ? [{ accountId: ACCOUNTS.HADI, debit: amount, credit: 0, description: 'تسوية الحساب الجاري على كشف هادي' },
      { accountId: ACCOUNTS.SETTLEMENTS, debit: 0, credit: amount, description: 'فرق الحساب الجاري عن الكشف — فترة التأسيس' }]
    : [{ accountId: ACCOUNTS.SETTLEMENTS, debit: amount, credit: 0, description: 'فرق الحساب الجاري عن الكشف — فترة التأسيس' },
      { accountId: ACCOUNTS.HADI, debit: 0, credit: amount, description: 'تسوية الحساب الجاري على كشف هادي' }];
  const status = posted.has(key) ? 'posted' : closed.has(foundingEnd.slice(0, 7)) ? 'blocked_period' : 'proposed';
  result.status = status;
  result.entry = { key, type: 'hadi_statement', sourceKey: key, title: 'الحساب الجاري مقابل كشف هادي', date: foundingEnd, lines: lines2300, status, amount,
    description: `تسوية حساب هادي الجاري على كشفه لفترة التأسيس (قبل ${cutoff})`, ...(posted.get(key) || {}) };
  return result;
}

function payerLabel(pay, partner) {
  if (pay.payer === 'hadi') return pay.source === 'rule' ? 'دفع شخصي - فترة التأسيس' : 'من حساب هادي';
  if (pay.payer === 'partner') return `من جيب الشريك ${partner}`;
  if (pay.payer === 'custody') return `من عهدة ${pay.custodian}`;
  return pay.payer === 'cash' ? 'كاش من الصندوق' : 'من حساب الشركة';
}
function payerLineText(pay, partner) {
  if (pay.payer === 'hadi') return pay.source === 'rule' ? 'دفع شخصي - فترة التأسيس' : 'دفعه هادي من حسابه الشخصي';
  if (pay.payer === 'partner') return `دفعه الشريك ${partner} من جيبه`;
  if (pay.payer === 'custody') return `دُفع من عهدة ${pay.custodian}`;
  return pay.payer === 'cash' ? 'دُفع كاش من الصندوق' : 'دُفع من حساب الشركة';
}

/** الحقول الأربعة المطلوبة بعد القطع قبل الاعتماد. */
export function completenessGaps(doc) {
  const gaps = [];
  if (!doc.supplier || !String(doc.supplier).trim()) gaps.push('المورد');
  if (!(Number(doc.amount) > 0)) gaps.push('المبلغ');
  if (!doc.hasProof && !doc.statementLineRef) gaps.push('الإثبات');
  if (!RESOLVED_FUNDING.includes(doc.fundingType)) gaps.push('الحساب المقابل');
  return gaps;
}

// ── قيد التسوية يوم القطع ────────────────────────────────────────────────
function settlementFor({ settings, foundingEnd, book, entries, posted, closed }) {
  const cutoff = settings.cutoffDate, key = `settlement:${cutoff}`;
  const actuals = settings.actuals || null;
  const accounts = [ACCOUNTS.BANK, ACCOUNTS.CASH, ACCOUNTS.ADVANCES];
  const bookAt = Object.fromEntries(accounts.map(a => [a, Math.round(book[a] || 0)]));
  // The proposed corrections inside the founding period move these balances too.
  const pending = Object.fromEntries(accounts.map(a => [a, 0]));
  const waiting = entries.filter(e => e.status === 'proposed' && e.date < cutoff && e.lines.some(l => accounts.includes(l.accountId)));
  for (const e of waiting) for (const l of e.lines) if (accounts.includes(l.accountId)) pending[l.accountId] += halala(l.debit) - halala(l.credit);
  const after = Object.fromEntries(accounts.map(a => [a, bookAt[a] + pending[a]]));
  const result = { cutoffDate: cutoff, foundingEnd, book: bookAt, afterCorrections: after, actual: null, differences: null, entry: null,
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
  if (!lines.length && !posted.has(key)) { result.status = 'balanced'; return result; }
  const entryStatus = posted.has(key) ? 'posted' : waiting.length ? 'waiting' : closed.has(foundingEnd.slice(0, 7)) ? 'blocked_period' : 'proposed';
  result.status = entryStatus;
  result.entry = { key, type: 'settlement', sourceKey: key, title: 'تسوية فترة التأسيس', date: foundingEnd, lines, status: entryStatus,
    amount: riyal(Math.abs(net)), description: `تسوية فترة التأسيس عند بدء البنك ${cutoff} — الفرق الباقي بين الدفاتر والواقع`,
    ...(posted.get(key) || {}) };
  return result;
}

// ── كشف حساب هادي الجاري ────────────────────────────────────────────────
const KIND_LABEL = {
  expense: 'مصروف دفعه هادي', partner_payment: 'دفعة شريك استلمها هادي',
  founding_document: 'تصحيح: مصروف دفعه هادي', founding_payment: 'تصحيح: دفعة شريك استلمها هادي',
  founding_transfer: 'تحويل بين هادي وحساب الشركة', founding_settlement: 'تسوية فترة التأسيس',
  founding_hadi_statement: 'تسوية الحساب الجاري على الكشف', founding_adjustment: 'تسوية على 3200 بقرارك',
  founding_receipt: 'دفعة شريك استلمها هادي',
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

const PENDING_STATUS = { held_vat: 'بانتظار مراجعة الإقرار', blocked_period: 'الفترة مقفلة', waiting: 'بعد ترحيل التصحيحات' };
function hadiStatement({ hadiLedger, rows, payments, entries }) {
  let running = 0;
  const posted = [...hadiLedger].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.entryNumber || 0) - (b.entryNumber || 0))
    .map(l => {
      running += halala(l.credit) - halala(l.debit);
      return { ...l, label: movementLabel(l.sourceType, l.sourceKind), balance: riyal(running) };
    });
  const pending = [];
  for (const d of rows) if (!d.protected && d.payer === 'hadi') {
    pending.push({ key: d.key, date: d.date, label: 'مصروف دفعه هادي — لم يُعتمد ويُرحّل بعد', description: d.title, debit: 0, credit: d.amount, status: 'unposted' });
  }
  // Received by Hadi as decided (or recorded), even before the payment record itself is updated.
  for (const p of payments) if (!p.protected && p.arrival === 'hadi') {
    pending.push({ key: p.key, date: p.date, label: 'دفعة شريك استلمها هادي — لم تُرحّل بعد', description: `دفعة ${p.partnerName}`, debit: p.amount, credit: 0, status: 'unposted' });
  }
  for (const e of entries) if (e.status !== 'posted') for (const l of e.lines) if (l.accountId === ACCOUNTS.HADI) {
    pending.push({ key: e.key, date: e.date, label: `${movementLabel(null, `founding_${e.type}`)} — ${PENDING_STATUS[e.status] || 'بانتظار موافقتك'}`,
      description: e.title, debit: l.debit, credit: l.credit, status: e.status });
  }
  pending.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const postedBalance = running;
  const projected = pending.reduce((n, p) => n + halala(p.credit) - halala(p.debit), postedBalance);
  return { posted, pending, postedBalance: riyal(postedBalance), projectedBalance: riyal(projected),
    meaning: balanceMeaning(postedBalance), projectedMeaning: balanceMeaning(projected) };
}
