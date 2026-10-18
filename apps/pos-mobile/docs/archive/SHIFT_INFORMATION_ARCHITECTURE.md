# HERMES POS — Shift & Kas Information Architecture

## Prinsip utama

Shift adalah **operational state** terminal, bukan pengaturan biasa. Karena itu seluruh aksi dan informasi yang mengubah atau menjelaskan state shift memiliki satu pusat: **Shift & Kas**.

## Single Source of Truth

Semua aksi berikut hanya dijalankan dari `src/screens/shift/ShiftScreen.tsx`:

- Buka Shift
- Tutup Shift & Rekap Kas
- Riwayat / daftar shift hari ini
- Ringkasan kas shift
- Catatan serah-terima

## Akses menuju Shift & Kas

### Dashboard
Dashboard hanya menampilkan **status ringkas**:

- `AKTIF` + nomor shift + modal awal, atau
- `BELUM DIBUKA`
- statistik singkat jika shift aktif
- satu CTA: `Buka Shift` atau `Kelola Shift & Kas`

Dashboard tidak lagi memiliki tombol Tutup Shift atau Riwayat Shift.

### Kasir
Jika belum ada shift, layar Kasir menampilkan blocker kontekstual `Shift belum dibuka` dengan aksi `Buka Shift`. Ini adalah exception flow agar kasir tidak bingung ketika mencoba mulai transaksi; bukan tempat untuk mengelola shift.

Ketika shift aktif, Kasir tidak menampilkan kontrol Open/Close Shift tambahan.

### Settings
Settings hanya menangani terminal, printer, katalog, profile, dan informasi aplikasi. Shift & Kas tidak lagi berada di Settings agar fungsi operasional tidak tersembunyi di menu konfigurasi.

### Navigation Drawer
Jika drawer digunakan, `Shift & Kas` ditempatkan di section `Operasional`, terpisah dari navigasi utama dan Bill Ditahan.

## Flow UX

```text
Dashboard
   │
   └── Buka Shift / Kelola Shift & Kas
              │
              ▼
        SHIFT & KAS
        ├── Belum aktif → Modal Awal → Buka Shift
        │
        └── Aktif
             ├── Ringkasan shift
             ├── Tutup Shift & Rekap Kas
             ├── Daftar Shift Hari Ini
             └── Catatan Serah Terima
```

## Aturan penting

1. Jangan menambahkan tombol `Tutup Shift` ke Dashboard.
2. Jangan menambahkan `Shift & Kas` kembali ke Settings.
3. Jangan membuat header Kasir menjadi tempat kedua untuk Open/Close Shift.
4. Status shift boleh muncul secara kontekstual, tetapi aksi pengelolaan tetap menuju Shift & Kas.
5. `Buka Shift` dan `Tutup Shift` harus selalu dianggap sebagai destructive/operational flow dengan konfirmasi dan feedback yang jelas.
6. Setelah shift ditutup, cart, split bill aktif, dan held-bill context terminal dibersihkan seperti flow existing.
