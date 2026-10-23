# HERMES POS PRD v2 (English)

Oct 11, 2026 · revised Oct 12, 2026 to match DESIGN.md · @Bayu Anggoro Sunu

## 1. Executive summary

HERMES POS is a subscription point-of-sale system for small cafes and restaurants in Indonesia: an Android cashier app (POS), a backoffice website for owners, and a landing page, targeting release on 17 October 2026.

**Product.** Three parts share one owner account and one Supabase database.

- **Android POS**: open and close shifts, sell, discount, hold bills, split bills, print receipts over Bluetooth, keep working when the internet drops.
- **Backoffice web** (backoffice.hermes-pos.com): owners manage outlets, cashiers, categories and products, view reports, and monitor their subscription.
- **Landing page** (hermes-pos.com): product introduction, plans, and sign-up.

**Business model.** A free 3-day trial, then a per-business subscription: IDR 149,000 per month, IDR 699,000 per 6 months, or IDR 1,399,000 per year. Every plan includes 1 outlet, 3 cashiers, and 100 products per outlet. Extra outlets cost IDR 99,000 per month.

**Core principles.**

1. The database is the source of truth: all important writes go through RPC functions, never from screens.
2. Money must never be wrong or duplicated: prices and stock are read by the server, and every payment carries an idempotency key.
3. Cashiers can keep selling without internet.
4. When a subscription expires, the app stays open but features are locked. Data is never deleted.
5. Tidy, thumb-friendly screens, portrait and landscape, Indonesian and English.

**Status at the time of writing.** The POS core, the backoffice foundation, and the subscription foundation in the database (migration 030) are built and tested on a local Postgres. They have not been tested on a real Supabase project, real devices, or real printers. Section 21 lists status per module.

This document is written like a pre-build PRD: every module has user stories, acceptance criteria, and a priority. P0 is required at release on 17 October 2026; P1 follows after release.

## 2. Background, problem, and opportunity

Small cafes and restaurants need a cashier system that is fast, never miscounts, and keeps working on a weak connection, but existing systems are usually expensive, heavy, or dependent on the internet.

**Problems solved**

- **Miscounts and cash variance.** Manual records or simple apps do not compute the cash that should be in the drawer, so variance is only discovered after closing.
- **Internet drops during rush hour.** Sales that fail to send are lost, or recorded twice when the connection returns.
- **Owners cannot see their business.** An outlet owner has no single place to see sales, profit, and cashier performance without being on site.
- **High upfront cost.** Dedicated terminals and large licences are out of reach for small businesses.
- **Printer diversity.** Cashiers use cheap Bluetooth printers of many brands, with 58 mm or 80 mm paper.

**Opportunity**

- Nearly every cashier already carries an Android phone or tablet, so no dedicated hardware is needed.
- A monthly subscription of IDR 149,000 is far below the cost of a traditional POS.
- A web backoffice gives owners access from anywhere and lets one business run several outlets under one subscription.

**How each problem is addressed**

| Problem | Product approach |
| --- | --- |
| Cash variance | Expected cash is computed by the server from the cash ledger of every shift |
| Internet drops | Offline queue with idempotency keys, no double payments |
| Owner blind spots | Web backoffice with cross-outlet reports |
| Upfront cost | Android app on existing devices, monthly subscription |
| Printer diversity | Generic ESC/POS Bluetooth printers, 58 mm and 80 mm, several brands |

## 3. Goals, non-goals, and success metrics

The 17 October 2026 release succeeds if a cafe can sign up, run the 3-day trial, sell for a full day with matching cash, and then pay for a subscription, all without help from a developer.

**Goals**

1. A cashier completes a cash or QRIS sale with a printed receipt, including when the internet is down.
2. Expected cash at the end of a shift is computed by the server and always equals the cash ledger.
3. An owner signs up alone, creates outlets, cashiers, categories, and products in the backoffice, and sees sales.
4. Plan limits (outlets, cashiers, products) and expiry are enforced in the database, not only on screen.
5. The app works on Android phones and tablets, portrait and landscape, in Indonesian and English.

**Non-goals for the first release**

- Automatic payment confirmation (payment gateway, dynamic QRIS, e-wallet integration). QRIS is accepted, but the cashier confirms it by hand (C11).
- Tax and service charge (P1, after release).
- iOS app.
- Automatic subscription payment through a payment gateway; first payments are manual and activated through the SQL Editor.
- Third-party integrations (ride-hailing, accounting).
- Advanced inventory such as purchasing, recipes, and transfers between outlets.

**Success metrics (proposed, not yet approved)**

| Metric | Proposed target | How measured |
| --- | --- | --- |
| Variance between system cash and cash ledger | 0 in all tests | Database tests and field test |
| Duplicate payments after offline sync | 0 | Offline queue tests, 28 checks |
| Time for one cash sale from picking products to receipt | Under 30 seconds for 3 items | Field test with real cashiers |
| Cafes that finish sign-up through first sale unaided | 80% of 5 test cafes | Test with real users |
| Trials that convert to a subscription | Measured after release, target set later | Subscriptions table |

## 4. Users, personas, and permissions

There are two roles: the owner, who holds the account, and the cashier, who uses the POS app on a device belonging to the owner.

**Personas**

- **Rina, owner of a single-outlet cafe.** Runs it herself, is rarely on site, wants today's revenue and assurance that cash matches. Uses an Android phone.
- **Dedi, owner of three outlets.** Needs combined and per-outlet reports, and creates new cashiers without calling a developer. Uses a laptop and a phone.
- **Sari, cashier.** Works fast during rush hour, one hand holding a tray, hates mis-taps. Uses a phone or tablet at the counter.

**How people sign in**

The owner signs in with email or username and a password (Supabase Auth) and stays signed in on the device until choosing Log out. A password is any 6 or more characters (digits only and letters only are allowed) and must differ from the email. On the POS a username is turned into the email by `pos_login_email` (migration 060) only when the password is right; ten wrong passwords for one username lock username sign-in for 15 minutes, while email sign-in keeps working. Cashiers have no account of their own: a cashier picks their name from the list of cashiers under the owner's account, then enters a 6-digit PIN. Five wrong PINs lock that cashier for 5 minutes. The server checks the PIN (no PIN hash leaves it since migration 059), so picking a cashier needs internet; the cashier already signed in can reopen the app offline during the shift.

**Permissions matrix**

| Capability | Cashier (POS) | Owner (POS) | Owner (backoffice) |
| --- | --- | --- | --- |
| Open and close a shift | Yes | Yes | No |
| Sell, discount, hold bill, split bill | Yes | Yes | No |
| Void a bill | Only with owner approval code | Yes | Yes (P1) |
| Refund items of a paid bill | Only with owner approval code | Yes | No |
| Manage categories and products | No | Yes | Yes |
| Manage outlets and cashiers | No | No | Yes |
| View reports for all outlets | No | No | Yes |
| View subscription status and notifications | Yes, read only | Yes | Yes |

