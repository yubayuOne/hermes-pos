import { useState } from 'react';
import { View } from 'react-native';
import { Tap } from './Tap';
import { Text } from './Text';
import { Icon } from './Icon';
import { Chip } from './bits';
import { Sheet, SheetBody, SheetHeader } from './Sheet';
import { colors } from '../theme';

export type Choice<K extends string> = { key: K; label: string };

/**
 * One button that shows the current choice and opens every option as wrapping chips. Replaces a sideways-scrolling
 * chip strip where the options do not fit: nothing hides past the edge, and long labels stay readable.
 */
export function ChoiceButton<K extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<Choice<K>>;
  value: K;
  onChange: (k: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value)?.label ?? '';
  return (
    <>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${current}`}
        onPress={() => setOpen(true)}
        className="h-[44px] flex-row items-center gap-2 rounded-k px-3"
        style={({ pressed }) => ({ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: pressed ? colors.tint : colors.slip })}
      >
        <Text numberOfLines={1} className="min-w-0 flex-1 font-body-600 text-[15px]">
          {current}
        </Text>
        <Icon name="chevron-down" size={18} />
      </Tap>
      <Sheet visible={open} onClose={() => setOpen(false)} label={title}>
        <SheetHeader title={title} onClose={() => setOpen(false)} />
        <SheetBody>
          <View className="flex-row flex-wrap gap-2">
            {options.map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                selected={o.key === value}
                onPress={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
              />
            ))}
          </View>
        </SheetBody>
      </Sheet>
    </>
  );
}
