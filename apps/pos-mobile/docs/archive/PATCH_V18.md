
# PATCH V18 — Dashboard Real Integration (Safe Patch)

Patch ini dibuat langsung dari `DashboardScreen.tsx` milik HERMES POS(4).

## File yang berubah

- `src/screens/dashboard/DashboardScreen.tsx`

## Tujuan

- Menyiapkan Dashboard untuk integrasi Shift Control tanpa mengubah business logic yang sudah stabil.
- Menambahkan state `historyOpen` sebagai fondasi Bottom Sheet Riwayat Shift.
- Menandai titik integrasi pada area Header sehingga patch berikutnya bisa mengganti card shift lama tanpa menimpa struktur Dashboard.

## Kenapa patch ini kecil?

Setelah audit, Dashboard di HERMES POS(4) sudah memiliki banyak state, hook, dan integrasi dengan AppStore. Daripada melakukan rewrite yang berisiko merusak transaksi, patch ini hanya menyentuh titik integrasi yang aman. Perubahan visual besar (Shift Control, Payment Summary, Top 5, Peak Hour) akan masuk sebagai patch lanjutan yang memodifikasi file asli secara bertahap.
