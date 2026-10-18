import { Text as RNText, TextProps } from 'react-native';

/**
 * Text with the body font by default. Android cannot pick a weight of a custom font from fontWeight, so every
 * weight is its own family: font-body, font-body-500/600/700, font-display, font-mono, font-mono-600.
 */
export function Text({ className = '', ...rest }: TextProps & { className?: string }) {
  const font = /(^|\s)font-/.test(className) ? '' : 'font-body ';
  const color = /(^|\s)text-(ink|mute|paper|slip|pine|fire|error|pineText|kas-)/.test(className) ? '' : 'text-ink ';
  return <RNText maxFontSizeMultiplier={1.4} className={`${font}${color}${className}`} {...rest} />;
}

/** Mono with tabular figures, for money, codes, and small labels. */
export function Mono({ className = '', style, ...rest }: TextProps & { className?: string }) {
  const font = /(^|\s)font-/.test(className) ? '' : 'font-mono ';
  return <Text className={`${font}${className}`} style={[{ fontVariant: ['tabular-nums'] }, style]} {...rest} />;
}

/** Bricolage 800 with the tight tracking of the design. */
export function Display({ className = '', style, size = 30, ...rest }: TextProps & { className?: string; size?: number }) {
  return (
    <Text
      className={`font-display ${className}`}
      style={[{ fontSize: size, letterSpacing: -0.035 * size, lineHeight: Math.round(size * 1.05) }, style]}
      {...rest}
    />
  );
}
