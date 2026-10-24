import { useState } from 'react';
import { View } from 'react-native';
import { Tap } from './Tap';
import { Text } from './Text';
import { Icon } from './Icon';
import { Button } from './Button';
import { Sheet, SheetBody, SheetHeader, ActionFooter } from './Sheet';
import { cachedTables, fetchTables, TableRow } from '../services/tables/tables';
import { colors } from '../theme';
import { fmtTime, t } from '../i18n';

/**
 * The table of a dine-in bill, picked from the outlet's tables. Free tables are tiles to tap; a table with a held bill
 * shows when it was taken and cannot be picked, except the one this bill already sits on.
 */
export function TablePicker({ outletId, current, onPick }: { outletId: string; current: string; onPick: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [failed, setFailed] = useState(false);

  const show = async () => {
    setOpen(true);
    setFailed(false);
    try {
      setRows(await fetchTables(outletId));
      setFromCache(false);
    } catch {
      const copy = await cachedTables(outletId);
      setRows(copy);
      setFromCache(true);
      setFailed(!copy);
    }
  };

  const pick = async (name: string) => {
    await onPick(name);
    setOpen(false);
  };

  return (
    <>
      <Tap
        accessibilityRole="button"
        accessibilityLabel={current ? t('Meja {n}', { n: current }) : t('Pilih meja')}
        onPress={show}
        className="h-[44px] flex-row items-center gap-2 rounded-k px-3"
        style={({ pressed }) => ({ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: pressed ? colors.tint : colors.slip })}
      >
        <Text numberOfLines={1} className={`min-w-0 flex-1 text-body ${current ? 'font-body-600' : 'text-mute'}`}>
          {current ? t('Meja {n}', { n: current }) : t('Pilih meja')}
        </Text>
        <Icon name="chevron-down" size={18} />
      </Tap>
      <Sheet visible={open} onClose={() => setOpen(false)} label={t('Pilih meja')}>
        <SheetHeader title={t('Pilih meja')} onClose={() => setOpen(false)} />
        <SheetBody>
          {fromCache && rows ? (
            <Text className="mb-2 text-small text-mute">{t('Daftar dari perangkat. Keadaan meja bisa sudah berubah.')}</Text>
          ) : null}
          {failed ? <Text className="py-6 text-center text-body text-mute">{t('Daftar meja butuh internet. Buka sekali saat ada internet.')}</Text> : null}
          {rows && rows.length === 0 ? (
            <Text className="py-6 text-center text-body text-mute">{t('Belum ada meja. Minta pemilik menambah meja di BackOffice.')}</Text>
          ) : null}
          <View className="flex-row flex-wrap justify-between gap-y-2.5 pb-2">
            {(rows ?? []).map((r) => {
              const own = r.name === current;
              const blocked = r.occupied && !own;
              return (
                <Tap
                  key={r.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: own, disabled: blocked }}
                  accessibilityLabel={`${t('Meja {n}', { n: r.name })}, ${blocked ? t('terisi') : t('kosong')}`}
                  disabled={blocked}
                  onPress={() => pick(r.name)}
                  className="min-h-[56px] justify-center rounded-k px-3.5 py-2"
                  style={({ pressed }) => ({
                    width: '48%',
                    borderWidth: 1.5,
                    borderColor: colors.ink,
                    backgroundColor: own ? colors.pine : blocked ? colors.tint : pressed ? colors.tint : colors.slip,
                  })}
                >
                  <Text numberOfLines={1} className={`font-body-600 text-body ${own ? 'text-slip' : blocked ? 'text-mute' : ''}`}>
                    {t('Meja {n}', { n: r.name })}
                  </Text>
                  <Text numberOfLines={1} className={`text-small ${own ? 'text-slip' : 'text-mute'}`}>
                    {blocked ? t('Terisi sejak {n}', { n: r.since ? fmtTime(r.since) : '-' }) : own ? t('Bill ini') : t('Kosong')}
                  </Text>
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
