import React from 'react';
import { Tap } from './Tap';
import { ActivityIndicator, View, ViewStyle } from 'react-native';
import { Text } from './Text';
import { Icon, IconName } from './Icon';
import { colors } from '../theme';

export type ButtonVariant = 'fire' | 'pine' | 'plain' | 'ghost' | 'danger' | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';

const HEIGHT: Record<ButtonSize, number> = { sm: 44, md: 48, lg: 54 };
const LOOK: Record<ButtonVariant, { bg: string; pressed: string; text: string; border: string }> = {
  fire: { bg: colors.fire, pressed: colors.fireHover, text: colors.ink, border: colors.ink },
  pine: { bg: colors.pine, pressed: colors.pineHover, text: colors.paper, border: colors.ink },
  plain: { bg: colors.slip, pressed: colors.tint, text: colors.ink, border: colors.ink },
  ghost: { bg: 'transparent', pressed: colors.tint, text: colors.ink, border: 'transparent' },
  danger: { bg: colors.slip, pressed: colors.errorSoft, text: colors.error, border: colors.error },
  'danger-solid': { bg: colors.error, pressed: colors.errorLine, text: colors.slip, border: colors.ink },
};

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Shows a spinner and blocks taps. Pass `label` already changed (e.g. "Memproses...") when it should read differently. */
  loading?: boolean;
  icon?: IconName;
  /** Flex weight inside a ButtonRow (Bayar is 1.7 times wider than Tahan). */
  grow?: number;
  className?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/**
 * One button for the whole app (PRD X3). Heights 44, 48, 54. Pressed: down 1px and a darker fill. No shadow.
 * Disabled: tint fill, muted text, light border, so it never reads as tappable.
 */
export function Button({
  label,
  onPress,
  variant = 'plain',
  size = 'md',
  disabled,
  loading,
  icon,
  grow,
  className = '',
  style,
  accessibilityLabel,
}: ButtonProps) {
  const look = LOOK[variant];
  const off = disabled || loading;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      className={`flex-row items-center justify-center rounded-k px-4 ${className}`}
      style={({ pressed }) => [
        {
          height: HEIGHT[size],
          minWidth: 44,
          borderWidth: variant === 'ghost' ? 0 : 1.5,
          backgroundColor: off && variant !== 'ghost' ? colors.tint2 : pressed ? look.pressed : look.bg,
          borderColor: off ? colors.disabledLine : look.border,
          transform: [{ translateY: pressed && !off ? 1 : 0 }],
        },
        grow ? { flexGrow: grow, flexBasis: 0 } : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={colors.mute} style={{ marginRight: 8 }} /> : null}
      {icon && !loading ? (
        <View style={{ marginRight: 8 }}>
          <Icon name={icon} size={20} color={off ? colors.mute : look.text} />
        </View>
      ) : null}
      <Text
        numberOfLines={2}
        className={`font-body-600 text-[15px] ${variant === 'ghost' ? 'underline' : ''}`}
        style={{ color: off ? colors.mute : look.text, textAlign: 'center', lineHeight: 18, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Tap>
  );
}

/** Buttons side by side with equal width by default. The primary action goes last (right, near the thumb). */
export function ButtonRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View className={`flex-row gap-2.5 ${className}`}>
      {items.map((child, i) => {
        if (!React.isValidElement<ButtonProps>(child)) return child;
        const grow = child.props.grow ?? 1;
        return React.cloneElement(child, { key: i, grow });
      })}
    </View>
  );
}

/** Square 44px icon button with a label for screen readers (DESIGN A7). */
export function IconButton({
  icon,
  onPress,
  label,
  disabled,
  badge,
  tone = 'plain',
  size = 44,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  disabled?: boolean;
  badge?: number;
  tone?: 'plain' | 'fire' | 'error';
  size?: number;
}) {
  const bg = tone === 'fire' ? colors.fireSoft : tone === 'error' ? colors.errorSoft : colors.slip;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: disabled ? colors.disabledLine : colors.ink,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.tint : bg,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      <Icon name={icon} size={20} color={disabled ? colors.mute : tone === 'error' ? colors.error : colors.ink} />
      {badge ? (
        <View className="absolute -right-2 -top-2 min-w-[20px] items-center justify-center rounded-k border-k border-ink bg-fire px-1" style={{ height: 20 }}>
          <Text className="font-mono-600 text-[12px] text-ink">{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Tap>
  );
}
