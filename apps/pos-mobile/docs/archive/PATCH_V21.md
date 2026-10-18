
# PATCH V21 — Real Hourly Analytics

## File berubah
- src/screens/dashboard/DashboardScreen.tsx

## Perubahan
- Grafik Tren Penjualan memakai `createdAt` transaksi asli.
- Menambahkan `hourlySales` dan `peakHour` berbasis `useMemo`.
- Hint pada section Jam Ramai otomatis menampilkan jam puncak.
- Tidak mengubah AppStore, database, Split Bill, atau Payment.
