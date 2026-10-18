
# PATCH V25 — Shift Analytics Service

## Tujuan

Menyatukan seluruh perhitungan Dashboard, Tutup Shift, dan Thermal Report ke satu service.

## File baru

- src/types/shiftAnalytics.ts
- src/services/analytics/buildShiftAnalytics.ts

## Arsitektur

Transaction Repository
        ↓
   buildShiftAnalytics()
        ↓
 Dashboard
 Close Shift
 Thermal Report

## V26

V26 akan mengubah repository agar mengembalikan `items[]` sehingga Top 5 Menu dan Kitchen/Bar aktif tanpa placeholder.
