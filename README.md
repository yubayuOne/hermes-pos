<div align="center">

# HERMES POS

**Android point of sale for cafés and small restaurants in Indonesia, with cash control for owners who are not always in the shop.**

Voids and refunds need the owner's code. Money taken from the drawer lowers the expected cash. Sales keep recording when the internet is down.

[Download the app](#download) · [Features](#features) · [Architecture](#architecture) · [Getting started](#getting-started) · [Documentation](#documentation)

</div>

---

## Download

<!-- The APK link always serves the newest GitHub release. For a new version, publish a release with the file named hermes-pos.apk. -->

| | |
| --- | --- |
| **Android app (APK)** | [Download hermes-pos.apk](https://github.com/yubayuOne/hermes-pos/releases/latest/download/hermes-pos.apk) |
| **Version** | 1.0.0 |
| **Requires** | Android phone or tablet, Bluetooth for receipt printing |
| **Backoffice (owner)** | [backoffice.hermes-pos.com](https://backoffice.hermes-pos.com) |
| **Website** | [hermes-pos.com](https://hermes-pos.com) |

**Install from an APK file:** open the download link on the device, allow installation from this source when Android asks,
open the file, and sign in. A free 3-day trial is available to new businesses: register in the backoffice, create a
cashier with a 6-digit PIN, then sign in on the app with the owner account (email or username) and pick the cashier.

## Why HERMES POS

Most small cafés lose track of cash in three places: voids, refunds, and money taken from the drawer for supplies.
HERMES POS gives each one a rule and a trace.

- **The owner holds the key.** A cashier cannot void or refund a paid bill alone. The owner sets a 6-digit approval
  code in the backoffice, and a reason is required. Item refunds work only on bills up to 24 hours old.
- **The drawer adds up.** Cashiers record expenses in the app. Money that came from the drawer lowers the expected
  cash at once, so a variance does not appear just because someone bought ice. The owner can correct an entry later and
  the shift is recalculated.
- **It works offline.** Bills wait in a queue on the device with a provisional number and are sent exactly once when the
  internet returns. The same key on every resend means the server rejects duplicates.
- **The report reaches the owner.** At the end of a shift the cashier taps *Kirim ke WA*; WhatsApp opens with the
  shift report ready to send. The slip can also be reprinted.

## Features

### Cashier app (Android)

- **Sign-in:** the owner account signs in once on the device with its email or username; the password is any 6 or more
  characters. Ten wrong passwords for a username lock username sign-in for 15 minutes (email still works). Each cashier
  then picks their name and enters a 6-digit PIN; five wrong PINs lock that cashier for 5 minutes. The server checks
  the PIN, so picking a cashier needs internet; the signed-in cashier can reopen the app offline during their shift. A
  phone is pinned to one outlet and only lists that outlet's cashiers.
- **Shifts:** open with opening cash, close with a cash count, also offline (queued like a sale). The expected cash and
  the variance come from the server's cash book. A shift belongs to the phone that opened it; another phone takes it
  over with the owner's code. A shift cannot close while bills are held or the offline queue is not empty. The
  business date follows the business's time zone (WIB, WITA, or WIT).
- **Selling:** product grid with search and a category picker, item and bill discounts, item notes, hold, recall, and
  split bills, temporary menu items, and a voucher picker. On a landscape phone the bill sits on the right; its totals
  and Bayar button stay in view while searching and step aside only while a bill field (note, table, name) is typed in.
- **Payment:** cash with change, and QRIS confirmed by the cashier (no payment gateway yet).
- **Printing:** Bluetooth ESC/POS printers on 58 mm or 80 mm paper, with printers assigned per role (cashier, kitchen,
  bar). Receipts carry the outlet's logo, address, phone, and header and footer text.
- **Refunds and voids:** owner-approved, with a mandatory reason, and a refund slip.
- **Expenses:** per shift, with a source (drawer or not), queued offline like a sale.
- **History:** every shift of the outlet with a period filter, reports per shift, reprint, and WhatsApp share.

### Backoffice (web, for the owner)

- **Summary:** one period filter on every page that has one (Hari ini, Bulan ini, Bulan lalu, or chosen dates, up to
  366 days). Net sales with the change against the same number of days before, cash and QRIS, bills, average bill,
  items sold, discounts given, voids and refunds; sales after expenses and gross profit; charts for the last 7 days and
  today's hours; payment method and expense category bars; top products, per outlet and per cashier.
- **Report:** the same period as an A4 report to print or save as PDF; going back keeps the chosen period.
- **Outlets:** name, address, phone, logo, and receipt text for each outlet.
- **Cashiers and products:** create cashiers and set PINs, manage the menu per outlet with a *Terjual* (sold) column
  for the chosen period, set the void approval code.
- **Expenses:** every shift's expenses by period; the owner can correct the items and the shift's cash is recomputed.
- **Vouchers:** percentage or amount, for the whole bill or chosen products, with minimum spend and quota.
- **Settings:** profile, business, receipt switches, notifications, and subscription.
- **Billing:** plans by bank transfer, with a billing history. Extra outlets are billed per month.

### Landing page

Product story, pricing, FAQ, and sign-up, with structured data for search engines. Indonesian and English.

## Architecture

```
┌──────────────────┐        ┌──────────────────────┐
│  POS app         │        │  Backoffice + landing │
│  Expo / RN       │        │  TanStack Start       │
│  offline queue   │        │  server functions     │
└────────┬─────────┘        └──────────┬───────────┘
         │  supabase-js (JWT)          │  supabase-js (JWT in HttpOnly cookie)
         └──────────────┬──────────────┘
                        ▼
              ┌───────────────────┐
              │ Supabase          │
              │ Postgres + RLS    │
              │ every write = RPC │
              └───────────────────┘
```

| Layer | Technology |
| --- | --- |
| POS app | Expo SDK 57, React Native, NativeWind, TypeScript (strict), `expo-secure-store` for the session |
| Web | TanStack Start (React 19), Vite, Tailwind CSS 4, Nitro, Zod |
| Database | Supabase (Postgres), row-level security, `security definer` RPCs |
| Tests | Node test runner for the apps, plain SQL tests for the database |

Design rules that hold everywhere:

- **The server decides money.** Totals, discounts, vouchers, refunds, change, and profit are computed in the database.
  The apps only show a preview.
- **Every write is an RPC** that checks the caller, the outlet, and the subscription. Tables the apps must not touch
  have row-level security on with client access revoked.
- **Security by default:** the signed-out role cannot execute `security definer` functions, the cashier session lives
  in the device keystore, and the web apps send security headers.

## Repository layout

```
hermes-pos/
├── README.md            this file
├── docs/
│   ├── PRD.md           product requirements (POS, backoffice, landing)
│   └── DESIGN.md        design system and screens for all apps
├── supabase/
│   ├── config.toml      Supabase CLI project
│   ├── migrations/      001 to 064, applied in order
│   └── tests/           SQL tests and the scratch-database runner
└── apps/
    ├── pos-mobile/      Expo / React Native cashier app (own README)
    └── web/             npm workspace: landing, backoffice, shared ui and theme (own README)
```

## Getting started

Requirements: Node.js 22 or later, npm, and for the POS app an Android device or emulator.

```bash
# POS app
cd apps/pos-mobile && npm install && cp .env.example .env    # set the Supabase URL and anon key
npm run android                                               # needs a dev build (Bluetooth printer module)

# Landing page and backoffice
cd apps/web && npm install
cp apps/backoffice/.env.example apps/backoffice/.env          # Supabase URL, anon key, APP_URL
npm run dev:web            # http://localhost:3000
npm run dev:backoffice     # http://localhost:3001
```

Both apps also run against a local mock Supabase without a database; see their READMEs.

### Build an APK

```bash
cd apps/pos-mobile

# In the cloud (needs an Expo account and EXPO_PUBLIC_SUPABASE_* set as EAS environment variables)
npx eas-cli build --platform android --profile preview

# On this machine (needs JDK 17 and the Android SDK)
cd android && ./gradlew assembleRelease     # android/app/build/outputs/apk/release/app-release.apk
```

The `android/` folder is kept in the repository with changes of its own, so do not run `expo prebuild --clean`: it
would reset them. Release builds use R8 (`android.enableMinifyInReleaseBuilds` and
`android.enableShrinkResourcesInReleaseBuilds` in `android/gradle.properties`), with a keep rule for the Bluetooth
printer module in `android/app/proguard-rules.pro`; the APK is about 47 MB for ARM 32 and 64 bit. After changing
either file, test printing on a release build.

**Release key.** Every update of the app must be signed with the same key, so make it once and keep two backups
outside this repository (losing it means users must uninstall to update). Create it with the JDK's `keytool`:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore hermes-pos-release.keystore -alias hermes-pos -keyalg RSA -keysize 2048 -validity 10000
```

Then add four lines to `~/.gradle/gradle.properties` on the build machine (not to the repository):

```properties
HERMES_UPLOAD_STORE_FILE=C:/path/to/hermes-pos-release.keystore
HERMES_UPLOAD_STORE_PASSWORD=...
HERMES_UPLOAD_KEY_ALIAS=hermes-pos
HERMES_UPLOAD_KEY_PASSWORD=...
```

`android/app/build.gradle` signs release builds with this key when the properties exist; without them it falls back to
the debug key and prints a warning. A phone with an APK signed by the debug key must uninstall it before installing
one signed with the release key; send its offline queue first.

## Database

All schema changes live in [`supabase/migrations`](supabase/migrations), numbered and applied in order.

- **Never edit an applied migration.** Add the next number (`069_…sql`).
- Apply migrations with the Supabase CLI from `apps/pos-mobile` (`npm run db:push`), or run each file in the SQL editor.
  Apply a migration before deploying the app build that calls it: the backoffice needs 061 (Produk), 062 (Ringkasan,
  sidebar), 063 (Laporan), and 066 to 068 (Transaksi; the Produk page reads the new `owner_product_sales` shape too); the POS build that reads the business time zone needs 064. Apply 059 only after every
  phone runs a build that no longer reads PIN hashes.
- SQL tests apply every migration to a fresh Postgres database and print `PASS` or `FAIL` per check:

```bash
PSQL="psql -h HOST -U postgres" sh supabase/tests/run_all.sh
```

They do not cover Supabase Storage or pg_cron; test those on a Supabase project. Three cleanups are scheduled when
pg_cron is active (Database > Extensions): temporary menu items, read notifications older than 90 days, and checkout
idempotency keys older than 90 days. Enable pg_cron before applying the migrations, or run their `do $$ … $$` block
again afterwards.

### Volume check

`supabase/tests/perf_volume.sql` fills a scratch database (after `run_all.sh`) with one outlet's year: 3 cashiers,
2,207 shifts, 219,025 bills, 438,033 items, 2,197 expenses, plus 2,500 other businesses with 100,000 products. It
times each read the apps call. Run it on a scratch database only:

```bash
psql -h HOST -U postgres -d hermes_pos_test -f supabase/tests/perf_volume.sql
```

Last run (18 Oct 2026, PostgreSQL 18 with default settings on a laptop; one run each, so treat as approximate):

| Read | Before | Now |
| --- | --- | --- |
| Sidebar counts | 25 ms (RLS over every business's products) | 1 ms (`owner_shell_counts`, 062) |
| Ringkasan, this month | 190 ms (3 summary calls) | 177 ms (`owner_dashboard`, 062) |
| Ringkasan, a whole year | | 2.2 s |
| Laporan, 30 days | 324 ms (two functions) | 190 ms (`owner_report_page`, 063) |
| Laporan, 365 days | 3.2 s | 2.6 s |
| Produk *Terjual*, 30 / 365 days | | 69 / 477 ms (`owner_product_sales`, 061) |
| POS catalog check, nothing changed | builds the menu each time | answers from row hashes (063) |
| Shift history, expenses, one shift's report and bills | | 5 to 76 ms |

Periods of a month or less stay under 200 ms. A year-long Ringkasan or Laporan takes 2 to 3 seconds; when that
matters, the next step is a daily summary table per outlet and product kept up to date at checkout, void, and refund.

Activate a plan after a bank transfer is verified (SQL editor):

```sql
select public.admin_verify_payment('<payment id>');                       -- from the billing history page
select public.admin_activate_subscription('<business_id>', 'monthly', 0); -- without a payment record
```

## Checks before a commit

```bash
# apps/pos-mobile
npm run typecheck && npm run test:js && npm run i18n:check

# apps/web
npm run typecheck
npm test -w @hermes-pos/backoffice && npm test -w @hermes-pos/web

# both apps, after editing code
npx prettier --check "src/**/*.{ts,tsx}"     # run inside each app; --write to fix
```

## Conventions

- **Language.** Code, comments, logs, URLs, and commit messages are in English. Interface text is written in Indonesian
  in the code and doubles as the translation key; English lives in a dictionary (`apps/pos-mobile/src/i18n/en.ts`,
  `apps/web/apps/*/src/dict.ts`). Add the English entry whenever you add or change Indonesian text.
- **TypeScript.** `strict`, `noUnusedLocals`, and `noUnusedParameters` in every app.
- **Formatting.** Prettier, same config in both apps: semicolons, single quotes, 160 columns.
- **Folders.** POS: `src/components`, `screens`, `hooks`, `services`, `utils`, `types`. Web: TanStack file routes in
  `src/routes`, shared code in `src/lib`, server functions in `src/server`, shared UI in `packages/ui`.
- **Tests.** Money and other calculations need a test that covers normal cases, zero, rounding, and edge cases.
- **Secrets.** `.env` files stay out of git; each app has an `.env.example`.

## Documentation

| Document | Read it for |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | What the product does and why: features, rules, decisions, open questions |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Tokens, components, and every screen; section I is the POS app, B to H the web |
| [`apps/pos-mobile/README.md`](apps/pos-mobile/README.md) | Running, previewing, and testing the POS app |
| [`apps/pos-mobile/docs/POS_V2.md`](apps/pos-mobile/docs/POS_V2.md) | POS screen-to-file map and decisions that differ from the design |
| [`apps/web/README.md`](apps/web/README.md) | Running, configuring, testing, and deploying the landing page and backoffice |

`docs/PRD.md` is written in English; `docs/DESIGN.md` is written in Indonesian, like the interface.

## Known limits

- QRIS is confirmed by the cashier; there is no payment gateway or bank link yet.
- Tax and service charge are not calculated.
- Picking a cashier (PIN check), voids, and refunds need an internet connection. Sales, held bills, expenses,
  temporary menu items, and opening or closing a shift are queued offline.
- The POS app keeps reading the catalog every 60 seconds; the server answers "unchanged" cheaply, but there is no push.
- Reports and charts take each day and hour in the business's time zone; rows saved before migration 064 keep the
  date they were given (WIB).
- The landing page serves one language per visitor (chosen by cookie), so search engines index the Indonesian version.

## Contact and license

- Support: WhatsApp [0851-5858-3200](https://wa.me/6285158583200) · [yubayu2004@gmail.com](mailto:yubayu2004@gmail.com),
  every day 07.00–24.00 WIB
- License: `[LICENSE TO BE DECIDED]`

<!-- Fill these in before publishing the repository. -->
