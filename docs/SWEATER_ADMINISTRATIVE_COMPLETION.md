# Administrative completion without collection

This admin workflow records an explicit owner decision for named cancelled SSP bookings. It creates one operational wash with unpaid commission, preserves the source cancellation, and does not confirm collection or create a journal, payment, payroll run, recognition policy or integration key. It is separate from the historical collection handoff and the pinned operations v2 sender.

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
