# Arabic and English interface

The language button is available on sign-in, password-update and application
headers for both administrators and partners. Arabic remains the default.
The selection is saved in `localStorage` (`sweater:language`) for this browser,
restored on refresh and synchronised across tabs. It does not change the URL,
the current page, user permissions or database preferences.

English uses `en-GB`, LTR layout and SAR currency presentation. Arabic retains
the existing Arabic locale and RTL layout. Monetary precision, accounting
calculations, API payloads, input values and canonical option values are
unchanged. Unknown user-authored text and personal names are not transliterated.
Exported CSV headers and payroll print direction follow the selected language;
CSV records remain unchanged.

## Architecture

Vite's local JSX runtime routes host elements and fragments through a React
presentation boundary. This translates visible copy and accessibility labels,
and mirrors existing physical-direction utility classes. Host nodes, refs and
form state survive language changes; no DOM mutation observer is used.
`translate="no"` skips translation on that element. Currency/date helpers and
native confirmation messages use the same locale module. Memoised chart labels
explicitly depend on the selected language.

The full English catalogue is loaded lazily when English is selected. No
translation API is used by the application. Missing catalogue entries stay
readable in Arabic rather than modifying arbitrary user data. If loading fails,
the application remains available with a bilingual retry message.

## Maintaining copy

- `src/i18n/en.generated.json` contains translation drafts of developer-authored
  string literals and template strings, including backend error messages shown
  in the interface. It contains no queried database records.
- `src/i18n/en.reviewed.json` overrides drafts with reviewed navigation,
  accounting, partner eligibility and setup-fund terminology.
- `node scripts/build-english-catalogue.mjs` extracts new source literals and
  obtains drafts using a public translation endpoint **at development time**.
  Do not put credentials, personal data or private records in source literals.
  Review new translations before delivery, especially financial terminology.
- `node scripts/localize-presentation.mjs` is a repeat-safe mechanical tool for
  locale helpers, native confirmations and mirrored Tailwind utility sources.
- Catalogue tests fail when new Arabic source messages are missing or template
  interpolation markers are lost. Language tests cover saved choices, routing,
  layout, accessibility, form preservation and unchanged monetary calculations.

No Firebase configuration, security rules, schema or financial records are
changed by this feature. Local preview fixtures are ignored by Git and are
disconnected from Firebase; they are not part of the deployed application.

## Verification — 3 October 2026

Base: official production branch at `b4dee4b938ec995268e17dd79bd286b036772549`.
Implementation is in an independent worktree, not the shared dirty checkout.

- Unit suite: 1,542 passing tests, 425 existing environment-dependent skips.
- Lint: no errors; two existing `useCategories` dependency warnings unchanged.
- Build: successful, including an independently loaded English catalogue.
- Local browser: 22 administrator pages and five partner sections load in
  English. Sign-in, Arabic/English switching, preserved form state, preserved
  disclosure state, refresh routing and restored language were checked.
- Responsive: 390 × 844 mobile viewport, LTR mobile menu and income statement;
  no document-level horizontal overflow. Desktop navigation also checked.
- Payroll: real English and Arabic PDFs generated from built-in test data and
  rendered for visual review. Fixed-width screen sheets previously cropped the
  export; the cloned sheet now fits A4 without resizing the live preview.
  Printed monetary totals use isolated LTR numeric direction in both layouts.
  Biker names and amounts are unchanged.
- Fresh browser tabs have no console errors or warnings after the final fixes.

These are local, isolated frontend checks, not a live deployment or a production
financial-data audit. No emulator/backend/security changes were required.
The long tail of generated message drafts is not represented as individually
human-reviewed; reviewed financial and navigation wording takes precedence.
