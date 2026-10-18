
# PATCH V15 — Close Shift Summary + Thermal Report

## File baru

- src/components/shift/CloseShiftSummarySheet.tsx
- src/components/receipt/ShiftReportReceipt.tsx

## Perubahan UX

- Tutup Shift sekarang menjadi Bottom Sheet.
- Ringkasan lengkap sebelum shift ditutup.
- Tombol `Cetak Laporan` berada di popup yang sama.
- Format receipt mengikuti gaya Customer Bill.

## Integrasi

1. Panggil `CloseShiftSummarySheet` dari Dashboard setelah tombol Tutup Shift.
2. Gunakan `ShiftReportReceipt` sebagai preview sebelum ESC/POS.
3. `onConfirm` tetap memanggil fungsi close shift yang sudah ada.
