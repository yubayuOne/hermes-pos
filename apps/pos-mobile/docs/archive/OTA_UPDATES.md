# Pembaruan tanpa build ulang (expo-updates)

`expo-updates` sudah terpasang. Perbaikan yang hanya mengubah JavaScript/TypeScript (layar, logika, teks) bisa dikirim lewat internet tanpa menginstal APK baru. Perubahan native (paket native baru, plugin, izin Android, `app.json` bagian native) tetap perlu build APK baru.

## Persiapan satu kali (butuh akun Expo, tidak bisa dilakukan dari lingkungan pengembangan otomatis)

1. `npm install -g eas-cli` lalu `eas login`.
2. `eas init` (membuat project dan mengisi `extra.eas.projectId` di `app.json`).
3. `eas update:configure` (mengisi `updates.url` di `app.json`).
4. Build APK sekali lagi: `eas build -p android --profile production`. Instal APK ini di semua perangkat kasir. Setelah ini, perangkat bisa menerima pembaruan.

`eas.json` sudah berisi channel `production` dan `preview`.

## Mengirim perbaikan

```bash
npm run typecheck
eas update --channel production --message "Perbaikan diskon"
```

Aplikasi mengecek pembaruan saat dibuka (`checkAutomatically: ON_LOAD`), mengunduhnya di latar belakang, dan memakainya pada pembukaan berikutnya (`fallbackToCacheTimeout: 0`, jadi kasir tidak pernah menunggu layar loading).

## Aturan penting

- `runtimeVersion` memakai kebijakan `appVersion`: pembaruan hanya dikirim ke APK dengan `version` yang sama di `app.json`. Naikkan `version` setiap kali membuat build native baru agar APK lama tidak menerima kode yang butuh modul native baru.
- Migrasi database (`supabase db push`) harus dijalankan SEBELUM mengirim pembaruan yang memanggil RPC baru.
- Tidak ada dampak pada antrean offline atau cache lokal; AsyncStorage tidak dihapus oleh pembaruan.
- Sampai langkah persiapan selesai, `updates.url` kosong dan expo-updates tidak aktif (aplikasi berjalan seperti biasa).
