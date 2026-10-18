import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** One haptic per action, always with a visible change (DESIGN I9a). Never on scroll or tab changes. */
const run = (fn: () => Promise<void>) => {
  if (Platform.OS !== 'web') fn().catch(() => undefined);
};
export const haptic = {
  /** Product added, stepper changed. */
  select: () => run(() => Haptics.selectionAsync()),
  /** Payment recorded. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Wrong PIN, payment refused. */
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Void confirmed. */
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
};
