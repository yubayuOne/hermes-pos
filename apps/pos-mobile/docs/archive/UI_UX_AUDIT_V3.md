# HERMES POS — UI/UX Audit V3

## Tujuan

V3 memperbaiki konsistensi visual dan perilaku terminal kasir tanpa menambahkan fitur back-office ke HERMES POS.

## Temuan dari review screenshot + reference design

1. **Kategori Menu mengalami layout collapse**
   - Chip `Semua` membesar menjadi kolom vertikal.
   - Penyebab: horizontal `FlatList` ikut mengambil ruang layout.
   - Perbaikan: gunakan horizontal `ScrollView` dengan tinggi konten terkontrol.

2. **Bottom navigation belum memiliki active state yang kuat**
   - Icon dan label aktif terlihat seperti teks biasa.
   - Perbaikan: active destination memakai pill `primary-container`, icon + label kontras tinggi.

3. **Floating order area dan bottom navigation berpotensi bertabrakan**
   - Spacing bawah catalog diseragamkan agar area order dan navigation tidak menutupi konten.
   - Shadow bottom navigation dibuat lebih ringan agar tidak menghasilkan blok gelap.

4. **Hamburger tidak seharusnya langsung mengarah ke Riwayat**
   - Reference design menggunakan navigation drawer.
   - V3 menambahkan drawer untuk navigasi terminal dan Bill Ditahan.

5. **Data kosong sebelumnya menghilangkan konteks UI**
   - V3 mempertahankan search, kategori, report, grafik, payment distribution, dan empty state.
   - Nilai kosong ditampilkan sebagai `0`, bukan menghilangkan komponen.

6. **Status `Kas Seimbang` tidak akurat ketika belum ada penjualan**
   - Keseimbangan kas baru dapat direkonsiliasi ketika shift ditutup.
   - V3 menggunakan `Belum ada penjualan` atau `Kas berjalan`.

7. **Grafik shift sebelumnya hard-coded `0`**
   - V3 membaca transaksi shift dan menghitung distribusi per jam.
   - Saat belum ada transaksi, grafik tetap tampil dengan nilai nol.

8. **Distribusi pembayaran sebelumnya menggunakan tiga segmen sama besar walaupun total 0**
   - Ini memberi kesan seolah ada distribusi.
   - V3 menampilkan empty distribution ketika belum ada pembayaran dan proporsi aktual ketika data tersedia.

9. **Product card belum menggunakan `image_url` database**
   - V3 menampilkan image produk jika tersedia.
   - Jika tidak tersedia, digunakan fallback visual yang konsisten dengan tema.

10. **Stock 0 belum mempunyai affordance yang jelas**
    - V3 menampilkan `Habis`, menurunkan emphasis card, dan menonaktifkan aksi tambah.

11. **Cart action terlalu padat**
    - Split Bill dipindahkan menjadi utility action.
    - `Tahan Bill` dan `Bayar` dibuat 50:50 sebagai primary checkout actions.
    - Total tagihan tetap sticky di footer sheet.

12. **Payment method terlalu kecil untuk touch target mobile**
    - V3 memakai full-row selectable cards.
    - Seluruh card dapat ditekan, bukan hanya icon/text.

13. **Checkout tidak memberikan review step yang cukup jelas**
    - V3 menambahkan confirmation modal sebelum RPC checkout.
    - Transaction-safe checkout dan idempotency tetap berada di database.

14. **Printer screen terlalu minimal dibanding reference**
    - V3 menambahkan diagnostic tabs dan live 58mm preview.
    - Hardware tetap melalui printer abstraction; tidak mengklaim koneksi hardware native tertentu.

15. **Doodle harus menjadi dekorasi, bukan gangguan**
    - Doodle tetap pointer-events none, low opacity, dan berada di layer background.
    - Floating gear yang tampak pada screenshot tidak diubah karena posisinya konsisten dengan overlay sistem perangkat, bukan elemen HERMES POS yang dapat diidentifikasi dari source UI.

## Prinsip visual V3

- Background: `#F7F2EB`
- Surface: `#EDE5D8`
- Primary: `#1D0603`
- Primary container: `#381B15`
- Secondary: `#865225`
- Border: `#E2D6C6`
- Success: `#2E7D32`
- Rounded tactile controls
- Android system font untuk terminal
- Dekorasi hanya sebagai supporting layer
- Touch target tidak terlalu kecil
- Empty state informatif tetapi tidak menghapus struktur halaman

## Scope tetap

HERMES POS tetap hanya terminal kasir. Product CRUD, harga/HPP, kategori CRUD, user/permission, outlet management, dan dashboard Owner/Manager tidak dimasukkan ke HERMES POS.

## V3.1 Information Architecture Update

HERMES POS now uses four primary bottom-navigation destinations:

1. Dashboard — operational sales summary and recent activity.
2. Kasir — product catalog, cart, hold/split, checkout, and Open Shift gate.
3. Pesanan — transaction list plus access to held bills.
4. Setting — profile, Shift & Kas, Printer, and terminal information.

Shift and Printer remain available as full-feature screens, but are intentionally nested under Setting so the primary navigation stays focused on the cashier's daily workflow.

Open Shift is intentionally surfaced inside Kasir. Before a shift exists, catalog browsing remains available, but product cards are locked and cannot add items to the cart. This keeps the product catalog useful while preventing an invalid transaction state.


## V4 navigation and chrome cleanup

- Primary navigation is fixed at four destinations: Dashboard, Kasir, Pesanan, Setting.
- Main screens no longer show a hamburger menu or a redundant top-right terminal button.
- The hamburger navigation drawer is removed from the runtime architecture; secondary destinations are reached from Setting.
- The bottom navigation uses a single floating surface with no Android elevation/shadow. This prevents a dark rectangular artifact behind the navigation bar on some devices.
- The active destination remains visually explicit through the dark primary pill and icon/label contrast.
- Dashboard keeps the decorative Cozy Doodle layer, but all decorative elements use `pointerEvents="none"` so they cannot block interaction.
- Dashboard report modules render deterministic zero/empty states instead of disappearing when the database has no transactions.
- Cashier remains the only place where products can be added to a transaction, and the active-shift gate remains enforced.

## Android navigation-bar regression guard

- The bottom navigation is an application surface; the Android system navigation area is not part of the HERMES POS card.
- `expo-navigation-bar` is configured at app bootstrap with relative positioning, HERMES POS background, and dark system buttons.
- Do not add an opaque/elevated container behind `BottomNav`.
- MaterialCommunityIcons names must be valid; `local-cafe` was replaced with `coffee-outline`.
- The cashier product insertion path is guarded by the active-shift condition in both UI and callback logic.

## Empty catalog cashier state

- When the outlet has no products, Kasir shows only the empty-catalog message.
- Search, barcode scan, category filter, and shift-ready banner are hidden until the catalog contains at least one product.
- Once products exist, the normal cashier controls appear automatically.

## Pesanan information architecture

- Pesanan is a transaction/order list only; shift sales analytics are not rendered here.
- The primary filters are `Bill Selesai` and `Bill Ditahan`.
- Search remains available for bill number, customer, and table.
- Held bills retain the existing recall flow when a held row is opened.
- Empty states are specific to the selected filter.

## Bottom navigation — floating active item

- Primary navigation remains Dashboard, Kasir, Pesanan, Setting.
- Inactive items show icon-only inside the navigation surface.
- The active item uses a floating circular icon treatment that rises above the bar, with its label below the icon.
- Active-state movement uses a spring animation to match the supplied reference interaction.
- HERMES POS colors are retained; the reference's green is not introduced.