**Important note.** The POS device signs in with the owner's account, so the database cannot tell a cashier from an owner at account level. Cashier restrictions are enforced by what the app shows, while isolation between businesses is enforced by the database (RLS). That is why a void or a refund by a cashier requires an owner approval code (Module C).

## 5. Scope and architecture

&#91;embedded content: architecture · 3 clients, 1 Supabase project\]

The POS and the backoffice call the same RPC functions with the owner's login; plan limits, expiry, and business isolation are enforced in the database, not on screen. The landing page never touches the database and only sends visitors to sign-up. An admin activates subscriptions manually through the SQL Editor.

**In scope for the first release:** Android POS, backoffice web, landing page, manual subscriptions. **Out of scope:** iOS, payment gateway (including automatic QRIS confirmation), third-party integrations. QRIS with manual confirmation is in scope.

## 6. Subscription plans and business model

Each business has one subscription with one expiry date; paid plans include 1 outlet, and extra outlets are charged separately.

| Plan | Price | Duration | Outlets | Cashiers per outlet | Products per outlet |
| --- | --- | --- | --- | --- | --- |
| Trial | Free | 3 days | 1 | 2 | 40 |
| Monthly | IDR 149,000 | 1 month | 1 | 3 | 100 |
| 6 months | IDR 699,000 | 6 months | 1 | 3 | 100 |
| Annual | IDR 1,399,000 | 1 year | 1 | 3 | 100 |

**Extra outlets.** IDR 99,000 per outlet per month, prorated against the remaining time, with a single expiry date for the whole business. Example: a business with 3 outlets uses 1 included outlet and 2 extra outlets.

**Rules**

1. Cashier and product limits apply per outlet; the outlet limit applies per business (included outlet plus extra outlets).
2. Temporary menu items are not counted as products.
3. Reactivating a cashier or product also counts against the limit.
4. A renewal adds to the remaining time instead of starting from the payment day, so customers lose nothing by renewing early.
5. The trial is for new businesses only, once.
6. First payments are manual (bank transfer) and activated by an admin through `admin_activate_subscription`. Automatic payment is an open decision (section 20).

**Assumption to confirm.** Cashier and product limits are counted per outlet, not per business. This is the current implementation decision; if per business is intended, the database rules must change before release.

## 7. Module A: Accounts and onboarding

An owner signs up on the web, automatically gets a business, one outlet, and a 3-day trial, then can prepare the menu and cashiers before opening the POS.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| A1 | As a prospective owner, I sign up with a username, email, and password. | Sign-up creates the business, one outlet, and a 3-day trial subscription in one step (`register_business`). The username is 3 to 20 lowercase letters, digits, dots, or underscores. The password is at least 6 characters of any kind and differs from the email. An email already registered is rejected with a clear message. | P0 |
| A2 | As an owner, I sign in to the backoffice and the POS with the same account, by email or username. | The backoffice session uses an HttpOnly cookie and resolves a username on the server. The POS resolves it with `pos_login_email` (060), which answers only for the right password and locks a username after ten wrong passwords for 15 minutes. The POS session stays signed in until the owner chooses Log out. | P0 |
| A3 | As an owner, I create a cashier with a name and a 6-digit PIN. | The new cashier appears in the POS cashier list. The PIN is stored as a bcrypt hash and is never readable by clients. The per-outlet cashier limit is enforced. | P0 |
| A4 | As an owner, I change a PIN or deactivate a cashier. | A new PIN takes effect immediately. A deactivated cashier does not appear in the POS login list. | P0 |
| A5 | As a cashier, I pick my name and enter my PIN. | A correct PIN signs in. A wrong PIN shows the attempts left. Five wrong attempts lock that cashier for 5 minutes. The cashier list comes from the phone's local copy, so it shows offline, but the PIN is checked by the server (059). | P0 |
| A6 | As a cashier, I switch cashier without signing the account out. | Settings, Switch Cashier returns to the cashier list; the owner account stays signed in. | P0 |
| A7 | As an owner, I reset my password if I forget it. | Password reset by email. Not built yet; the scheduling decision is in section 20. | P1 |

**Expected onboarding flow.** Sign up, sign in to the backoffice, create categories and products, create cashiers, install the POS app and sign in with the same account, pick a cashier, open a shift. The landing page (Module H) leads to sign-up.

## 8. Module B: POS shifts and cash

Every sale happens inside a shift; the server computes the cash that should be in the drawer, so variance at close does not depend on what the screen counts.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| B1 | As a cashier, I open a shift with opening cash. | `open_shift_with_id` (050) records the opening cash as a cash ledger entry; the phone makes the shift id, so opening and closing also work offline through the queue. The business date uses the business's time zone (WIB, WITA, or WIT, migration 064) and is fixed when the shift opens. Only one open shift per cashier. A shift belongs to the phone that opened it (051); another phone takes it over with the owner's approval code. | P0 |
| B2 | As a cashier, I see a summary of the current shift. | Shows sales, bill count, cash, and held bills, read from `get_dashboard_summary`. Zero values still show as Rp 0 rather than being hidden. | P0 |
| B3 | As a cashier, I close a shift by counting the cash in the drawer and, when the shift had QRIS, entering the QRIS total from the merchant app. | One keypad fills two boxes (Uang di laci, QRIS di aplikasi merchant; tap a box to choose). Expected cash, expected QRIS, and both differences are computed by the server (`close_shift_at`, 075). The result shows both differences; the shift report is shown and can be printed. A locked day (F11) refuses any change to its shifts. | P0 |
| B4 | As a cashier, I cannot close a shift while held bills or offline queue entries remain. | The close button shows the reason. The offline queue must be empty first. | P0 |
| B5 | As an owner, I am confident cash always matches the cash ledger. | Cash in from payments is recorded automatically by a cash ledger trigger; a void removes that bill's cash-in entry. A cash refund writes a cash-out entry in the shift where the refund happens (migration 033). There is no manual cash entry (removed in migration 018). | P0 |
| B6 | As a cashier, I cannot open a shift when the subscription has expired. | The database rejects it with an expiry message; the app shows the locked screen (Module G). | P0 |
| B7 | As a cashier, I record expenses paid during my shift (supplies, operating costs). | `record_expense` (migrations 040, 041). Each entry has one or more items (up to 30): name, category `belanja` or `operasional`, quantity with a unit from a fixed list, and the total price for that quantity, plus where the money came from: the cash drawer or not. All entries of a shift join that shift's one expense record (up to 200 items); each item keeps its source. From the drawer, the shift's single expense cash-out entry grows at once, so expected cash drops immediately. One idempotency key per entry, so a retry records once. Only while the shift is open. The owner gets an `expense` notification per entry. Shift screen lists the items with their source. Queued offline like a sale. Since migration 043 there is no review: every expense counts at once, and the owner can correct a shift's items any time (F10). | P0 |

**Rules that must not be broken.** The app must never clear the shift on screen as a substitute for closing it in the database. A backend error must never be turned into an empty-data display.

## 9. Module C: POS sales

