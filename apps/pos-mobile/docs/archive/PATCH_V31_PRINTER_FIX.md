# PATCH V31 – Perbaikan Print Bill

## Penyebab printer tidak berjalan
1. Modul native `HermesPosBluetoothPrinter` dipanggil dari JS tetapi tidak pernah ada di proyek Android.
2. Izin Bluetooth belum ada di `AndroidManifest.xml`; JS juga meminta `BLUETOOTH_SCAN` yang tidak dideklarasikan sehingga pengecekan izin selalu gagal.
3. Format struk: teks di-center semua, `[LOGO OUTLET]` ikut tercetak, tidak mengikuti lebar kertas, karakter non-ASCII tercetak sebagai sampah.
4. Printer Kitchen/Bar mencetak ulang seluruh bill pelanggan dan tetap mencetak walau tidak ada item.
5. Tiga job cetak berjalan paralel (race pada socket Bluetooth dan registry AsyncStorage).
6. Error saat cetak bisa tampil sebagai "Pembayaran gagal" walau transaksi sudah tersimpan.

## Perubahan
- Native: `android/.../printer/HermesPosBluetoothPrinter{Module,Package}.kt` (Bluetooth Classic SPP, koneksi di-cache, reconnect otomatis, kirim per chunk), didaftarkan di `MainApplication.kt`.
- `plugins/withHermesPosPrinter.js` (terdaftar di `app.json`): menjaga izin, file Kotlin, dan registrasi package tetap ada setelah `expo prebuild --clean`.
- `escpos.ts`: builder ESC/POS baru, kolom 32 (58mm) / 48 (80mm), bill pelanggan, tiket Kitchen/Bar, tes cetak, mode cetak ulang.
- `service.ts`: antrean cetak berurutan, timeout 20 detik, Kitchen/Bar dilewati jika kosong, reprint.
- `PaymentScreen`: cetak dipisah dari alur pembayaran, berurutan.
- `PrinterScreen`: pilih lebar kertas, saklar aktif/cetak otomatis, tombol ke Pengaturan Bluetooth.
- `TransactionsScreen`: tombol cetak ulang pada bill selesai.

## Wajib
Build ulang aplikasi native: `npx expo run:android`. Metro/reload saja tidak cukup.
