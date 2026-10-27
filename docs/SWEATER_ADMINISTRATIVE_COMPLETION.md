# Administrative completion without collection

This admin workflow records an explicit owner decision for named cancelled SSP bookings, actual ongoing executions under the standing approval below, and the single missing-start exception. It creates one operational wash with unpaid commission, preserves the source facts, and does not confirm collection or create a journal, payment, payroll run, recognition policy or integration key. It is separate from the historical collection handoff and the pinned operations v2 sender.

## Actual ongoing executions — standing approval from 18 October 2026

Hadi's verified message `01a15086-97de-7292-8767-b755ee029923` in conversation `01a04f9f-cdbe-7213-bf1b-eee76eb35b38` says «كل الغسلات من اليوم وانت طالع سجلها المكتملة والجارية». Messages `01a16f81-d999-7e20-b83d-8ece75c37e15` and `01a179ab-1b3f-7373-bf4c-f35d4f623bb1` reaffirm it. This covers actual ongoing washing from service day `2026-10-18` onward; it is not daily reapproval, a cancellation policy, or proof of source completion or collection.

Use the existing Integration JSON administrative review/preview/save workflow and unchanged kind. Each batch still names its actual service date, exact booking IDs, verified worker links, exclusions, original owner statement/reference and documented decision time. Never replace the owner's message reference or timestamp with the current run time. A standing reference may precede the service day; it must precede the source observation.

An eligible record must be individual `interior_exterior_wash`, raw status exactly `Washing Started`, an actual `startedAt` on that service day in Riyadh, and explicit `completedAt: null`. Start cannot follow the source reading, and source reading/decision cannot be future timestamps. Waiting, arrival, en-route, future bookings, missing Start, or observed End are outside this ongoing path. A genuinely finished execution uses unchanged automatic operations v2 eligibility instead.

First save the truthful raw observation using the existing operations v2 process. The administrative preview then requires that exact stored observation: source `operations_sync_v2`, verified `operationalWorkerId`, same booking/day/driver/service/status/Start and null End. No invented source fields or new raw-only bypass is accepted. Existing claims, foreign prefixes, protected records, closed periods, approved settlements, actor-role rereads and preview hashes retain their existing guards.

For the administrative save, the application wash is «مكتملة» with `completion_basis: owner_administrative_decision`; the original `Washing Started` and null End remain unchanged and the owner decision stays separate. Existing 20/3/23 pricing and a single 4.50 unpaid commission are reused. Collection stays pending, payment method null; no journal, payroll payment or separate commission record is created.

Read back the natural booking identity across all prefixes, one canonical wash/claim and one unpaid commission. Later real End evidence is stored as a new truthful observation through operations v2; it cannot create a second wash or commission or rewrite the original administrative evidence. A protected/changed prefix remains a review item, never an excuse to replace the claim or use a new identity. The already completed real-source bookings 5666443 and 5666482 need verification only, not another administrative save.

## One-time missing-start exception approved 25 October 2026

Hadi approved only `S-5655042`, service day `2026-10-24`, external driver `1988`, verified internal worker `5MMg7pj0wjYM06NLuzS7`. The original SSP observation is `Collecting Payment`, `startedAt: null`, `completedAt: "2026-10-24T14:48:00+03:00"`, type `interior_exterior_wash`. Never substitute Arrival for Start, invent Start, or relabel CP as a cancellation. Automatic operations v2 eligibility is unchanged and still rejects a missing real Start.

Use the same `kind`, preview/save actions and review hashes below, with exactly one record and one `decision.bookingIds` entry (`S-5655042`). The decision must reference conversation `01a04f9f-cdbe-7213-bf1b-eee76eb35b38`, actual owner message `01a16fb9-0e70-7203-b117-6f8c2fe44a8c`, and his exact statement: «ايه كلف التقنية وخلصها وسجل غسلة أخيل الناقصة، بدون اختلاق وقت بداية ولا تكرار الغسلة والعمولة». Operations verified request receipt at `2026-10-25T00:03:19+03:00`; use `decidedAtBasis: "request_received_at"`, not an invented exact message timestamp. Use actual source coverage and a new stable administrative run ID; do not replay or edit an old signed operations batch. Include `startedAt: null` explicitly in this request, even if the source extractor omitted the missing field.

The server additionally requires the existing operations booking to match these source facts and its verified worker. An absent booking, a real Start now present, changed End/worker/source, different booking/prefix/day, another owner-message reference, or a mixed batch is not this exception. Original `record`, `sourceHash`, raw/run references, review fields and natural claim stay unchanged. The separate decision and `completion_basis: "owner_administrative_decision"` explain why one wash exists despite missing execution evidence. The versioned administrative raw record retains null Start and the actual End.

For this record use the already deployed Integration JSON review card. Review locally, then server-preview; expect one existing booking modified and one wash `ssp__S-5655042` to be created, worker `1988`, net 20 / VAT 3 / gross 23 / unpaid commission 4.50, pending collection, payment method null. Operations alone saves after checking both review boxes. If already saved, inspect the existing wash instead of using a new identity. Read back one natural identity across all prefixes, one commission, source CP/null Start/14:48 End and separate owner decision. With no other concurrent import, day 24 should move 49→50 and total 581→582; these counts are diagnostics, not write authorization or a substitute for identity checks.

