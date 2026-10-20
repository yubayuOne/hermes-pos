# HERMES POS — cashier app

Android app for selling: open a shift, sell, take cash or QRIS, print, refund, close the shift.
The owner manages the business in the backoffice ([`apps/web`](../web)). Product, design, and database docs are
global: see the [root README](../../README.md).

- Screens: [`docs/DESIGN.md`](../../docs/DESIGN.md) section I · rules: [`docs/PRD.md`](../../docs/PRD.md)
- Screen-to-file map and decisions that differ from the design: [`docs/POS_V2.md`](docs/POS_V2.md)
- History of earlier versions (old UI, patch notes): [`docs/archive/`](docs/archive)

## Stack

Expo SDK 57, React Native 0.86, TypeScript, NativeWind 4, Supabase (Auth, Postgres RPC). Bluetooth ESC/POS
printing through a native module in [`plugins/hermes-pos-printer`](plugins/hermes-pos-printer), installed by
[`plugins/withHermesPosPrinter.js`](plugins/withHermesPosPrinter.js) on every prebuild.

## Setup

```bash
npm install
cp .env.example .env    # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm run android         # dev build; Expo Go cannot load the printer module
```

The database is the shared one in [`supabase/`](../../supabase). `npm run db:push` applies new migrations to the
linked Supabase project; `npm run db:reset` resets a local one.

## Preview on the web without Supabase

A mock server answers Auth, tables, and RPCs with sample data. Bluetooth printing does not work on the web.

```bash
npm run mock:supabase   # port 54500
npm run web:mock        # second terminal
```

Sign in with any email and password `rahasia123`; cashier PIN `123456`; void approval code `481516`.
Scenarios: `http://localhost:54500/__scenario?sub=active|trial|expired&shift=open|none&menu=ok|fail|slow&photos=yes|no&net=up|down`.
`net=down` sends checkout and hold down the offline path.

## Code layout

```
App.tsx                 bootstrap: fonts, session, cashier picker, tabs
src/screens/            one folder per tab or flow (sell, pay, bills, shift, more, auth, locked)
src/components/         shared UI (Text, Button, Field, Sheet, Slip, chrome, overlays, ReceiptView, ...)
src/hooks/              AppStore and NotifyProvider contexts, useBill, useLayout
src/services/           Supabase calls, offline queue, printer, cache, subscription
src/utils/              pure logic: discount, voucher, refund, receipt, errors, stock
src/i18n/               t(), formats, English dictionary (en.ts)
tests/                  unit tests for src/utils and src/services (plain Node, no test runner)
scripts/i18n-check.js   finds Indonesian keys without an English entry
e2e/mock-supabase.mjs   mock server for the web preview
```

## Checks

```bash
npm run typecheck       # TypeScript strict, also reports unused code
npm run test:js         # discount, voucher, payment chips, refund, receipts, notes, logo, offline queue
npm run i18n:check      # Indonesian text without an English entry fails the check
```

SQL tests for the database: see the root README.

## Rules the code relies on (from the PRD)

- Checkout, hold, void, refund, and shift close are server RPCs in one transaction. Each carries an idempotency
  key, so a retry never records twice.
- Without internet, sales (cash or QRIS), held bills, temporary menu items, and opening or closing a shift
  go to an offline queue and sync later. A bill already carries its final number from the phone
  (`#HPOS-YYYYMMDD-<terminal>-NNNN`, migration 054); only entries made before 054 have a temporary `TUNDA-XXXXXX`.
  A shift cannot close while its queue has entries. Picking a cashier (the server checks the PIN), split payments,
  voids, and refunds need internet.
- Dates on the phone (bill numbers, today's shifts) use the business's time zone, sent with the catalog snapshot
  (migration 064) and kept in the local database; WIB until the first sync.
- Release builds use R8 with a keep rule for the Bluetooth printer module (see the root README, "Build an APK").
- When the subscription has ended, new sales and new shifts are locked. Bills and reports stay readable and the
  queue still syncs.
- Voiding or refunding a paid bill needs the owner's 6-digit approval code.
- A failing printer never cancels a payment.
