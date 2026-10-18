
# PATCH V27 — Dashboard Analytics Live

File berubah:
- src/screens/dashboard/DashboardScreen.tsx
- src/services/analytics/buildShiftAnalytics.ts

Perubahan:
- Dashboard sekarang membaca `items[]` dari repository.
- Analytics menjadi satu sumber data.
- Top 5 Menu siap memakai data real.
- Peak Hour memakai createdAt transaksi.
- Cash vs QRIS memakai analytics.
