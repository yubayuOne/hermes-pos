import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Mono, Text } from '../../components/Text';
import { Button, ButtonRow, IconButton } from '../../components/Button';
import { Chip, Label } from '../../components/bits';
import { TextField } from '../../components/Field';
import { Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { recordExpense } from '../../services/transaction/repository';
import { CHECKOUT_TIMEOUT_MS, enqueueCheckout, queueFirst, waitsForQueue, withTimeout } from '../../services/transaction/offlineQueue';
import { refreshSubscription } from '../../services/subscription/subscription';
import { describeError, isExpiredError, isNetworkError } from '../../utils/errors';
import { checkLines, emptyLine, ExpenseLine, parseAmount } from '../../utils/expense';
import { haptic } from '../../utils/haptics';
import { colors } from '../../theme';
import { money, num, t, useT } from '../../i18n';

type RowErrors = Partial<Record<keyof ExpenseLine, string>>;

/**
 * Catat pengeluaran (migrations 040, 041, 043): one or more notes, each with a name, operasional or belanja, and the total paid.
 * The quantity is 1 pcs, so the note is only what was bought, and the owner does not need to match it to stock. They join the shift's one expense record and count at once; from
 * the drawer they leave the shift's cash at once. No owner approval; the owner can edit it on the web. Offline: stored in
 * the offline queue with the same key and sent when the internet is back, so it is recorded once.
 */
export function ExpenseSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  useT();
  const notify = useNotify();
  const { shift, session } = useAppStore();
  const [lines, setLines] = useState<ExpenseLine[]>([emptyLine()]);
  const [errors, setErrors] = useState<RowErrors[]>([]);
  // The cashier's expenses always come out of the drawer (owner's decision, 23 Oct 2026); other money is the owner's in the backoffice.
  const paidFrom = 'drawer' as const;
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const key = useRef('');
  useEffect(() => {
    if (!visible) return;
    setLines([emptyLine()]);
    setErrors([]);
    setFormError('');
    // One key per opened sheet: a retry after a lost response records once.
    key.current = `expense:${session?.cashierId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = lines.reduce((n, l) => n + (parseAmount(l.amount) ?? 0), 0);
  const set = (i: number, patch: Partial<ExpenseLine>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setErrors((es) => es.map((e, j) => (j === i ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))) : e)));
    setFormError('');
  };

  const submit = async () => {
    if (!shift || !session || saving) return;
    const checked = checkLines(lines);
    setErrors(checked.errors);
    if (!checked.items) return;
    setSaving(true);
    const args = { shiftId: shift.id, cashierId: session.cashierId, outletId: session.outletId, paidFrom, items: checked.items, idempotencyKey: key.current };
    try {
      if (waitsForQueue(shift.id)) throw queueFirst();
      await withTimeout(recordExpense(args), CHECKOUT_TIMEOUT_MS);
      haptic.heavy();
      notify.success(t('Pengeluaran tercatat'), t('{amount} keluar dari kas laci dan masuk laporan shift.', { amount: money(total) }));
      onSaved();
    } catch (err) {
      if (isExpiredError(err)) void refreshSubscription().catch(() => undefined);
      if (!isNetworkError(err)) {
        setFormError(describeError(err).message);
        return;
      }
      try {
        // Same key as the request that may have reached the server: the server records it once either way.
        await enqueueCheckout({
          ...args,
          kind: 'expense',
          items: [],
          customer: { name: '', phone: '', table: '' },
          payment: { method: 'cash', amountReceived: 0 },
          total,
          expense: { paidFrom, items: checked.items },
        });
        haptic.heavy();
        notify.success(t('Pengeluaran disimpan di perangkat'), t('{amount} terkirim otomatis saat internet kembali.', { amount: money(total) }));
        onSaved();
      } catch (qe) {
        setFormError(describeError(qe, t('Pengeluaran belum tersimpan. Coba lagi.')).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="tall"
      label={t('Catat pengeluaran')}
    >
      <SheetHeader title={t('Catat pengeluaran')} subtitle={t('Belanja bahan atau biaya operasional outlet.')} onClose={onClose} />
      <SheetBody contentClassName="gap-3.5 pb-8">
        <Text className="text-[14px] text-mute">{t('Uang dari laci? Catat di sini. Belanja dengan uang lain? Catat di menu Belanja di BackOffice.')}</Text>
        {lines.map((l, i) => {
          const e = errors[i] ?? {};
          return (
            <View key={i} className="gap-3 rounded-k border-k border-ink bg-slip px-3 py-3">
              <View className="flex-row items-center justify-between">
                <Label>{t('Barang {n}', { n: i + 1 })}</Label>
                {lines.length > 1 ? (
                  <IconButton
                    icon="trash"
                    label={t('Hapus barang {n}', { n: i + 1 })}
                    onPress={() => {
                      setLines((ls) => ls.filter((_, j) => j !== i));
                      setErrors((es) => es.filter((_, j) => j !== i));
                    }}
                  />
                ) : null}
              </View>
              <TextField
                label={t('Catatan: yang dibeli atau dibayar')}
                value={l.name}
                onChangeText={(v) => set(i, { name: v })}
                placeholder={t('Gula pasir, galon, listrik')}
                maxLength={60}
                error={e.name ? t(e.name) : null}
              />
              <View className="flex-row gap-2">
                <Chip grow label={t('Belanja')} selected={l.category === 'belanja'} onPress={() => set(i, { category: 'belanja' })} />
                <Chip grow label={t('Operasional')} selected={l.category === 'operasional'} onPress={() => set(i, { category: 'operasional' })} />
              </View>
              <TextField
                label={t('Harga total')}
                value={l.amount ? num(Number(l.amount)) : ''}
                onChangeText={(v) => set(i, { amount: v.replace(/\D/g, '').replace(/^0+/, '') })}
                keyboardType="number-pad"
                mono
                maxLength={13}
                placeholder="0"
                help={t('Total yang dibayar. Satu catatan, tanpa jumlah dan satuan.')}
                error={e.amount ? t(e.amount) : null}
              />
            </View>
          );
        })}
        {lines.length < 30 ? (
          <Button icon="plus" label={t('Tambah barang')} onPress={() => setLines((ls) => [...ls, emptyLine(ls[ls.length - 1]?.category)])} />
        ) : null}

        <Text className="text-[14px] text-mute">{t('Dari kas laci. Mengurangi kas seharusnya di shift ini sekarang juga.')}</Text>
        <View
          accessibilityLiveRegion="polite"
          className="flex-row items-center justify-between rounded-k px-3.5 py-3"
          style={{ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.tint3 }}
        >
          <Text className="font-body-600 text-[15px]">{t('Total pengeluaran')}</Text>
          <Mono className="font-mono-600 ml-3 min-w-0 flex-1 text-right text-[16px]" numberOfLines={1} adjustsFontSizeToFit>
            {money(total)}
          </Mono>
        </View>
        <Text className="text-[14px] text-mute">
          {t('Langsung masuk laporan shift ini tanpa persetujuan. Pemilik bisa mengubahnya di backoffice. Tanpa internet, disimpan dulu di perangkat.')}
        </Text>
        {formError ? (
          <Text accessibilityRole="alert" className="font-body-600 text-[14px] text-error">
            {formError}
          </Text>
        ) : null}
        {/* Last in the scroll, not a pinned footer: a footer rides up with the keyboard and gets tapped before the fields above it are seen. */}
        <ButtonRow>
          <Button label={t('Batal')} disabled={saving} onPress={onClose} />
          <Button
            variant="fire"
            grow={1.6}
            label={saving ? t('Menyimpan...') : t('Catat {amount}', { amount: money(total) })}
            loading={saving}
            onPress={() => void submit()}
          />
        </ButtonRow>
      </SheetBody>
    </Sheet>
  );
}
