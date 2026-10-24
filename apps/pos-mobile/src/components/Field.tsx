import { forwardRef, useState } from 'react';
import { Tap } from './Tap';
import { TextInput, TextInputProps, View } from 'react-native';
import { Mono, Text } from './Text';
import { Icon } from './Icon';
import { colors, fonts } from '../theme';
import { t } from '../i18n';

type FieldProps = TextInputProps & {
  label?: string;
  optional?: boolean;
  help?: string;
  error?: string | null;
  containerClassName?: string;
  /** Mono value, e.g. codes and PIN-like inputs. */
  mono?: boolean;
  /** Adds a "Lihat" toggle for passwords. */
  reveal?: boolean;
};

/**
 * Input with a visible label (DESIGN B, .in). 48px, 1.5px ink border; error state has the error border and a
 * message under it that disappears as soon as the value changes (the caller clears `error` in onChangeText).
 */
export const TextField = forwardRef<TextInput, FieldProps>(function TextField(
  { label, optional, help, error, containerClassName = '', mono, reveal, secureTextEntry, style, multiline, ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <View className={containerClassName}>
      {label ? (
        <Text className="mb-1.5 font-body-600 text-small">
          {label}
          {optional ? <Text className="text-small text-mute"> {t('(opsional)')}</Text> : null}
        </Text>
      ) : null}
      <View
        className="flex-row items-center rounded-k"
        style={{
          minHeight: multiline ? 76 : 48,
          borderWidth: 1.5,
          borderColor: error ? colors.errorLine : focus ? colors.fire : colors.ink,
          backgroundColor: error ? colors.errorSoft : rest.editable === false ? colors.tint2 : colors.slip,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          placeholderTextColor={colors.mute}
          secureTextEntry={secureTextEntry && !shown}
          aria-invalid={!!error}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          multiline={multiline}
          style={[
            {
              flex: 1,
              minWidth: 0,
              paddingHorizontal: 12,
              paddingVertical: multiline ? 10 : 0,
              minHeight: multiline ? 72 : 46,
              fontFamily: mono ? fonts.mono : fonts.body500,
              fontSize: 16,
              color: colors.ink,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            style,
          ]}
          {...rest}
        />
        {reveal ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel={shown ? t('Sembunyikan') : t('Lihat|sandi')}
            onPress={() => setShown((v) => !v)}
            className="h-[46px] justify-center px-3"
          >
            <Text className="font-body-600 text-small underline">{shown ? t('Sembunyikan') : t('Lihat|sandi')}</Text>
          </Tap>
        ) : null}
      </View>
      {/* A slot that is always there, so a message appearing or going never moves the fields below it. */}
      <View className="mt-1.5 min-h-[20px]">
        {error ? (
          <Text accessibilityRole="alert" className="font-body-600 text-small text-error">
            {error}
          </Text>
        ) : help ? (
          <Text className="text-small text-mute">{help}</Text>
        ) : null}
      </View>
    </View>
  );
});

export function SearchInput({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View className="h-[48px] flex-row items-center rounded-k border-k border-ink bg-slip pl-3">
      <Icon name="search" size={20} color={colors.mute} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mute}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={{ flex: 1, minWidth: 0, height: 46, paddingHorizontal: 10, fontFamily: fonts.body500, fontSize: 16, color: colors.ink }}
      />
      {value ? (
        <Tap
          accessibilityRole="button"
          accessibilityLabel={t('Hapus pencarian')}
          onPress={() => onChangeText('')}
          className="h-[46px] w-[44px] items-center justify-center"
        >
          <Icon name="close" size={18} color={colors.mute} />
        </Tap>
      ) : null}
    </View>
  );
}

/** Amount box (DESIGN I4): 64px, slip, ink border with an orange inner line while it is being filled. */
export function AmountBox({ label, value, active = true, compact }: { label: string; value: string; active?: boolean; compact?: boolean }) {
  return (
    <View
      accessibilityLabel={`${label} ${value}`}
      className="flex-row items-center justify-between rounded-k bg-slip px-3.5"
      style={{ height: compact ? 54 : 64, borderWidth: 1.5, borderColor: colors.ink, ...(active ? { boxShadow: `inset 0 0 0 1.5px ${colors.fire}` } : null) }}
    >
      <Mono className="text-small text-mute">{label}</Mono>
      <Mono className="font-mono-600" style={{ fontSize: compact ? 24 : 28 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Mono>
    </View>
  );
}

/** Change box: pine-soft for change, error-soft when short, tint-3 before anything is typed. */
export function ChangeBox({ state, label, value }: { state: 'change' | 'short' | 'empty'; label: string; value: string }) {
  const bg = state === 'change' ? colors.pineSoft : state === 'short' ? colors.errorSoft : colors.tint3;
  const fg = state === 'short' ? colors.error : colors.ink;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="h-[48px] flex-row items-center justify-between rounded-k px-3.5"
      style={{ backgroundColor: bg, borderWidth: 1.5, borderColor: state === 'short' ? colors.errorLine : colors.ink }}
    >
      <Text className="font-body-600 text-body" style={{ color: fg }}>
        {label}
      </Text>
      <Mono className="font-mono-600 ml-3 min-w-0 flex-1 text-right text-body" style={{ color: fg }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Mono>
    </View>
  );
}
