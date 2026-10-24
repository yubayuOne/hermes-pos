import React from 'react';
import { Tap } from './Tap';
import { View, ViewProps } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { Mono, Text } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme';

/** Choice chip, 44px. Selected is pine with paper text (DESIGN B, chip). */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  dashed,
  className = '',
  grow,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  dashed?: boolean;
  className?: string;
  grow?: boolean;
}) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`h-[44px] items-center justify-center rounded-k px-4 ${className}`}
      style={({ pressed }) => [
        {
          borderWidth: 1.5,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: disabled ? colors.disabledLine : colors.ink,
          backgroundColor: selected ? colors.pine : pressed ? colors.tint : colors.slip,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
        grow ? { flex: 1 } : null,
      ]}
    >
      <Text numberOfLines={1} className="font-body-600 text-[15px]" style={{ color: selected ? colors.paper : disabled ? colors.mute : colors.ink }}>
        {label}
      </Text>
    </Tap>
  );
}

export type TagTone = 'neutral' | 'fire' | 'pine' | 'error';
const TAG: Record<TagTone, { bg: string; border: string; text: string }> = {
  neutral: { bg: colors.slip, border: colors.ink, text: colors.ink },
  fire: { bg: colors.fireSoft, border: colors.ink, text: colors.ink },
  pine: { bg: colors.pineSoft, border: colors.pine, text: colors.pine },
  error: { bg: colors.errorSoft, border: colors.errorLine, text: colors.error },
};
/** Mono 13px label with a 1.5px border. Status is always a word, never only a color. */
export function Tag({ label, tone = 'neutral', className = '' }: { label: string; tone?: TagTone; className?: string }) {
  const s = TAG[tone];
  return (
    <View className={`self-start rounded-k px-2 ${className}`} style={{ borderWidth: 1.5, borderColor: s.border, backgroundColor: s.bg, paddingVertical: 1 }}>
      <Mono numberOfLines={1} className="text-[14px]" style={{ color: s.text }}>
        {label}
      </Mono>
    </View>
  );
}

/** Slip card: 1.5px ink border, 4px radius. */
export function Card({ children, className = '', style, ...rest }: ViewProps & { className?: string }) {
  return (
    <View className={`rounded-k border-k border-ink bg-slip p-4 ${className}`} style={style} {...rest}>
      {children}
    </View>
  );
}

/** Small mono label above a value or a group. */
export function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <Mono className={`text-[14px] text-mute ${className}`}>{children}</Mono>;
}

export type BannerTone = 'fire' | 'error' | 'slip' | 'pine';
const BANNER: Record<BannerTone, string> = { fire: colors.fireSoft, error: colors.errorSoft, slip: colors.slip, pine: colors.pineSoft };
/** Notice box at the top of a screen. `compact` puts the title and the buttons on one row (phone landscape). */
export function Banner({
  tone = 'fire',
  title,
  message,
  children,
  onClose,
  closeLabel,
  compact,
  className = '',
}: {
  tone?: BannerTone;
  title: string;
  message?: string | null;
  children?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <View
      accessibilityRole="summary"
      className={`rounded-k ${compact ? 'flex-row items-center gap-3 py-1.5 pl-3.5 pr-1.5' : 'px-3.5 py-3'} ${className}`}
      style={{ backgroundColor: BANNER[tone], borderWidth: 1.5, borderColor: tone === 'error' ? colors.errorLine : colors.ink }}
    >
      <View className={`flex-row items-start gap-3 ${compact ? 'min-w-0 flex-1' : ''}`}>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={compact ? 2 : undefined} className="font-body-700 text-[15px]" style={{ color: tone === 'error' ? colors.error : colors.ink }}>
            {title}
          </Text>
          {message ? <Text className="mt-0.5 text-[14px] text-mute">{message}</Text> : null}
        </View>
        {onClose ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel={closeLabel ?? title}
            onPress={onClose}
            className="-my-2 -mr-1 h-[44px] w-[44px] items-center justify-center"
          >
            <Icon name="close" size={20} />
          </Tap>
        ) : null}
      </View>
      {children ? <View className={compact ? '' : 'mt-3'}>{children}</View> : null}
    </View>
  );
}

/** Joined tabs (Selesai, Ditahan, Void) that never collapse (DESIGN I9a). */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: K; label: string; count?: number }>;
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-k border-k border-ink" style={{ flexShrink: 0 }}>
      {items.map((it, i) => {
        const on = it.key === value;
        return (
          <Tap
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={it.count === undefined ? it.label : `${it.label} ${it.count}`}
            onPress={() => onChange(it.key)}
            className="h-[44px] flex-1 flex-row items-center justify-center gap-1"
            style={({ pressed }) => ({
              backgroundColor: on ? colors.pine : pressed ? colors.tint : colors.slip,
              borderLeftWidth: i ? 1.5 : 0,
              borderColor: colors.ink,
            })}
          >
            <Text numberOfLines={1} className="font-body-600 text-[15px]" style={{ color: on ? colors.paper : colors.ink }}>
              {it.label}
            </Text>
            {it.count !== undefined ? (
              <Mono className="text-[14px]" style={{ color: on ? colors.pineText : colors.mute }}>
                {it.count}
              </Mono>
            ) : null}
          </Tap>
        );
      })}
    </View>
  );
}

/** Quantity stepper: − value +, 44px each. */
export function Stepper({
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
  label,
}: {
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
  label: string;
}) {
  const btn = (icon: 'minus' | 'plus', onPress: () => void, off?: boolean, a11y?: string) => (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={off}
      onPress={onPress}
      className="h-[44px] w-[44px] items-center justify-center"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.tint : colors.slip })}
    >
      <Icon name={icon} size={18} color={off ? colors.disabledLine : colors.ink} />
    </Tap>
  );
  return (
    <View className="flex-row items-center overflow-hidden rounded-k border-k border-ink bg-slip">
      {btn('minus', onMinus, minusDisabled, `${label} −`)}
      <View className="h-[44px] min-w-[36px] items-center justify-center border-x-k border-ink px-1">
        <Mono className="text-[15px]">{value}</Mono>
      </View>
      {btn('plus', onPlus, plusDisabled, `${label} +`)}
    </View>
  );
}

/** Diagonal hatching for sold-out cards and static skeletons. */
export function Hatch({ color = colors.tint2, gap = 10 }: { color?: string; gap?: number }) {
  return (
    <Svg style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern id="hatch" patternUnits="userSpaceOnUse" width={gap} height={gap} patternTransform="rotate(45)">
          <Line x1="0" y1="0" x2="0" y2={gap} stroke={color} strokeWidth={gap / 2} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#hatch)" />
    </Svg>
  );
}

/** Divider made of dashes (receipt rows). */
export function Dashed({ className = '', color = colors.ink }: { className?: string; color?: string }) {
  return <View className={className} style={{ borderBottomWidth: 1, borderStyle: 'dashed', borderColor: color }} />;
}
