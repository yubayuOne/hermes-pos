# HERMES POS Keyboard Fix

## Tujuan
Mencegah keyboard Android menutupi input di seluruh alur HERMES POS, terutama pada modal/bottom sheet yang berada di bagian bawah layar.

## Perubahan
- `BottomSheet` sekarang benar-benar mengaktifkan keyboard avoidance di Android (`behavior="height"`) saat `keyboardAvoiding` digunakan.
- `SplitBillScreen` mengaktifkan keyboard avoidance.
- Form modal Kategori dan Produk menggunakan `KeyboardAvoidingView` + `ScrollView`.
- Modal Teks Tambahan Printer menggunakan `KeyboardAvoidingView` + `ScrollView`.
- Modal Buka/Tutup Shift menggunakan keyboard avoidance; form Tutup Shift dapat di-scroll saat keyboard terbuka.
- Area input Kas Laci di Shift berada di dalam keyboard-aware scroll container.
- `CloseShiftSummarySheet` menggunakan keyboard avoidance + satu scroll container.
- Login menggunakan keyboard-aware scroll container agar password/form tetap dapat diakses pada layar pendek.
- Bottom navigation otomatis disembunyikan saat keyboard terbuka agar tidak menutupi area input.
- `android.softwareKeyboardLayoutMode` tetap `resize`; tidak diubah ke `pan`, karena layout HERMES POS sudah ditangani dengan `KeyboardAvoidingView` dan scroll container.

## Prinsip implementasi
1. `resize` tetap menjadi mode Android utama.
2. Modal/bottom sheet yang memiliki input harus memakai `KeyboardAvoidingView`.
3. Form yang berpotensi lebih tinggi dari viewport harus memiliki `ScrollView` dengan `keyboardShouldPersistTaps="handled"`.
4. Bottom navigation tidak boleh menjadi overlay terhadap keyboard/input.
5. Tidak menambahkan library native keyboard baru, sehingga tidak menambah risiko kompatibilitas Expo SDK 57.
