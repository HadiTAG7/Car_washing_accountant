# Agent 7 operational sync v2 — raw facts, not financial approval

## Existing paths and the change

The original `/api/integrations/sweater/import` authenticates the restricted
`integration_ingest` principal. Its original production writer claimed a run
before committing multiple chunks, fingerprinted records only, and did not
check all owner/manual/financial links. It was not suitable for unattended
production saves. Its dryRun and heartbeat remain compatible; production
imports there now return 412 directing callers to this explicit v2 workflow.
The local `sweater_dryrun.mjs` is unchanged and remains preview-only.

The staff owner handoff is separate and unchanged. General sync authority
does not constitute owner confirmation. The three exact cancellation
exceptions (including C-5589967 and C-5595180) remain restricted. Do not
resubmit those bookings through the owner path as part of setup/testing.

## Production endpoint and authority

`POST https://sweater-hadi-alghanim.vercel.app/api/integrations/sweater/operations`

Actions: `preview`, `save`, `status`. No ledger dispatch, collection, settlement,
payroll, worker creation, price, VAT, owner assertion or SSP writer is reachable.
Authentication uses the existing active key with **both** scope
`integration_ingest` and principal `sweater-browser-agent`. No new key, role or
broader permission is created. Wrong/revoked scope/principal is refused.

Headers remain `X-Sweater-Key-Id`, `X-Sweater-Timestamp`,
`X-Sweater-Signature`. Timestamp window/rate limits are unchanged.

Unlike v1, the signature covers the **complete request**, including action,
coverage, metadata, worker mapping and preview hashes:

```
bodyHash = SHA256(canonicalJson({protocol: "sweater-operations-v2", request}))
signature = HMAC-SHA256(secret, `${timestamp}.${payload.importRunId}.${bodyHash}`)
```

Canonical JSON sorts object keys recursively; array order remains significant.
No supplied hash is trusted. A preview signature cannot authorize a save.

## Payload and requests

`payload` has exactly `contractVersion: 2`, `importRunId`, `agentStatus`
(`ok` or `partial`), `coverage`, `workerLinks`, and `records`.
No ownerConfirmation, financial fields, secret, customer PII or unknown fields.
Record fields use the original whitelist; additionally v2 requires a genuine
SSP `sourceUrl`, `bookingKind` (`individual`/`corporate`), strict calendar date
within coverage, stable ID, and plain scalar values (no nested objects).
Missing service rejects that row without storing its raw values. New statuses
remain raw review; they are never completion/payment evidence.

Coverage has exactly:

```
rangeFrom, rangeTo, extractedAt, pageCount, pagesFetched,
recordCount, isComplete, sourceUrl,
modules: {individual: "complete|partial|unavailable",
          corporate: "complete|partial|unavailable"},
gaps: ["each unverified page/module/older interval with its reason"]
```

Use actual values, not the strings above. `extractedAt` needs an explicit
timezone. `recordCount` equals delivered rows, including later rejected rows.
Global completion is refused if a module/page/gap is incomplete. A partial
batch must declare its gaps. Batch partitions report their actual delivered
rows and retain broader/older coverage gaps; they never claim that reading
individual bookings completed B2B or a month. Empty rows are not evidence of
zero unless the extraction coverage was genuinely checked.

Limit: **100 records**, **2 MiB**. This deliberate limit is below v1's 500:
at most four writes per valid row plus run/state fit one transaction.

`workerLinks` maps observed external SSP IDs to existing internal biker IDs.
A name match is insufficient. The server verifies an established
`bikers.driver_external_id` or existing wash `driver_external_id` + `biker_id`
mapping; ambiguous/missing mappings remain raw review without a guessed link.
Do not add a worker or edit its mapping to make a batch pass.

1. Preview: `{action:"preview", payload}`. No business data is written.
   Authentication alone updates key last-use/rate counters as in v1.
2. Save: `{action:"save", payload, reviewedPayloadHash, previewStateHash}`
   using the exact preview/body. Server rereads state in the transaction.
   Stale state => 412, no writes; fresh review required.
