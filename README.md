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
reversed entry stops counting automatically. Operational tables are never
summed directly into a report.

---

## Modules

| Tab | What it does |
|---|---|
| رسوم التأسيس | One-time startup costs, per-item expense ledger, invoice links, VAT flags |
| المصاريف السنوية | Recurring yearly expenses + per-item payment ledger |
| المصاريف الشهرية / المتغيرة | Monthly fixed + per-wash variable costs (biker commissions auto-derived from wash logs) |
| الغسلات | Wash batches (quantity × price) feeding revenue and commissions |
| قائمة الدخل | Income statement |
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
| 4000 / 4100 | إيرادات غسيل السيارات / أرباح استبعاد أصول | revenue |
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
The posting transaction writes `posting_locks/<sourceType>__<sourceId>`. The
rules refuse update and delete on `washes`, `partner_payments`,
`monthly_expenses`, `variable_expenses`, `annual_expense_entries`,
`startup_cost_entries` and `temporary_expenses` while that lock exists — so a
record in the books cannot be edited behind the ledger's back, whatever the UI
does or does not render.

Reversing an entry releases the lock, which is what makes a legitimate
correction possible: reverse, fix, re-post.

### Re-opening a closed period
Closing is an accountant's call. **Re-opening needs an admin and a written
reason**, both enforced in the rules (`reopenReason` must be a non-empty
string), and it is audited.

### Posting rules
| Operation | Entry |
|---|---|
| غسلة (مكتملة فقط) | Dr cash/bank/receivable (gross) · Cr revenue (net) · Cr output VAT |
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
| `salesIssueDocument` | accountant | **recomputes the totals from the lines**, mints the number and sequence, takes the seller identity from settings |
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
| **ضريبة المخرجات** | From **completed** washes in the period, split per the VAT-registered and price-mode settings. Cross-checked against posted movement on `2100`; a difference means completed washes are not in the books yet, and the page says so. |
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
