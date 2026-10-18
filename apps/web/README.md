# HERMES POS — landing page and backoffice

npm workspace with the public landing page and the owner's backoffice. Product, design, and database docs are
global: see the [root README](../../README.md). Design follows [`docs/DESIGN.md`](../../docs/DESIGN.md) v2.0 (calm
brutalism: paper, pine, one orange accent, receipt motif); features follow [`docs/PRD.md`](../../docs/PRD.md).

Stack: TanStack Start (React 19, Vite), Tailwind CSS 4, Zod, Supabase (`@supabase/ssr`).

| Folder | Contents |
| --- | --- |
| `apps/web` | Landing page `hermes-pos.com` (DESIGN sections C1 to C9) |
| `apps/backoffice` | Backoffice `backoffice.hermes-pos.com`: sign in and sign up, password reset, 5-step setup, Summary, Reports, Outlets, Cashiers, Products, Expenses, Vouchers, Settings, Subscription (checkout and billing history), 404, 500 |
| `packages/theme` | DESIGN tokens (section A) and component classes (section B) in `theme.css`; fonts self-hosted through Fontsource |
| `packages/ui` | Shared components (button, chip, field, switch, tag, receipt, dialog, toast, bar chart, steps, skeleton, icons) and the ID/EN `i18n.tsx` |
| `e2e`, `tests` | Mock Supabase for local preview, and the end-to-end navigation test |

The domains are not registered yet; every default URL points to localhost.

## Run

```bash
npm install
npm run dev:web          # http://localhost:3000
npm run dev:backoffice   # http://localhost:3001, needs apps/backoffice/.env
npm run build
```

Backoffice without Supabase: `npm run mock` (port 54400), then start the backoffice with
`SUPABASE_URL=http://localhost:54400 SUPABASE_ANON_KEY=mock APP_URL=http://localhost:3001`. Sign in with any email
and password `rahasia123`. Scenarios: `http://localhost:54400/__scenario?status=active|trial|expired&data=full|empty&biz=yes|none`.

## Configuration

See `apps/backoffice/.env.example` and `apps/web/.env.example`.

- `SUPABASE_SERVICE_ROLE_KEY` is optional and only enables sign-in with a username. It is used in one server
  function and never reaches the browser; without it, sign-in by email still works.
- Google sign-in needs the Google provider enabled in Supabase (Authentication, Providers) and the redirect URL
  `http://localhost:3001/auth/callback` (production: `https://backoffice.hermes-pos.com/auth/callback`).
- The session lives in HttpOnly cookies. With "Ingat saya" (remember me) off, they end when the browser closes.
- Production: set `VITE_LANDING_URL`, `VITE_BACKOFFICE_URL`, and `APP_URL`.

## Checks

```bash
npm run typecheck                    # both apps; strict, also reports unused code
npm test -w @hermes-pos/backoffice   # schemas, plan prices, logo processing
npm test -w @hermes-pos/web          # landing prices
npm run test:e2e                     # see "End-to-end test" below
```

## Database

The backoffice uses the shared migrations in [`supabase/migrations`](../../supabase/migrations) (030 onward for the
web). What each RPC returns is in the comments at the top of each migration. All writes are refused while the subscription has ended, except the profile,
notification switches, and payment confirmation. Data is never deleted.

`db/` holds an early copy of migration 031 with its own small test runner. The applied version is
`supabase/migrations/031_web_backoffice.sql`.

## Design rules

- Colors only through tokens, never hex in components. One full orange block per screen. Buttons 48px, chips 44px,
  radius 4px, focus ring 3px orange.
- Interface text is written in Indonesian in the markup and translated through each app's `dict.ts`. The language
  choice is stored in `localStorage` and the `hermes-pos-lang` cookie, so the first page already renders in it.
- Tables become cards at 760px and below; the sidebar becomes a drawer with a hamburger button.
- `prefers-reduced-motion` turns every animation off.

Deliberate differences from the design:

