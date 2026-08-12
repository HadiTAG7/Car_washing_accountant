# سويتر (Sweater) — نظام محاسبة مغسلة السيارات

React + Vite + Tailwind + **Firebase/Firestore** dashboard (RTL, Arabic-first)
for running a Sweater franchise: day-to-day operations *and* a real
double-entry accounting system on top of them.

> **Backend:** Firestore. Some historical comments still mention Supabase —
> the project migrated, and Firestore is the only data source. Anything
> user-facing has been updated; a few code comments keep the old name where
> they explain *why* something is shaped the way it is.

---

## Two layers

The app deliberately keeps two layers, and the split matters:

| Layer | Collections | Role |
|---|---|---|
| **Operational** | `washes`, `monthly_expenses`, `variable_expenses`, `startup_costs`, `annual_expenses`, `partner_payments`, `temporary_expenses`, … | What happened. Staff record here, day to day. |
| **Accounting** | `chart_of_accounts`, `journal_entries`, `journal_lines`, `accounting_periods`, `audit_logs` | What it means. Every financial statement is built **only** from posted journal lines. |

A number in a statement is therefore always traceable to an entry, and a
reversal cancels itself out — the original and its mirror both stay in the
books. Operational tables are never summed directly into a report.

---

## Modules

| Tab | What it does |
|---|---|
| رسوم التأسيس | One-time startup costs, per-item expense ledger, invoice links, VAT flags |
| المصاريف السنوية | Recurring yearly expenses + per-item payment ledger |
| المصاريف الشهرية / المتغيرة | Monthly fixed + per-wash variable costs (biker commissions auto-derived from wash logs) |
| الغسلات | Wash batches (quantity × price) feeding revenue and commissions |
| قائمة الدخل | Income statement, read from the posted journal — plus a reconciliation against the operational registers |
| تقرير ضريبة القيمة المضافة | Output tax, deductible input tax and the net, per filing period |
| الرقابة والميزانيات | Category budgets with auto-discovery + over/under tracking |
| إدارة الشركاء / المدفوعات | Partner registry, capital fees, payment receipts |
| المصروفات المؤقتة | Reimbursable outlays with pending → recovered tracking |
| **دفتر الأستاذ** | Per-account movements, running balance, opening/closing, CSV |
| **ميزان المراجعة** | Per-account debits/credits/balance with an explicit balanced verdict, CSV |
| **المركز المالي** | Assets = Liabilities + Equity, CSV |
| **المستندات الضريبية** | Simplified invoices with a sequential number and a Phase-1 QR, credit/debit notes, sequence-gap audit, CSV |
| **الأصول الثابتة** | Register, straight-line schedules, monthly depreciation entries, disposal, CSV |
| **إقفال الفترة** | Chart seeding, recurring-voucher generation, posting sweep, per-month preflight, close/reopen |

---

## The accounting model

### دليل الحسابات — chart of accounts
Seeded from **إقفال الفترة → تهيئة دليل الحسابات** (idempotent; never
overwrites an existing account). Document id = account code.

| Code | Account | Type |
|---|---|---|
| 1010 / 1020 | الصندوق / البنك | asset |
| 1100 | العملاء (الذمم المدينة) | asset |
| 1200 | ضريبة مدخلات قابلة للاسترداد | asset |
| 1300 | عهد ومصروفات قابلة للاسترداد | asset |
| 1500 / 1510 | أصول ثابتة / مجمع الإهلاك | asset (1510 contra) |
| 2000 / 2100 | الموردون / ضريبة مخرجات مستحقة | liability |
| 3000 / 3100 | رأس مال الشركاء / أرباح محتجزة | equity |
| 4000 / 4010 | إيرادات غسيل السيارات / مردودات المبيعات (contra) | revenue |
| 4100 | أرباح استبعاد أصول | revenue |
| 5000–5400 | عمولات · متغيرة · إيجار · إدارية · إهلاك | expense |
| 5500 | خسائر استبعاد أصول | expense |

Each partner also gets a capital sub-account `3000-<partnerId>`, created
automatically on their first posted payment.

### Invariants (enforced in code **and** in rules)
- Total debits = total credits, to the halala.
- A line carries a debit **or** a credit — never both, never neither.
- A **posted** entry is never edited or deleted. The only permitted update is
  the reversal transition `posted → reversed`.
- Corrections are reversals or adjusting entries, dated into an **open**
  period — never a back-dated edit.
- Nothing posts into a closed period — **checked by the rules**, not only by
  the client.

### Lines live inside their entry
They used to be their own collection, which left a hole no rule could close:
`journal_lines` create had to stay open for the posting transaction, and
Firestore evaluates a batch against the state *before* it, so a rule like "the
parent must be a draft" would have rejected the very write that creates the
entry. An accountant could therefore append a line to a posted entry and
silently unbalance it.

Embedded, the invariant is **structural**: the entry is written once, and the
only update rules permit is the reversal transition with
`hasOnly(['status','reversedBy','reversedAt'])`, which cannot touch `lines`.
There is no separate document left to append to. The old collection stays
readable so pre-existing entries render, and is frozen against
create/update/delete.

### A posted source record is locked
The posting transaction writes `posting_locks/<kind>__<sourceId>` — keyed on
the record's **kind**, because five collections post with
`sourceType: 'expense'` and keying on the type put them all in one namespace.
Entries written before that change carry `expense__<id>`, so the rules check
**both** keys: checking only one would leave every expense posted since the
change editable, or every expense posted before it.

