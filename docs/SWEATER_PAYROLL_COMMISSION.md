# Completed-wash payroll commission: owner decision of 2026-10-04

New payroll drafts for period `2026-10` and later use 4.50 SAR per completed
wash. New calculations for earlier periods retain the historical 2 SAR rate.
The October period includes the owner's October 3 washes. This is a payroll
commission rate, not a deduction from the owner-asserted 20 SAR wash amount.

Every newly saved run records the rate and version in
`policySnapshot.commission`. Preview, draft refresh and approval reuse a run's
stored policy. Runs predating the snapshot field retain their implicit 2 SAR
policy, including existing October drafts. No migration or automatic upgrade
of an existing draft is performed. A separately authorized new draft/revision
is needed if the owner wants an old draft moved to the new policy.

Approved and paid runs cannot be refreshed through draft saving or approval.
Their preview reads saved totals/items without recalculating live sources.
Their persisted totals/items remain unchanged. The payment code continues to
consume approved stored totals rather than recalculating them. No salary,
payroll payment, ledger entry or monthly worker payment lock is changed by
this source correction.

The new policy counts a completed SSP booking once, using `ssp_booking_id`
across all workers; duplicate documents with identical execution facts count
once. A conflicting worker/date/quantity for the same source is a review error,
not two entitlements. SSP records must represent one wash. Direct legacy
washes deduplicate by document ID; distinct legacy rows without a natural SSP
ID are not silently collapsed. Cancelled/incomplete and outside-period washes
do not earn commission. Historical policy calculations retain their previous
counting behavior.

Examples: 5 completed washes ×4.50=22.50; 7×4.50=31.50. The salary base always
comes from each worker's record; 900 is a test example, not a default or a
policy. For the supplied October 3 batch, allocation by reported performer is
Ajith5→22.50, Mahin1→4.50 and Safi1→4.50; total31.50, with no payment recorded.

No client-supplied rate or snapshot overrides the server policy. Saved-run
snapshots are read server-side. The importer's separate 4.50 instruction now
matches new-current-period payroll calculations. See
[the owner-confirmed import](SWEATER_OWNER_HANDOFF.md).

Tests cover five/seven-wash examples, duplicate/conflicting SSP IDs, worker
salary differences, exclusions, payload override attempts, stable draft/run
IDs on repeat saving, historical previews and preservation of approved/paid
runs with zero writes. The existing payroll payment-lock and posting tests
remain in place. No production payroll draft/approval/payment is executed
while testing or deploying this source change.
