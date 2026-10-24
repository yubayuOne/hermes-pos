import { useState } from 'react';
import { View } from 'react-native';
import { Tap } from './Tap';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';
import { Sheet, SheetBody, SheetHeader, ActionFooter } from './Sheet';
import { colors } from '../theme';
import { t } from '../i18n';

export type Choice<K extends string> = { key: K; label: string };

/**
 * One button that shows the current choice. Opening it lists every option as a large tile in a two-column grid, with
 * a "Tutup" button at the bottom where the thumb already is. Options never hide past an edge and tiles are 56px tall.
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
        className="h-[48px] flex-row items-center gap-2 rounded-k px-3"
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
          <View className="flex-row flex-wrap justify-between gap-y-2.5 pb-2">
            {options.map((o) => {
              const selected = o.key === value;
              return (
                <Tap
                  key={o.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={o.label}
                  onPress={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  className="min-h-[56px] flex-row items-center justify-between rounded-k px-3.5"
                  style={({ pressed }) => ({
                    width: '48%',
                    borderWidth: 1.5,
                    borderColor: colors.ink,
                    backgroundColor: selected ? colors.pine : pressed ? colors.tint : colors.slip,
                  })}
                >
                  <Text numberOfLines={2} className={`min-w-0 flex-1 font-body-600 text-[16px] ${selected ? 'text-slip' : ''}`}>
                    {o.label}
                  </Text>
                  {selected ? <Icon name="check" size={18} color={colors.slip} /> : null}
                </Tap>
              );
            })}
          </View>
        </SheetBody>
        <ActionFooter>
          <Button label={t('Tutup')} onPress={() => setOpen(false)} />
        </ActionFooter>
      </Sheet>
    </>
  );
}
