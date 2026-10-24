import { Tap } from './Tap';
import { View } from 'react-native';
import { Mono } from './Text';
import { Icon } from './Icon';
import { colors } from '../theme';
import { t } from '../i18n';

/**
 * Number pad (DESIGN I4): 3 x 4, 1 to 9, 000, 0, delete. 54px keys (44px in landscape). Money inputs use this
 * instead of the system keyboard so the total stays visible. The PIN pad leaves out 000.
 */
export function Keypad({
  value,
  onChange,
  maxLength = 9,
  pin = false,
  compact = false,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  pin?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    let next = value + k;
    if (!pin) next = next.replace(/^0+(?=\d)/, '');
    if (next.length > maxLength) return;
    onChange(next);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', pin ? '' : '000', '0', 'del'];
  const h = compact ? 44 : 54;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {keys.map((k, i) => (
        <View key={i} style={{ width: '32%', flexGrow: 1 }}>
          {k === '' ? (
            <View style={{ height: h }} />
          ) : (
            <Tap
              accessibilityRole="button"
              accessibilityLabel={k === 'del' ? t('Hapus satu angka') : k}
              disabled={disabled}
              onPress={() => press(k)}
              onLongPress={k === 'del' ? () => onChange('') : undefined}
              className="items-center justify-center rounded-k"
              style={({ pressed }) => ({
                height: h,
                borderWidth: 1.5,
                borderColor: disabled ? colors.disabledLine : colors.ink,
                backgroundColor: pressed ? colors.tint : colors.slip,
                transform: [{ translateY: pressed ? 1 : 0 }],
              })}
            >
              {k === 'del' ? <Icon name="backspace" size={24} /> : <Mono className="text-heading">{k}</Mono>}
            </Tap>
          )}
        </View>
      ))}
    </View>
  );
}

/** Six PIN boxes, 56px. A filled box shows a 16px ink square. */
export function PinBoxes({ count, length = 6, error }: { count: number; length?: number; error?: boolean }) {
  return (
    <View accessibilityLabel={t('{n} dari {m} angka', { n: count, m: length })} className="flex-row justify-center" style={{ gap: 8 }}>
      {Array.from({ length }, (_, i) => (
        <View
          key={i}
          className="items-center justify-center rounded-k"
          style={{
            width: 48,
            height: 56,
            borderWidth: 1.5,
            borderColor: error ? colors.errorLine : colors.ink,
            backgroundColor: error ? colors.errorSoft : colors.slip,
          }}
        >
          {i < count ? <View style={{ width: 16, height: 16, backgroundColor: colors.ink }} /> : null}
        </View>
      ))}
    </View>
  );
}
