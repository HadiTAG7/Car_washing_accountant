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
With Hadi's specific approval on 10 October 2026, missing service is retained
only as `needs_review` / `unknown_service_type`, with an empty normalized
service (never a guessed placeholder). All other row/source/scalar/privacy
checks still apply. A missing-service observation cannot erase an existing
known service or overwrite a protected booking; its raw evidence is retained
separately. The shared financial/owner contract remains strict: no completed
wash, price, tax, recognition eligibility or revenue is created. This exception
applies only to operations v2, not the legacy/owner/financial workflows.
New statuses
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

## Explicit production sender and approved Windows signing adapter

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

The sender requires the **independently approved** Windows credential-store
module named by process variable `SWEATER_OPERATIONS_SIGNER_MODULE` (absolute
path). Hadi approved binding the existing credential on 9 October 2026, without
new keys, roles, permissions, schedules or agent instruction changes.
It exports only:

```
sign({timestamp, importRunId, bodyHash}) -> {keyId, signature}
```

No secret is returned to this tool or printed. The old tool remains dryRun-only
and unmodified. Its existing DPAPI **credential store** is read programmatically
only by the separately approved signing child; this is NOT an import/wrapper
of the old tool or removal of its guard. No key was created, rotated or revoked.

The adapter's tracked source is `scripts/signers/windows-operations-signer.mjs`
and `scripts/lib/windows-operations-signing.mjs`. Its installed production
location on the current Windows account is:

```
C:\Users\MMC\.codex\automations\automation-2\operations-v2\signers\windows-operations-signer.mjs
```

Its sibling `../lib/windows-operations-signing.mjs` and `approved-sender.json`
contain code and approved absolute caller paths/SHA-256 fingerprints only,
never secrets. The new `operations-v2` directory is private to the current
Windows user. The existing credential file and its ACL were not changed.
Do not relocate/recreate this installation or overwrite the policy to bypass
a mismatch. Provisioning on another machine/user requires fresh approval.

The sender resolves only this private installed module, verifies it and its
helper against the tracked approved sources **before import**, and rejects
arbitrary modules/URLs. The adapter permits only the exact approved sender
entrypoint and checks approved sender/client/contract source fingerprints.
Input must be exactly timestamp/run/full body hash and recent; the client
validates v2 action/envelope/preview hashes before signing. The trusted child
uses the fixed built-in Windows PowerShell executable with a minimal env,
reads the existing DPAPI file internally, refuses an unexpected key ID,
reparse-point store or broader file permissions, then produces only
`{keyId,signature}`. Plaintext never appears in stdout, stderr, argv, env,
payload, manifest or reports. BSTR/key buffers are cleared and the child
times out after 15 seconds. Internal diagnostics are discarded. These
controls do not claim sandbox isolation from a malicious current-user or
Administrator process: Windows account isolation remains the boundary.

The **path only** is saved in the Windows User environment. A running Codex
process may not inherit a newly set User variable; the agent's command must
load it into the child process explicitly (no secret value is involved):

```powershell
$env:SWEATER_OPERATIONS_SIGNER_MODULE = [Environment]::GetEnvironmentVariable('SWEATER_OPERATIONS_SIGNER_MODULE','User')
Set-Location -LiteralPath 'C:\Users\MMC\Documents\ChatGPT\شغل سويتر\work\operations-signer-20261009'
node scripts/sync-sweater-operations.mjs 'ABSOLUTE-VERIFIED-PAYLOAD.json' --preview-only
```

Only remove `--preview-only` for an actual verified operational batch within
agent 7's separate save authority; not a software test. Do not run the empty
authentication diagnostic as a save or advance coverage based on it.

The signed production diagnostic preview succeeded on 9 October 2026 using
the existing restricted key: empty records, zero SSP pages read, both modules
unavailable, honest explicit gaps. `dryRun:true`, `saved:false`,
`rawSavedCount:0`, `bookingSavedCount:0`, `washesCreated:0`,
`ledgerPosted:false`, `payrollPaid:false`. Authentication updated existing
key last-use/rate metadata only. This proves authentication and the preview
boundary, **not a production save/readback or completed wash workflow**.
The authentication gate is resolved for this installed account/caller; no
automation has been enabled and no operational import has been performed.

## Recommendation for agent 7 instructions (do not auto-edit skills/schedules)

After the signer gate is resolved, add this document/command as the general
raw-save workflow. Keep the daily 00:00 Riyadh / completed yesterday / seven
completed days / independent older gaps policy unchanged. Keep owner handoff
independent; keep the dryRun-only tool safe. Record raw persistence separately
from wash readiness and financial processing. Record per-row rejection/review
and keep gaps independent of successful newer batches. No production booking
may be imported as a software test; use isolated demo-sweater emulators.
