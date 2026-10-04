const round2 = n => Math.round(n * 100) / 100;

// A recorded, source-backed split; missing tax evidence is never zero VAT.
export function ownerWashTaxSplit(wash) {
  const s = wash?.ownerTaxSnapshot;
  if (!s || s.source !== 'owner_statement' || s.currency !== 'SAR' || !s.clarificationId
    || s.priceMode !== 'exclusive' || s.quantity !== wash.quantity
    || ['net', 'vat', 'gross'].some(key => typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < 0)
    || round2(s.net + s.vat) !== s.gross || round2(wash.quantity * wash.price) !== s.net) return null;
  return { net: s.net, vat: s.vat, gross: s.gross };
}
