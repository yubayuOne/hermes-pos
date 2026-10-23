import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Tap } from '../../components/Tap';
import { AppState, FlatList, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Banner } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { SearchInput } from '../../components/Field';
import { Header } from '../../components/chrome';
import { ChoiceButton } from '../../components/ChoiceSheet';
import { useQueueActions } from '../../components/overlays';
import { useLayout } from '../../hooks/useLayout';
import { useAppStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { fetchCatalog } from '../../services/transaction/repository';
import { invalidateCatalogFreshness, isCatalogFresh, markCatalogFresh } from '../../services/catalog/freshness';
import { clearPendingCheckout, getPendingCheckout } from '../../services/transaction/pendingCheckout';
import { useCheckoutQueue, useQueueSyncing } from '../../services/transaction/useCheckoutQueue';
import { submitCheckout } from '../../services/transaction/offlineQueue';
import { useOnline } from '../../services/network/network';
import { onOtherDevice } from '../../services/device';
import { isUnknownCheckoutOutcome } from '../../utils/errors';
import { isLocked, planLabel, useSubscription } from '../../services/subscription/subscription';
import { useCatalogView } from '../../services/prefs/catalogView';
import { Product } from '../../types/domain';
import { billTotals } from '../../utils/voucher';
import { haptic } from '../../utils/haptics';
import { ProductCard, SkeletonTile, TempItemCard } from './ProductCard';
import { BillPanel, BillSheet } from './BillPanel';
import { TempMenuSheet } from './sheets';
import { LockedScreen } from '../locked/LockedScreen';
import { colors } from '../../theme';
import { fmtDate, money, t, useT } from '../../i18n';

const TEMP = '__temp__';

/** Bill dock on phones (DESIGN I4): 66px pine bar with the item count, table, total, and "Lihat bill". */
function BillDock({ onOpen }: { onOpen: () => void }) {
  const { cart, billDiscount, voucher, customer } = useAppStore();
  if (!cart.length) return null;
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  const total = billTotals(cart, billDiscount, voucher).total;
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={t('Lihat bill, {n} item, {total}', { n: count, total: money(total) })}
      onPress={onOpen}
      className="mx-3 mb-2 h-[66px] flex-row items-center gap-3 rounded-k border-k border-ink px-2.5"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.pineHover : colors.pine })}
    >
      <View className="h-[44px] min-w-[44px] items-center justify-center rounded-k border-k border-ink bg-fire px-1">
        <Mono className="font-mono-600 text-[17px]">{count}</Mono>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[13px] text-pineText" numberOfLines={1}>
          {customer.table ? t('Bill · Meja {n}', { n: customer.table }) : t('Bill')}
        </Text>
        <Mono className="font-mono-600 text-[21px] text-paper">{money(total)}</Mono>
      </View>
      <Text className="font-body-600 text-[15px] text-paper">{t('Lihat bill')}</Text>
      <Icon name="chevron-up" size={20} color={colors.paper} />
    </Tap>
  );
}

/**
 * The menu grid, memoized: it renders again only when its props change (the list, a quantity, the lock), not on
 * every search keystroke, banner or queue change of the screen around it.
 */