The rules refuse update and delete on `washes`, `partner_payments`,
`monthly_expenses`, `variable_expenses`, `annual_expense_entries`,
`startup_cost_entries`, `temporary_expenses` and posted `expense_vouchers`
while a lock exists — proven per collection, with the legacy key too, in
`functions/test/productionRules.test.js`.

The client identifies a posted source the same way: `sourceKind` + id, falling
back to `sourceType` only for entries that predate the kind.

Reversing an entry releases the lock — and only if the lock still names that
entry, so reversing an older entry cannot unlock a record a newer one holds.

### Re-opening a closed period
Closing is an accountant's call. **Re-opening needs an admin and a written
reason**, both enforced in the rules (`reopenReason` must be a non-empty
string), and it is audited.

### Posting rules
| Operation | Entry |
|---|---|
| غسلة (مكتملة فقط) | Dr cash/bank/receivable (gross) · Cr revenue (net) · Cr output VAT — under the tax policy in force on the WASH's date, and the split is frozen onto the entry as `taxSnapshot` |
| مصروف | Dr expense/asset (net) · Dr input VAT *(if deductible)* · Cr cash/bank/**payable** |
| دفعة شريك | Dr cash/bank · Cr partner capital sub-account |
| عهدة | Dr advances (an **asset**) · Cr cash/bank |
| استرداد عهدة | Dr cash/bank · Cr advances |

Notes that are easy to get wrong, and are handled explicitly:
- VAT is separated **only** when the business is registered *and* the document
  qualifies. A non-deductible input tax is part of the cost, not a receivable.
- Input VAT sits on an **asset** account, so it never appears as an expense in
  the income statement.
- An unpaid purchase credits **الموردون**, not cash.
- An advance is an asset until explicitly converted to expense.
- Startup costs are **capitalised** to fixed assets, not expensed.
- Partner paid-to-date is **derived** by summing `partner_payments` — the
  receipts are the evidence, and `partners.paid_amount` is a cache maintained
  by a client-side read-then-sum that two devices can disagree on. It is still
  written for exports; nothing reads it for display.
- Management/supervisor fees are configured rows in `fee_rules` with an
  `effective_from` date — no percentage is hard-coded, so changing a rate
  cannot silently restate a past period.

### The ledger is not client-writable
`journal_entries`, `journal_lines`, `posting_locks`, `counters/journal`,
`accounting_periods` and `audit_logs` are **read-only to every client**,
whatever its role. They are written exclusively by the callable Cloud
Functions in `functions/`, which run with the Admin SDK.

This is not defence in depth; it is the only way three invariants can exist at
all. **Firestore rules have no loop and no fold**, so:

| Invariant | Why a rule cannot express it |
|---|---|
| debits = credits | summing a list of unknown length is impossible |
| a reversal names a real, balanced mirror | a rule cannot read and total another document's lines |
| a lock release accompanies an actual reversal | a rule cannot tell it from a release made to unlock an edit |

A rule can only check *shape*. Accounting needs *arithmetic*, so it needs a
trusted server.

The posting function also **derives `periodKey` from `entryDate`** rather than
trusting the caller — otherwise a July entry could be smuggled past a closed
July by labelling it August — and rejects dates that do not exist
(`Date.parse` silently rolls 30 February over to 2 March).

| Function | Role | Does |
|---|---|---|
| `ledgerPostSource` | accountant · **operator for `wash`** | takes `{ kind, sourceId }` and **reads the record itself** — the amount, date, payment method and VAT treatment all come from the stored document |
| `ledgerPostManual` | accountant | manual / adjusting / period-end entries, the one path where lines still come from the caller |
| `ledgerReverseEntry` | accountant | builds the mirror **from the original's own lines**, links both, marks the original, releases the lock |
| `ledgerClosePeriod` | accountant | re-reads the month and re-checks that every entry balances on its own |
| `ledgerReopenPeriod` | **admin** | requires a written reason; audited |
| `salesIssueDocument` | accountant | **recomputes the totals from the lines**, mints the number and sequence, takes the seller identity from settings; a note names `referenceDocumentId` and the reference number is **derived from the document read**, never from the payload |
| `salesVoidDocument` | accountant | records the reason; the document is never removed |
| `ledgerSeedChart` · `ledgerEnsureAccount` | accountant | idempotent chart setup |

The author is taken from the caller's verified token, never from the payload.

### The payload names the record; the server reads it
`ledgerPostSource` is the difference between "server authoritative" as a
slogan and as a fact. Validating the *arithmetic* of a client-supplied entry
still leaves the server with no idea whether those lines describe the wash
they claim to — a balanced 50,000-riyal entry citing a 115-riyal wash would
have been accepted. Now the contract is `{ kind, sourceId }` and nothing else.

Locks are keyed on the **kind**, not the source type: five collections post
with `sourceType: 'expense'`, so keying on the type put a monthly expense and
a variable expense in one namespace. Legacy `expense__<id>` locks are still
honoured on read.

**An operator may post a `wash` and nothing else.** They already decide when a
wash is complete and auto-posting fires at that moment; the alternatives were
disabling auto-posting for the people who use the app, or granting them the
accountant role. No manual entries, no expenses, no period close.

### What the server does NOT recompute
A **depreciation** charge is computed by the client from the asset register
and posted through `ledgerPostManual`. The server balances it, checks every
account, derives the period and refuses a closed one — but it does not rebuild
the schedule. Recomputing the register server-side is the next step, and
saying so is better than implying otherwise.

> **Deployment:** the app cannot post until these are deployed
> (`firebase deploy --only functions,firestore:rules`). Cloud Functions
> require the **Blaze** plan.

### Atomicity
Entry number, closed-period check, header, lines, source lock and audit record
all land or none do.

---

## المستندات الضريبية — invoices and notes

| Series | Prefix | Example |
|---|---|---|
| فاتورة | `INV` | `INV-2026-000042` |
| إشعار دائن | `CRN` | `CRN-2026-000003` |
| إشعار مدين | `DBN` | `DBN-2026-000001` |

- **Numbering is transactional**, one sequence per type **and** year, minted in
  the same transaction that writes the document — two tills issuing at the
  same instant cannot receive the same number.
- **One document per source record.** A claim doc in `sales_document_sources`
  is read inside the transaction, so pressing "issue" twice on one wash gives
  the first number back as an error, never a second invoice.

### مساران للإصدار — and only one of them posts

An invoice is not always for a wash that is already in the books. The documents
page issues invoices from free-typed lines with no wash and no source record at
all, and the old single rule — *"an invoice never posts, because its wash was
already posted"* — meant those sales never reached the ledger. A credit note
against one then debited مردودات المبيعات and produced **negative revenue out
of nothing**, plus output tax reclaimed on a sale the authority was never told
about. So issuing is split, server-side, into three explicit modes:

| Mode | Client sends | Server does |
|---|---|---|
| `linked` — فاتورة غسلة مُرحّلة | `washId` + `issueDate` | Reads the wash, its `posting_locks/wash__<id>` and the posted entry that lock names. Builds the lines and the tax treatment from those, takes `supplyDate` from the wash, refuses if the invoice and the entry disagree by a halala, stores `linkedJournalEntryId`. **Creates no entry.** |
| `standalone` — فاتورة بيع مستقلة | lines + `paymentMethod` + `paymentStatus` | Writes the invoice **and** its sales entry in one transaction: Dr cash/bank/receivable (gross) · Cr `4000` (net) · Cr `2100` (VAT). Invoice stores `journalEntryId`, entry stores `documentId`. |
| `note` — إشعار دائن/مدين | reference + reason + lines | Posts the adjusting entry (below), and only if the reference invoice names a **live** entry. |

Consequences worth stating plainly:

- On the linked path nothing the caller sends about money is used. A forged
  `lines` array, an invented total — all ignored in favour of the wash and its
  entry. The *dates* are the exception, and deliberately so: see below.
- A standalone invoice cannot claim `sourceType: 'wash'`. That was the route to
  posting one wash's revenue twice, so it is refused with the reason.
- A note is refused unless its invoice carries `journalEntryId` **or**
  `linkedJournalEntryId` pointing at an entry that still has `status: 'posted'`.
  An invoice with no accounting original, or one whose entry has been reversed,
  cannot be credited into negative revenue.
- **Nothing is deleted.** An issued number stays spoken for: reduce with a
  credit note, increase with a debit note, or void with a recorded reason —
  and voiding is a note about intent, the accounting effect still comes from a
  credit note. Rules allow exactly one update: `issued → cancelled`.
- **Every note needs a reason and a reference** to the invoice it adjusts.
- **Sequence gaps and duplicates are reported** on the page, because a missing
  invoice number is the first thing an audit asks about.
- A **QR code** is attached only to a taxable document — printing one on a
  non-taxable receipt would misrepresent it. It is the Phase-1 TLV/base64
  payload (tags 1–5: seller, VAT number, timestamp, total, VAT), rendered as
  inline SVG from a bundled zero-dependency generator so it still works in the
  offline APK.

### تاريخ الإصدار ≠ تاريخ التوريد

Two dates, two facts, both printed and both exported.

`supplyDate` is when the service was rendered — the wash's own date on the
linked path, an optional field on a standalone sale, inherited from the invoice
on a note. `issueDate` is when the paper was raised, and it is what the
document's **identity** is made of: the sequence, the year, the counter, the
accounting period and the QR timestamp all follow it.

The linked path used to take its `issueDate` from the wash, which quietly filed
every late invoice in the month of supply: a wash on 31 July invoiced on 12
August came out with a July period and a QR timestamp for a moment the invoice
did not exist. It is an **August document for a July supply**, and now says so.

One rule, and it goes one way only: **an invoice may not be dated before its
supply.** Issuing late is normal and unlimited; issuing early would file a sale
into a period that closed before the service happened. A note is exempt — it
corrects a supply that is by definition already past.

### إشعارات قائمة تمنع إلغاء أصلها

Cancelling an invoice reverses it in full. Doing that while a credit note
against it is still posted takes the sale out **twice** — once through the
reversal and once through the note — and leaves 4010 carrying a return against
revenue that is no longer there. So `salesVoidDocument` reads the live notes
first (`referenceDocumentId`, anything not `cancelled`) and refuses, naming
them: void the notes first, or correct with a further note. The same guard runs
in the atomic correction path.

### التصحيح الذري لفاتورة الغسلة

A wash-linked invoice, the wash's journal entry, the posting lock and the
source claim are four things held together. Undoing them one at a time can
leave four different half-states, and one of them is genuinely dangerous: an
**ISSUED tax invoice pointing at a REVERSED entry** — paper in a customer's
hands saying a sale happened, and books saying it did not.

So `ledgerReverseEntry` now **refuses** to reverse an entry that a live
document points at, whether by `linkedJournalEntryId` (a wash invoice) or
`journalEntryId` (a standalone sale or a note), and the error names the way
out. That way out is `salesCorrectWashInvoice`, one transaction:

1. the document is **cancelled** — number, `issueDate` and `supplyDate` all
   untouched, because a tax series carries cancelled rows and cannot carry
   gaps;
2. the linked entry is **reversed** on an explicit `reversalDate`, mirror
   posted and original marked;
3. the wash's **posting lock is deleted only if it still names that entry** —
   if a newer entry owns it, that entry is the live one and the lock stays;
4. the **source claim is released**, not deleted: it keeps
   `previousDocumentId` and the number it belonged to;
5. one audit record ties all four together.

Then the wash is corrected, re-posted (`postSource` writes a fresh lock), and
invoiced again. The replacement carries `replacesDocumentId` / `…Number`, and
the cancelled document gets `replacedByDocumentId` / `…Number` written back —
so the trail from the dead number to the live one is walkable from either end.

A failure at any step aborts the whole transaction: no half-cancelled document,
no orphan mirror, no freed lock over a live entry, no released claim without a
cancellation.

### ربط الفواتير القديمة — a migration, run before go-live

Invoices issued before the two-path split carry neither `journalEntryId` nor
`linkedJournalEntryId`, so nothing can be credited against them.
**إقفال الفترة → ربط الفواتير القديمة بقيودها** is the tool, and it is a
dry-run by default.

The rule that makes automating it safe: **a link is adopted only when the
document already declares it.** An invoice saying `sourceType: 'wash',
sourceId: 'w1'` is asserting which record it is for; the tool verifies that
assertion against the posting lock, the entry's status and the total to the
halala, and adopts it only when all four agree. Matching by "same day, same
amount" would be a guess, and a guess here writes a filed tax document's link
to an entry that may not be its own — so every other case becomes a review row,
with same-total candidates listed as information for a person, never applied.

Two more rules follow from the first:

- **One record, one document.** Two invoices declaring the same wash — or two
  declarations resolving to the same *entry* — are a contradiction the data
  cannot settle, so **all** of them go to review with what they clash on.
  Picking one would be picking arbitrarily.
- **The plan does not authorise the write.** A dry-run is a photograph, and
  between the photograph and the write an entry can be reversed, a claim can be
  taken, another invoice can be linked. So `apply` re-reads the invoice, the
  wash, the lock, the entry and the claim **inside a per-document transaction**
  and re-checks all of it there, including a query for any other live document
  already pointing at that entry. A row that no longer qualifies is skipped
  with its reason and joins the review list — never forced through on the
  strength of a stale scan. Two concurrent applies therefore link the source
  exactly once.

The **claim always ends `held`** by the linked invoice. A `released` claim is
re-holdable only by the document it was released *from*; released to somebody
else, or held by somebody else, it goes to review. Leaving it released would
let a second invoice be issued for a wash that already has one — which is the
first thing the next `salesIssueDocument` for that wash now refuses.

Applying writes link fields only — `linkedJournalEntryId`,
`linkedJournalEntryNumber`, `washId`, `issueMode`, `supplyDate` — plus the
claim. Numbers, sequences, dates, totals, VAT rates and QR payloads are never
restated. It is idempotent, admin-gated to apply, and audited per document.

### ZATCA — what is and is not implemented
`src/lib/accounting/zatcaIntegration.js` is the boundary, and it is honest:
every function returns `{ ok: false, status: 'not_implemented' }` rather than
throwing or silently succeeding.

| Implemented | Not implemented |
|---|---|
| Phase-1 QR payload · sequential numbering · credit/debit notes | Onboarding (CSR/certificates) · invoice hash chain · cryptographic stamp · reporting (B2C) · clearance (B2B) |

Phase 2 needs a trusted server: the private key must never reach a browser,
and the hash chain requires a single serialized issuer. The app is shaped so
only that one file changes.

---

## الأصول الثابتة — register and depreciation

Capitalising a purchase to 1500 and never depreciating it overstates the
assets *and* the profit, every month, forever. **الأصول الثابتة** closes that.

**Policy** — straight line, `(cost − salvage) ÷ useful life in months`, on a
**full-month convention**: an asset bought on the 3rd and one bought on the
28th both take a full month in the month they enter service. The **last**
month absorbs the rounding drift, so total depreciation equals the depreciable
base to the halala and the asset lands exactly on its salvage value.

**The monthly entry** is dated the last day of the month it covers, and
carries the period key as its `sourceId`:

| | |
|---|---|
| مدين | مصروف الإهلاك `5400` — one line per asset |
| دائن | مجمع الإهلاك `1510` — one line per asset |

Per-asset lines on both sides mean the general ledger for 1510 reads as a
per-asset history, which is what a fixed-asset note needs.

**Guards that matter**
- A month already charged is **refused**, not silently repeated. Fixing a
  posted month is a reversal, like any other entry.
- A future month is never offered — its expense has not been incurred.
- Cost, salvage, life and in-service date **freeze** once any of *that
  asset's* months have been charged; the schedule must not disagree with the
  ledger. (An unrelated asset having been depreciated does not freeze this
  one.)
- **Disposal is blocked** until the asset's depreciation is up to date: the
  disposal entry debits 1510 by what the schedule says accumulated, so an
  unposted month would drive that account negative and misstate the gain.
- An asset back-dated **into an already-posted month** would otherwise be lost
  — the sweep never revisits a charged month. The page reconciles register
  against ledger and reports the difference instead.
- An asset is deactivated or disposed of, never deleted.

**Disposal** posts Dr cash · Dr accumulated · Cr asset at cost, with the
balancing figure landing on `4100` (gain) or `5500` (loss) — computed, never
typed.

---

## السندات الدورية — recurring expenses become documents

A row in `monthly_expenses` with `recurrence: 'monthly'` is a **template**, not
a document: "the rent is 5,000 a month, due on the 5th". It has no date, so
nothing can post it and no VAT claim can be dated to it.

**إقفال الفترة → سندات المصاريف المتكررة** generates one dated voucher per
template per month. After that, everything downstream stops special-casing
recurrence — the ledger posts it like any other expense, the VAT report claims
it in the quarter it falls in, and the income statement charges it to its own
month.

- **Idempotency is structural.** The voucher's document id is
  `<templateId>__<periodKey>`, so generating twice writes the same document.
  No counter to race, no "already generated" flag a failed write could leave
  wrong, and a half-finished sweep is resumed by running it again.
- **Preview before create.** Nothing is written until the range is scanned and
  the list shown, and every skipped template says why.
- **Due dates are clamped to the month** — a template due "on the 31st" gives
  28 February (29 in a leap year), never `2026-02-31`.
- **Amounts are copied, not referenced.** Raising the rent next year must not
  restate last year's vouchers.
- **An unpaid voucher credits الموردون**, not cash — the whole point of dating
  it is that the liability exists whether or not it is settled.
- **A posted voucher is frozen**, and a voucher is cancelled (with a reason)
  rather than deleted: a gap in a monthly series is itself information.
- **Double-count guard.** Once a template has vouchers, the VAT report drops
  the template and counts the vouchers — otherwise the same tax would be
  claimed twice, once as a real document and once as a ×N estimate.

Optional `start_period` / `end_period` fields bound a template's life; a row
without them is open-ended, which is how every existing row behaves.

---

## تقرير ضريبة القيمة المضافة

A **report**, not a return: it covers the three headline figures but not every
field of a ZATCA declaration (zero-rated and exempt supplies, imports,
corrections of prior periods), so calling it an إقرار would overstate it.

| | |
|---|---|
| **ضريبة المخرجات** | The **posted movement on `2100`** — which already contains the washes AND the credit/debit notes that adjusted them. Washes and invoices are never summed together: an invoice documents a wash that was already posted, so adding both would double the sale. The wash figure is kept as an independent check that says how much has not reached the books yet. |
| **ضريبة المدخلات** | Only from purchases that carry a real tax invoice. |
| **الصافي** | Output − input, labelled payable or refundable. |

### Deduction requires a document
Input VAT is deducted **only** against a purchase carrying all four of:

`تاريخ الفاتورة` · `رقم الفاتورة` · `اسم المورّد` · `مبلغ الفاتورة`

A recurring cost is **not** evidence that invoices exist. An earlier version
multiplied a monthly template by three inside a quarter, which invented two
invoices nobody had received — an overstated reclaim, and the kind an
assessment reverses with a penalty. That multiplier is gone; the rule is
enforced in `vatReturn.js` and covered by a regression test.

Rejected purchases are **not** silently dropped. They are listed as
«غير مؤهلة» with the exact missing fields, the report totals the tax being
given up for want of a document, and the CSV carries them too — a number
quietly vanishing from a return is as bad as one quietly appearing in it.

An undated reject appears in **every** period, because it belongs to none.

### Filing frequency is a setting
Quarterly below the SAR 40m threshold, monthly above it — neither is assumed.
Set it in **إقفال الفترة → إعدادات المحاسبة**, alongside VAT registration and
whether wash prices include the tax. The report's periods, labels and totals
follow it.

---

## الإشعارات تصل إلى الدفاتر

A credit note that writes only `sales_documents` changes nothing: revenue and
output tax stay exactly where the invoice left them, and the VAT report keeps
showing the original sale in full. So the document and its journal entry are
written in **one transaction** — document, counter, entry, journal counter,
period and audit record all land or none do. The document stores
`journalEntryId`; the entry stores `documentId`, so neither can be an orphan.

| | |
|---|---|
| **إشعار دائن** | Dr `4010` مردودات المبيعات (net) · Dr `2100` (the tax reversed) · Cr cash/bank/customer (gross) |
| **إشعار مدين** | Dr cash/bank/customer · Cr `4000` (net) · Cr `2100` |

A **wash-linked invoice** gets no entry: the sale it documents was already
posted from its wash, and posting it again would double the revenue. A
**standalone invoice** gets one, because nothing else will ever post it.

The settlement account is not guessed — the caller states `refundMethod` /
`paymentMethod`, defaulting to the account the invoice itself settled to
(stored as `settlementAccount`, so a refund goes back where the money came in).

### A note inherits its invoice's tax treatment
`taxable`, `vatRate`, `priceMode`, the customer and the seller identity all
come from the **referenced invoice**, read inside the transaction. A note
correcting an invoice issued while registered still carries that invoice's VAT
even if the business has de-registered since — reading today's setting would
silently drop tax the authority was already told about. `vatRate` is stored on
every document rather than assumed to be 15% forever.

The note's period comes from its own date, and a closed month refuses it.

### Voiding a document with an accounting effect
Cancelling the paper while its entry stayed posted would leave revenue and
output tax reduced by a note the register says never happened. `salesVoidDocument`
**reverses the entry in the same transaction** and links the mirror both ways.

Only the document's **own** entry (`journalEntryId`). Voiding a wash-linked
invoice reverses nothing: it documents an entry it did not create, and undoing
the wash's revenue is done by reversing that entry through the ledger.

**`reversalDate` is required and explicit**, and travels UI → client →
callable → `voidDocument`. It used to default to the document's own date
server-side, which left one case with no way out at all: a note raised in July,
July filed and closed, and the only date the server would accept was the one
the closed period refuses. The void dialog carries a date field for exactly
this — pick an open month, and the original stays in its own closed month with
its own lines while the mirror lands where you put it.

### A reversed entry still counts
`postedLines` used to keep only `status === 'posted'`, which dropped the
original of a reversal while keeping its mirror — leaving the account off by
the full amount, in the wrong direction. Reports now include `posted` **and**
`reversed`; only `draft` stays out.

### …but a mirror is not a posting of its source
Idempotency is the opposite question, and it had the opposite bug. The mirror
used to inherit the original's `sourceType` and `sourceId`, so after reversing
a wash the lock was released — the record was free to correct — while every
reader asking *"does this source have a posted entry?"* found the **mirror**
and answered yes. `collectUnposted` reported `مُرحّل مسبقاً`, auto-post
skipped, and the correction could never be posted. Reversal was a dead end.

Two changes, either of which would do, both applied because old mirrors are
already in the data:

- `reverseEntry` writes the mirror as `sourceType: 'adjustment'`,
  `sourceId: null`, `sourceKind: null`, recording what it reversed in
  `reversedSourceKind` / `reversedSourceType` / `reversedSourceId`.
- `isLiveSourceEntry` (and `hasPostedEntryFor` through it) ignores any entry
  carrying `reversalOf`, whatever identity it holds.

`posting_locks` remains the server-side truth; this is what lets the client
offer the re-post that the server would already have accepted.

---

## قائمة الدخل تقرأ الدفاتر

**قائمة الدخل** used to be summed straight out of `washes`,
`variable_expenses`, `monthly_expenses` and `annual_expenses`. Every figure on
it — revenue, gross profit, the management fee, the supervisor's share, the
six-month trend, the CSV — came from those raw rows.

Which meant a credit note changed nothing. Cancel a 115-riyal sale in full and
the statement still reported 115 of revenue, still charged 10% of a profit that
had been given back, and still disagreed with the trial balance, the VAT return
and the balance sheet — all three of which read the journal. A wash typed in
but never posted counted too, so the official statement reported revenue the
books had never recognised.

`src/lib/accounting/monthlyStatement.js` is now the single source for that
page. It is pure, so the screen, the CSV export, the KPI cards and the trend
chart all consume the *same object* and cannot drift:

- Revenue comes from `incomeStatement` over posted journal lines, and
  **net revenue is `4000` less `4010`** — a credit note reduces it because a
  contra-revenue debit is exactly what the note posts. Returns keep their own
  line on the face of the statement rather than being netted out of sight.
- Direct costs (`50xx`/`51xx`) and operating expenses are separated by the
  chart's own `accountType` / `directCost`, not by which table a row came from.
- Fees are read from `fee_rules` when configured, falling back to the 10% /
  5% the statement has always charged, and a losing month charges neither.
- The partner-view pro-rata factor is applied once, at the end.

The operational registers keep their page and their drill-down, relabelled as
what they are: **تفاصيل تشغيلية للمطابقة**.

### الشهر السابق لا يتحرك بتغيير إعداد

`vatRegistered` and `washPriceMode` decide whether a 115-riyal wash is 100 + 15
or 115 + 0. Read as "whatever the setting says today", flipping either one
silently restated every past month that a screen derives from raw wash rows —
and produced a reconciliation gap exactly the size of the tax, which no amount
of posting could close, because the gap was in the question rather than in the
data.

Two changes, and they cover the two halves of the problem:

**Posted washes carry their own answer.** `postSource` writes a `taxSnapshot`
onto the wash's entry — the switches that were in force and the net/vat/gross
they produced. Every later reader asking "what was this wash's revenue?" reads
it from there. Entries written before the snapshot existed are read off their
own lines, which say the same thing one step less directly.

**Unposted records use the rules of their own day.** The switches carry an
effective date: `app_settings/accounting.taxPolicyHistory` is a list of
`{ effectiveFrom, vatRegistered, washPriceMode, vatRate }`, and `taxPolicyAt`
answers "what were the rules on this date". `postSource` resolves the policy
from the *record's* date too, so posting a July wash in September files it
under July's rules rather than today's.

### السجل التاريخي يبدأ بـbaseline صريح

The first change is the one that decides whether any of this works. Storing the
new policy alone leaves one row dated August — and `taxPolicyAt('2026-07-15')`
then finds nothing on or before July, falls back to the current settings, and
reports July under the policy the change had *just* introduced. One save,
and a filed month silently restated.

So the first change writes **two** rows: an explicit `baseline` for the policy
that was in force until then, and the change itself. The baseline date is never
inferred — a guessed baseline is the same bug wearing a timestamp. **إقفال
الفترة → إعدادات المحاسبة** asks for it once, either as its own step (record
what has applied since the books began, changing nothing) or alongside the
first change.

Three consequences worth stating:

- A date **before** the first baseline returns `known: false`, not today's
  settings. Every caller says «السياسة التاريخية غير مهيأة» rather than
  substituting a figure: `postSource` refuses to post, `issueDocument` refuses
  to issue, and the VAT report and the reconciliation report the count instead
  of a number.
- A **future-dated** change does not move `taxPolicyAt(today)`. The flat
  `vatRegistered` / `washPriceMode` / `vatRate` fields kept for compatibility
  are always `taxPolicyAt(today)`, never the last row — so a change effective
  next month does not take effect the moment it is saved.
- An install with **no history at all** reads as before: the current values
  apply to all dates, labelled `source: 'unversioned'`, which says "we do not
  know when this was set" rather than "it was always this".

### الإعدادات تُكتب على الخادم

`app_settings/accounting` is denied to clients in the rules — readable, never
writable — and every change goes through `accountingSetTaxPolicy`. Written from
a browser it had three holes, and only the third is obvious:

1. **Lost updates.** Read-merge-write from two tabs drops a policy row, with no
   counter to notice it and no audit record to find it in.
2. **No audit trail.** Changing `washPriceMode` restates what every future wash
   means. That is an accounting decision and it has to be signed.
3. **No gate.** Anyone reaching Firestore could back-date a policy into a month
   already filed.

The callable re-reads inside a transaction, validates the date against the
calendar (not `Date.parse`, which rolls `2026-02-30` over to 2 March), and
writes before/after/effectiveFrom/reason/userId to `audit_logs`. A change whose
effective date reaches into a **closed** month rewrites what was filed: an
accountant may not make it at all, an admin may with a written reason, and the
audit record says `retroactive`. `accountingSetPreferences` carries the
switches that move no past figure — auto-posting and the filing frequency.

### الفوترة تقرأ السياسة، لا الترويسة

`app_settings/company` is the seller's **identity** — name, address, VAT number.
Whether a supply bears tax is an accounting policy, and the two used to be
conflated: `company.vatRegistered` decided a standalone invoice's taxability.
It no longer does. Three sources, one per path:

| Path | Tax treatment from |
|---|---|
| `note` | the invoice it corrects — a correction to a taxable invoice keeps its tax even if the business has since de-registered |
| `linked` | the wash entry's own `taxSnapshot`. A pre-snapshot entry has its rate and pricing mode **derived from its lines and verified** — the derived rate has to reproduce the entry to the halala, and if it cannot the invoice is refused rather than issued at an assumed 15% |
| `standalone` | `taxPolicyAt(supplyDate)` |

Both the document and its entry store a `taxSnapshot` and
`taxPolicyEffectiveFrom`, so a reader never re-derives either. The `2100` line
names its own rate — `ضريبة مخرجات 5%` on a 5% entry, not a fixed 15% caption
contradicting its own amount. The rate is a real setting, with 15% and 5% in
the picker: KSA has charged both, and a 2019 purchase invoice keeps its 5%
however many times the standard rate moves.

### تقرير الضريبة كذلك

The official output figure is the movement on **2100** and always was. What
moved was the operational check beside it, and the input side:

- A **posted** wash contributes what its entry froze; an **unposted** one is
  split under the policy in force on its date.
- **Input VAT** comes from the amount the supplier wrote on the invoice when
  there is one — a tax invoice states its own VAT, and recomputing it from a
  rate is second-guessing the paper the deduction rests on. Failing that, the
  rate stored *on* the invoice; failing that, the rate in force on the
  invoice's date. Today's rate is never the answer for a historical document.
- A period the record cannot answer for reports
  «السياسة التاريخية غير مهيأة» and a count, never a figure computed under
  today's rules.

### المطابقة تُفسّر، ولا تطرح رقمين

The first version of the reconciliation strip subtracted the operational total
from the ledger's net revenue and blamed the whole remainder on unposted
washes. It was wrong twice: `quantity × price` is a **gross** figure whenever
wash prices are quoted VAT-inclusive, so a perfectly reconciled month reported
a difference exactly equal to its output tax; and a credit note — which reduces
the ledger and touches no wash at all — was reported as a missing posting.

The operational side is now split with the **same** `vatRegistered` and
`washPriceMode` the wash poster reads out of `app_settings/accounting`, so the
comparison is net against net. And the result is six named lines, not one
subtraction:

| | |
|---|---|
| **أ** | صافي المبيعات التشغيلية — completed washes, tax removed |
| **ب** | إيرادات الغسلات المُرحّلة — 4000, restricted to entries whose source is a wash |
| **ج** | غسلات مكتملة غير مُرحّلة — at **net**, and counted |
| **د** | مردودات المبيعات — credit notes, which move the ledger and not the register |
| **هـ** | إيرادات أخرى مُرحّلة — standalone invoices, debit notes, non-operating revenue |
| **و** | الفرق غير المفسَّر — **أ − ب − ج** |

Only **و** is a discrepancy. A month full of unposted washes and credit notes
is fully *explained*, and the page says which, rather than lumping them into
one number and calling it a posting gap. Mirror entries are attributed back to
the source they cancel (`reversedSourceKind`), so a reversed wash nets to zero
under **ب** instead of appearing as revenue under **هـ**.

Line **أ** itself is built the same way the statement is: a POSTED wash
contributes the figures its own entry froze, and only an UNPOSTED one is split
— under the policy effective on its date. That is what makes **و** stay at zero
when a setting changes, instead of jumping by the month's output tax.

---

## الترحيل التلقائي — posting at the approval moment

Posting stays a *decision*; what this adds is that the decision can be
expressed where it is actually made — the moment a wash is marked **مكتملة**,
or a dated expense is marked **مسدَّد**.

Switched in one visible place, **إقفال الفترة → الترحيل التلقائي**, and **off
by default**: an existing install must not silently start writing entries
because the app updated.

Three properties make it safe to fire from a UI action:

1. **It fires on a transition**, not on every save. An operator editing a
   completed wash three times does not mint three entries.
2. **Same guards as the manual sweep.** Both paths read the same adapters in
   `sourceAdapters.js` — one definition of "how does this record become an
   entry" — so idempotency on `sourceType + sourceId`, the closed-period check
   and the account mapping cannot drift apart. Posting via one path makes the
   other a no-op.
3. **It never throws, and never swallows.** The operational save already
   succeeded, so a ledger failure must not tear down the user's action — but
   the result is always surfaced as a toast. A closed period or an invalid
   date comes back as a *blocking* skip shown in red.

The record is **re-read from Firestore** before posting, so what lands in the
ledger is what was actually stored.

A recurring template is deliberately excluded: it has no date, so its dated
vouchers are what post. And editing a record that is already in the books
gets a warning — the posted entry does not follow the edit, so the correction
is a reversal or an adjusting entry.

---

## Setup

```bash
npm install
npm run dev
```

The Firebase web config is **embedded as a default** (it is a public client
identifier; access is enforced by security rules, not by hiding it), so the
app runs with no env setup. To point at a different project, set any of:

```
VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID
```

`VITE_REQUIRE_AUTH` defaults to required; set `false` only for local demos.

### First run on a fresh project
1. **Authentication → Sign-in method** → enable Email/Password.
2. Create the accounts you need, then add a `users/{uid}` document per user
   with `{ email, role }` (see roles below). An admin also needs
   `app_admins/{uid}`.
3. Deploy the rules in `firestore.rules`.
4. In the app: **إقفال الفترة → تهيئة دليل الحسابات**.
5. **إقفال الفترة → فحص غير المُرحّل → ترحيل** to bring existing operational
   data into the books (see Migration).

### Firestore rules
`firestore.rules` defines four roles on `users/{uid}.role`:

| Role | Can |
|---|---|
| `admin` | everything operational + manage accounts and fee rules, close periods |
| `accountant` | post/reverse entries, close periods, issue documents, manage the asset register and accounting settings, read everything |
| `operator` | record day-to-day operations; **cannot** touch the ledger |
| `partner` | read-only |

`app_settings` is **not** an operational collection: it holds the VAT number
printed into every QR code and the auto-posting switch, so it needs an
accountant.

Two things **no** client can do, whatever the role:
- write `app_admins` (privilege escalation would be one write away);
- amend or delete a posted entry or any journal line — only the single
  `posted → reversed` transition is allowed.

Storage rules for invoice files live in `storage.rules` (Cloud Storage must be
enabled on the project first).

---

## Migration — bringing existing data into the books

There is **one** code path, used both for today's business and for the
backlog: `إقفال الفترة → فحص غير المُرحّل`, then `ترحيل`.

- **Idempotent.** A record whose `sourceType + sourceId` already has a posted
  entry is skipped, so re-running the sweep is always safe.
- **Explicit about skips.** Anything not posted is listed with the reason —
  an in-progress wash, a missing date, a closed period, or already posted.
- **Nothing is mutated.** Operational documents are read, never rewritten; the
  ledger is additive.
- Posting is sequential (the entry-number counter is one document), and a
  failure on one record is reported without stranding the rest.

Order of operations for a first migration: seed the chart → generate the
recurring vouchers for the months you are bringing in → run the sweep → check
**ميزان المراجعة** is balanced → close the oldest completed month.

---

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`
- `npm run lint` — ESLint
- `npm test` — vitest unit suites (balance, VAT, posting rules, reports,
  invoicing, QR encoding). No emulator needed.
- `npm run test:watch` — vitest in watch mode
- `npm run test:emulator` — ledger + invoicing integration against a real
  Firestore emulator: transaction atomicity, concurrent numbering, closed
  periods, reversals, one-invoice-per-source
- `npm run test:rules` — drives `firestore.rules` itself through every role
- `npm run test:callables` — the callables themselves, through the Functions
  and Auth emulators with **real signed-in users**, so `callerRole`,
  `requireAccountant` and `requirePostSource` are exercised rather than assumed
- `npm run test:functions` — the trusted server: balance, derived periods,
  concurrent numbering, reversal integrity, invoice issuing, the role gate,
  a drift check between the client's preview validation and the server's
  authoritative copy, and a full journey under the **real** `firestore.rules`
  (callable succeeds → audit present → direct client write denied)

The emulator suites share one database and reset between tests, so they run
with `--no-file-parallelism`; `npm test` excludes them.

## Android

A Capacitor project lives in `android/`. Web assets are bundled inside the
APK, so it needs no deployment domain:

```bash
npm run build && npx cap sync android && (cd android && ./gradlew assembleRelease)
```

Release signing reads `android/keystore.properties` (gitignored, along with
`*.keystore`) — signing material never enters the repo.

---

## Known limits

- **ZATCA e-invoicing is NOT integrated.** Documents are numbered, carry a
  Phase-1 QR and behave correctly as accounting records, but nothing is
  stamped, chained, reported or cleared. Treat them — and the VAT report — as
  internal working papers.
- Cloud Storage is not enabled on the project, so invoices are referenced by
  **URL** rather than uploaded.
- Depreciation is **straight line only**. Declining-balance and units-of-
  production are not implemented.
- Existing startup-cost rows are not swept into the asset register
  automatically — `importAssetFromSource` exists and is idempotent, but each
  asset's useful life is a judgement, so it is entered rather than guessed.
- **Invoices issued before the two-path split carry no ledger link**, so a
  credit note against one is refused. That is a **migration to run before this
  goes live**, not a limit to live with — see *ربط الفواتير القديمة* above.
  What stays a limit is the residue: any invoice that does not declare its
  source record is never linked automatically, and has to be decided by hand.
- **قائمة الدخل shows only what has been posted.** A month whose washes are
  recorded but not swept into the ledger reads as zero revenue there, with the
  gap named as line **ج** of the reconciliation. That is the intended reading of
  an official statement, not a bug, but it does mean the sweep is now on the
  critical path for the monthly numbers.
- **Correcting a wash invoice needs the atomic path**, and that path cancels
  the document rather than amending it. There is no "edit the invoice": the old
  number stays cancelled and a new one is issued, linked both ways. Fixing a
  typo in a customer name therefore consumes a number, which is the correct
  behaviour for a tax series and worth knowing before it surprises anyone.
