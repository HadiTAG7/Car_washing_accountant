# Stored cancellation details

Open **Quality and violations → Booking cancellation details**, or open the
booking table on **Sweater settlements**. Select the month, search for the
booking number and open its cancellation details.

This is a read-only display of existing `sweater_bookings` and staff-readable
`sweater_raw_payloads`. The source hook reads observations for one booking on
opening the dialog. It uses the existing natural booking identity and observed
B/C/S prefix variants; it does not change any stored ID, source hash or status.
The booking-list search affects that list only, not the settlement KPI cards.

The original saved booking status is displayed separately from the newest
stored raw observation. Older observations remain available in a disclosure.
The observation save time is explicitly labelled; it is not a live SSP read.

- Cancelling party comes only from an explicit source status.
- A staff name is shown only if the cancellation card explicitly records it.
- Cancellation reason comes from the stored cancellation card in `notes`.
- Assigned biker comes from that observation's ID; a unique existing biker
  mapping supplies its name. Assignment does not establish responsibility.
- Explicit timestamp offsets convert to Riyadh with the recorded precision.
  A local clock value converts only when the notes explicitly specify
  `timezone: Asia/Riyadh` or `timezone=Asia/Riyadh`. Otherwise the original
  text and the missing-timezone limitation remain visible. A reference to
  an old clarification is not treated as a timezone value.
- Empty fields, multiple cancellation cards and failed reads are not silently
  interpreted as valid values, zero events or successful reads.

No schema, RLS, source extraction, sender, payload contract, write endpoint,
booking/wash status, commission, deduction, settlement or journal changes.
This does not backfill data missing from the stored observations.

## Isolated visual fixture

`node node_modules/vite/bin/vite.js --config tests/cancellation-preview/vite.config.mjs --mode test-preview`

Open `http://127.0.0.1:5214/tests/cancellation-preview/index.html`, or append
`?lang=en`. Both data hooks are replaced by synthetic fixtures. No auth,
database, SSP or integration writer is loaded by this isolated entry point.