- Product categories are per outlet (database), not shared by all outlets as on the design board (PRD question 12).
- The product dialog has "Tiket dicetak ke: Dapur atau Bar" (ticket printed to kitchen or bar) because the POS
  prints kitchen and bar tickets.
- There is no transfer-proof upload yet; users send the proof through WhatsApp.
- Fonts come from Fontsource (the same files as Google Fonts) to avoid a third-party server.

## Routes

Backoffice routes are English: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/onboarding`,
`/subscription`, `/auth/callback`, then `/` (Summary), `/reports`, `/outlets`, `/cashiers`, `/products`, `/expenses`,
`/vouchers`, `/settings` (`?tab=profile|business|receipt|notifications|subscription`). Paths, query keys and values, and
anchors are English only; there are no Indonesian aliases. Page titles follow the language read when the page loads.

## Landing page and SEO

Pitch of the landing page: cash control for an owner who is not in the shop (void and refund approval code, drawer expenses
counted in the cash book, shift report to WhatsApp), plus working offline. Every claim on it matches what the app and the
database do; keep it that way and label sample numbers "contoh".

- `src/seo.ts` holds the title, description, and the JSON-LD (SoftwareApplication with the real plan prices, and FAQPage built
  from `FAQ` in `src/content.ts`, so the page and search engines never disagree). `__root.tsx` adds canonical, Open Graph,
  Twitter, and robots tags from `SITE.url` (set `VITE_LANDING_URL` for production).
- `public/robots.txt` and `public/sitemap.xml` name `https://hermes-pos.com`. Change both if the real domain differs.
- Not done: separate URLs per language (the language comes from a cookie, so search engines index the Indonesian page), and
  a real product screenshot or customer proof (none exists yet; do not invent them).

## Placeholders to replace before release (DESIGN H1)

`[NOMOR WHATSAPP]`, `[ALAMAT EMAIL]`, `[NAMA BANK]`, `[NOMOR REKENING]`, `[ATAS NAMA]`,
`[JAM OPERASIONAL VERIFIKASI]`, `[TAUTAN SYARAT LAYANAN DAN KEBIJAKAN PRIVASI]`. Landing: `apps/web/src/content.ts`.
Backoffice: `apps/backoffice/src/lib/plans.ts`.

## Deploy

Two projects from the same repository. Vercel: Root Directory `apps/web/apps/web` and `apps/web/apps/backoffice`,
enable "Include files outside the Root Directory", and set the environment variables. Own server: `npm run build`,
then `PORT=3000 node apps/web/.output/server/index.mjs` and `PORT=3001 node apps/backoffice/.output/server/index.mjs`
behind a reverse proxy.

## Backoffice performance notes

- The protected layout uses the browser-only `appContextCache` for sibling-menu navigation, so moving between menus
  does not re-run the bootstrap request. Hard reloads still do.
- Sidebar links use TanStack Router intent preloading (`preloadDelay={0}`): loaders start when the pointer or focus
  reaches a menu item, and fresh results are reused.
- `callRpc` and `readRpc` call the RPC directly with the cookie-backed JWT instead of a separate `getClaims()` first.
  PostgREST validates the JWT; tenant and owner checks stay in SQL and RLS. UI route protection is not the security
  boundary.
- Independent reads run concurrently. Ringkasan is one RPC (`owner_dashboard`, migration 062), Laporan is one
  (`owner_report_page`, 063), and the sidebar counts come from `owner_shell_counts` (062).

## End-to-end test

Runs against the mock Supabase and needs no credentials:

1. Node.js `22.22.3+` (or `24.8.0+`).
2. `npm install --save-dev e2e@0.20.0 @e2e-dev/web@0.14.0`, then `npx @e2e-dev/web install chromium`.
3. `npm run test:e2e`.

`e2e.config.ts` starts `e2e/start-backoffice.mjs` (mock Supabase plus the backoffice dev server). The test records
click-to-heading times for Outlets, Products, and Cashiers, with a local target under 2 seconds; it does not replace
measuring against the real Supabase. The mock credentials (`rina@kopipojok.id` / `rahasia123`) are for local use only.
