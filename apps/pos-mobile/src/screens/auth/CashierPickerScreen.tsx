import { useCallback, useEffect, useRef, useState } from 'react';
import { Tap } from '../../components/Tap';
import { ActivityIndicator, Image, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from '../../components/Text';
import { Button } from '../../components/Button';
import { Banner, Tag } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Keypad, PinBoxes } from '../../components/Keypad';
import { Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useLayout } from '../../hooks/useLayout';
import { useNotify } from '../../hooks/NotifyProvider';
import { AppSession, DeviceCashier, PinResult } from '../../types/domain';
import {
  bindOutlet,
  confirmActiveCashier,
  loadDeviceCashierList,
  rememberActiveCashier,
  signOut,
  toSession,
  verifyCashierPin,
} from '../../services/supabase/session';
import { confirmSignOut } from '../../utils/logout';
import { isNetworkError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { BRAND } from '../../brand';
import { colors } from '../../theme';
import { t, useT } from '../../i18n';

const minutesLeft = (until?: string | null) => (until ? Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000)) : 0);

function pinMessage(r: Exclude<PinResult, { ok: true }>): string {
  if (r.reason === 'wrong') return t('PIN salah. Sisa percobaan: {n}.', { n: r.attemptsLeft });
  if (r.reason === 'locked') return t('Terlalu banyak salah. Coba lagi dalam {n} menit.', { n: minutesLeft(r.lockedUntil) });
  if (r.reason === 'no_pin') return t('PIN belum dibuat. Minta pemilik membuatnya di backoffice.');
  return t('Kasir tidak ditemukan. Tarik layar ke bawah untuk memuat ulang.');
}

function CashierRow({ cashier, onPress }: { cashier: DeviceCashier; onPress: () => void }) {
  const locked = minutesLeft(cashier.pinLockedUntil);
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('Kasir {name}', { name: cashier.cashierName })}
      className="min-h-[76px] flex-row items-center gap-3 rounded-k border-k border-ink px-3 py-2.5"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.tint : colors.slip })}
    >
      <View className="h-[44px] w-[44px] items-center justify-center rounded-k bg-pine">
        <Text className="font-body-700 text-[20px] text-paper">{cashier.cashierName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-body-600 text-[17px]">
          {cashier.cashierName}
        </Text>
        <Text numberOfLines={1} className="text-[14px] text-mute">
          {cashier.outletName} · {cashier.terminalName}
        </Text>
        {!cashier.hasPin ? (
          <Tag className="mt-1" label={t('PIN belum dibuat')} tone="fire" />
        ) : locked ? (
          <Tag className="mt-1" label={t('terkunci {n} menit', { n: locked })} tone="error" />
        ) : null}
      </View>
      <Icon name="chevron-right" size={22} />
    </Tap>
  );
}

function OutletRow({ cashier, onPress }: { cashier: DeviceCashier; onPress: () => void }) {
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('Outlet {name}', { name: cashier.outletName })}
      className="min-h-[76px] flex-row items-center gap-3 rounded-k border-k border-ink px-3 py-2.5"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.tint : colors.slip })}
    >
      <Text numberOfLines={2} className="min-w-0 flex-1 font-body-600 text-[17px]">
        {cashier.outletName}
      </Text>
      <Icon name="chevron-right" size={22} />
    </Tap>
  );
}

/**
 * After the owner account signs in, the cashier picks a name and enters the PIN (DESIGN I5.2 and I5.3).
 * The account stays signed in until Keluar akun; Ganti kasir comes back here. With 
esumeCashierId (the app reopened
 * during that cashier's shift) the PIN pad opens for them at once and the PIN is checked on the phone, also offline.
 */
