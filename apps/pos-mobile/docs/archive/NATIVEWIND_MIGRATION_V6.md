# NativeWind V6 — Shift & Kas

## Scope
Migrasi UI `src/screens/shift/ShiftScreen.tsx` dari `StyleSheet` ke NativeWind.

## Migrated UI
- Header Shift & Kas
- Status shift aktif
- Modal awal / buka shift
- Input uang fisik saat tutup shift
- Tombol buka/tutup shift
- Rekap ekspektasi sistem dan selisih kas
- Daftar shift hari ini
- Empty/loading state
- Pengeluaran kas laci (petty) state
- Catatan serah terima state

## Preserved behavior
- `openShift(...)` dan `closeShift(...)` tetap menggunakan service/repository yang sama.
- `fetchTodayShifts(...)` dan `fetchTransactions(...)` tetap digunakan tanpa perubahan.
- Business date dan nomor shift tidak diubah.
- Perhitungan expected cash dan variance tetap berasal dari hasil `closeShift(...)`.
- Format nominal tetap menggunakan `formatMoneyInput`, `parseMoney`, dan `money` yang sudah ada.
- Tidak ada perubahan database, migration, RPC, store, atau business logic.

## NativeWind notes
- Screen styling menggunakan token `kas-*` yang sudah ada di Tailwind config.
- Warna dinamis untuk icon/status tetap memakai token `colors` existing agar behavior dan visual state tidak berubah.
- `ReportSummaryCard` tidak diubah karena berada di luar scope migrasi screen ini.
