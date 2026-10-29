# Agent 7 operational sync v2 — raw facts and evidenced wash executions

## Actual ongoing washing under the standing owner decision (27 October 2026)

Automatic v2 still requires genuine Start and End before it creates an executed wash. An actual `Washing Started` observation with genuine Start and null End is first stored truthfully by v2. Under Hadi's standing 18 October instruction, the authorized operations manager then uses the existing administrative preview/save workflow described in [SWEATER_ADMINISTRATIVE_COMPLETION.md](SWEATER_ADMINISTRATIVE_COMPLETION.md), with the original owner reference and the current batch's explicit booking IDs. No daily approval request, invented End, collection assertion, new sender, signature, key, pin, or schedule is required. Existing natural claims and canonical wash identities prevent a second entitlement when genuine completion arrives later. Never replay the two already verified 26 October executions merely to test this repair.

## Later completion after a started observation (24 October 2026)

The same v2 preview/save/status workflow can promote an earlier `washing_started`
observation when SSP reports a different prefix for the same numeric booking.
There is no new input flag, permission, signer, sender or owner assertion.
The earlier observation must be an intact operations-only `execution_not_final`
record with the same worker, service day, service type and actual Start Service.
The later observation must satisfy all existing genuine End Service checks.
The closed earlier run and immutable raw must prove that no execution was made,
and its extraction must precede the newly observed completion.

Any existing wash, owner decision/link, ambiguous alias, financial reference,
closed period or protected settlement continues to block promotion. These facts
are rechecked inside the existing transaction; changed previews fail closed.
The one new wash uses the original reserved wash ID from the natural-number
claim. The B booking, historical raw, original claim and closed run are never
rewritten. A new current-prefix booking and raw retain the later source facts.
`observationPromotion` in the result exposes the checks and hashed evidence;
`status` verifies preservation separately from the later booking.

29 October correction: the immutable natural claim identifies the first source
run, while the current booking can legitimately identify a later unexecuted run.
Both endpoints must independently match their raw facts and unique closed-run
receipt, worker, day and service, with ordered source extraction times before End.
An earlier `on_the_way` source with no Start is also permitted only when its
extraction predates the genuine later Start. A known Start must match exactly.
Both raw/run endpoints are retained and hash-bound to preview/save/readback.
Other statuses, cancellations, conflicting facts, financial effects and existing
washes stay protected. No new sender contract, key, pin or action is introduced.
An already saved run stays an immutable replay; do not resubmit the hour19 batch
or rename its ID to bypass that receipt. Operations may use the next genuinely
observed source update through the existing preview/save/status workflow.

### Observed source labels and reassignment limits (29 October, hour20)

The operational execution path also accepts the exact observed literal
`completed` only with genuine Start/End, the approved service, a verified worker
and all existing identity/financial/period protections. It does not rename that
label to Collecting Payment or assert collection. Global normalization and
financial recognition rules remain unchanged; archived hashes remain valid.

For prefix promotion, the exact source literals `Initiated` and `Reached` may
prove an earlier unexecuted observation only with null Start/End and extraction
before the later actual Start. They retain their original `unknown` normalized
status and `unknown_status` receipt reason. Both immutable endpoint receipts
must still prove the same worker, day and service and no prior execution.
Other unknown labels remain review-only, even with supplied times.

A changed source driver between the initial claim and later execution remains
protected. The current v2 and administrative routes do not authorize source
reassignment through a prefix alias. Do not choose an earlier prefix, substitute
a worker, rewrite the claim/raw, or rename a saved batch to pass that guard.
Such a case needs an explicitly approved bounded reassignment workflow with
source evidence before execution; this repair does not introduce one.

Hadi's subsequent explicit instruction `01a188a5-3daf-7e83-a1e7-768c243e17ce`
covers the four identified hour20 executions. Only the two named assignment
cases 5677597 and 5677684 on 29 October have a bounded source-review rule in
`operationsAssignmentReview20261029.js`. It pins the original and later run,
both recorded worker identities, actual Start/End and the natural claim. The
original Initiated source must contain no Start/End, its receipt must prove no
execution, and its extraction must precede Start. The latest source and final
execution must agree on the verified actual worker and service. All existing
wash, financial-link, period and settlement checks still apply.

