# HERMES POS Printer System V1

## Prinsip

Printer adalah output dari transaksi, bukan bagian dari commit transaksi. Transaksi harus tetap tersimpan walaupun printer offline, kehabisan kertas, atau Bluetooth terputus.

## Multiple printer

Satu instalasi HERMES POS dapat menyimpan banyak printer. Setiap printer memiliki:

- `id`
- `connectionType`: Bluetooth, USB, network, simulator
- `address`
- `paperWidth`: 58/80mm
- `roles`: receipt, kitchen, bar, reprint, report
- `enabled`
- `autoPrint`
- `status`

Satu printer boleh memiliki beberapa role.

## Routing

- `receipt`: struk pelanggan
- `kitchen`: item kitchen
- `bar`: item bar
- `reprint`: cetak ulang transaksi
- `report`: laporan

Automatic printing hanya memakai printer yang `enabled=true` dan `autoPrint=true`.

## Bluetooth V1

HERMES POS menggunakan Android native bridge `HermesPosBluetoothPrinter` untuk Bluetooth Classic RFCOMM menggunakan SPP UUID standar. HERMES POS membaca perangkat yang sudah paired di Android. Pairing pertama dilakukan melalui pengaturan Bluetooth Android.

Data dikirim sebagai raw ESC/POS bytes sehingga adapter tidak bergantung pada merek printer tertentu.

## Flow pembayaran

1. Checkout transaction.
2. Transaction tersimpan.
3. Payment intent dibersihkan.
4. Cart dibersihkan.
5. Print jobs dikirim ke printer sesuai routing.
6. Jika salah satu printer gagal, transaksi tetap sukses dan user diberi informasi bahwa printer perlu dicek/reprint.

## Pengembangan berikutnya

- Bluetooth discovery langsung dari HERMES POS.
- USB printer.
- LAN/Wi-Fi printer.
- Print queue persisten.
- Retry job.
- Reprint dari riwayat transaksi.
- Kitchen/bar ticket dengan format khusus.
- Cash drawer kick.
- Cutter capability detection.