A cashier completes a bill in a few taps; prices, cost of goods, and stock are always read by the server, and the client sends only the product and quantity.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| C1 | As a cashier, I pick products from the catalog by category and search. | Search and a Kategori button that opens a list of categories share one row in every orientation. The catalog is read from the phone's local copy, which the server refreshes every 60 seconds and when the app returns (052; 063 answers "unchanged" without rebuilding the menu). Products without stock tracking are never rejected for low stock and their stock does not decrease. While the menu loads, the catalog shows placeholder tiles. If it cannot load and there is no cache, it shows an error with a Try again button, and the open bill is not affected. | P0 |
| C1a | As a cashier, I choose how the catalog looks on this device: Compact (default) or Photo. | Compact shows text only and is the default, so it also suits older phones and long menus. Photo shows the product photo cropped 4:3 in a uniform frame, with the original colors kept. Photo applies only when at least one product at the outlet has a photo. A product without a photo shows its initials. If a photo fails to load, the initials show instead. The choice is saved per device. | P1 |
| C2 | As a cashier, I set quantity and add a note per item (for example, no ice). | A note is at most 200 characters and prints under the item on customer, kitchen, and bar receipts. A note never changes price, stock, or discount. Note and item discount sit under an Options button on each bill line, and a filled note or discount stays visible on the line. Customer name and table are one collapsed row on the bill that opens two optional fields. | P0 |
| C3 | As a cashier, I take cash payment and see the change. | `complete_checkout` runs in one database transaction, locking the shift and product rows, writing the transaction, items, payment, and cash entry, and decreasing stock. Bill numbers are made on the phone: `#HPOS-YYYYMMDD-<terminal code>-NNNN` from its own daily counter (054), so a receipt printed offline already has its final number; the date is in the business's time zone (064). A phone without a terminal code yet gets a server number `#HPOS-YYYYMMDD-NNNNN`, dated in the outlet's zone. The Bayar button shows no amount (the total is right above it); Tahan or Simpan and Bayar share the row equally. | P0 |
| C4 | As a cashier, I give a discount per item or per bill, in percent or rupiah. | Percent is 0 to 100 with at most 2 decimals. The total must not be zero or negative. Rounding is half-up to whole rupiah; the server is authoritative and the client mirrors its formula. | P0 |
| C5 | As a cashier, I apply a voucher. | A voucher has a code, a type (percent or fixed amount), a validity period, and a usage limit. Detailed rules await the product owner's decision (section 20). | P0 |
| C6 | As a cashier, I hold a bill, recall it, and delete it. | A held bill keeps its discount and notes. A recalled bill does not create a second held bill. | P0 |
| C7 | As a cashier, I split a bill into several payments. | Only from a recalled bill. The bill discount is spread over lines so rupiah do not drift; the last part takes the remainder. | P0 |
| C8 | As a cashier, I ask the owner to void a paid bill. | Voids the whole bill only; the shift must still be open, a reason is required, stock is restored, and the bill's cash-in entry is removed from the cash ledger. Voiding requires an owner approval code. A bill that already has a refund cannot be voided. Needs internet and is not queued. | P0 |
| C9 | As a cashier, I see this shift's bill history and reprint. | Paged list from `list_shift_bills`, with tabs Completed, Held, Voided. Item details load when a bill opens. Shifts of the same outlet closed in the last 24 hours (any cashier, up to 10) can be picked to view, reprint, and refund their bills; void is hidden there because the server refuses voids in a closed shift. | P0 |
| C10 | As an owner, I enable tax and service charge per outlet. | Can be switched on or off, and affects totals, receipts, and reports. Detailed rules await a decision. | P1 |
| C11 | As a cashier, I take a QRIS payment. | The pay screen offers Cash or QRIS. With QRIS the amount is the bill total, there is no change, keypad, or quick amounts. The customer scans the outlet's own QRIS outside the app; the cashier presses "Konfirmasi QRIS Rp…" only after seeing the payment succeed, and the screen says so. The bill is stored with `payment_method = 'qris'`, writes no cash ledger entry, and shows as QRIS on the receipt, in bill history, and separately in the shift report and dashboard. A QRIS sale is queued offline like a cash sale. Not built: automatic confirmation, dynamic QRIS per bill, a payment reference. | P0 |
| C12 | As a cashier, I refund some items of a paid bill when a customer complains. | `refund_items_approved` (migration 033). The bill is never changed; each refund is a separate record. Allowed for a completed bill up to 24 hours after it was created (server clock), including bills of a closed shift and split-bill parts; not for the parent of a split bill. The cashier picks items and quantities up to what is left, a reason (3 to 200 characters), cash or QRIS/transfer (not tied to how the bill was paid), and per item whether stock comes back (only for tracked products, off by default). The server computes the amount: the item's net value after item discount, times the bill-discount share; the refund that empties the bill takes exactly what is left, so all refunds add up to the bill total. The refund lands in the cashier's open shift: cash leaves the drawer through the cash ledger, QRIS/transfer is recorded only. Owner approval code as for voids (5 wrong codes lock for 5 minutes). One idempotency key per refund screen, so a retry refunds once. The owner gets a `refund` notification. Shift report and dashboard subtract refunds. A refund slip can be printed. Needs internet and is not queued. | P0 |

**Payment idempotency.** Every payment attempt carries a key that is stable as long as the cart contents do not change. A retry reuses the same key, so a bill that already went through is returned, not duplicated. Network errors and timeouts mean payment is unconfirmed, not failed.

## 10. Module D: Printing and printers

Receipts, kitchen tickets, and bar tickets print on any Bluetooth ESC/POS printer, 58 mm or 80 mm paper, without depending on one brand.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| D1 | As a cashier, I pair a Bluetooth printer and print a test page. | The printer is saved in the registry (name, brand, protocol, connection, paper width). The test result clearly shows success or failure and the cause. | P0 |
| D2 | As an owner, I use printers from Epson, iware, taffware, nyk, odi, or other generic brands. | One generic ESC/POS protocol; the brand is only a label and a tuning option. Tested on at least one real printer per paper width before release. | P0 |
| D3 | As an owner, I choose 58 mm or 80 mm paper per printer. | The receipt layout adapts to characters per line; no clipped text or shifted columns at either width. | P0 |
| D4 | As an owner, I assign printers by role: receipt, kitchen, bar, reprint, report. | One order can print on several printers at once. A failing printer never fails the payment. | P0 |
| D5 | As a cashier, I reprint receipts and shift reports. | Reprint is available from bill history and the close-shift screen. A refund slip (refunded items and quantities, server total, method, reason) prints from the toast after a refund, on the reprint printer or the receipt printer. Not yet: reprinting a refund slip later. | P0 |
| D6 | As an owner, I put a logo on the receipt. | The outlet logo (`outlets.logo_url`) shows on the on-screen receipt, the POS header, and the cashier list, in a fixed box that fits any shape. Printed receipts do not carry the logo yet (needs an ESC/POS bitmap). The backoffice uploads to the public Storage bucket `outlet-logos` (migration 035: path `{business_id}/{outlet_id}/…`, owner-only writes, max 256 KB, PNG/JPEG/WebP, no SVG). Before upload the backoffice compresses the logo in the browser: fit inside 256 × 256, WebP (PNG fallback), under 40 KB, colors unchanged and saves the URL through `owner_set_outlet_logo` (migration 034, https only). The upload screen is not built yet. | P1 |

