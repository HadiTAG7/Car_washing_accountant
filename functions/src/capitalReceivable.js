// ═══════════════════════════════════════════════════════════════════════════
// «ذمة رأس مال غير مسددة» — رأس مال اكتتب فيه الشريك ولم يدفعه بعد
// ═══════════════════════════════════════════════════════════════════════════
// تُثبت بقيد: مدين 1100 «ذمة رأس مال — اسم الشريك» ودائن رأس ماله (3000-<الشريك>).
// فرأس المال في الدفتر = المدفوع + غير المسدد، والذمة رصيدٌ مستقل لا فرق.
// وسند القبض لشريك عليه ذمة يُقفلها أولًا: دائن 1100 حتى تنتهي، والباقي لرأس
// المال. حساب خالص يشترك فيه الخادم (الترحيل) والصفحات (المطابقة).
// ═══════════════════════════════════════════════════════════════════════════

export const CAPITAL_RECEIVABLE_ACCOUNT = '1100';
export const CAPITAL_RECEIVABLE_PREFIX = 'ذمة رأس مال';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const halala = value => Math.round((Number(value) || 0) * 100);
const DESCRIPTION = /^ذمة رأس مال\s*[—–-]\s*(.+)$/;

/** The line description that names the partner a capital receivable belongs to. */
export const capitalReceivableDescription = name => `${CAPITAL_RECEIVABLE_PREFIX} — ${clean(name)}`;

/**
 * Whose capital receivable a line is. A line we write carries `partnerId`; a line
 * written by hand is «ذمة رأس مال — <الاسم>» naming exactly one partner.
 * Returns the partner id, `undefined` for a capital-receivable line no single
 * partner can be found for, or `null` for any other line.
 */
export function capitalReceivablePartner(line, partners) {
  if (String(line?.accountId ?? '') !== CAPITAL_RECEIVABLE_ACCOUNT) return null;
  const tagged = clean(line.partnerId);
  if (tagged) return (partners || []).some(p => String(p.id) === tagged) ? tagged : undefined;
  const named = DESCRIPTION.exec(clean(line.description))?.[1];
  if (!named) return null;
  const hits = (partners || []).filter(p => clean(p.name) === clean(named));
  return hits.length === 1 ? String(hits[0].id) : undefined;
}

/**
 * Outstanding receivable per partner (riyal), from posted lines (posted and
 * reversed entries — a reversal is its own mirror). `unmatched` are lines that
 * look like a capital receivable but name no single known partner.
 */
export function capitalReceivables(postedLines, partners) {
  const totals = new Map(), unmatched = [];
  for (const line of postedLines || []) {
    const partnerId = capitalReceivablePartner(line, partners);
    if (partnerId === null) continue;
    if (partnerId === undefined) { unmatched.push(line); continue; }
    totals.set(partnerId, (totals.get(partnerId) || 0) + halala(line.debit) - halala(line.credit));
  }
  return { byPartner: new Map([...totals].map(([id, n]) => [id, n / 100])), unmatched };
}

/**
 * How a receipt is credited: to the partner's open receivable first, until it is
 * settled, then to capital. Amounts in riyal; never more than the receipt.
 */
export function splitPartnerReceipt(amount, outstanding) {
  const total = Math.max(0, halala(amount)), open = Math.max(0, halala(outstanding));
  const receivable = Math.min(total, open);
  return { receivable: receivable / 100, capital: (total - receivable) / 100 };
}

/** The credit lines of a partner receipt: 1100 for the open receivable, the rest to capital. */
export function partnerReceiptCredits({ amount, outstanding, partnerId, partnerName, capitalAccount, capitalDescription }) {
  const split = splitPartnerReceipt(amount, outstanding);
  // No open receivable: exactly the capital line a receipt always had.
  if (split.receivable === 0) return [{ accountId: capitalAccount, debit: 0, credit: Number(amount) || 0, description: capitalDescription }];
  return [
    ...(split.receivable > 0 ? [{ accountId: CAPITAL_RECEIVABLE_ACCOUNT, debit: 0, credit: split.receivable,
      description: capitalReceivableDescription(partnerName), partnerId: String(partnerId) }] : []),
    ...(split.capital > 0 ? [{ accountId: capitalAccount, debit: 0, credit: split.capital, description: capitalDescription }] : []),
  ];
}
