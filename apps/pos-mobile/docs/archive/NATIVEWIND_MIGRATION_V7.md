# NativeWind V7 — Printer

## Scope
Migrasi UI `src/screens/printer/PrinterScreen.tsx` dari `StyleSheet` ke NativeWind.

## Migrated UI
- Header dan area konten Printer
- Status printer dan informasi adapter
- Tombol Tes Cetak Struk
- Diagnostik Printer
- Tab Alignment / Kepadatan / Feed & Potong
- Preview kertas 58mm
- Informasi arsitektur printer
- Press feedback pada tab diagnostik

## Preserved behavior
- `printerService.getAdapter()` tetap digunakan.
- `printer.testPrint()` tetap digunakan tanpa perubahan.
- Alert sukses/gagal tetap sama.
- State `loading` dan `mode` tetap sama.
- Printer adapter, ESC/POS builder, receipt types, dan service tidak diubah.
- Tidak ada perubahan database, migration, store, transaction flow, atau business logic.

## NativeWind notes
- Styling utama screen menggunakan token `kas-*` yang sudah tersedia.
- Warna dinamis untuk status/icon tetap memakai `colors` existing.
- Preview printer mempertahankan font monospace dan warna kertas/diagnostik yang sudah digunakan.
- `Button` existing digunakan tanpa perubahan behavior.