**Technical constraints.** Bluetooth printing uses a native Kotlin module (`HermesPosBluetoothPrinter`), so it does not run in Expo Go and must be tested on a device. The native module must not be renamed because it is tied to the app package. Print results always go through one path (`reportPrintResult`) so error messages stay uniform.

**Risk.** No real printer has been tested yet. See section 20.

## 11. Module E: Offline and sync

Cashiers keep selling when the internet drops, and every pending sale is sent exactly once when the connection returns.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| E1 | As a cashier, I complete a normal bill while the internet is down. | When the checkout outcome is unknown (network error or the 15-second timeout), the bill is stored in a local queue with its final number from the phone (C3), the cart is cleared, and the receipt can be printed. Entries made by a build before migration 054 carry a provisional `TUNDA-XXXXXX` number. | P0 |
| E2 | As a cashier, I hold a bill while offline. | Hold is queued too; it does not lower local stock but it blocks closing the shift. | P0 |
| E3 | As a cashier, I see queue status and sync manually. | A banner shows the waiting count, a Sync button, and a review sheet. Sync runs automatically on sign-in, when the app returns to the foreground, and every 30 seconds while the queue is not empty. | P0 |
| E4 | As an owner, I am sure offline sales are never duplicated or lost. | Replay uses the original idempotency key. A definite server rejection (stock, closed shift) marks the entry `conflict` and it is never silently dropped because the money was already taken. | P0 |
| E5 | As a cashier, I do not oversell while offline. | Local stock drops when an entry is queued and is reapplied every time the catalog loads. Server stock remains authoritative. | P0 |
| E6 | As a cashier, I am warned before signing out with a non-empty queue. | A confirmation dialog; the queue is not erased by sign-out or cache clearing. | P0 |
| E7 | As an owner, I do not want new sales to slip through after the subscription expires. | The app refuses new sales after expiry, but queue entries created before expiry still sync (24-hour limit on the server). | P0 |

**Limits.** Split payments are not queued; they use the manual recovery banner. Picking a cashier (PIN check), void, and refund need internet. Sales, holds, expenses, temporary menu items, and opening or closing a shift are queued (050).

## 12. Module F: Backoffice web

Owners manage the whole business from a browser: outlets, cashiers, menu, and reports, without touching the POS device.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| F1 | As an owner, I see a sales summary for all outlets or one outlet. | Ringkasan (`/`), one call to `owner_dashboard` (062). Period filter: Hari ini (default), Bulan ini, Bulan lalu, or Pilih tanggal (both dates, not after today, at most 366 days; the server checks the range again). Net sales after refunds with the change against the same number of days just before; cash, QRIS, bills, average per bill, items sold, discounts given, voids, refunds; sales after all expenses, expenses from the drawer and from elsewhere, gross profit (amount only), last cash variance. Charts: net sales per day for the last 7 days and sales per hour today, always, whatever the period. Bars: top 6 products, payment method, expenses by category, per outlet (all outlets only), per cashier. Refunds (`transaction_refunds`, 033) are subtracted on the refund date; the cost of restocked refund items is taken out of profit. Days and hours follow the business's time zone (064). A Laporan button opens the report for the same period and outlet. | P0 |
| F2 | As an owner, I create and edit outlets. | The plan outlet limit is enforced; the error message suggests adding an extra outlet. | P0 |
| F3 | As an owner, I manage cashiers (create, edit, PIN, activate or deactivate). | Same as A3 and A4, but from the web. | P0 |
| F4 | As an owner, I manage categories and products, including products without stock tracking. | Can be prepared at an outlet that has no cashier yet. Inactive products do not appear in the POS. The product limit is enforced. An owner can add an optional product photo (JPG, PNG, or WebP, up to 2 MB). The system crops it to 4:3 and resizes it (640 × 480 and 320 × 240, WebP) and never changes its colors. The product list has a Terjual (quantity sold) column for the chosen period, with the same period filter as Ringkasan; it counts completed bills, without subtracting refunds, as Produk terlaris does (`owner_product_sales`, 061). Categories are picked from a dropdown. | P0 |
| F5 | As an owner, I see a transaction list with filters. | Transaksi page (`/transactions`, 066). Same period filter as Ringkasan, outlet (or all), status Selesai, Dibatalkan, or Semua, and a search by bill number, name, or table (`owner_list_bills`, 50 per page). The bill dialog shows items, discounts, payment, refunds (`owner_get_bill_items`, `owner_list_bill_refunds`), and the edit history (`transaction_edits`, 067). Bills are never edited in place: the owner voids a bill (F7) or corrects it (`owner_correct_bill`, 073): the bill is voided with the reason and a replacement with the new items, payment, name, and table is made on the same day and shift, the two linked (`correctsNumber`, `correctedByNumber`). Bills with a refund or a voucher are not corrected. Edits made with 066/067 before 071 still show in the history and as "diubah nx" in the list. A Produk terjual tab lists every product of one outlet, sold or not, with quantity and net sales after item and bill discounts (bill discounts are split over the lines since 072), sorted by quantity, sales, or name. Not built: filters for cashier and payment method. | P1 |
| F6 | As an owner, I see detailed reports. | Laporan page (`/reports`, one call to `owner_report_page`, 063: `owner_report` from 042 plus the sales figures it shows) shows the performance report as six A4 sheets in the format of the DESIGN.md F sample. It has no menu entry: the Laporan button on Ringkasan opens it with Ringkasan's period and outlet, and "Kembali ke Ringkasan" returns to the same chip. Period: the same choices as Ringkasan, today when none is given (a link with only dates is read as chosen dates); 7 days is titled "Laporan Kinerja Mingguan" and a whole calendar month "Bulanan"; all outlets or one; compared with the same number of days just before. Page 1: header (logo, business, outlets, report number, period, created, currency), four key figures, executive summary built only from the numbers, net sales per day chart. Then: simple profit and loss (gross sales, discounts and vouchers, refunds, net sales, COGS with restocked refund items taken out, gross profit, operating expenses, operating profit, margins, difference and percent); cash drawer reconciliation of closed shifts from the cash book (opening, cash sales, cash refunds, drawer expenses, expected, counted, difference) with the shifts that had a difference; expenses by category; cash flow (cash and QRIS in, operating expenses and ingredient purchases out; paid from drawer or not); largest expenses; sales per day, by outlet, by cashier; product performance with margin (margins more than 5 points under the average are red) and by category; voids by cashier and discounts by voucher or manual; notes and definitions; sign-off block. Every expense counts (no approval since 043); `belanja` (ingredient purchases) is left out of profit and loss because its cost is already in COGS. Printed text is at least 12 px. "Cetak / simpan PDF" prints the sheets through the browser: the PDF holds typed text, the chart is drawn shapes, and every printed page gets a footer with the page number. Insight, decisions, and the action plan keep their place and say "segera hadir". Not built: CSV, DOCX, tax (VAT). | P1 |
| F7 | As an owner, I void a bill from the backoffice. | `owner_void_bill` (066): the POS rules (reason of 3 or more characters, no refunded or split bills; `already_refunded` shown clearly), but also on a closed shift, whose expected cash and variance are recomputed. Stock goes back. A voided bill (POS or backoffice) gives its voucher use back (067), and so does a bill refunded in full (068); a partial refund keeps it. | P1 |
| F8 | As an owner, I see subscription status, days left, usage, and the notification bell. | Covered in Module G. | P0 |
| F9 | As an owner, I only see my own business's data. | RLS restricts every table to the owner's business; tested with two businesses. | P0 |
| F10 | As an owner, I check the expenses cashiers recorded, per shift. | Pengeluaran page (`owner_list_expenses`, paged by 50 with a cursor, 045). Same period filter as Ringkasan, plus the outlet filter. A total card for the period (operating and supplies; old 071 expense corrections included and named under it), then the shifts grouped by business date with the day total from the database; one card per shift with shift number, outlet, cashier, total, amount from the drawer, and the items with category and source. Every expense counts at once. No item is edited: a wrong item is cancelled with a reason (`owner_cancel_expense_item`, 073; kept struck through) and recorded again with Tambah barang (`owner_add_expense_items`); the drawer follows. | P1 |
| F11 | As an owner, I see every shift's figures and fix a cash difference without any daily step. | Shift page (`/closing`, 073, 075 and 078; `owner_day_close` read only). One outlet, one business date: every shift's cash (opening, cash sales, cash refunds, cash in, cash out, expected, counted, difference) and QRIS (sales, refunds, expected, the total the cashier read from the merchant app, difference), Uang masuk / Uang keluar with a reason (`owner_add_cash_movement`) on any day, the day's voids, corrections, refunds, cancelled expenses, and stock losses and counts, and the automatic balance checks (P1 to P5, P7, docs/ACCOUNTING.md). No day close and no day lock (078); days closed before 078 stay as history. | P1 |
| F12 | As an owner, I keep stock right without overwriting it. | Stok page (`/stock`, 074): stock now and a document history; stock in, adjustments with a reason, and stock counts, each a document (`owner_stock_document`). The product form no longer changes stock except the opening amount when tracking starts. A stock count shows each product's difference. The ledger and check P7 compare each product's stock with its stock book. | P1 |
| F13 | As an owner, I hear about what needs a look. | Bell notifications (076): every void (not corrections), a shift closed with a cash or QRIS difference of Rp10.000 or more or more than 1% of its net sales, and nightly (05:00 WIB, pg_cron `watch_books`): failed balance checks of the last 8 days, days of the last two weeks that are 2 or more days old and not closed, shifts open more than 16 hours. | P1 |
| F14 | As an owner, I see what each menu item costs to make. | Bahan & Resep page (`/ingredients`, 084 to 086). Bahan tab: ingredients with the pack price (g, kg, ml, l, pcs) and the price per unit; changing a price first shows which menu items' HPP will move. Resep tab: every menu item with HPP and profit per serving; one recipe page per item with a live cost (computed in the database, `owner_preview_recipe`), a warning when the cost is above the selling price, and an estimate flag when an ingredient costs Rp 0. A product with a recipe has its HPP computed into `products.hpp` and locked in the product form; the POS, sales (`hpp_unit` stays as sold), stock value, and reports read the same column. No ingredient stock yet. | P1 |

