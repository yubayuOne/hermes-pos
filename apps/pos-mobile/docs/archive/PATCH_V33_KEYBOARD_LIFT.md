# PATCH V33 - Keyboard Lift (tanpa bergantung pada scroll)

## Masalah
Input kadang tertutup keyboard. Expo SDK 57 / RN 0.86 memakai edge-to-edge di Android, sehingga
`softwareKeyboardLayoutMode: resize` tidak mengecilkan window, dan `KeyboardAvoidingView`
(`behavior="height"`) tidak andal di dalam `<Modal>` (window terpisah).

## Solusi
- `hooks/useKeyboardHeight.ts` membaca tinggi keyboard dari event `Keyboard`.
- `components/common/KeyboardAvoidingOverlay.tsx` memberi `paddingBottom` setinggi keyboard pada overlay.
  Sheet (justify-end) terangkat di atas keyboard, dialog (justify-center) pindah ke tengah area yang terlihat,
  tombol aksi tetap terjangkau. Selisih resize dari sistem dikurangkan agar tidak terangkat dua kali.
- Semua `Modal` berinput memakai `statusBarTranslucent` + `navigationBarTranslucent` agar koordinat konsisten.
- Mode ringkas: Pembayaran (tunai) mengecilkan banner total & menyembunyikan daftar metode saat keyboard terbuka;
  dialog Menu Sementara menyembunyikan teks penjelasan.

## File
BottomSheet (dipakai Cart, Payment, SplitBill), ShiftScreen, CategoriesScreen, ProductsScreen, PrinterScreen,
CloseShiftSummarySheet, LoginScreen, PaymentScreen, CashierScreen.

## Shift: konten terpotong BottomNav
BottomNav bersifat overlay (`absolute`), sehingga kartu terakhir di Shift tertutup. ScrollView Shift kini memakai
`pb-[120px]` (sama seperti Dashboard/Settings/Transactions).

## Kas Masuk / Kas Keluar
Sudah dihapus di kode (tidak ada UI maupun pemanggil `create_cash_movement`) dan di database lewat
`supabase/migrations/018_temp_menu_delete_bill_remove_cash_entry.sql`. Tampilan "Kas Laci" pada screenshot berasal
dari build lama: build ulang aplikasi dan jalankan migration 018.
