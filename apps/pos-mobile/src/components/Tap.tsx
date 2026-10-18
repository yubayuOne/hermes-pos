import { useState } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

type Style = StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);

/**
 * Pressable that works with NativeWind classes and a pressed style together. NativeWind drops a style callback
 * when className is also set, so the pressed state is tracked here and passed as a plain style.
 */
export function Tap({ style, className, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { className?: string; style?: Style }) {
  const [pressed, setPressed] = useState(false);
  const resolved = typeof style === 'function' ? style({ pressed }) : style;
  return (
    <Pressable
      className={className}
      style={resolved}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      {...rest}
    />
  );
}