**After the backoffice is proven.** The POS Settings menus for Categories and Products are hidden so the catalog is edited in one place. Hiding them before the backoffice is tested on a real Supabase project is risky, so this is scheduled as P1.

**Design.** The system in DESIGN.md (paper, pine, and one orange accent; Bricolage Grotesque, Instrument Sans, IBM Plex Mono; 1.5 px ink lines), shared with the landing page and the POS, built with TanStack Start, Tailwind CSS 4, and the shared `packages/ui` kit. The sidebar stays in place while the page scrolls.

## 13. Module G: Subscription, expiry, and notifications

When a subscription expires, the backoffice and POS stay open but features are locked and show how to renew; before that, the owner is warned through a notification bell.

**Subscription states**

| State | Meaning | Behavior |
| --- | --- | --- |
| Trial | 3 days from sign-up | Trial limits apply (1 outlet, 2 cashiers, 40 products per outlet) |
| Active | Paid plan not yet expired | Plan limits apply |
| Expired | Past the expiry date | Features locked, data stays and can be viewed, nothing is deleted |

**Warning schedule (070).** Paid plans: one reminder at 30, 21, 14, and 7 days before expiry, then one every day from 3 days left until the last day. Trial (3 days): one every day. Reminders are kept; after a renewal, the schedule starts again. Ringkasan shows no countdown banner; only an expired plan gets a banner, on every page.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| G1 | As an owner, I see the time left and plan usage. | `get_subscription_status` returns the state, plan, days left, limits, per-outlet usage, and unread notification count. Shown in the backoffice and POS. | P0 |
| G2 | As an owner, I receive warnings through a bell in the backoffice and POS. | A bell icon with an unread count; the list comes from `list_notifications`, marked read with `mark_notifications_read`. Text is rendered on the client in the user's language from the kind and parameters. | P0 |
| G3 | As an owner, I see an Expired screen that tells me how to renew. | The locked screen shows the expiry date, plan and price, and a contact or bank account for payment. Exact content awaits a decision (section 20). | P0 |
| G4 | As a cashier, I cannot start a new sale when the subscription has expired. | The POS refuses new sales and opens the locked screen. The server refuses new outlets, cashiers, products, categories, and shifts; a transaction passes only if its shift opened before expiry and not more than 24 hours have passed. | P0 |
| G5 | As an owner, I can still view reports and history while locked. | Data stays readable; only writes are refused. | P0 |
| G6 | As a HERMES POS admin, I activate or extend a subscription after payment. | `admin_activate_subscription(business, plan, extra_outlets)` through the SQL Editor or service role. Renewal adds to the remaining time. Not callable by ordinary users. | P0 |
| G7 | As an owner, I add extra outlets. | IDR 99,000 per month, prorated, one expiry date. The first purchase goes through the admin. | P0 |
| G8 | As an owner, I pay for the subscription myself on the web. | Payment gateway; not for the first release. | P1 |

**Honest limitation.** The server cannot tell an offline queue replay from a new sale, so a transaction still passes up to 24 hours after expiry if its shift opened before expiry. Blocking new sales in the POS app is the main layer; the database is the backup layer.

## 14. Module H: Landing page

A visitor understands HERMES POS in one scroll, sees the correct prices, and starts the free trial in two taps.

