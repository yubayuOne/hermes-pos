# POS v2 — implementation notes

The visual and interaction source is [`docs/DESIGN.md`](../../../docs/DESIGN.md), section I (Aplikasi POS). Product rules come from [`docs/PRD.md`](../../../docs/PRD.md). The files in [`archive/`](archive) describe the old UI (coffee-brown, 12 px radius, Dashboard/Kasir/Pesanan/Setting) and are kept only as history.

## Screens

| DESIGN | File |
| --- | --- |
| I5.1 Login, I5.2 pick cashier + PIN | `src/screens/auth/LoginScreen.tsx`, `CashierPickerScreen.tsx` |
| I5.3–I5.9 Jual, bill, options, discount, voucher, temporary menu | `src/screens/sell/*` |
| I5.10–I5.12 Payment, confirm, success, offline TUNDA | `src/screens/pay/PaymentScreen.tsx` |
| I5.13–I5.15 Bills, detail, void, recall, split | `src/screens/bills/*` |
| I5.16–I5.17 Shift open, close, result | `src/screens/shift/ShiftScreen.tsx` |
| I5.18 Offline queue, I5.19 bell | `src/components/overlays.tsx` |
| I5.20 Subscription locked | `src/screens/locked/LockedScreen.tsx` |
| More, printer | `src/screens/more/*` |

Shared pieces live in `src/components/` (Text, Button, Tap, Field, Keypad, Sheet, Slip, bits, Icon, chrome, overlays, ReceiptView) and `src/hooks/` (useBill, useLayout, AppStore, NotifyProvider). Tokens are in `tailwind.config.js` and `src/theme/index.ts`.

## Layout

`src/hooks/useLayout.ts` decides the layout:

- phone portrait: bottom nav, 2 product columns, bill as a bottom sheet;
- wide (width ≥ 900): rail on the left, 3–4 columns, bill panel on the right;
- phone landscape (width ≥ 700 and height ≤ 520): compact header, rail, 2 columns, bill panel.

Sheets are bottom sheets on phones and centered dialogs on wide screens.

## Language

The Indonesian text is the key. `src/i18n/en.ts` maps it to English. Run `npm run i18n:check` after changing text: it reports missing and unused keys.

## Database: migration 032

`supabase/migrations/032_pos_voucher_void_code.sql` at the repo root (after 030 subscriptions and 031 backoffice):

1. **Voucher at checkout.** `complete_checkout` is now a wrapper. Without `voucher_code` it behaves as before. With a code, the server checks the voucher (active, dates, quota, min spend on gross subtotal) and recalculates the discount from DB prices.
   - Bill-scope voucher: refused when a manual bill discount is set; becomes the bill discount.
   - Product-scope voucher: applies to matching lines; refused on lines with a manual item discount, and when no line matches.
   - Refused for split-bill parts.
   - A repeated idempotency key returns the same result; `used_count` goes up once.
   - `pos_check_voucher` gives the till a preview before payment. Since 044 the till lists usable vouchers with `pos_list_vouchers` and the cashier picks one; no code is typed.
2. **Void approval code.** The owner sets a 6-digit code in the backoffice (Settings → Business and receipt). The till calls `void_transaction_approved`. Five wrong codes lock void for 5 minutes. The hash is in `business_void_codes`, which no client can read. `void_transaction` is no longer callable from clients.
3. **`list_device_cashiers`** also returns `pin_locked_until`, so the picker shows locked cashiers.
4. **`update_held_bill`** replaces the items of a recalled held bill instead of creating a second one. Refused when a split has started.

Tests: `supabase/tests/test_032.sql` and `run_all.sh`.

## Decisions that differ from DESIGN

- No manual discount on the till. Promotions are vouchers made in the backoffice. The Diskon bill button and the item discount under Opsi are gone; Opsi now holds only the note. A held bill saved before this change may still carry a manual discount: it is shown and kept, and applying a voucher replaces it.

- DESIGN mentions `@expo/ui` BottomSheet and `react-native-keyboard-controller`. The app uses its own `Sheet` on top of `Modal` so it works on the web preview and without a native rebuild. Switching later only touches `src/components/Sheet.tsx`.

## Placeholders to fill before release

- `src/brand.ts`: `whatsapp` is `[NOMOR WHATSAPP]`.
- Plan prices in `LockedScreen.tsx` mirror PRD section 6; the server stays the source of truth.

## Not yet tested

Android devices, real Bluetooth printers, and a real Supabase project. Everything above was checked on the web preview against the mock and with SQL tests on PostgreSQL 16.