For 5677597, the current worker was first observed while Washing Started,
after the actual Start; for 5677684, the current worker was observed On the Way
before Start. Neither proves the exact assignment-change time. The separate
`sourceAssignmentReview` receipt records the owner scope and observation cuts,
with `assignmentChangedAt: null`; it does not rewrite either historical worker
or the original claim. This is the source's execution-worker attribution under
the specific owner instruction, not a claim to know an unobserved assignment
event. Other identities or changed facts remain protected. The general v2 and
administrative reassignment restrictions above remain in force.

The existing 20/3/23 pricing and unpaid 4.50 commission representation are
unchanged. No collection, payroll payment or journal is created. Replaying the
same run or another prefix cannot create a second wash. This is source-proven
execution, not the distinct administrative cancellation/owner-decision route.

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
payroll payment/approval, worker creation, price-policy/VAT-setting change,
owner collection assertion or SSP writer is reachable. Only the11Oct
owner-authorized wash pricing snapshot may accompany evidenced execution.
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
separately. A missing-service observation creates no completed wash, price,
tax, recognition eligibility or revenue. This exception
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
claims (`sweater_owner_booking_claims`), review variances, and run/state; an
eligible execution may also write one wash using the existing representation.
The claim coordinates with the existing owner workflow but does not assert
completion; its reserved deterministic wash ID does not mean a wash exists.

Numeric booking identity protects prefix aliases. Existing manual washes,
owner confirmations, operational links, financial links and locked/posted
bookings are reread before writing. Conflicting protected observations are
stored only as raw review, never replacing the booking/link/evidence.
Repeated IDs within one batch reject all occurrences rather than choosing
the first. A different run cannot create a second booking/wash naturally.

**11 Oct 2026 owner-authorized execution extension:** raw-only observations
remain compatible. A proven `interior_exterior_wash`, with actual Start/End
Service timestamps, original date and established worker, may additionally
create one completed wash, independent of customer collection. Hadi approved
SAR23 gross = SAR20 net service value + SAR3 VAT, and SAR4.50 worker commission.
The existing wash/tax-snapshot representation is used. No receipt, owner
collection assertion, payroll payment or journal is created. Payment labels
or Collecting Payment alone are NOT execution evidence. Unknown services,
other service types, ambiguous timestamps/workers and protected records remain
review-only. Historical commission policies and closed/settled periods are
not overridden. See `SWEATER_EXECUTED_SERVICE_PROPOSAL.md` for the final contract.

Result separates `rawSavedCount`, `bookingSavedCount`, each row's `rawSaved`,
`bookingSaved`, `washId`, `washCreated` and actual persisted `washesCreated`,
`ledgerPosted:false`, `payrollPaid:false`. Preview never claims a saved wash.
Replay returns the historical count, not new creations; do not sum it as new.
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

## Monthly readings of Sweater's dashboards (`--metrics`)

Sweater's own numbers for a month, read from its Metabase dashboards on
`ssp-portal.sweater.sa`, travel the same path: the same endpoint, key,
principal `sweater-browser-agent`, full-request signature and rate limit.
They are **display and reconciliation only**: the overview shows Sweater's
wash count beside ours, net tips apart from revenue, and the Compensations
lines. Nothing is posted to the ledger and no wash is created.

| metric | dashboard | unit | Sweater's class |
|---|---|---|---|
| `completedWashes` | Business Dashboard | count | — |
| `tipsNet` (net tips after fees) | Business Dashboard › Tips | SAR | — |
| `violations`, `damages`, `compensations` | Compensations | SAR | deduction |
| `freeWashCompensation`, `cancelledByBiker`, `cancelledMaintenance` | Compensations | count | deduction |
| `cancelledByCustomer` | Compensations | count | addition |

```json
{ "contractVersion": "sweater-metrics-v1", "importRunId": "metrics-20261023-0800",
  "periodKey": "2026-10", "extractedAt": "2026-10-23T08:00:00+03:00",
  "sourceUrl": "https://ssp-portal.sweater.sa/…",
  "metrics": { "completedWashes": 480, "tipsNet": 68, "violations": 530, "damages": 0,
    "compensations": 0, "freeWashCompensation": 8, "cancelledByCustomer": 10,
    "cancelledByBiker": 13, "cancelledMaintenance": 4 } }
```