| ID | User story | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| H1 | As a visitor, I immediately understand what HERMES POS is and who it is for. | The hero says it is a cashier system for cafes and restaurants, with one call-to-action button: Try free for 3 days. | P0 |
| H2 | As a visitor, I see the main features. | Offline cashier, shifts and cash, discounts, split bill, Bluetooth printers, multi-outlet backoffice. Only features that actually exist at release. | P0 |
| H3 | As a visitor, I see the exact prices. | Shows the four plans from section 6 (trial, monthly, 6 months, annual) and the extra outlet price. The placeholder plans Mulai, Tumbuh, Jaringan in the current code are replaced. | P0 |
| H4 | As a visitor, I sign up or sign in. | Buttons lead to sign-up and sign-in at backoffice.hermes-pos.com. | P0 |
| H5 | As a visitor, I contact the seller. | A real WhatsApp number and email replace the placeholders; awaiting data from the product owner. | P0 |
| H6 | As a visitor, I read frequently asked questions. | Covers the trial, expiry, data not being deleted, offline use, and supported printers. | P1 |
| H7 | As a visitor, I read the page in English. | Two-language content. | P1 |

**Technical.** Lives in `apps/web` of the monorepo and shares `packages/ui` components and `packages/theme` tokens with the backoffice. The brand name and domain are not final; all brand text must come from one content file so it is easy to change.

## 15. Cross-module: language, responsive layout, UI, and brand

The following rules apply to every module so the product feels like one: two languages, two orientations, one component kit, and one brand.

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| X1 | Indonesian and English in the POS and backoffice. | The user picks a language in Settings and the choice is saved. All display text comes from a translation dictionary, including error messages and notifications (rendered from kind and parameters). Dates and rupiah follow the language. | P0 |
| X2 | Phone and tablet screens, portrait and landscape. | No clipped content or buttons off screen from small phones to tablets. On a landscape tablet the catalog and cart show side by side. Rotation does not lose the cart or typed input. | P0 |
| X3 | A shared component kit. | All buttons use `Button` and `ButtonRow` (equal width, heights 44/48/54). Every bottom sheet uses `SheetHeader` and `ActionFooter`. The primary button is on the right and within thumb reach. Minimum text size 12 px. | P0 |
| X4 | Safe space at the bottom of the device. | Buttons never touch the gesture bar; bottom spacing is at least 20 px plus 16 px. | P0 |
| X5 | HERMES POS brand: logo, app icon, name. | The logo from the product owner is used for the app icon, the sign-in screen, the receipt (optional), and the website. The name HERMES POS is set by the owner (15 Oct 2026); every name comes from one constant. | P0 |
| X6 | Consistent messages. | No `Alert.alert`; all messages go through toasts or dialogs (`useNotify`), and backend errors are translated into sentences people understand. | P0 |
| X7 | Basic accessibility. | Text contrast meets 4.5:1; icon buttons have labels; tap targets are at least 44 px, including the small button (`btn-sm`, 44 px). | P1 |

**Renamed identifiers (15 Oct 2026, migrations 038 and 039).** The owner renamed every COLOONY/KASBOX identifier to HERMES POS: Android package `com.hermespos.pos` (was `com.kasbox.pos`, so the new app installs beside the old one and does not update it), storage keys `@hermes-pos/…` (was `@kasbox/…`), the module `HermesPosBluetoothPrinter`, the `hermespos_transaction_seq` sequence, and the `#HPOS-` prefix for new bills. Bills made before keep their `#KBX-` numbers. Domains: `hermes-pos.com` (landing page) and `backoffice.hermes-pos.com` (backoffice), registered by the owner (18 Oct 2026).

## 16. Non-functional requirements