export function CashierPickerScreen({
  accountEmail,
  resumeCashierId,
  onSelected,
  onSignedOut,
}: {
  accountEmail: string;
  resumeCashierId?: string;
  onSelected: (session: AppSession) => void | Promise<void>;
  onSignedOut: () => void;
}) {
  useT();
  const notify = useNotify();
  const insets = useSafeAreaInsets();
  const { phoneLandscape } = useLayout();
  const [cashiers, setCashiers] = useState<DeviceCashier[] | null>(null);
  const outlet = cashiers?.length && cashiers.every((c) => c.outletId === cashiers[0].outletId) ? cashiers[0] : null;
  const [cached, setCached] = useState(false);
  const [needsOutlet, setNeedsOutlet] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [target, setTarget] = useState<DeviceCashier | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await loadDeviceCashierList();
      setCashiers(r.list);
      setCached(r.cached);
      setNeedsOutlet(r.needsOutlet);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setCashiers((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const resumeAsked = useRef(false);
  useEffect(() => {
    const c = resumeCashierId && !resumeAsked.current ? cashiers?.find((x) => x.cashierId === resumeCashierId) : undefined;
    if (!c) return;
    resumeAsked.current = true;
    open(c);
  }, [cashiers, resumeCashierId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickOutlet = async (c: DeviceCashier) => {
    const ok = await notify.confirm({
      title: t('Pakai outlet {name}?', { name: c.outletName }),
      message: t('Untuk pindah outlet, keluar akun lalu masuk lagi.'),
      confirmLabel: t('Pakai outlet ini'),
    });
    if (!ok) return;
    await bindOutlet(c.outletId);
    void load();
  };

  const open = (c: DeviceCashier) => {
    if (!c.hasPin) {
      void notify.warning(t('PIN belum dibuat'), t('Minta pemilik membuat PIN untuk kasir ini di backoffice, menu Kasir.'));
      return;
    }
    const locked = minutesLeft(c.pinLockedUntil);
    setPin('');
    setPinError(locked ? t('Terlalu banyak salah. Coba lagi dalam {n} menit.', { n: locked }) : '');
    setTarget(c);
  };
  const closePin = () => {
    if (!checking) {
      setTarget(null);
      setPin('');
      setPinError('');
    }
  };

  const submit = async (value: string) => {
    if (!target) return;
    setChecking(true);
    setPinError('');
    try {
      const r = target.cashierId === resumeCashierId ? await confirmActiveCashier(target.cashierId, value) : await verifyCashierPin(target.cashierId, value);
      if (r.ok) {
        await rememberActiveCashier(target.cashierId);
        const session = toSession(target);
        setTarget(null);
        setPin('');
        await onSelected(session);
        return;
      }
      haptic.error();
      setPin('');
      setPinError(pinMessage(r));
      if (r.reason === 'locked') void load();
    } catch (e) {
      haptic.error();
      setPin('');
      // Signing in needs the server; only the cashier still on shift is checked on the phone (confirmActiveCashier).
      setPinError(
        isNetworkError(e) ? t('Masuk kasir butuh internet. Sambungkan internet, lalu coba lagi.') : t('PIN tidak bisa diperiksa. Periksa koneksi internet.'),
      );
    } finally {
      setChecking(false);
    }
  };

  const change = (next: string) => {
    setPinError('');
    setPin(next);
    if (next.length === 6) void submit(next);
  };

  const logout = async () => {
    if (!(await confirmSignOut(notify))) return;
    await signOut();
    onSignedOut();
  };

  const pad = <Keypad pin value={pin} onChange={change} maxLength={6} compact={phoneLandscape} disabled={checking} />;
  const status = (
    <View className="min-h-[44px] items-center justify-center px-2" accessibilityLiveRegion="polite">
      {checking ? (
        <Text className="font-body-600 text-[14px] text-mute">{t('Memeriksa PIN...')}</Text>
      ) : pinError ? (
        <Text accessibilityRole="alert" className="text-center font-body-600 text-[14px] text-error">
          {pinError}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-paper" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, alignItems: 'center' }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.ink}
          />
        }
      >
        <View className="w-full" style={{ maxWidth: 460 }}>
          {/* The outlet's own identity, not the app's. A device with cashiers from several outlets names none. */}
          <View className="items-center">
            {outlet?.outletLogoUrl ? (
              <View className="items-center justify-center rounded-k border-k border-ink bg-slip p-2">
                <Image
                  source={{ uri: outlet.outletLogoUrl }}
                  accessibilityIgnoresInvertColors
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  resizeMode="contain"
                  style={{ width: 120, height: 120 }}
                />
              </View>
            ) : null}
            {outlet ? (
              <Display size={34} numberOfLines={2} className="mt-3 text-center">
                {outlet.outletName}
              </Display>
            ) : null}
            <Mono numberOfLines={1} className="mt-1 text-[14px] text-mute">
              {accountEmail}
            </Mono>
          </View>
          <Display size={26} className="mt-6" accessibilityRole="header">
            {needsOutlet ? t('Pilih outlet untuk HP ini') : t('Siapa yang jaga kasir?')}
          </Display>
          {cached ? (
            <Banner
              className="mt-4"
              tone="fire"
              title={t('Tidak ada internet')}
              message={t('Kasir baru perlu internet untuk masuk.')}
            />
          ) : null}
          <View className="mt-4 gap-2.5">
            {cashiers === null ? (
              <View className="items-center py-12" accessibilityLabel={t('Memuat data...')}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : cashiers.length === 0 ? (
              loadError ? (
                <Banner
                  tone="error"
                  title={t('Daftar kasir belum bisa dimuat')}
                  message={t('Periksa internet, lalu tarik layar ke bawah untuk mencoba lagi.')}
                />
              ) : (
                <Banner
                  tone="slip"
                  title={t('Belum ada kasir')}
                  message={t('Pemilik membuat kasir di {host}, menu Kasir. Lalu tarik layar ke bawah.', { host: BRAND.backofficeHost })}
                />
              )
            ) : needsOutlet ? (
              // One row per outlet, taken from its first cashier.
              cashiers
                .filter((c, i) => cashiers.findIndex((x) => x.outletId === c.outletId) === i)
                .map((c) => <OutletRow key={c.outletId} cashier={c} onPress={() => void pickOutlet(c)} />)
            ) : (
              cashiers.map((c) => <CashierRow key={c.cashierId} cashier={c} onPress={() => open(c)} />)
            )}
          </View>
          <Button className="mt-5" variant="danger" label={t('Keluar akun')} onPress={() => void logout()} />
        </View>
      </ScrollView>

      <Sheet visible={!!target} onClose={closePin} label={t('Masukkan PIN')}>
        <SheetHeader title={t('Masukkan PIN')} subtitle={target ? `${target.cashierName} · ${target.outletName}` : undefined} onClose={closePin} />
        <SheetBody>
          {phoneLandscape ? (
            <View className="flex-row gap-4">
              <View className="flex-1 justify-center">
                <PinBoxes count={pin.length} error={!!pinError && !checking} />
                {status}
              </View>
              <View className="flex-1">{pad}</View>
            </View>
          ) : (
            <View className="items-center">
              <PinBoxes count={pin.length} error={!!pinError && !checking} />
              {status}
              <View className="mt-2 w-full" style={{ maxWidth: 360 }}>
                {pad}
              </View>
            </View>
          )}
          <View style={{ height: Math.max(insets.bottom, 20) }} />
        </SheetBody>
      </Sheet>
    </View>
  );
}
