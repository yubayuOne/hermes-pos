# HERMES POS NativeWind Migration — V1

## Scope

This is the first safe migration step from the existing HERMES POS `StyleSheet` design system to NativeWind v4.

### Migrated
- NativeWind v4.2.7 project setup
- Tailwind v3 design tokens mapped from `src/theme/index.ts`
- `AnimatedPressable` NativeWind interoperability
- `Button`
- `Header`
- `Screen`
- `ProductCard`

### Intentionally unchanged
- Supabase
- AppStore/business logic
- checkout/payment logic
- Split Bill logic
- Shift & Kas logic
- printer logic
- navigation/routing
- remaining screens/components

The existing `src/theme/index.ts` is retained during the migration so legacy components continue to work while screens are migrated incrementally.

## Installation

This project targets Expo SDK 57. Install the configured dependencies with:

```bash
npm install
```

If Expo reports native dependency alignment warnings, run:

```bash
npx expo install --fix
```

Then restart Metro with:

```bash
npx expo start --clear
```

## Verification

Before moving to the next migration phase, verify:

1. App boots normally.
2. Login still works.
3. Cashier product grid renders.
4. Product card can be tapped.
5. Button press animation still works.
6. Header/back navigation works.
7. Cart/payment/split/shift flows are unchanged.

## Next phase

After this baseline is confirmed on the emulator/device, migrate the reusable cart and cashier components, then refine the Cashier UI using the same token system.
