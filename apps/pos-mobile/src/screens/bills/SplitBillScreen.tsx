import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Mono, Text } from '../../components/Text';
import { Button } from '../../components/Button';
import { Dashed, Stepper } from '../../components/bits';
import { TextField } from '../../components/Field';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { useLayout } from '../../hooks/useLayout';
import { startSplitFromHeld } from '../../services/transaction/splitBills';
import { billWaits, remainingForSplit } from '../../services/transaction/offlineQueue';
import { CartItem } from '../../types/domain';
import { cartTotals, lineGross, splitLineDiscount } from '../../utils/discount';
import { isNetworkError } from '../../utils/errors';
import { colors } from '../../theme';
import { money, t, useT } from '../../i18n';

/**
 * Split bill (DESIGN I5.12, PRD C7): only from a recalled held bill. Offline it works from the server's last count kept on the
 * device, with parts queued in order (remainingForSplit). Each part picks portions;
 * the bill discount is spread over the lines so no rupiah drifts, and the last part takes the remainder.
 */
export function SplitBillScreen({
  parentTransactionId,
  number,
  part,
  onBack,
  onPay,
}: {
  parentTransactionId: string;
  number: string | null;
  part: number;
  onBack: () => void;
  onPay: (items: CartItem[], customer: { name: string; phone: string; table: string }, meta: string) => void;
}) {
  useT();
  const notify = useNotify();
  const { customer, shift } = useAppStore();
  const { phoneLandscape } = useLayout();
  const [items, setItems] = useState<Array<CartItem & { remainingDiscount: number }>>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        // Offline, or a bill the server does not have yet (held on this phone, 054): its check is skipped, the remaining
        // count comes from the device (remainingForSplit).
        if (!billWaits(parentTransactionId))
          await startSplitFromHeld(parentTransactionId).catch((e) => {
            if (!isNetworkError(e)) throw e;
          });
        const next = shift ? await remainingForSplit(shift.id, parentTransactionId) : null;
        if (!next) throw new TypeError('Network request failed'); // no device count for this bill: it needs internet
        if (!live) return;
        setItems(next);
        setPicked({});
        setName('');
      } catch (e) {
        void notify.fail(t('Pisah bill belum bisa dibuka'), e, undefined, {
          hint: isNetworkError(e) ? t('Pisah bill ini perlu internet.') : undefined,
        });
        onBack();
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [parentTransactionId, part]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo<CartItem[]>(
    () =>
      items
        .map(({ remainingDiscount, ...i }) => {
          const quantity = Math.max(0, Math.min(i.quantity, picked[i.productId] ?? 0));
          const d = splitLineDiscount(remainingDiscount, i.quantity, quantity, i.unitPrice * quantity);
          return { ...i, quantity, discount: d > 0 ? { type: 'amount' as const, value: d } : null };
        })
        .filter((i) => i.quantity > 0),
    [items, picked],
  );

  const partTotal = cartTotals(chosen).total;
  const remaining = items.reduce((n, i) => n + lineGross(i) - i.remainingDiscount, 0);
  const step = (id: string, delta: number, max: number) => setPicked((p) => ({ ...p, [id]: Math.max(0, Math.min(max, (p[id] ?? 0) + delta)) }));

  return (
    <Sheet visible onClose={onBack} size="tall" label={t('Pisah bill')}>
      <SheetHeader title={t('Pisah bill')} subtitle={t('{n} · pilih porsi yang dibayar sekarang', { n: number ?? '' })} onClose={onBack} />
      <SheetBody>
        {loading ? (
          <View className="items-center py-10" accessibilityLabel={t('Memuat data...')}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : items.length === 0 ? (
          <Text className="py-8 text-center text-body text-mute">{t('Semua porsi bill ini sudah dibayar.')}</Text>
        ) : (
          <>
            {/* Short landscape screen: totals and the name share one row so the portions start higher. */}
            <View className={phoneLandscape ? 'flex-row items-end gap-2.5' : ''}>
              <View className={`flex-row gap-2.5 ${phoneLandscape ? 'flex-1' : ''}`}>
                <View className="flex-1 rounded-k border-k border-ink bg-slip px-3 py-2.5">
                  <Mono className="text-small text-mute">{t('Sisa bill')}</Mono>
                  <Mono className="font-mono-600 mt-0.5 text-body" numberOfLines={1} adjustsFontSizeToFit>
                    {money(Math.max(0, remaining - partTotal))}
                  </Mono>
                </View>
                <View className="flex-1 rounded-k border-k border-ink bg-fireSoft px-3 py-2.5">
                  <Mono className="text-small text-mute">{t('Bagian {n}', { n: part })}</Mono>
                  <Mono className="font-mono-600 mt-0.5 text-body" numberOfLines={1} adjustsFontSizeToFit>
                    {money(partTotal)}
                  </Mono>
                </View>
              </View>
              <TextField
                containerClassName={phoneLandscape ? 'flex-1' : 'mt-3.5'}
                label={t('Nama di bagian ini')}
                optional
                value={name}
                onChangeText={setName}
                placeholder={t('Andi')}
                maxLength={40}
              />
            </View>
            <View className="mt-2">
              {items.map((i) => {
                const q = picked[i.productId] ?? 0;
                return (
                  <View key={i.productId} className="py-3">
                    <View className="flex-row items-center gap-3">
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={2} className="font-body-600 text-body">
                          {i.name}
                        </Text>
                        <Mono className="mt-0.5 text-small text-mute">
                          {t('{n} sisa', { n: i.quantity - q })} · {money(i.unitPrice)}
                        </Mono>
                        {i.note ? (
                          <View className="mt-1 border-l-[3px] border-fire pl-2">
                            <Text className="text-small">{i.note}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Stepper
                        value={q}
                        label={i.name}
                        onMinus={() => step(i.productId, -1, i.quantity)}
                        onPlus={() => step(i.productId, 1, i.quantity)}
                        minusDisabled={q <= 0}
                        plusDisabled={q >= i.quantity}
                      />
                    </View>
                    <Dashed className="mt-3" />
                  </View>
                );
              })}
            </View>
          </>
        )}
      </SheetBody>
      <ActionFooter>
        {items.length && !loading ? (
          <Button
            size="lg"
            variant="fire"
            label={chosen.length ? t('Bayar bagian ini · {amount}', { amount: money(partTotal) }) : t('Pilih porsi dulu')}
            disabled={!chosen.length}
            onPress={() =>
              onPay(
                chosen,
                { name: name.trim(), phone: '', table: customer.table },
                [customer.table ? t('Meja {n}', { n: customer.table }) : null, t('bagian {n}', { n: part })].filter(Boolean).join(' · '),
              )
            }
          />
        ) : (
          <Button size="lg" label={t('Tutup')} onPress={onBack} />
        )}
      </ActionFooter>
    </Sheet>
  );
}
