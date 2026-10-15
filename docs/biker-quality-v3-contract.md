# Quality rules v3 — direct approval 15 October 2026

Authority: thread12 userMessage `01a13efb-bd56-7053-bd8c-23ba3bdb6990`.
This supersedes the v2 productivity/update definitions. No v2 candidate has been
released or saved to production. v1 snapshots remain immutable; no roles, SSP,
worker records, financial logic, Firebase functions or security rules change.

Use the same base input, sourceIdentity, rating segments and proofs documented in
biker-quality-v2-contract.md, with `rulesVersion: "cqo-20261015-v3"` and a NEW
actual snapshotAt. Do not relabel a historical snapshot as newly read evidence.

## Changed evidence fields

- `evidence.productivity: {completed:[{washId,serviceDate}], source:proof,
  coverage:"sample"|"complete-period"}`. No workDays input. Points are
  `10*min(1, completed count / distinct service dates / 8)`. A zero denominator
  is unavailable, not zero points. Dates with no washes are excluded; this is
  NOT attendance or proven absence. The server verifies each canonical UID/date
  link. A claimed complete list must match the canonical linked unit completed
  washes in the report window, not merely a list matched by worker name.
  If omitted, the server can derive this criterion from its own canonical cohort
  (unless an explicit completion conflict blocks that assumption). A supplied
  reviewed sample stays a sample; it is not silently extended with disputed rows.
  The canonical cohort/hash and validation time are retained for audit.
- `evidence.updates: {coverage:"sample"|"complete-period",reviews:[...]}`.
  A readable review has `{washId,serviceDate,appointmentId,readStatus:"read",
  arrival:ISO-offset-timestamp|null,start:...|null,end:...|null,source:proof}`.
  This means the actual SSP event section was read; do not substitute a list's
  computed duration or Collecting Payment status. Explicit missing events use
  null. A source-unreadable review instead has `{washId,serviceDate,appointmentId,
  readStatus:"unreadable",reason,source:proof}` and NO fabricated event fields.
  Unreadable reviews stay in independent gaps, excluded from numerator AND
  denominator. Count each affected appointment once if any required timestamp
  is missing. Points `max(0,10-100*affectedAppointments/readableEligibleWashes)`.
  This is timestamp completeness, NOT an accusation of forgetting.
- Each of complaints/cancellations/lateness keeps
  `{eligible:[{id,serviceDate}],attributedIds:[id],source:proof}` and adds
  `coverage:"sample"|"complete-period"` (default sample).
  Unique evidenced eligible and attributed items only. For complaints, eligible
  IDs are canonical completed wash IDs; cancellations use eligible assigned
  booking IDs; lateness uses arrival-measurable booking IDs under the approved
  source definition, no invented grace period. Zero attributed cases is a real
  zero ONLY when a nonzero eligible denominator was actually reviewed.
  Complaints/cancellations: full points at/below1%, linear to zero at5%.
  Lateness: full points at0%, linear to zero at10%. No financial deduction.
- `evidence.ratingsCoverage:"sample"|"complete-period"` defaults sample.
  Partial historical segments retain their actual dates/counts and approximate
  precision. Complete-period rating coverage requires explicit date coverage
  for both metrics, including true zero-rating segments where applicable; never
  make up these segments just to close gaps.
- Optional `evidence.gaps:[{washId,serviceDate,kind,reason,source:proof}]` preserves
  known per-worker source gaps. kind is unreadable-source, completion-conflict,
  or missing-start-end. Each wash must already have a verified canonical UID
  link. Unresolved worker assignments stay in the quality manager's independent
  global gap record, never attached by a name guess.

## Completion and read context

Points from supported, evidenced criteria can be shown even with sample coverage.
The final/100 is computed only when all eight are calculable AND each covers the
report period: complete canonical productivity cohort, complete qualified
duration cohort, explicit rating-period coverage, complete eligible attributed
rate denominators, and complete readable update cohort with no unreadable gaps.
Otherwise show the available sum and specific coverage/evidence gap, not a
rescaled final. An approved rule does not establish missing facts.

The existing admin read accepts `includeSource:true` for the SAME UID/month. It
returns a minimal current canonical linked wash context (UID, externalId, wash
IDs, service dates, SSP booking IDs), no wage/phone/customer/payment fields. The
profile shows it collapsed for source verification. Non-admins remain denied
before report/worker access. Bounded-source overflow is unavailable, never zero.
No extra role or direct Firestore client access is introduced.

The current rules version takes precedence over historical definitions for the
top card; within that version use the latest suitable window and snapshot. All
historical versions stay separately readable. Source context is a separate dated
current read, not a silent update to the saved cohort. Duration measured/linked
total and the remaining count are saved with each v3 snapshot. Partial criteria
with a total available weight100 do NOT display a fabricated final /100.

Quality manager prepares actual evidence; technical manager does not re-extract
SSP. Validate the final payload offline, pass release gates, then save approved
real quality snapshots through the existing admin UI and re-read. No production
test transactions or source-row edits. Keep previous snapshots and open gaps.
