# Approved one-booking identity reconciliation —5596423

Hadi's specific approval is the direct administration message `01a1299e-6982-7b80-a5bb-de93279daffe` on11Oct2026, after the question authorizing correction without deletion/protection bypass, followed by one wash/commission. This does not authorize generic aliases, another booking/date/worker, Firebase deployment, collection/payment/posting or rewriting historical records. Release readiness must be established separately by the exact commit, gates and live preview; this contract is not evidence of deployment or a completed save.

## Unchanged transport

Use only the already pinned sender in `work/operations-signer-20261009`, its existing Windows adapter and existing v2 signature. Do not edit any sender/adapter/key/fingerprint. Endpoint remains `POST https://sweater-hadi-alghanim.vercel.app/api/integrations/sweater/operations`.

Actions and signed envelopes are unchanged:

- Preview: `{action:"preview",payload}`. No business writes; authentication usage counters may change.
- Save: `{action:"save",payload,reviewedPayloadHash,previewStateHash}` from a fresh preview of the identical body.
- Readback/status: `{action:"status",payload}` with the same run/body, including after a timeout. Never replace/delete a prepared manifest or select a new run to evade an uncertain save.

Do not run save until the new Vercel release and live preview are verified and administration explicitly assigns the actual single-booking save to7. Engineering does not test business writes in Production.

## Exact approved input scope

Derive **one** record from the existing verified SSP evidence, keeping `sspBookingId=S-5596423`; do not substitute B in the source payload. `contractVersion=2`, `records.length=coverage.recordCount=1`, `coverage.rangeFrom=coverage.rangeTo=2026-10-10`. Preserve honest partial coverage and gaps; this singleton does not claim the entire day's coverage or re-import the other24 washes.

- Date2026-10-10; individual booking; driverExternalId1986; established current worker `KehSV5K73zkyWWEE8hE9`.
- `serviceType=interior_exterior_wash`, final source status `Collecting Payment`.
- Actual Start `2026-10-10T22:42:00+03:00`, End `2026-10-10T23:35:00+03:00`, extraction after End from the existing read. These are not the scheduled appointment.
- No ownerConfirmation, price/commission/tax override, customer data or extra input flag. Those inputs remain rejected.

## Server decision, not caller assertion

`identityResolution` in the redacted preview names the approval, old/current booking IDs and reserved wash ID. Every `checks` value must be true and `eligible=true`; otherwise keep the row protected and investigate the failed guard, without repeating the other24 rows. Unknown fields/shapes on B or the claim, missing historical raw/claim, different old worker/date/state or unknown period state fail closed. Failed financial reads never become empty results.

The server reads B, the existing numeric claim, the original raw from `ops-20261011-oct10-210648`, current worker mapping, the planner's **complete natural-identity related set for every letter prefix**, nested owner references and orphan link IDs, and the period/settlement. B/S are the approved pair, not an exhaustive list of protected aliases.

For this approved singleton only, the server audits identifier-column projections (`select`) in the five existing journal/lock/transaction/collection/adjustment stores, matching their source references by natural identity inside the server. Fixed `in(B,S)` lookups cannot establish absence of a third-prefix orphaned financial reference. No amounts, balances, person names or complete financial rows are selected or returned. Only matching reference fingerprints enter CAS, not unrelated financial data. SDK DocumentReference paths and known nested reference fields are covered; unsupported/cyclic metadata or failed reads fail closed. This is a one-booking audit, costs reads proportional to the identifier documents in these stores, and introduces no index/schema/credential or general financial endpoint. Non-approved scope does not perform the financial audit and cannot qualify. This decision is re-read inside the transaction; body/state hash mismatch rejects the save with412 and no writes.

## Atomic result and preserved identity

The canonical wash document is **`washes/ssp__B-5596423`**, the deterministic wash ID already reserved by the original numeric claim; it is not an arbitrary new ID. Its `ssp_booking_id` remains the actual current source **S-5596423**. The claim, B booking and original B raw are kept byte-for-byte unchanged. The current S observation/booking, the wash and the import-run's resolution audit are saved in the existing transaction/stores. No new collection or general migration is introduced. The retained B unknown-service record remains historical review evidence, not a second executed service.

The one new wash uses existing approved net20/VAT3/gross23 and4.50 unpaid commission, quantity1, original service date, pending collection and null payment method. No owner collection assertion, money receipt, payroll payment or journal is created.

Preview: `washCreated=false`, `identityResolution.resolutionSaved=false`. Successful first save: `washCreated=true`, `washesCreated=1`, `identityResolution.resolutionSaved=true`, `replay=false`. Same-run replay returns the existing result with `replay=true`, not a second creation. Another run after completion remains protected. Readback must return `verified/rawVerified/linksVerified=true` and `identityResolutionSaved/identityResolutionVerified=true`, verifying the preserved claim/B/raw hashes and the one wash hash. An ambiguous timeout is resolved by status/replay of the same run only.

## Release and execution gate

Verify tests against the exact final code hashes, including the C/other-prefix manual wash, nested owner evidence, orphan journal/reference and their concurrent introduction after preview. An older green candidate does not verify a subsequently changed guard. Then verify Vercel Ready/commit/alias and a signed **preview-only** of the actual singleton through the pinned sender. Only administration may assign7the actual save after these checks; engineering performs no Production business-write test. Keep the actual payload/run/manifest unchanged. No Production release or save is authorized by this document alone.