Money must be correct first, then fast, then beautiful. Server read times were measured on 18 Oct 2026 with `supabase/tests/perf_volume.sql` (one outlet's year, about 220,000 bills, plus 2,500 other businesses); device times are still proposals.

| Area | Requirement | How to check |
| --- | --- | --- |
| Correctness | All important writes go through `security definer` RPCs; clients never compute a trusted price | SQL tests (test\_020 through test\_064) |
| Idempotency | One key yields one transaction even if sent repeatedly | Offline queue tests (28 checks), SQL tests |
| QRIS | A QRIS sale is recorded only after the cashier saw the payment succeed; it never changes expected cash | Device test with a real QRIS |
| Data security | RLS restricts an owner to their business; the PIN bcrypt hash is unreadable by clients; admin functions are service role only | test\_026, test\_027, test\_028 |
| Offline reliability | A sale is not lost if the app is force-closed; the queue persists with no time limit | Device test |
| Performance (device, proposed) | A 100-product catalog shows in under 1 second from the local copy; the bill list is paged, never downloading all transactions | Mid-range device test |
| Performance (server, measured) | Ringkasan, Laporan, Produk, and Pengeluaran for a month or less answer in under 200 ms; a whole year in 2 to 3 s; sidebar counts 1 ms; RLS checks the owner's outlet set once per query, not a function per row (062) | `perf_volume.sql`, numbers in the README |
| Scale | Reads cost what one business holds, not what the platform holds: owner reads are scoped by business, sidebar counts by `owner_shell_counts`, idempotency keys older than 90 days are deleted daily (062) | `perf_volume.sql`, `test_062.sql` |
| Time | Dates and hours use the business's time zone (WIB, WITA, or WIT); the business date is fixed when the shift opens | `test_064.sql` |
| Compatibility | Android phones and tablets; a device without Bluetooth can still sell without printing | Device test |
| Updates | JavaScript updates over the air once configured; native changes need a new APK | `docs/OTA_UPDATES.md` |
| Maintainability | Numbered migrations are never edited after being applied; changes go in a new migration | Code review |
| Privacy | No customer data is collected beyond an optional name; business data is not shared | Review |

## 17. Data model

One business owns many outlets, and all operational data attaches to an outlet; the subscription attaches to the business.

| Entity | Main contents | Relationships |
| --- | --- | --- |
| `businesses`, `business_members` | The business and its owner (one owner account, one business) | Parent of outlets and subscription |
| `outlets` | Name, address, business | Has cashiers, categories, products, shifts |
| `cashier_sessions` | Cashier name, PIN hash, lockout fields, active or not | Many rows per owner account, one outlet per row |
| `categories`, `products` | Name, price, cost, stock, `track_stock`, temporary or not | Belong to an outlet |
| `shifts` | Opening cash, status, business date, closing cash | Belong to a cashier and outlet |
| `transactions`, `transaction_items`, `payments` | Bill, items with notes and discounts, payments | Split bills use `parent_transaction_id` |
| `cash_ledger` | Cash entries per shift | Created by the payment trigger (removed again by a void), by cash refunds, and by drawer expenses (one entry per shift) |
| `expenses`, `expense_items` | One expense record per shift with its total (no review status since 043); items with name, category, quantity, unit, amount, source (`paid_from`), and the entry's idempotency key | Attach to a shift; read and written only through RPCs |
| `transaction_refunds`, `transaction_refund_items` | Refund per bill: shift where it happened, cashier, method, amount, reason, idempotency key; refunded quantity, amount, cost, and restock per item | Attach to a bill and its items; `transactions.refunded_total` keeps the running sum |
| `checkout_idempotency` | Key and result of a checkout or hold | Guarantees one key, one result |
| `plans` | Trial, monthly, 6 months, annual, limits, prices | Referenced by subscriptions |
| `subscriptions` | One per business: plan, `expires_at`, `extra_outlets` | Determines limits and expiry |
| `notifications` | Kind and parameters, read status | Belong to the business; not directly accessible to clients |
| `pos_terminals` | One short code per phone and outlet (A1, A2, ...) for bill numbers | Made by `register_terminal` (054) |
| `login_attempts` | Wrong-password count and window per account for username sign-in on the POS | Read and written only by `pos_login_email` (060) |

**Data principles**

1. Clients do not write directly to important tables; only through RPCs.
2. Data is never deleted because a subscription expired; only new writes are refused.
3. Notifications store a kind and parameters, not a sentence, so the client decides the language.
4. Numbered migrations run in order; the latest is 064. Recent ones: 040 to 043 expenses (one record per shift, no review); 042 owner report; 045 paging and indexes for growing data; 049 no anonymous execute; 050 to 057 offline shifts, phone-owned shifts, local reference and shift snapshots, phone bill numbers; 058 and 059 PIN hashing and PIN checks on the server only; 060 username sign-in on the POS; 061 quantity sold per product; 062 RLS and read efficiency; 063 Laporan in one call and a cheap catalog check; 064 business time zone.
5. Each time zone, date range, and money rule lives in the database. A client range is checked again on the server (at most 366 days, real calendar dates).

## 18. Testing and release criteria

The 17 October 2026 release happens only if every P0 item below passes, including testing on a real Supabase project, real devices, and real printers, none of which has been done yet.

**Existing automated tests**

- SQL tests per migration (test\_020 through test\_030) on a local Postgres; every check must start with PASS.
- Unit tests for the offline queue (28 checks), discounts (15), item notes and receipts including the refund slip (15), the refund estimate (8), expense input (9), and the memory cache.
- `test_033.sql` covers migrations 033 and 034 (refund rules, money, cash ledger, stock, reports, backoffice summary, outlet logo).
- `test_041.sql` covers expenses (040, 041: one record per shift, replay, cash book, review only after close, owner correction, other business) with 35 checks; `test_042.sql` covers the owner report (profit and loss with discounts, ingredient purchases apart, drawer reconciliation, voids and discounts, expenses, categories, products, expiry, other business) with 19 checks. Both and `test_033.sql` pass on a local Postgres (15 Oct 2026). The merge of 040 data in 041 was also checked once, including a rerun after a partial run.
- `test_060.sql` to `test_064.sql`: username sign-in and its lock, quantity sold, RLS and the new reads, the Laporan call and the catalog check, and business time zones. The whole SQL suite (001 to 064) passed on a fresh PostgreSQL 18 on 18 Oct 2026.
- POS unit tests (`npm run test:js`), including the local reference copy and the stored time zone; backoffice unit tests for the period filter, date checks, and range limits.
- TypeScript type-checking in both apps.
- Backoffice e2e tests with a mock Supabase using Playwright.
- `supabase/tests/perf_volume.sql`: read times on a year of data (not part of `run_all.sh`).

**Release criteria (all must pass)**

| # | Criterion | How to test | Status |
| --- | --- | --- | --- |
| 1 | Migrations 026 to 030 run on a real Supabase project without errors | `npm run db:push` to a test project | Not yet |
| 2 | Sign up, sign in, create a cashier and product in the backoffice, then sell in the POS and see it in reports | End-to-end test on real Supabase | Not yet |
| 3 | Plan limits are rejected in the database for outlets, cashiers, products | test\_030 on real Supabase | Passes locally |
| 4 | Expiry locks the POS and backoffice, and data stays readable | Test with the expiry date moved forward | Not yet (client side not built) |
| 5 | Offline sales sync exactly once | Turn off the internet on a real device | Not yet |
| 6 | The receipt prints correctly at 58 mm and 80 mm | Real printers | Not yet |
| 7 | The display is correct on small phones, large phones, tablets, portrait, landscape | Devices or emulator | Not yet |
| 8 | Indonesian and English are complete with no leftover text | Walk through every screen | Not yet |
| 9 | Vouchers and the owner approval code work | SQL tests and device test | Not yet |
| 10 | The landing page shows four plans and real contacts | Review | Not yet |
| 11 | Refunds: partial then full adds up to the bill total; a retry refunds once; void after refund refused; older than 24 hours refused; cash refund lowers expected cash, QRIS does not; restock only when chosen | `test_033.sql` and a device test | Passes locally; device test not yet |
| 12 | Expenses: entries of a shift form one record; a drawer expense lowers expected cash once; every expense counts; an owner correction recomputes a closed shift's expected cash | `test_041.sql`, `test_043.sql`, device test | Passes locally; real Supabase not yet |
| 14 | A WITA or WIT business sees its own days and hours in reports, shift dates, and bill numbers | `test_064.sql`, a device test with the business set to WITA | Passes locally; device test not yet |
| 15 | Migrations 057 to 064 applied to Supabase in order, each before the app build that needs it | SQL Editor or `npm run db:push` | Not yet |
| 13 | Laporan matches Ringkasan and the shift reports for the same period, and prints on A4 | `test_042.sql`, compare with real data, print from Chrome | Passes locally; real data and print not yet |

**Prerequisite.** The product owner has no Supabase test project yet. A project separate from production must be created before criteria 1 and 2; a step-by-step guide will be provided.

## 19. Roadmap

&#91;embedded content: roadmap · 4 phases, 1 gate\]

The six days before release are spent on one thing: finishing the P0 items and proving them on real Supabase, devices, and printers. Client-side building can run in parallel with writing this document. If a P0 item cannot be finished, the lowest-risk P0 item is deferred, never testing on real devices. Phases are not drawn to scale; dates after release are to follow.

## 20. Risks, assumptions, and open questions

The biggest risk is time: six days remain until 17 October 2026, and testing on real Supabase, devices, and printers has not started.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Migration 030 has never run on real Supabase | Errors at release | Create a test project and run it before anything else |
| No real printer tested | Broken or missing receipts | Test one 58 mm and one 80 mm printer before release |
| Client side of subscriptions, vouchers, language, responsive layout not built | Release scope not met | Cut to P0 per section 19; defer anything not P0 |
| The server cannot distinguish an offline replay from a new sale | Sales pass for up to 24 hours after expiry | The app blocks them; the 24-hour window is accepted |
| POS devices use the owner's account | A cashier could bypass restrictions if the app is modified | Accepted for the first release; voids and refunds protected by an approval code |
| QRIS confirmed by hand | A cashier confirms a QRIS payment that never arrived; sales look higher than the bank | Clear instruction on the pay screen; owner reconciles QRIS per shift with the bank or provider statement; automatic confirmation needs a gateway (P1) |
| Fake refunds to take cash from the drawer | Cash loss, wider because closed-shift bills can be refunded | Approval code, required reason, owner notification per refund, 24-hour limit; a daily cap only if abuse shows up |
| Backoffice screens do not show refunds yet | Owner sees refund-adjusted totals without the refund detail | Migration 034 already nets the numbers; build the refund tags and detail in the backoffice (F1) |
| Name and logo not final | Rework of assets | One brand constant and one asset file |
| Subscription payment is manual | Admin workload, late activation | Accept at first; payment gateway is P1 |

**Assumptions**

1. Cashier and product limits apply per outlet.
2. One owner account per business.
3. Cash and QRIS (confirmed by the cashier) at the first release; the outlet already has its own QRIS from its bank or provider.
4. Users run Android 8 or newer (proposal, not verified).

**Open questions for the product owner**

| # | Question | Affects |
| --- | --- | --- |
| 1 | What does the Expired screen show and how does the owner renew (WhatsApp, bank account)? | G3 |
| 2 | Is there a grace period after expiry, or does it lock immediately? | G4 |
| 3 | Subscription payment: manual transfer or a payment gateway? | G6, G8 |
| 4 | What form does the owner approval code take: owner PIN, one-time code, or fixed code? | C8 |
| 5 | Voucher rules: percent or fixed amount, usage limit, validity, one per bill? | C5 |
| 6 | Tax and service charge rules: percentage, per outlet, before or after discount? | C10 |
| 7 | Final brand name and domain? | X5, H |
| 8 | Are the notification bell and English included before release? | G2, X1 |
| 9 | Is password reset needed before release? | A7 |

## 21. Appendix: implementation status and decision history

On 11 October 2026 the POS core, the backoffice foundation, and the subscription foundation in the database exist; the client side of subscriptions, vouchers, language, responsive layout, and real-environment testing do not.

**Status per module**

| Module | Status | Notes |
| --- | --- | --- |
| A Accounts and onboarding | Mostly there | Sign-up, sign-in, cashiers with PIN (migrations 026, 027); password reset not yet |
| B Shifts and cash | Done | Migrations 001 to 020; cash ledger |
| C Sales | Partial | Discounts, notes, hold, split, void, vouchers, approval code, item refund (migration 033) exist; tax does not |
| D Printers | Partial | Bluetooth ESC/POS exists; generic 58 and 80 mm not tested on real devices |
| E Offline | Done | Checkout and hold queue, 28 unit checks |
| F Backoffice | Partial | Outlets, cashiers, catalog with quantity sold, Ringkasan with one period filter, expenses per shift with corrections, reports with print to PDF; filtered Transactions, CSV and DOCX export, insights not yet |
| G Subscription | Database done | Migration 030 and test\_030 (61 checks); locked screen, bell, POS blocking not yet |
| H Landing page | Partial | Warm design built, prices still placeholders, contacts still placeholders |
| Cross-module | Partial | Component kit and bottom spacing tidied; English, tablet, icon not yet |

**Decision history**

| Decision | From | To | Reason |
| --- | --- | --- | --- |
| Initial scope | POS as a terminal only; catalog handled elsewhere | Catalog managed in the POS, then moved to the backoffice | Owners need to prepare the menu without a cashier device |
| Owner and cashier | One account per cashier | One owner account, many cashiers with a 6-digit PIN | Cashiers switch without a password; no email account per cashier |
| Business | Standalone outlet | Business with many outlets | One owner, one subscription, cross-outlet reports |
| Monetization | None | 3-day trial, three paid plans, extra outlet IDR 99,000 per month | Approved by the product owner |
| When a subscription expires | Undecided | App stays open with features locked; data not deleted | Approved by the product owner |
| Warnings | None | Notification bell in backoffice and POS; 30, 21, 14, 7 days, then every day from 3 days left (trial: every day) | Requested by the product owner |
| Display | Portrait only | Portrait and landscape, phone and tablet | Requested by the product owner |
| Language | Indonesian | Indonesian and English | Requested by the product owner |
| Payment | Cash | Cash and QRIS with manual confirmation; no payment gateway | QRIS is common at cafes; a gateway needs a provider contract, so confirmation stays manual |
| Expense records | One record per entry, reviewed any time (040) | One list per shift, reviewed once after the shift closes (041) | Requested by the product owner (15 Oct 2026): expenses count per day and per shift |
| Report export | PDF and DOCX files (DESIGN D5) | Print the report page to PDF from the browser; DOCX, CSV, insights, and decisions later | Chosen by the product owner (15 Oct 2026): numbers first, no new library |
| Ingredient purchases in the report | Subtracted with all approved expenses | Left out of profit and loss (already in COGS), shown in expenses and cash flow | Chosen by the product owner (15 Oct 2026), as in the DESIGN.md F sample |
| Report layout | One screen page of cards | Six A4 sheets as in the DESIGN.md F sample; insight, decisions, and action plan as "segera hadir" placeholders | Requested by the product owner (15 Oct 2026) |
| Tax and service charge | None | Switchable, after release | Approved by the product owner |
| Void | POS only | Owner can void from the backoffice (P1) | Requested by the product owner |
| Refund | None (whole-bill void only) | Item refund with approval code, 24 hours, closed shifts allowed, lands in the open shift, cashier chooses restock and cash or QRIS/transfer; refunded bills cannot be voided; voucher quota is not returned | Requested by the product owner; method free because QRIS bills are often refunded in cash |
| Release date | None | 17 October 2026 | Set by the product owner |
| Catalog look | Not specified | Compact by default; Photo is an option per device; photos are cropped and framed, never recolored | Owner photos vary too much to match the app; owners should not have to edit photos |
| Small button height | 40 px | 44 px | Meets the 44 px tap target (X7) without extra hit area |
| Expense review | Approve or reject after the shift closes (041) | Every expense counts at once; the owner corrects any time (043) | Requested by the product owner |
| Owner sign-in | Email, password with 8 characters, letters and digits | Email or username; any password of 6 or more characters (060) | Requested by the product owner (18 Oct 2026) |
| Period filter | 7 days, 30 days, chosen dates | Hari ini (default), Bulan ini, Bulan lalu, chosen dates, on Ringkasan, Pengeluaran, Produk, and Laporan | Requested by the product owner (18 Oct 2026) |
| Gross profit on Ringkasan | Amount and margin percent | Amount only | Requested by the product owner (18 Oct 2026) |
| Time zone | Every date and hour in WIB | The business's own zone (064) | WITA and WIT businesses saw shifted hours and dates |
| Catalog refresh on the phone | Server builds the whole menu every minute | Server answers "unchanged" from row hashes (063); a trigger-based counter was rejected because it would lock the outlet row on every sale | Efficiency audit (18 Oct 2026) |

The earlier PRD, PRD HERMES POS, remains the historical reference; this document replaces it as the basis for building.
