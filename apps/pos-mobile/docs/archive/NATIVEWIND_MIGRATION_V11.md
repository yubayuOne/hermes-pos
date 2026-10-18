

## V11.1 Safe Area Fix
- Added `SafeAreaProvider` at the application root.
- Replaced React Native's deprecated `SafeAreaView` in `Screen.tsx` with `react-native-safe-area-context`.
- Bottom navigation continues to use `useSafeAreaInsets()` safely.
- No navigation, transaction, shift, payment, printer, or database logic changed.
