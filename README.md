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
| الضريبة المستردة | Every tax invoice across all four sources, totalled **per quarter** |
| الرقابة والميزانيات | Category budgets with auto-discovery + over/under tracking |
| إدارة الشركاء / المدفوعات | Partner registry, capital fees, payment receipts |
| المصروفات المؤقتة | Reimbursable outlays with pending → recovered tracking |
| **دفتر الأستاذ** | Per-account movements, running balance, opening/closing, CSV |
| **ميزان المراجعة** | Per-account debits/credits/balance with an explicit balanced verdict, CSV |
| **المركز المالي** | Assets = Liabilities + Equity, CSV |
| **المستندات الضريبية** | Simplified invoices with a sequential number and a Phase-1 QR, credit/debit notes, sequence-gap audit, CSV |
| **الأصول الثابتة** | Register, straight-line schedules, monthly depreciation entries, disposal, CSV |
| **إقفال الفترة** | Chart seeding, posting sweep, per-month preflight, close/reopen |

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
- Nothing posts into a closed period.

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
- Partner paid-to-date is **derived** from the capital account balance, not a
  stored number that can drift from the receipts.
- Management/supervisor fees are configured rows in `fee_rules` with an
  `effective_from` date — no percentage is hard-coded, so changing a rate
  cannot silently restate a past period.

### Atomicity
Every ledger mutation runs inside a **Firestore transaction**: entry number,
closed-period check, header, lines and audit record all land or none do. A
read-then-write from the client could interleave with another device and mint
a duplicate entry number, or post into a month closed a second earlier.

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
| `accountant` | post/reverse entries, close periods, read everything |
| `operator` | record day-to-day operations; **cannot** touch the ledger |
| `partner` | read-only |

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

Order of operations for a first migration: seed the chart → run the sweep →
check **ميزان المراجعة** is balanced → close the oldest completed month.

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
