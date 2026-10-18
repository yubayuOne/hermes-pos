# NativeWind Migration V8 — Settings & Pengaturan

## Scope
Migrated `src/screens/settings/SettingsScreen.tsx` from React Native `StyleSheet` styling to NativeWind.

## Migrated UI
- Profile / terminal card
- Operasional section
- Shift & Kas row
- Printer row
- Katalog section
- Kategori Produk row
- Produk row
- Profile information card
- Tentang card
- Logout button spacing
- Press feedback on settings rows

## Preserved behavior
- `useAppStore()` session and shift data
- Navigation callbacks
- `signOut()` flow
- Existing labels and descriptions
- Existing icon choices
- No database changes
- No service changes
- No transaction / shift / printer business-logic changes

## Note
`CategoriesScreen.tsx` and `ProductsScreen.tsx` remain separate screens and were not changed in this migration pass. This keeps V8 limited to the main Settings navigation screen and avoids unrelated changes.
