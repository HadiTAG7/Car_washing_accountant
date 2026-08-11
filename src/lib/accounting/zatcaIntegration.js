// ═══════════════════════════════════════════════════════════════════════════
// حدود التكامل مع ZATCA — the integration boundary
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ NOTHING HERE TALKS TO ZATCA. This file exists so that a real integration
// has one obvious place to attach, and so that the rest of the app codes
// against a stable interface instead of scattering assumptions about
// e-invoicing through the UI.
//
// Every function returns a NOT_IMPLEMENTED result rather than throwing or —
// worse — silently succeeding. A caller that ignores the result must not end
// up believing an invoice was reported when it was not.
//
// What a real Phase-2 implementation needs, and why none of it can be faked
// client-side:
//   1. Onboarding — generate a CSR, exchange an OTP from the ZATCA portal for
//      a compliance certificate, then a production certificate. The private
//      key must never reach a browser, so this belongs on a server.
//   2. Invoice hash chain — every invoice carries the hash of the previous
//      one (PIH), which requires a single serialized issuer, not N clients.
//   3. Cryptographic stamp — XML canonicalisation + ECDSA signature over the
//      UBL document, using that certificate.
//   4. Reporting (simplified/B2C) within 24 hours, or Clearance (standard/B2B)
//      before issuance.
//
// Implementing 1–4 means adding a trusted server (Cloud Functions or similar)
// and moving issuance behind it. The app is structured so that only the
// functions below would change.
// ═══════════════════════════════════════════════════════════════════════════

export const NOT_IMPLEMENTED = 'not_implemented';

function unavailable(operation, arabic) {
  return {
    ok: false,
    status: NOT_IMPLEMENTED,
    operation,
    message: arabic,
    // Machine-readable so a caller can branch without string matching.
    requiresServer: true,
  };
}

/** Would exchange a CSR + OTP for a compliance certificate. */
export async function onboardDevice() {
  return unavailable('onboarding',
    'ربط الجهاز بمنصة فاتورة غير منفّذ — يتطلب خادماً موثوقاً يحتفظ بالمفتاح الخاص.');
}

/** Would produce the invoice hash and chain it to the previous invoice. */
export async function computeInvoiceHash() {
  return unavailable('invoice_hash',
    'تسلسل تجزئة الفواتير غير منفّذ — يتطلب جهة إصدار واحدة متسلسلة.');
}

/** Would canonicalise the UBL XML and sign it with the production certificate. */
export async function stampInvoice() {
  return unavailable('cryptographic_stamp',
    'الختم التشفيري غير منفّذ — يتطلب شهادة إنتاج من هيئة الزكاة والضريبة والجمارك.');
}

/** Would POST a simplified (B2C) invoice to the reporting API within 24h. */
export async function reportSimplifiedInvoice() {
  return unavailable('reporting',
    'إبلاغ الفواتير المبسطة غير منفّذ — لم يتم الربط بمنصة فاتورة بعد.');
}

/** Would POST a standard (B2B) invoice for clearance before issuance. */
export async function clearStandardInvoice() {
  return unavailable('clearance',
    'مطابقة الفواتير الضريبية غير منفّذة — لم يتم الربط بمنصة فاتورة بعد.');
}

/**
 * Single source of truth for the UI: what is real and what is not.
 * Pages render this rather than asserting compliance on their own.
 */
export function integrationSummary() {
  return {
    connected: false,
    phase: null,
    implemented: ['رمز QR للفاتورة المبسطة (المرحلة الأولى)', 'ترقيم متسلسل للمستندات', 'إشعارات دائن ومدين'],
    missing: [
      'ربط الجهاز (CSR والشهادات)',
      'تسلسل تجزئة الفواتير',
      'الختم التشفيري',
      'الإبلاغ عن الفواتير المبسطة',
      'مطابقة الفواتير الضريبية',
    ],
    warning: 'المستندات الصادرة من هذا النظام وثائق داخلية — لم يتم إرسالها '
           + 'إلى هيئة الزكاة والضريبة والجمارك ولا مطابقتها.',
  };
}
