# Sistem Notifikasi HERMES POS

Semua pesan ke kasir lewat dua template. Jangan pakai `Alert.alert` lagi.

| Template | Kapan dipakai | Perilaku |
|---|---|---|
| **Toast** (`Toast.tsx`) | Kabar singkat: transaksi berhasil, data tersimpan, hasil cetak | Muncul di atas layar, hilang sendiri (2,8 dtk untuk sukses), tidak menghalangi sentuhan, ketuk untuk menutup |
| **ActionDialog** (`ActionDialog.tsx`) | Konfirmasi, masalah yang perlu penjelasan, hasil penting | Popup di tengah layar, menunggu pilihan pengguna, bisa diantre |

## Pemakaian

```tsx
const notify = useNotify();   // dari src/providers/NotifyProvider

// Toast
notify.success('Pembayaran berhasil', 'INV-0012 • Rp 45.000');
notify.info('Bill ditutup', 'Bill tetap ada di Bill Ditahan.');

// Masalah: pesan + cara mengatasi
notify.warning('Bill kosong', 'Belum ada menu di bill ini.', { hint: 'Tambahkan minimal 1 menu.' });
notify.fail('Gagal menutup shift', error, 'Shift tidak dapat ditutup.');   // error diterjemahkan otomatis

// Konfirmasi (resolve true/false)
if (await notify.confirm({ title: 'Hapus produk?', message: '...', confirmLabel: 'Hapus', destructive: true })) { ... }

// Butuh aksi: tombol sendiri, resolve dengan key tombol
const choice = await notify.dialog({
  tone: 'warning',
  title: 'Shift belum bisa ditutup',
  message: 'Masih ada 2 Bill Ditahan di shift ini.',
  hint: 'Bayar atau batalkan Bill Ditahan, lalu tutup shift lagi.',
  actions: [{ key: 'later', label: 'Nanti', variant: 'secondary' }, { key: 'view', label: 'Lihat Bill Ditahan' }],
});
```

## Aturan penulisan pesan

- Judul menyebut apa yang terjadi ("Gagal menutup shift"), bukan "Error".
- `message` menjelaskan penyebab; `hint` menjelaskan langkah berikutnya. Masalah tanpa hint harus jarang.
- Nama tombol = aksi nyata ("Hapus", "Lihat Bill Ditahan"), bukan "OK".
- Nama aksi konsisten: tombol "Hapus" menghasilkan toast "... dihapus".

## Menambah penjelasan error baru

Tambahkan satu `if` di `describeError()` pada `src/utils/errors.ts`. Semua layar yang memakai
`notify.fail(...)` langsung ikut mendapat pesan dan langkah perbaikannya.

## Catatan teknis

- `<Modal>` React Native menutupi layar di belakangnya. Karena itu `<ToastHost />` juga dipasang di
  `BottomSheet` dan `ConfirmModal`. Jika membuat `<Modal>` mentah baru yang bisa memicu toast saat
  terbuka, tambahkan `<ToastHost />` di dalamnya. Dialog (ActionDialog) selalu tampil di atas semuanya.
- Hasil cetak diseragamkan lewat `reportPrintResult()` (`src/utils/printFeedback.ts`).
