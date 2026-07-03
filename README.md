# سويتر (Sweater) — لوحة التحكم المالية للامتياز

React + Vite + Tailwind + Supabase dashboard (RTL, Arabic-first) for managing a
Sweater franchise's finances: startup costs, recurring/monthly/variable
expenses, wash revenue, P&L, budgets, partners, and recoverable VAT.

## Modules

| Tab | What it does |
|---|---|
| رسوم التأسيس | One-time startup costs, per-item expense ledger (click an item name), invoice links, VAT flags |
| المصاريف السنوية | Recurring yearly expenses + the same per-item payment ledger with auto paid/pending status |
| المصاريف الشهرية / المتغيرة | Monthly fixed + per-wash variable costs (biker commissions auto-derived from wash logs) |
| الغسلات | Wash batches (quantity × price) feeding revenue and commissions |
| الملخص المالي وصافي الربح | Monthly income statement with 10% management + 5% supervisor deductions |
| الضريبة المستردة | Every tax invoice across the ledgers, with the recoverable 15% VAT total |
| الرقابة والميزانيات | Category budgets with auto-discovery + over/under tracking |
| إدارة الشركاء / المدفوعات | Partner registry, capital fees (20,000 ر.س per worker), payment receipts ledger |
| المصروفات المؤقتة | Reimbursable outlays with pending → recovered tracking |

**Pro-Rata partner portal:** link a partner row to a Supabase user
(Edit Partner → partner email) and that user sees the whole dashboard scaled to
their workforce share, strictly read-only. Admins get a TopBar selector to
simulate any partner's view.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

Without Supabase env vars the app runs in demo mode (nothing persists).
Login is required by default; set `VITE_REQUIRE_AUTH=false` only for demos.

## Supabase setup (fresh project)

Run in the SQL Editor, in this order — paste each file's **content**:

1. `supabase/schema.sql` — all tables, RLS (authenticated-only), triggers,
   seed data, and the `is_admin` / `get_user_id_by_email` functions.
2. `supabase/migrations/2026_06_rls_authenticated_hardening.sql` — safe to
   run even after schema.sql (idempotent); required when upgrading an
   existing DB that still has the old public policies.

For an **existing** DB, apply migrations instead (skip files superseded by
the `*_ALL` consolidations — see each file's header). Recommended order:

```
2026_05_partners_capital_tracking.sql
2026_05_partners_user_link.sql
2026_05_partner_payments_ledger.sql
2026_05_temporary_expenses_ledger.sql
2026_05_admin_helper_and_secure_rpc.sql   (supersedes 2026_05_get_user_id_by_email_rpc.sql)
2026_06_startup_cost_entries_ALL.sql      (supersedes the 3 startup_cost_entries files)
2026_06_annual_expense_entries_ALL.sql
2026_06_rls_authenticated_hardening.sql
```

Auth settings (Dashboard → Authentication):
- **URL Configuration**: Site URL = your production URL; add
  `https://<your-domain>/update-password` (or `/**`) to Redirect URLs for
  the password-reset flow.
- **Email → Confirm email**: disable for the smoothest partner-account
  provisioning flow (accounts created in-app get a temporary password).

## Deploy (Vercel)

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in the project's
Environment Variables. `VITE_REQUIRE_AUTH` defaults to required — no need to
set it. SPA fallback handles `/update-password` automatically.

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`
- `npm run lint` — ESLint
