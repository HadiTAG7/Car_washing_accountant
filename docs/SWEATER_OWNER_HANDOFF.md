# Owner-confirmed SSP wash handoff

The staff handoff uses the existing admin/accountant Firebase session and
`/api/ledger`. It needs no integration key, new role, or Firestore rules change.
The existing HMAC import contract remains separate and unchanged.

1. Read SSP in its authorized visible session. Transfer only sanitized records
   and actual extraction coverage. Exclude cancelled bookings explicitly.
   For an observed complete `accountBookings` module, use typed coverage
   `scope: "accountBookings"`, `scopeComplete: true`, `sourceRecordCount`,
   `excludedCancelled` and `imported`. Keep global `isComplete: false` when
   Company/B2B has not been verified. For example, 10 source rows minus 3
   cancelled rows yields 7 imported rows (`recordCount: 7`, `imported: 7`).
   All counts must be nonnegative integers, source must equal cancelled plus
   imported, imported must equal delivered rows, and all declared pages must
   have been fetched. Unknown scopes, missing metadata and incomplete scopes
   cannot be saved. No source rows are silently filtered or deduplicated.
2. Supply the observed SSP worker identifier on every record. In `workerLinks`,
   map each identifier to the confirmed internal `bikers` document ID. Never
   create workers, guess a name match, or use a sample salary.
3. Add `ownerConfirmation` with `source: "owner_statement"`, `ownerName`, the
   owner's `statement`, `unitAmount`, `totalAmount`, and `vatAmount: null`.
   Unit/total amounts are the owner's batch-specific assertion, not SSP prices
   and not a tax/price policy. Unknown VAT stays null, not zero.
4. Review locally, confirm the source, then request the server preview in
   Integration. Check worker/count/amount/commission and booking details.
5. Confirm saving separately. The client sends the same canonical payload,
   `reviewedPayloadHash` and `previewStateHash` to `sweaterSaveOwnerHandoff`.
   Editing the file invalidates the preview and confirmation. A failed save
   requires another preview; the UI does not retry writes automatically.

The server rechecks the current role and validates the whole batch. A single
Firestore transaction rereads every booking, worker, wash, owner evidence,
legacy financial link and operational link before any write. An invalid,
conflicting, cancelled, incomplete or stale batch saves nothing. Maximum 50
washes keeps the transaction within the write limit.

Saved documents:

- `sweater_bookings/{encoded SSP ID}` and versioned raw payloads: raw SSP
  status/payment facts remain unchanged. Observed `Collecting Payment` and
  `CollectingPayment` normalize to `payment_collection`, not paid. No synthetic
  completion timestamp or platform amount is added.
- `washes/ssp__{encoded SSP ID}`: one completed wash, worker registry ID/name,
  SSP worker ID, service date and owner-asserted unit price. `revenue_origin` is
  `sweater`, so the existing wash posting adapter refuses manual revenue posting.
  `payment_method` and `vat_amount` are null.
- `sweater_owner_collection_confirmations/{encoded SSP ID}`: separate owner
  assertion, amount, provenance and the server actor/recording time; no bank
  movement, payment method or accounting receipt is inferred.
- `sweater_operational_wash_links`: deterministic links both ways. This is
  intentionally separate from `sweater_booking_links`, whose legacy meaning in
  settlement is "already posted through a wash". An operational import does
  not claim that posting happened or alter monthly recognition policy.
- `sweater_import_runs` and integration state: atomic completed run, hashes,
  coverage and result IDs for replay/audit. An account-only import has run
  status `completed_with_gaps`; its saved coverage retains `isComplete: false`.
  Preview, save and replay keep the warning that Company/B2B is unverified.
  Scoped import success never claims company/month completeness or closing.

Same run + same complete payload returns the stored result without writing.
Same run + different source/evidence/worker mapping rejects. Another run cannot
create another wash or overwrite an existing confirmation: natural IDs,
transaction reads and the SSP lookup protect both. A changed database state
since the preview requires a fresh preview.

The Washes screen retains its existing log and adds a compact worker summary
for owner-confirmed SSP washes, with optional booking details. The commission
instruction is recorded as 4.50 per completed wash, payable with payroll and
not paid now. It is never deducted from the wash price.

## Existing payroll gap

The subsequent owner-authorized correction is documented in
[the commission policy](SWEATER_PAYROLL_COMMISSION.md): new drafts for October
2026 and later use 4.50, while historical snapshots remain unchanged. The
paragraph below records the discrepancy found before that correction.

Before that correction, `functions/src/payroll.js` calculated 2 per completed wash from
`washes`, linked by `biker_id` (name fallback for legacy rows). It uses each
worker's stored salary and a monthly worker payment lock; it does not deduplicate
commission sources by SSP ID. The new deterministic imported wash IDs prevent
this importer from duplicating commission source rows. The 4.50 instruction is
stored and displayed, but no payroll rate, accrual, payment or payroll writer
is changed here. Resolve that rate mismatch before approving payroll. Do not
invoke `sweaterRecordCollection`: it posts a bank collection automatically.

Deployment includes UI, `/api/ledger` and its shared source modules on Vercel.
The callable export is kept in parity, but this UI is pinned to Vercel and
does not depend on separately deploying Firebase Functions. No source records
may be saved until the deployed commit is verified and the actual batch has
passed its server preview in the authorized application session.
