// Hadi's clarification applies only to the twelve already reviewed washes.
export const OWNER_WASH_TAX_PLAN = Object.freeze({
  id: 'owner-wash-tax-2026-10-04', ownerName: 'هادي',
  statement: 'ال20 ريال هذي بدون ضريبة مع الضريبة تكون23 عشان تزبط الincome statment',
  net: 20, vat: 3, gross: 23,
  bookings: Object.freeze([
    ['S-5572978', '2026-10-03'], ['S-5573072', '2026-10-03'], ['S-5573186', '2026-10-03'],
    ['S-5573222', '2026-10-03'], ['S-5573955', '2026-10-03'], ['S-5574285', '2026-10-03'],
    ['S-5574769', '2026-10-03'], ['S-5577358', '2026-10-04'], ['S-5577940', '2026-10-04'],
    ['S-5578479', '2026-10-04'], ['S-5578860', '2026-10-04'], ['S-5579162', '2026-10-04'],
  ]),
});
