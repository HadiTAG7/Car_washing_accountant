# Admin quality evidence v2 — 15 October 2026

This is the existing private quality endpoint, unchanged admin membership policy and
default-denied client collection. No SSP, payroll, worker or accounting writes.
Hadi's direct approvals are in thread12 messages 01a13b94-3a4d-77d0-8b22-e00b456ae525,
01a13b99-e608-7c10-9bea-cd91eb221b98 and 01a13bae-4e61-7531-b389-69ad85d51c9b.
No complaint/cancellation/lateness penalty curve is approved in this version.

## Immutable input

Keep the v1 input fields `bikerUID`, `periodKey`, `from`, `to`, `sourceReadDate`,
`samples`, `improvement`; use `rulesVersion: "cqo-20261015-v2"` and add:

- `snapshotAt`: actual dated ISO timestamp, not a future timestamp. Its Riyadh day
  equals sourceReadDate. Retrying the same snapshot is idempotent; changing it
  creates a separate immutable report. Earlier v1 reports remain unchanged.
- `sourceIdentity: {externalId, sspId}`: the verified worker mapping, strings or
  null when there is no relevant evidence. externalId must match the current
  worker's driver_external_id. Ratings require both identifiers. The SSP mapping
  comes from the authorized source review, not a name match or guessed ID.
- `evidence`: optional criteria listed below; omitted means missing, NOT zero.

A proof is `{reference, hash, readDate}`: a specific inspectable source reference,
SHA256 of that reviewed evidence file, and actual date of its reading. No token,
cookie, customer contact or personal identity document belongs in the payload.
Facts must be within the report scope and the worker's employment period; their
proof must have been read on/after the fact and no later than sourceReadDate.

## Eight criteria

| Criterion | Input and calculation | Missing/blocked status |
|---|---|---|
| Wash quality,30 | evidence.ratings[]; each segment {from,to,wash:{mean,n},behavior:{mean,n},source:proof}. Weighted wash mean /5*30. | No measured segment = missing rating sample. |
| Behavior,20 | Same segments, separate behavior mean and n; /5*20. | Same, never substitute a single generic customer star. |
| Productivity,10 | evidence.productivity:{workDays:[ISO day],completed:[{washId,serviceDate}],source:proof}. Complete verified working-day evidence, including zero-service workdays. min(1, completed/workingDays/8)*10. | No working-day evidence = missing verified workdays; wash-days are not attendance. |
| Complaints,10 | evidence.complaints:{eligible:[{id,serviceDate}],attributedIds:[id],source:proof}. Unique affected eligible services, with attribution established in source review. | Counts/rate may be retained; points await an approved penalty rule. |
| Cancellations,5 | evidence.cancellations: same shape, eligible assigned booking denominator and evidenced attributed cancellations, not all cancellations. | Same; no executable unapproved curve. |
| Lateness,5 | evidence.lateness: same shape, bookings eligible for arrival measurement under the approved source definition, evidenced attribution. | Same; no invented grace period or curve. |
| Duration,10 | Existing samples {washId,serviceDate,start,end,sourceHash}, same v1 per-wash formula then average. | Missing qualified timestamps = missing duration evidence. |
| Updates,10 | evidence.updates:{reviews:[{washId,serviceDate,appointmentId,forgotten:["arrival","start","end"],evidenceType:"explicit-status-review",source:proof}]}. Include every reviewed eligible wash, including explicit no-forgetting reviews. Unique affected appointment IDs / reviewed washes; max(0,10-100*ratio). | No explicit reviewed evidence = missing status review. Missing timestamps/Collecting Payment are NOT accepted as forgetting. |

All arrays are unique within their relevant identity/date scope. Rating ranges
must not overlap per criterion; do not combine totals with their daily details.
Source means have at most two displayed decimals and are always marked approximate
sample evidence; do NOT send the derived 4-decimal weighted mean as a source mean.
n=0 requires mean=null. Source dates and partial coverage remain visible.
Productivity/updates wash references are verified against canonical completed
unit washes, same UID/date; updates also require canonical ssp_booking_id binding.
No administrative subtotal, finalScore, availableWeight or caller-supplied points
is accepted as an input score. Formulae run on the server.

The available sum is only the sum of saved computable components and their own
weights. It is NOT rescaled. Final remains null because three policy curves are
unapproved, even if the five other criteria have evidence. Completing v2 support
does NOT close the eight-criterion business objective.

## Payload preparation by quality manager

Use the already verified v1 duration payload, plus raw NON-overlapping historical
rating segments and each segment's genuine source reference/read date/hash.
Do not reconstruct precision from rounded administrative subtotals. Preserve
open source/attendance/attribution/status-review gaps independently. The technical
manager does not re-extract SSP or manufacture missing source evidence.

Submit via existing admin save action as {reports:[...]}. Split into batches if
unique duration/productivity/update wash IDs plus two per report exceed
450; payload remains under the current 500000-byte endpoint limit. No overwrite,
migration, new permission, raw-source import or direct Firestore client write.

Read `all-approved` to retrieve v1 and v2 together, or request one exact supported
version. The top card selects one latest suitable snapshot; never add reports.
