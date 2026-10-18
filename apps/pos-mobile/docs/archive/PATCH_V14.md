
# PATCH V14 — Dashboard Analytics

## File baru
- SalesHeroCard.tsx
- PaymentSummaryCard.tsx
- TopProductsCard.tsx
- PeakHourCard.tsx

## Integrasi Dashboard

Import:

```tsx
import SalesHeroCard from "@/components/dashboard/SalesHeroCard";
import PaymentSummaryCard from "@/components/dashboard/PaymentSummaryCard";
import TopProductsCard from "@/components/dashboard/TopProductsCard";
import PeakHourCard from "@/components/dashboard/PeakHourCard";
```

Urutan setelah ShiftControlCard:

1. SalesHeroCard
2. PaymentSummaryCard
3. TopProductsCard
4. PeakHourCard

Semua data menggunakan `getShiftAnalytics()`.
