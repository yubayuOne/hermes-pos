import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Tap } from '../../components/Tap';
import { Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Banner, Card, Chip } from '../../components/bits';
import { TextField } from '../../components/Field';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useAppStore } from '../../hooks/AppStore';
import { createTemporaryProduct, loadVouchers } from '../../services/transaction/repository';
import { Product, ProductStation, Voucher } from '../../types/domain';
import { enqueueCheckout } from '../../services/transaction/offlineQueue';
import { randomUUID } from 'expo-crypto';
import { digitsOnly } from '../../utils/money';
import { applyVoucher } from '../../utils/voucher';
import { describeError, isNetworkError } from '../../utils/errors';
import { useNotify } from '../../hooks/NotifyProvider';
import { haptic } from '../../utils/haptics';
import { colors } from '../../theme';
import { money, t, useT } from '../../i18n';

/**
 * Voucher (PRD C5, migration 044): the cashier picks one from the outlet's usable vouchers. The server checks it again
 * at checkout. Offline, today's last loaded list is used (owner's choice, 16 Oct 2026); a voucher that ran out in the
 * meantime makes the queued payment a conflict for the cashier to review.
 */
export function VoucherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useT();
  const notify = useNotify();
  const { session, cart, billDiscount, voucher, setVoucher, clearManualDiscounts } = useAppStore();
  // A held bill from before vouchers may still carry a manual discount. The voucher replaces it.
  const manual = !!billDiscount || cart.some((i) => !!i.discount);
  const plain = useMemo(() => (manual ? cart.map((i) => (i.discount ? { ...i, discount: null } : i)) : cart), [cart, manual]);
  const [list, setList] = useState<Voucher[] | null>(null);
  const [found, setFound] = useState<Voucher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const load = async () => {
    if (!session) return;
    setList(null);
    setError(null);
    setStale(false);
    try {
      // From the local database; `fresh` false = offline, the last synced list (the server checks again at checkout).
      const { list: next, fresh } = await loadVouchers(session.outletId);
      setList(next);
      setStale(!fresh);
    } catch (e) {
      haptic.error();
      setError(describeError(e).message);
    }
  };
  useEffect(() => {
    if (!visible) return;
    setFound(null);
    if (!voucher) void load();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => (found ? applyVoucher(plain, null, found) : null), [found, plain]);

  const describe = (v: Voucher) =>
    [
      v.discountType === 'percent' ? `${v.value}%` : money(v.value),
      v.scope === 'bill' ? t('seluruh bill') : t('menu tertentu'),
      v.minSpend > 0 ? t('min. belanja {amount}', { amount: money(v.minSpend) }) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Sheet visible={visible} onClose={onClose} label={t('Voucher')}>
      <SheetHeader title={t('Voucher')} subtitle={t('Pilih satu voucher untuk bill ini. Server memeriksanya lagi saat bayar.')} onClose={onClose} />
      <SheetBody contentClassName="gap-2.5">
        {voucher ? (
          <Card className="bg-pineSoft">
            <Mono className="font-mono-600 text-[15px]">{voucher.code}</Mono>
            <Text className="mt-1 text-[14px] text-mute">{describe(voucher)}</Text>
          </Card>
        ) : error ? (
          <>
            <Text accessibilityRole="alert" className="font-body-600 text-[14px] text-error">
              {error}
            </Text>
            <Button label={t('Coba lagi')} onPress={() => void load()} />
          </>
        ) : list === null ? (
          <View className="items-center py-6" accessibilityLabel={t('Memuat data...')}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : stale && list.length === 0 ? (
          <Text className="py-6 text-center text-[15px] text-mute">{t('Tidak ada voucher di daftar terakhir. Coba lagi saat online.')}</Text>
        ) : list.length === 0 ? (
          <Text className="py-6 text-center text-[15px] text-mute">{t('Belum ada voucher aktif. Pemilik membuatnya di backoffice, menu Voucher.')}</Text>
        ) : (
          <>
            {stale ? (
              <Banner
                tone="fire"
                title={t('Offline: daftar voucher terakhir hari ini')}
                message={t('Server memeriksa voucher lagi saat pembayaran terkirim. Kalau kuotanya sudah habis, pembayaran itu perlu ditinjau.')}
              />
            ) : null}
            {list.map((v) => {
              const on = found?.code === v.code;
              const bad = on && !!preview?.error;
              return (
                <Tap
                  key={v.code}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${v.code}, ${describe(v)}`}
                  onPress={() => setFound(on ? null : v)}
                  className="min-h-[60px] justify-center rounded-k px-3.5 py-2.5"
                  style={({ pressed }) => ({
                    borderWidth: on ? 2.5 : 1.5,
                    borderColor: bad ? colors.errorLine : colors.ink,
                    backgroundColor: bad ? colors.errorSoft : on ? colors.pineSoft : pressed ? colors.tint : colors.slip,
                  })}
                >
                  <Mono className="font-mono-600 text-[15px]">{v.code}</Mono>
                  <Text className="mt-0.5 text-[14px] text-mute">{describe(v)}</Text>
                  {on ? (
                    preview?.error ? (
                      <Text className="mt-1.5 font-body-600 text-[14px] text-error">{preview.error}</Text>
                    ) : (
                      <Text className="mt-1.5 font-body-600 text-[15px]">
                        {t('Potongan {amount}', { amount: money(preview?.cut ?? 0) })}
                        {manual ? ` · ${t('Diskon lama di bill ini diganti voucher.')}` : ''}
                      </Text>
                    )
                  ) : null}
                </Tap>
              );
            })}
          </>
        )}
      </SheetBody>
      <ActionFooter>
        {voucher ? (
          <ButtonRow>
            <Button label={t('Tutup')} onPress={onClose} />
            <Button
              variant="danger"
              label={t('Lepas voucher')}
              onPress={() => {
                setVoucher(null);
                onClose();
              }}
            />
          </ButtonRow>
        ) : (
          <ButtonRow>
            <Button label={t('Batal')} onPress={onClose} />
            <Button
              variant="fire"
              label={t('Pakai voucher')}
              disabled={!found || !!preview?.error}
              onPress={() => {
                if (!found) return;
                if (manual) clearManualDiscounts();
                setVoucher(found);
                notify.success(t('Voucher {code} dipakai', { code: found.code }));
                onClose();
              }}
            />
          </ButtonRow>
        )}
      </ActionFooter>
    </Sheet>
  );
}

/** Temporary item: one-off menu for this bill. Recorded on the bill and reports, not added to products. */
export function TempMenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useT();
  const notify = useNotify();
  const { session, shift, addProduct } = useAppStore();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState(1);
  const [station, setStation] = useState<ProductStation>('kitchen');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});
  useEffect(() => {
    if (visible) {
      setName('');
      setPrice('');
      setQty(1);
      setStation('kitchen');
      setErrors({});
    }
  }, [visible]);

  const save = async () => {
    if (!session || !shift || saving) return;
    const p = Number(digitsOnly(price));
    const e: typeof errors = {};
    if (!name.trim()) e.name = t('Nama menu wajib diisi.');
    if (!(p > 0)) e.price = t('Harga harus lebih dari Rp0.');
    setErrors(e);
    if (e.name || e.price) return;
    setSaving(true);
    const args = { productId: randomUUID(), cashierId: session.cashierId, outletId: session.outletId, name: name.trim(), price: p, station };
    try {
      let product: Product;
      try {
        product = await createTemporaryProduct(args);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        // Offline: the item waits in the queue ahead of the bill that uses it, with the same id.
        await enqueueCheckout({
          idempotencyKey: `product:${args.productId}`,
          kind: 'temp_product',
          shiftId: shift.id,
          cashierId: args.cashierId,
          outletId: args.outletId,
          items: [],
          customer: { name: '', phone: '', table: '' },
          payment: { method: 'cash', amountReceived: 0 },
          total: 0,
          product: { id: args.productId, name: args.name, price: p, station },
        });
        product = { id: args.productId, categoryId: null, name: args.name, hpp: 0, price: p, stock: 0, trackStock: false, imageUrl: null, station };
      }
      addProduct(product, qty);
      haptic.select();
      notify.success(t('Menu sementara ditambahkan'), `${qty} × ${name.trim()}`);
      onClose();
    } catch (err) {
      void notify.fail(t('Menu sementara belum ditambahkan'), err);
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
      label={t('Menu sementara')}
    >
      <SheetHeader
        title={t('Menu sementara')}
        subtitle={t('Sekali pakai untuk bill ini. Tercatat di bill dan laporan, tidak masuk daftar produk.')}
        onClose={onClose}
      />
      <SheetBody contentClassName="gap-4">
        <TextField
          label={t('Nama menu')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setErrors((x) => ({ ...x, name: undefined }));
          }}
          placeholder={t('Es teh spesial')}
          maxLength={60}
          error={errors.name}
        />
        <TextField
          label={t('Harga')}
          value={price ? Number(price).toLocaleString('id-ID') : ''}
          onChangeText={(v) => {
            setPrice(digitsOnly(v));
            setErrors((x) => ({ ...x, price: undefined }));
          }}
          keyboardType="number-pad"
          placeholder="15.000"
          mono
          error={errors.price}
        />
        <View>
          <Text className="mb-1.5 font-body-600 text-[14px]">{t('Jumlah')}</Text>
          <View className="flex-row gap-2">
            {[1, 2, 3, 4].map((n) => (
              <Chip key={n} label={String(n)} selected={qty === n} onPress={() => setQty(n)} />
            ))}
          </View>
        </View>
        <View>
          <Text className="mb-1.5 font-body-600 text-[14px]">{t('Dicetak di')}</Text>
          <View className="flex-row gap-2">
            <Chip label={t('Dapur')} selected={station === 'kitchen'} onPress={() => setStation('kitchen')} />
            <Chip label={t('Bar')} selected={station === 'bar'} onPress={() => setStation('bar')} />
          </View>
        </View>
      </SheetBody>
      <ActionFooter>
        <ButtonRow>
          <Button label={t('Batal')} disabled={saving} onPress={onClose} />
          <Button variant="fire" label={saving ? t('Menambahkan...') : t('Tambahkan ke bill')} loading={saving} onPress={() => void save()} />
        </ButtonRow>
      </ActionFooter>
    </Sheet>
  );
}
