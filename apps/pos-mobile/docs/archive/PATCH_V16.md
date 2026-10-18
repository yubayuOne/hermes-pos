
# PATCH V16 — Dashboard Modular Architecture

## Tujuan

Memecah Dashboard menjadi feature modules sehingga DashboardScreen menjadi orchestrator.

## File baru

- src/screens/dashboard/DashboardHeader.tsx
- src/screens/dashboard/ShiftSection.tsx
- src/screens/dashboard/SalesSection.tsx
- src/screens/dashboard/PaymentSection.tsx
- src/screens/dashboard/TopProductsSection.tsx
- src/screens/dashboard/PeakHourSection.tsx
- src/screens/dashboard/InsightSection.tsx

## Integrasi

DashboardScreen cukup mengimpor seluruh section lalu menyusunnya:

1. DashboardHeader
2. ShiftSection
3. SalesSection
4. PaymentSection
5. TopProductsSection
6. PeakHourSection
7. InsightSection

Target akhir DashboardScreen ±120–180 baris.
