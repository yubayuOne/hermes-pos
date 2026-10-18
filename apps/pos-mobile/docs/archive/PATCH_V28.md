
# PATCH V28 – Close Shift Final

File baru:
- src/components/shift/CloseShiftSummarySheet.tsx
- src/components/receipt/ShiftReportReceipt.tsx

## Integrasi

Dashboard cukup memanggil:

```tsx
<CloseShiftSummarySheet
  visible={showCloseShift}
  analytics={analytics}
  cashier={session.cashierName}
  shiftName={shift.name}
  onPrint={handlePrint}
  onConfirm={handleCloseShift}
/>
```

Receipt memakai komponen yang sama sehingga tampilan popup dan hasil cetak konsisten.