## Review and save through Integration

Open `https://app.hadialghanim.com/?page=sweater_integration` in the existing authorized admin session. In the SSP JSON review card, upload or paste the payload below, review locally, confirm the source review, then preview on the server. Check each booking, worker, source status, exclusion and amount. Complete both technical review checkboxes before saving. A changed file or failed save invalidates the preview; nothing is retried automatically.

The authenticated same-origin `/api/ledger` operations are `sweaterPreviewAdministrativeCompletion` and `sweaterSaveAdministrativeCompletion`. Both require the stored admin role. The save body is exactly `{ payload, reviewedPayloadHash, previewStateHash }`, using both hashes returned by the preview of that same payload. Neither operation accepts a caller-supplied price, payment method, collection assertion or role.

## Payload

The synthetic example is not production evidence. Replace it only with the actual source observations, owner statement, conversation and message identifiers. Reuse one fixed `importRunId` for the same decision, including after an uncertain response.

```json
{
  "kind": "owner_administrative_completion_v1",
  "importRunId": "synthetic-owner-completion",
  "coverage": {
    "rangeFrom": "2026-10-21",
    "rangeTo": "2026-10-21",
    "extractedAt": "2026-10-24T01:00:00+03:00",
    "pageCount": 1,
    "pagesFetched": 1,
    "recordCount": 1,
    "isComplete": false,
    "scope": "explicit_owner_bookings",
    "scopeComplete": true,
    "sourceUrl": "https://ssp-portal.sweater.sa/bookings"
  },
  "decision": {
    "source": "owner_statement",
    "ownerName": "Synthetic owner",
    "statement": "Record this booking as completed administratively, without asserting collection.",
    "conversationId": "synthetic-thread",
    "messageId": "synthetic-message",
    "decidedAt": "2026-10-24T00:50:00+03:00",
    "decidedAtBasis": "request_received_at",
    "approved": true,
    "decision": "record_as_completed_wash",
    "serviceDate": "2026-10-21",
    "bookingIds": ["C-990001"],
    "excludedBookingIds": ["C-990005"]
  },
  "workerLinks": { "1982": "synthetic-internal-worker" },
  "records": [{
    "sspBookingId": "C-990001",
    "driverExternalId": "1982",
    "bookingKind": "individual",
    "serviceType": null,
    "serviceDate": "2026-10-21",
    "rawStatus": "Cancelled by Admin",
    "startedAt": null,
    "completedAt": null,
    "sourceUrl": "https://ssp-portal.sweater.sa/bookings"
  }]
}
```

One batch covers one service day and at most 50 explicit bookings. The records must match `bookingIds` exactly. Natural booking numbers cannot repeat across prefixes or intersect `excludedBookingIds`. The source URL must belong to SSP and contain no credentials or session parameters. Unknown service types remain unknown: do not copy the owner's pricing/service policy into a missing SSP `serviceType`. Actual start/end observations are preserved; never insert a scheduled time as an execution event.

Use `decidedAtBasis: "message_timestamp"` only when a message timestamp is available. Otherwise, verified request-receipt metadata may be recorded with `decidedAtBasis: "request_received_at"`; it is not the owner's exact speaking or sending time. The server records its own save time separately.

Coverage describes only the explicitly reviewed bookings, not the whole day, company, month or corporate scope. Keep `isComplete: false`. Use the actual source reading time and page counts. Per-booking supporting observations may remain in the operations evidence file; do not add non-contract fields or customer/session data to `records`.

## Stored records and safeguards

The transaction rereads membership, workers, natural booking claims, legacy aliases, washes, financial/operational links, period and monthly settlement before writing. A stale preview, conflicting mapping, protected period/settlement, financial link or conflicting source identity saves nothing.

Existing booking `record`, `sourceHash`, source, import-run reference and older review/link fields remain unchanged. The separate `ownerCompletionDecision` records the exact statement, message reference, actor provenance and named scope. A new versioned raw document records the supplied source observation. No collection-confirmation document is created.

The wash uses the existing operations values: net SAR 20, VAT 3, gross 23, commission 4.50, `collection_status: "pending"`, `payment_method: null`, and `worker_commission_paid: false`. The original status is retained as `ssp_raw_status`; the administrative basis is separate. Operational links and the existing shared natural-number claim prevent a second wash. The existing payroll calculator sees that wash once; this workflow does not write payroll.

The same run and exact payload returns the stored result with `replay: true`, without another write. A different payload under that run ID rejects. Another run for the same decision cannot create a second wash. Later observations through unchanged operations v2 remain available as raw evidence and cannot overwrite the owner decision or create another wash, including under a changed SSP prefix.

The integration state is not marked as a fresh complete source synchronization. Prior signed batch bodies, manifests, sender, signer, credentials and trust configuration are outside this workflow.

## Verify the real operation

After the deployed commit and server preview are verified, Operations saves only the explicitly authorized bookings. Read back the exact wash IDs, source cancellations, decision references, quantities, amounts and unpaid commissions. Confirm the excluded booking has no wash and each natural booking number has exactly one wash, even if multiple source observations exist. An acknowledgement or preview alone is not a completed save.

Do not test save on production. Isolated regression coverage is in `functions/test/administrativeCompletion.emulator.test.js`, including role rejection, stale preview, replay, concurrent runs, source preservation and later operations v2 completion.