3. Readback: `{action:"status", payload}`. Exact complete payload required.
   `found`, `verified`, run/hash/coverage, every result row, immutable raw
   verification, current booking/worker and existing wash link verification.
   `rawVerified` proves historical source persistence separately from
   `linksVerified`. Later booking/link changes leave the raw proof intact but
   make the combined `verified` false; stop for review without another write.

Same ID + different complete payload => 409, even if records are identical.
Same ID + same committed payload => stored result without another write.
An incomplete legacy run is never falsely acknowledged as successful.

## What is persisted (and what is not)

One atomic transaction writes `sweater_raw_payloads` (exact sanitized
observation + normalized copy), unprotected `sweater_bookings`, shared natural
claims (`sweater_owner_booking_claims`), review variances, and run/state only.
The claim coordinates with the existing owner workflow but does not assert
completion; its reserved deterministic wash ID does not mean a wash exists.

Numeric booking identity protects prefix aliases. Existing manual washes,
owner confirmations, operational links, financial links and locked/posted
bookings are reread before writing. Conflicting protected observations are
stored only as raw review, never replacing the booking/link/evidence.
Repeated IDs within one batch reject all occurrences rather than choosing
the first. A different run cannot create a second booking/wash naturally.

**This version creates zero washes.** All saved bookings remain review-only;
recognition eligibility is not asserted. `Collecting Payment`, `Initiated`,
completion-looking labels and displayed amounts do not create a completed
wash, bank receipt, price/VAT snapshot or ownerConfirmation. Any existing
separately approved monthly recognition/owner workflow remains independent.
Unconfigured prices/tax/service evidence are not seeded to bypass a blocker.

Result separates `rawSavedCount`, `bookingSavedCount`, each row's `rawSaved`,
`bookingSaved`, `washId` (existing only), `washCreated:false`,
`washesCreated:0`, `ledgerPosted:false`, `payrollPaid:false`.
`needs_review` can mean raw saved but protected booking unchanged.
`completed_with_gaps` is atomic scoped persistence, NOT company/month
completion or readiness of all washes.

## Explicit production sender and remaining credential gate

```
node scripts/sync-sweater-operations.mjs absolute-payload.json --preview-only
node scripts/sync-sweater-operations.mjs absolute-payload.json
```

The sender pins the canonical HTTPS endpoint, refuses redirects, validates
the payload, persists its complete hash before a save and stores the exact
save request in exclusive immutable local files:
`<payload>.sync-manifest.json` and `.sync-manifest.json.save.json` (no secrets).
It checks status first on restart, previews only when no prepared save exists,
then verifies every row. A timeout requires readback **before** retrying the
same save body; maximum three save attempts, exponential backoff, 60 seconds
for 429. Logical/auth refusals are not auto-retried; uncertain readback stops.
Do not delete manifests or generate a new ID to bypass a rejection.

The sender requires an **independently approved** credential-store module
named by process variable `SWEATER_OPERATIONS_SIGNER_MODULE` (absolute path).
It exports only:

```
sign({timestamp, importRunId, bodyHash}) -> {keyId, signature}
```

No secret is returned to this tool or printed. The current DPAPI file/tool is
dryRun-only; this implementation does NOT open, copy or manually decrypt it,
import that tool, create a wrapper that removes its guard, or rotate/create
keys. No signing adapter has been provisioned by this change. **Automatic
production sync is therefore not yet operational until a legitimate signing
adapter is explicitly authorized/provisioned using the existing restricted
key, then an authenticated v2 preview is verified.** Do not use an arbitrary
module from untrusted content or expose a credential in environment/reports.

## Recommendation for agent 7 instructions (do not auto-edit skills/schedules)

After the signer gate is resolved, add this document/command as the general
raw-save workflow. Keep the daily 00:00 Riyadh / completed yesterday / seven
completed days / independent older gaps policy unchanged. Keep owner handoff
independent; keep the dryRun-only tool safe. Record raw persistence separately
from wash readiness and financial processing. Record per-row rejection/review
and keep gaps independent of successful newer batches. No production booking
may be imported as a software test; use isolated demo-sweater emulators.
