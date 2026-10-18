# Growth and biker performance

Internal read-only admin page: `?page=growth_performance`. Hadi approved this
page in growth thread 01a04f9f-da73-7402-bcf0-f0fe87c03def, human turn
01a15083-3453-75f3-9254-2bddf586990b (18 October 2026). No business write,
payroll/financial calculation, role policy, schema, rules or Firebase deployment.

## Sources and scope

- `server/growthRoster.js` is a private, dated SSP roster reference verified on
  both pages at 18 October 2026 21:12 Riyadh. It is not live status, historic
  availability or attendance. Zone has the same timestamp. Names are resolved
  from unique `driver_external_id` mappings at read time, not published assets.
  When that code is absent on a worker, consistent completed-wash code/UID
  evidence may resolve an existing worker; conflicts fail closed and the
  worker itself is never updated.
- `POST /api/growth-performance` verifies/revocation-checks the Firebase session
  and resolves the existing server membership policy before reading performance.
  Only the existing admin role is accepted. Partner simulation never mounts the
  page; a direct unauthorized URL falls back to the role's existing home page.
- Four bounded parallel reads, plus at most one bounded missing-worker lookup,
  select only necessary columns. Maximum visible
  period is 93 completed service dates; 30 prior dates provide comparison
  lookback. Query caps fail explicitly, never silently truncate. No all-history
  extraction, raw payloads, phones, payroll, customer fields or new credentials.
- Counts require a unique completed registered wash linked to an individual
  booking with consistent worker identity. CollectingPayment alone is not
  completion. Corporate rows remain separate. Source coverage comes from
  persisted import-run coverage, including runs extending beyond the view.
- Known C-5584720 completion conflict is excluded analytically, not deleted.
  Only the evidenced `ssp__B-5596423`/`S-5596423` singleton is treated as an
  alias. No prefix normalization. Missing completion/link evidence is retained
  as a gap, including S-5609774 if still unproven in the current read.

## Measurements

- D versus exact D−1, even when D−1 is before the visible period. Percent needs
  a positive denominator; a verified zero denominator is not applicable, but
  missing input is unavailable.
- Personal baseline: last seven documented prior workdays, never jumping an
  unknown day or silently dropping a verified zero. A short valid sample is
  provisional. Actual positive execution + complete source coverage verifies
  that execution day, not attendance on other dates. No synthetic team
  baseline from only a subset of available personal samples.
- General descriptive average: eligible recorded washes / distinct positive
  recorded dates within the visible period, including D. Team denominator is
  the union of dates, not the sum of worker days or average of averages.
  Partial counts and coverage are visible; this is not attendance or a separate
  baseline. Single-day samples are explicitly marked.
- Saturday–Friday comparisons require complete coverage for both weeks. No
  invented four-week comparison or causal/personnel inference from a count.

## Verification

`npm test` covers pure metrics, UI filtering, dates/null/zero, server authorization,
identity conflicts, corporate separation and private-field stripping.
`npm run test:growth` additionally exercises actual Firestore projections and
overlapping coverage in the isolated demo-sweater-growth emulator namespace;
it deletes only its six synthetic documents. It never uses production credentials.
Follow the repository's full applicable release gates, plus real admin journey
and mobile/RTL review. A fixture UI is not proof of live data or partner access.

Filters do not reload the document. Period reads are explicit, abort stale
requests and immediately hide data on identity/role/simulation changes. There
is no polling, automatic page refresh or production business mutation.