```
node scripts/sync-sweater-operations.mjs absolute-metrics.json --metrics
```

- Send only what was read: a missing metric stays «not received» on the
  overview, never zero. Counts are whole numbers; amounts are riyals to the
  halala (`tipsNet` may be negative after fees; the others may not).
- Each reading gets a **new** `importRunId` and is stored as its own row
  (`sweater_metric_snapshots`); the overview shows the month's latest, with
  its time. Re-sending the same file is idempotent (same run id and body);
  the same run id with other numbers is refused, never overwritten.
- `extractedAt` is the reading time with its zone; a time in the future (beyond
  five minutes of clock skew) or before the month's first day is refused.

**On the Windows account**: the sender, client and contract files changed,
so their SHA-256 fingerprints in `approved-sender.json` no longer match and
signing refuses until Hadi approves the new fingerprints of the updated
working copy. This is a fresh approval of reviewed files, not a bypass.

**Production order**: apply
`supabase/migrations/20261023000000_sweater_metric_snapshots.sql` to the
project before the code that reads the table is deployed.

## Recommendation for agent 7 instructions (do not auto-edit skills/schedules)

### Compensations event tables — 26 October 2026

In the existing monthly `Metrics` run, read the seven Compensations tables
with the SAME month, account, filters and extraction time as their aggregates.
Use all source pages or the actual downloaded CSV; record incomplete coverage.
Do not request another live integration or infer these events from wash status.

The existing `sweater-metrics-v1` envelope accepts an optional **pair**:

```json
{
  "eventDetails": [{
    "metricKey": "cancelledByCustomer", "sourceId": "actual-source-row-id",
    "bookingId": "actual-booking-id", "date": "2026-10-26", "time": "19:10",
    "driverExternalId": "actual-driver-id", "reason": "Source reason",
    "quantity": 1, "amount": null,
    "sourceUrl": "https://ssp-portal.sweater.sa/dashboards/compensations"
  }],
  "eventCoverage": [{"metricKey": "cancelledByCustomer", "totalRows": 1, "complete": true}]
}
```

- Supported keys: `violations`, `damages`, `compensations`,
  `freeWashCompensation`, `cancelledByBiker`, `cancelledMaintenance`,
  `cancelledByCustomer`. Keep their existing units and direction.
- Each row has exactly the ten fields above. Source IDs must be real stable
  source identifiers, unique within type/month. An actual stable booking ID
  can identify a row only if the source uniquely identifies that event with it.
  Do not fabricate an index, worker, date, timestamp, reason or amount.
  Distinct events may share a booking; never collapse them by booking alone.
- Missing booking/date/time/worker/reason/amount is `null`. Dates belong to
  the selected month. Time is Riyadh `HH:mm[:ss]`, with a known date; do not
  turn a missing time into midnight. No customer names, phones or credential URLs.
- Quantity is the source count (positive integer); only free-wash compensation
  can have quantity above one. Monetary rows have quantity one and source SAR
  amounts to the halala. Never convert cancellation/free-wash counts into SAR.
- `totalRows` is the source table row count, or `null` if unavailable.
  `complete:true` requires all rows and reconciliation to THIS reading's
  aggregate: sum of quantities for count metrics, sum of amounts for money.
  Unknown monetary amounts prevent complete monetary coverage.
  A partial list is `complete:false`, with known subtotals not exceeding the
  aggregate. Maximum 5,000 delivered rows per snapshot. Omit this pair entirely
  if no table was read. Empty rows are complete only for a source-confirmed zero.
- Never re-stamp old details or attach them to newer totals. A newer aggregate-only
  reading deliberately makes its old event details unavailable. Existing legacy
  `deductionDetails` / `countDetails` remain readable, with unavailable times.
- Keep the same endpoint, key, principal, signing, immutable run/body/readback,
  existing 09:00/22:00 schedule and source permissions. Objection status is
  internal site metadata, never a submitted SSP objection or payroll deduction.