const ProductGrid = memo(function ProductGrid({
  data,
  columns,
  photo,
  photoHeight,
  cardMin,
  landscape,
  locked,
  qtyById,
  onAdd,
  onTemp,
  onRefresh,
  lang,
  bottomPad,
  hasProducts,
}: {
  data: Array<Product | { id: string }>;
  columns: number;
  photo: boolean;
  photoHeight: number;
  cardMin: number;
  landscape: boolean;
  locked: boolean;
  qtyById: Map<string, number>;
  onAdd: (p: Product) => void;
  onTemp: () => void;
  onRefresh: () => void;
  lang: string;
  bottomPad: number;
  hasProducts: boolean;
}) {
  return (
    <FlatList
      data={data}
      key={`grid-${columns}-${photo ? 'p' : 'c'}`}
      numColumns={columns}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      refreshing={false}
      onRefresh={onRefresh}
      contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: bottomPad, gap: 10 }}
      columnWrapperStyle={{ gap: 10 }}
      extraData={qtyById}
      renderItem={({ item }) => (
        <View style={{ flex: 1 / columns }}>
          {item.id === TEMP ? (
            <TempItemCard minHeight={cardMin} disabled={locked} onPress={onTemp} />
          ) : (
            <ProductCard
              product={item as Product}
              qty={qtyById.get(item.id) ?? 0}
              photo={photo}
              photoHeight={photoHeight}
              landscape={landscape}
              locked={locked}
              onAdd={onAdd}
              lang={lang}
            />
          )}
        </View>
      )}
      ListEmptyComponent={
        <Text className="py-10 text-center text-[15px] text-mute">
          {hasProducts ? t('Menu tidak ditemukan. Coba kata lain.') : t('Belum ada menu. Pemilik menambahkannya di backoffice, menu Produk.')}
        </Text>
      }
    />
  );
});

