import { useEffect, useState } from 'react';
import { Tap } from '../../components/Tap';
import { ScrollView, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Card, Label, Tabs, Tag } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Header } from '../../components/chrome';
import { useLayout } from '../../hooks/useLayout';
import { useShellStore } from '../../hooks/AppStore';
import { useNotify } from '../../hooks/NotifyProvider';
import { planLabel, useSubscription } from '../../services/subscription/subscription';
import { setCatalogView, useCatalogView } from '../../services/prefs/catalogView';
import { loadPrinters } from '../../services/printer/registry';
import { BRAND } from '../../brand';
import { colors } from '../../theme';
import { fmtDate, t, useT } from '../../i18n';

function Row({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 py-2"
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.tint : 'transparent' })}
    >
      <View className="min-w-0 flex-1">
        <Text className="font-body-600 text-[15px]">{title}</Text>
        <Text className="mt-0.5 text-[13px] text-mute">{sub}</Text>
      </View>
      <Icon name="chevron-right" size={20} />
    </Tap>
  );
}

/** Lainnya (DESIGN I5.16): cashier, read-only subscription, device settings, catalog pointer, about, sign out. */
export function MoreScreen({
  onQueue,
  onBell,
  onOpenPrinter,
  onSwitchCashier,
  onSignOut,
}: {
  onQueue: () => void;
  onBell: () => void;
  onOpenPrinter: () => void;
  onSwitchCashier: () => void;
  onSignOut: () => void;
}) {
  const { lang, setLang } = useT();
  const notify = useNotify();
  const { wide } = useLayout();
  const { session, shift } = useShellStore();
  const { status } = useSubscription();
  const view = useCatalogView();
  const [printers, setPrinters] = useState({ ready: 0, all: 0 });
  useEffect(() => {
    void loadPrinters().then((p) => setPrinters({ all: p.length, ready: p.filter((x) => x.enabled && x.status === 'connected').length }));
  }, []);

  const totalDays =
    status?.startedAt && status.expiresAt
      ? Math.max(1, Math.round((new Date(status.expiresAt).getTime() - new Date(status.startedAt).getTime()) / 86400000))
      : 30;
  const left = status?.daysLeft ?? 0;
  const forever = status?.planCode === 'unlimited';
  const pointer = () =>
    void notify.dialog({
      title: t('Menu dikelola di backoffice'),
      message: t(
        'Kategori dan produk diubah pemilik di {host}, menu Produk. Kasir melihat perubahannya setelah katalog dimuat ulang (tarik grid menu ke bawah).',
        { host: BRAND.backofficeHost },
      ),
    });

  const cashier = (
    <Card>
      <View className="flex-row items-center gap-3">
        <View className="h-[52px] w-[52px] items-center justify-center rounded-k bg-pine">
          <Text className="font-body-700 text-[22px] text-paper">{(session?.cashierName ?? '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Display size={26} numberOfLines={1}>
            {session?.cashierName ?? '-'}
          </Display>
          <Text className="text-[14px] text-mute" numberOfLines={1}>
            {session?.outletName} · {session?.terminalName}
          </Text>
        </View>
      </View>
      <View className="mt-3 flex-row gap-2">
        <Tag tone="pine" label={t('kasir')} />
        <Tag label={shift ? t('shift {n} buka', { n: shift.shiftNumber }) : t('belum ada shift')} />
      </View>
    </Card>
  );

  const subscription = (
    <Card>
      <Label>{t('Langganan bisnis')}</Label>
      {status ? (
        <>
          <View className="mt-1 flex-row items-end justify-between gap-2">
            <Display size={26}>{planLabel(status)}</Display>
            <Mono className="font-mono-600 text-[15px]" style={{ color: status.state === 'expired' ? colors.error : colors.ink }}>
              {forever ? t('selamanya') : status.state === 'expired' ? t('berakhir') : t('{n} hari lagi', { n: left })}
            </Mono>
          </View>
          {/* Unlimited (migration 065) has no end date, so no countdown bar or date. */}
          {forever ? null : (
            <>
              <View className="mt-2 h-[8px] border border-ink bg-tint2">
                <View className="h-full bg-pine" style={{ width: `${Math.min(100, (left / totalDays) * 100)}%` }} />
              </View>
              <Text className="mt-2 text-[14px] text-mute">{t('Berlaku sampai {date}', { date: status.expiresAt ? fmtDate(status.expiresAt) : '-' })}</Text>
            </>
          )}
        </>
      ) : (
        <Text className="mt-1 text-[14px] text-mute">{t('Status langganan belum dimuat.')}</Text>
      )}
      <Text className="mt-2 text-[14px] text-mute">{t('Pemilik memperpanjang dari backoffice: Pengaturan, tab Langganan. Kasir hanya bisa melihat.')}</Text>
    </Card>
  );

  const device = (
    <Card className="py-2">
      <Label className="mt-1">{t('Perangkat')}</Label>
      <Row
        title={t('Printer')}
        sub={printers.all ? t('{a} dari {b} printer siap', { a: printers.ready, b: printers.all }) : t('Belum ada printer')}
        onPress={onOpenPrinter}
      />
      <View className="border-t border-rule py-3">
        <Text className="font-body-600 text-[15px]">{t('Tampilan katalog')}</Text>
        <Text className="mb-2 mt-0.5 text-[13px] text-mute">
          {view === 'compact'
            ? t('Teks saja: lebih banyak menu per layar, ringan di HP lama.')
            : t('Foto menu dalam bingkai seragam. Menu tanpa foto memakai inisial.')}
        </Text>
        <View style={{ maxWidth: 260 }}>
          <Tabs
            items={[
              { key: 'photo', label: t('Foto') },
              { key: 'compact', label: t('Ringkas') },
            ]}
            value={view}
            onChange={setCatalogView}
          />
        </View>
      </View>
      <View className="border-t border-rule py-3">
        <Text className="font-body-600 text-[15px]">{t('Bahasa')}</Text>
        <Text className="mb-2 mt-0.5 text-[13px] text-mute">{t('Indonesia atau English, disimpan di perangkat ini')}</Text>
        <View style={{ maxWidth: 140 }}>
          <Tabs
            items={[
              { key: 'id', label: 'ID' },
              { key: 'en', label: 'EN' },
            ]}
            value={lang}
            onChange={setLang}
          />
        </View>
      </View>
    </Card>
  );

  const catalog = (
    <Card className="py-2">
      <Label className="mt-1">{t('Katalog')}</Label>
      <Row title={t('Kategori produk')} sub={t('Dikelola di backoffice, menu Produk')} onPress={pointer} />
      <View className="border-t border-rule" />
      <Row title={t('Produk')} sub={t('Dikelola di backoffice, menu Produk')} onPress={pointer} />
    </Card>
  );

  const about = (
    <Card>
      <Label>{t('Tentang')}</Label>
      <Text className="mt-1 font-body-600 text-[15px]">{BRAND.appName}</Text>
      <Text className="mt-0.5 text-[13px] text-mute">{t('Versi {v} · pembaruan otomatis lewat udara', { v: BRAND.version })}</Text>
    </Card>
  );

  const actions = (
    <ButtonRow>
      <Button variant="danger" label={t('Keluar akun')} onPress={onSignOut} />
      <Button variant="pine" label={t('Ganti kasir')} onPress={onSwitchCashier} />
    </ButtonRow>
  );

  return (
    <View className="flex-1 bg-paper">
      <Header title={t('Lainnya')} onQueue={onQueue} onBell={onBell} />
      <ScrollView contentContainerClassName="gap-3 px-3.5 pb-8 pt-3">
        {wide ? (
          <View className="flex-row gap-3">
            <View className="flex-1 gap-3">
              {cashier}
              {subscription}
              {about}
              {actions}
            </View>
            <View className="flex-1 gap-3">
              {device}
              {catalog}
            </View>
          </View>
        ) : (
          <>
            {cashier}
            {subscription}
            {device}
            {catalog}
            {about}
            {actions}
          </>
        )}
      </ScrollView>
    </View>
  );
}