**Agent device rollout:** only `functions/src/sweater/metricsContract.js` changes
in the installed sender checkout. Its SHA-256 entry in
`C:/Users/MMC/.codex/automations/automation-2/operations-v2/signers/approved-sender.json`
needs owner approval. The fixed `run-approved-sync.ps1` also needs the two optional
allowlisted fields `eventDetails` and `eventCoverage` in its Metrics branch.
Do not change CLI/client, signer/provider, key, endpoint, other trust entries,
wash writer files or schedules. Stage/review these changes; do not silently
replace approved fingerprints. Update the operations agent's external monthly
instructions at `07-sweater-operations-sync/references/dashboard-metrics.md`
to follow this section once those reviewed files are installed.

Before UI release, apply the additive generated migration
`20261026210339_quality_objections.sql`. It contains only admin-readable internal
objection metadata; browser writes are denied. Both narrow server actions recheck
admin membership, source freshness and revision. Detailed before/after history
stays inside the admin-only objection record. The shared accountant-readable
audit contains revision numbers only, never the objection status or note.
The deadline is unset until Hadi saves it in the page; no guessed default is seeded.

After the signer gate is resolved, add this document/command as the general
raw-save workflow. Keep the daily 00:00 Riyadh / completed yesterday / seven
completed days / independent older gaps policy unchanged. Keep owner handoff
independent; keep the dryRun-only tool safe. Record raw persistence separately
from wash readiness and financial processing. Record per-row rejection/review
and keep gaps independent of successful newer batches. No production booking
may be imported as a software test; use isolated demo-sweater emulators.
## حداثة البيانات وجدول تشغيل مقترح — 27 أكتوبر 2026

الصفحات تقرأ نجاح الاستيراد المحفوظ، لا نبضة الوكيل أو وقت فتح الصفحة. شريط موحّد في اليوم والغسلات والبايكر والنمو والجودة والتكامل يعرض آخر نجاح بتوقيت الرياض، ووقت قراءة المصدر ونطاقه. القراءة الجزئية لا تثبت اكتمال اليوم أو الشركة، وحفظ قراءة قديمة الآن لا يجعل بياناتها حديثة.

حدود العرض في `src/config/operationsSettings.js`: أصفر بعد 3 ساعات، وأحمر بعد 12 ساعة. النظرة العامة تنبّه عند مرور أكثر من 12 ساعة بلا نجاح موثق. ساعة الألوان محلية؛ لا تشغّل استيرادًا أو إعادة تحميل. سجل التكامل يعرض جميع التشغيلات المحفوظة خلال آخر 7 أيام؛ المحاولات التي لم تصل للخادم لا يمكن استنتاجها منه.

الجدول التالي **اقتراح يضبطه هادي على جهاز الوكيل**، وليس جدولًا مفعّلًا من التطبيق:

| التوقيت — الرياض | المقترح |
| --- | --- |
| 08:00 إلى 23:00 | جولة كل ساعة عبر مسار التكامل المعتمد؛ لا تداخل بين جولتين. |
| 00:00 | جولة أخيرة عن اليوم السابق، مع إبقاء الجاري والمفقود والتغطية الجزئية صريحة. |
| عند تعذر الاتصال أو المصادقة | يسجل الوكيل الفشل في مساره القائم؛ لا يعيد الدخول أو يغير الأذونات تلقائيًا. |

كل جولة تستخدم المعاينة والحفظ والتحقق ومنع التكرار المعتمدين، وتعيد فحص نطاق التحديثات المتداخلة المسموح به كي تتحدث الحالات. لا تستخدم وقت الحفظ بدل وقت قراءة المصدر، ولا تنشئ غسلة غير مؤهلة أو قبضًا أو قيدًا. إن كانت جولة سابقة ما زالت تعمل، تؤجَّل التالية دون تشغيل مرسلين متزامنين. لا يدعي التطبيق معرفة موعد الجولة القادمة.

لم تغيّر هذه الإضافة جدولة الجهاز أو ملفات المرسل أو بصماته أو أسراره أو قواعد البيانات. ضبط الجدول نفسه عند هادي.