export function SellScreen({
  active = true,
  onPay,
  onSplit,
  onOpenShift,
  onQueue,
  onBell,
  onOpenBills,
  openBillRequest,
}: {
  active?: boolean;
  onPay: () => void;
  onSplit: () => void;
  onOpenShift: () => void;
  onQueue: () => void;
  onBell: () => void;
  onOpenBills: () => void;
  openBillRequest: number;
}) {
  const { lang } = useT();
  const notify = useNotify();
  const { wide, tablet, phoneLandscape, columns } = useLayout();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const { session, products, categories, setCatalog, cart, categoryId, setCategoryId, addProduct, shift, replaceCart, bumpHeld } = store;
  const { status } = useSubscription();
  const view = useCatalogView();
  const queue = useCheckoutQueue().filter((e) => e.outletId === session?.outletId);
  const syncing = useQueueSyncing();
  const online = useOnline();
  // The shift belongs to another phone (051): this one cannot sell into it, online or queued.
  const otherDevice = onOtherDevice(shift);
  const { sync } = useQueueActions();

  // Search stays in this screen: typing re-renders the grid only, not the whole app. The grid filters on a
  // deferred copy so the keyboard never waits for it.
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const [loading, setLoading] = useState(!products.length);
  const [loadError, setLoadError] = useState(false);
  const [tick, setTick] = useState(0);
  const [billOpen, setBillOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [reminderHidden, setReminderHidden] = useState(false);
  const [pending, setPending] = useState<{ kind: string } | null>(null);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (openBillRequest > 0 && !wide) setBillOpen(true);
  }, [openBillRequest, wide]);

  useEffect(() => {
    if (!session) return;
    getPendingCheckout()
      .then((p) => {
        if (p && p.cashierId === session.cashierId && p.outletId === session.outletId) setPending({ kind: p.kind });
      })
      .catch(() => undefined);
  }, [session?.cashierId, session?.outletId]);

  // Catalog: from cache when the request fails (PRD C1). Skeleton while loading, error box with Coba lagi.
  useEffect(() => {
    if (!session) return;
    if (products.length > 0 && isCatalogFresh(session.outletId) && tick === 0) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setLoadError(false);
    fetchCatalog(session.outletId)
      .then((data) => {
        if (live) {
          setCatalog(data.products, data.categories);
          markCatalogFresh(session.outletId);
        }
      })
      .catch(() => {
        if (live) setLoadError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session?.outletId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable callbacks: the grid and the bill panel are memoized and skip renders (e.g. each search keystroke).
  const retry = useCallback(() => {
    if (session) invalidateCatalogFreshness(session.outletId);
    setTick((n) => n + 1);
  }, [session?.outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  const openTemp = useCallback(() => setTempOpen(true), []);

  // Menu changes made in the backoffice reach the till without a restart: refresh quietly every 60 s
  // while Jual is open and whenever the app comes back to the foreground. Pull down on the grid refreshes now.
  useEffect(() => {
    // SellScreen remains mounted to preserve scroll/search state while tabs change.
    // Do not poll or refresh the catalogue while it is hidden behind another tab.
    if (!session || !active) return;
    const outletId = session.outletId;
    let live = true;
    let busy = false;
    const refresh = () => {
      if (!live || !active || busy) return;
      busy = true;
      fetchCatalog(outletId)
        .then((data) => {
          if (!live || !active) return;
          setCatalog(data.products, data.categories);
          markCatalogFresh(outletId);
          setLoadError(false);
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    };
    const timer = setInterval(refresh, 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      live = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [session?.outletId, active, setCatalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const qtyById = useMemo(() => {
    const m = new Map<string, number>();
    cart.forEach((i) => m.set(i.productId, i.quantity));
    return m;
  }, [cart]);

  const hasPhotos = products.some((p) => !!p.imageUrl);
  const photo = view === 'photo' && hasPhotos;
  const photoHeight = phoneLandscape ? 58 : tablet ? 104 : 88;
  const cardMin = photo ? photoHeight + 74 : phoneLandscape ? 100 : 112;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list: Array<Product | { id: string }> = products.filter(
      (p) => (!categoryId || p.categoryId === categoryId) && (!q || p.name.toLowerCase().includes(q)),
    );
    // 'lainnya' ("other") is the owner's catch-all category name.
    const isOtherCategory = categories.find((c) => c.id === categoryId)?.name.toLowerCase() === 'lainnya';
    if (!q && (!categoryId || isOtherCategory)) list.push({ id: TEMP });
    return list;
  }, [products, categoryId, query, categories]);

  const add = useCallback(
    (p: Product) => {
      if (!shift || otherDevice) return;
      addProduct(p);
      haptic.select();
    },
    [shift, otherDevice, addProduct],
  );

  const hasCart = cart.length > 0;
  const pay = useCallback(() => {
    if (!hasCart) return;
    setBillOpen(false);
    if (!shift) {
      onOpenShift();
      return;
    }
    onPay();
  }, [hasCart, shift, onOpenShift, onPay]);
  const closeBill = useCallback(() => setBillOpen(false), []);
  const splitFromSheet = useCallback(() => {
    setBillOpen(false);
    onSplit();
  }, [onSplit]);
  const openShiftFromSheet = useCallback(() => {
    setBillOpen(false);
    onOpenShift();
  }, [onOpenShift]);

  // ---------------------------------------------------------------- banners (DESIGN I5.4)
  const waiting = queue.filter((e) => e.status === 'waiting');
  const rejected = queue.filter((e) => e.status === 'conflict');
  // Payments only: a queued held bill has not been paid, and an expense is money out.
  const waitingPaid = waiting.reduce((n, e) => n + ((e.kind ?? 'checkout') === 'checkout' ? e.total : 0), 0);
  const networkBanner = pending ? (
    <Banner
      tone="error"
      title={t('Pembayaran belum terkonfirmasi')}
      compact={phoneLandscape}
      message={phoneLandscape ? null : t('Jangan buat bill baru. Lanjutkan bill yang tersimpan.')}
    >
      <ButtonRow>
        <Button
          size="sm"
          variant="danger"
          label={t('Hapus data')}
          onPress={async () => {
            const ok = await notify.confirm({
              title: t('Hapus data pemulihan?'),
              message: t('Lakukan ini hanya kalau Anda yakin pembayaran itu tidak tercatat di server.'),
              confirmLabel: t('Hapus data'),
              destructive: true,
            });
            if (!ok) return;
            await clearPendingCheckout().catch(() => undefined);
            setPending(null);
          }}
        />
        <Button
          size="sm"
          variant="pine"
          label={t('Lanjutkan')}
          loading={resuming}
          onPress={async () => {
            const p = await getPendingCheckout();
            if (!p) {
              setPending(null);
              return;
            }
            if (p.kind === 'split') {
              void notify.warning(
                t('Bagian pisah bill belum terkonfirmasi'),
                t('Buka Pisah bill di tab Bill dan lanjutkan bagian yang belum dibayar.'),
              );
              return;
            }
            // Resend the stored request with its own key: if the first attempt went through, the server returns
            // that bill instead of recording a second one. Paying again from the cart would use a new key.
            setResuming(true);
            try {
              const r = await submitCheckout(p);
              await clearPendingCheckout().catch(() => undefined);
              setPending(null);
              if (p.existingTransactionId) bumpHeld();
              notify.success(t('Pembayaran tercatat.'), t('Bill {n}. Struk bisa dicetak ulang dari tab Bill.', { n: r.transactionNumber }));
            } catch (e) {
              if (isUnknownCheckoutOutcome(e)) {
                void notify.warning(t('Server belum terjangkau'), t('Coba Lanjutkan lagi saat internet kembali.'));
                return;
              }
              // Refused, so the first attempt was never recorded: put the bill back to be paid normally.
              await clearPendingCheckout().catch(() => undefined);
              setPending(null);
              if (!cart.length && !p.existingTransactionId && shift?.id === p.shiftId) replaceCart(p.items, p.customer, p.billDiscount ?? null);
              void notify.fail(t('Pembayaran ditolak'), e);
            } finally {
              setResuming(false);
            }
          }}
        />
      </ButtonRow>
    </Banner>
  ) : rejected.length ? (
    <Banner
      tone="error"
      title={t('{n} entri ditolak server', { n: rejected.length })}
      compact={phoneLandscape}
      message={phoneLandscape ? null : t('Perlu ditinjau. Uang sudah diterima, jadi data tidak dihapus otomatis.')}
    >
      <ButtonRow>
        <Button size="sm" label={t('Tinjau')} onPress={onQueue} />
      </ButtonRow>
    </Banner>
  ) : waiting.length ? (
    <Banner
      tone="fire"
      title={t('{n} entri menunggu sinkron', { n: waiting.length })}
      compact={phoneLandscape}
      message={
        phoneLandscape
          ? null
          : waitingPaid
            ? t('{amount} tersimpan di perangkat. Dikirim otomatis saat internet kembali.', { amount: money(waitingPaid) })
            : t('Antrean tetap aman di perangkat dan dicoba lagi otomatis.')
      }
    >
      <ButtonRow>
        <Button size="sm" label={t('Tinjau')} onPress={onQueue} />
        <Button size="sm" variant="pine" label={syncing ? t('Mengirim...') : t('Sinkronkan')} loading={syncing} onPress={() => void sync()} />
      </ButtonRow>
    </Banner>
  ) : !online && phoneLandscape ? (
    // The header chip is left out in phone landscape, so the row says it here.
    <Banner tone="slip" compact title={t('Offline. Penjualan disimpan di perangkat dan dikirim saat internet kembali.')} />
  ) : null;

  const reminder =
    !networkBanner && !reminderHidden && !phoneLandscape && status && status.state !== 'expired' && (status.state === 'trial' || status.daysLeft <= 7) ? (
      <Banner
        tone="fire"
        title={
          status.state === 'trial' ? t('Trial berakhir {n} hari lagi', { n: status.daysLeft }) : t('Langganan berakhir {n} hari lagi', { n: status.daysLeft })
        }
        message={
          wide && !phoneLandscape
            ? t('Paket {plan} berlaku sampai {date}. Pemilik memperpanjang di backoffice.', {
                plan: planLabel(status),
                date: status.expiresAt ? fmtDate(status.expiresAt) : '-',
              })
            : null
        }
        onClose={() => setReminderHidden(true)}
        closeLabel={t('Tutup pengingat')}
      />
    ) : null;

  const shiftBanner = !shift ? (
    <Banner
      tone="slip"
      title={t('Shift belum dibuka')}
      compact={phoneLandscape}
      message={phoneLandscape ? null : t('Buka shift dengan kas awal untuk mulai jualan.')}
    >
      <ButtonRow>
        <Button size="sm" variant="fire" label={t('Buka shift')} onPress={onOpenShift} />
      </ButtonRow>
    </Banner>
  ) : otherDevice ? (
    <Banner
      tone="error"
      compact={phoneLandscape}
      title={t('Shift ini dibuka di HP lain.')}
      message={phoneLandscape ? null : t('Jualan hanya bisa di HP itu. Pemilik bisa memindahkannya di tab Shift.')}
    >
      <ButtonRow>
        <Button size="sm" label={t('Buka tab Shift')} onPress={onOpenShift} />
      </ButtonRow>
    </Banner>
  ) : null;

  const locked = isLocked(status);
  // Search and a category button that opens every category in one sheet: no sideways strip to swipe, on any screen.
  const searchRow = (
    <View className="flex-row items-center gap-2">
      <View className="min-w-0 flex-1">
        <SearchInput value={search} onChangeText={setSearch} placeholder={t('Cari menu')} />
      </View>
      <View style={{ width: 140 }}>
        <ChoiceButton
          title={t('Kategori')}
          options={[{ key: '', label: t('Semua') }, ...categories.map((c) => ({ key: c.id, label: c.name }))]}
          value={categoryId ?? ''}
          onChange={(k) => setCategoryId(k || null)}
        />
      </View>
    </View>
  );
  // Phone landscape has about 410px of height: search and categories share the header row and the title goes
  // (the rail already marks the tab; the cashier and shift show in the bill panel).
  const header = <Header title={t('Jual')} onQueue={onQueue} onBell={onBell} center={phoneLandscape ? searchRow : undefined} />;
  const hasBanner = !!(networkBanner || reminder || shiftBanner);

  if (locked) {
    return (
      <View className="flex-1 bg-paper">
        <Header title={t('Jual')} onQueue={onQueue} onBell={onBell} />
        <LockedScreen onOpenBills={onOpenBills} />
      </View>
    );
  }

  const grid = (
    <View className="flex-1">
      {loading && !products.length ? (
        <View accessibilityRole="progressbar" accessibilityLabel={t('Memuat data...')} className="flex-row flex-wrap px-3.5 pt-1" style={{ gap: 10 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={{ width: `${100 / columns - 3}%`, flexGrow: 1 }}>
              <SkeletonTile height={cardMin} />
            </View>
          ))}
        </View>
      ) : loadError && !products.length ? (
        <View className="mx-3.5 mt-1">
          <Banner tone="error" title={t('Menu belum bisa dimuat.')} message={t('Periksa internet. Bill yang sedang dibuat tidak terganggu.')}>
            <ButtonRow>
              <Button size="sm" variant="pine" label={t('Coba lagi')} onPress={retry} />
            </ButtonRow>
          </Banner>
        </View>
      ) : (
        <ProductGrid
          data={visible}
          columns={columns}
          photo={photo}
          photoHeight={photoHeight}
          cardMin={cardMin}
          landscape={phoneLandscape}
          locked={!shift || otherDevice}
          qtyById={qtyById}
          onAdd={add}
          onTemp={openTemp}
          onRefresh={retry}
          lang={lang}
          bottomPad={16 + (wide ? insets.bottom : 0)}
          hasProducts={products.length > 0}
        />
      )}
    </View>
  );

  const content = (
    <View className="flex-1 bg-paper">
      {header}
      {!phoneLandscape || hasBanner ? (
        <View className={`gap-2.5 px-3.5 ${phoneLandscape ? 'pb-2 pt-2' : 'pb-2.5 pt-3'}`}>
          {networkBanner}
          {reminder}
          {shiftBanner}
          {phoneLandscape ? null : searchRow}
        </View>
      ) : (
        <View className="h-2" />
      )}
      {grid}
      {!wide ? <BillDock onOpen={() => setBillOpen(true)} /> : null}
    </View>
  );

  return (
    <View className="flex-1 flex-row">
      {content}
      {wide ? <BillPanel onPay={pay} onSplit={onSplit} onOpenShift={onOpenShift} /> : null}
      {!wide ? <BillSheet visible={billOpen && active} onClose={closeBill} onPay={pay} onSplit={splitFromSheet} onOpenShift={openShiftFromSheet} /> : null}
      <TempMenuSheet visible={tempOpen && active} onClose={() => setTempOpen(false)} />
    </View>
  );
}
