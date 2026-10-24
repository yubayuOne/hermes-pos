import React from 'react';
import { Tap } from './Tap';
import { Image, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from './Text';
import { Icon, IconName } from './Icon';
import { IconButton } from './Button';
import { useLayout } from '../hooks/useLayout';
import { useShellStore } from '../hooks/AppStore';
import { useCheckoutQueue, useQueueSyncing } from '../services/transaction/useCheckoutQueue';
import { useOnline } from '../services/network/network';
import { settlesHeldBill } from '../services/transaction/offlineQueue';
import { useSubscription } from '../services/subscription/subscription';
import { colors, controls } from '../theme';
import { t, useT } from '../i18n';
import { BRAND, BRAND_MARK } from '../brand';

export type Tab = 'sell' | 'bills' | 'shift' | 'more';
const TABS: Array<{ key: Tab; label: string; icon: IconName }> = [
  { key: 'sell', label: 'Jual', icon: 'sell' },
  { key: 'bills', label: 'Bill', icon: 'bill' },
  { key: 'shift', label: 'Shift', icon: 'shift' },
  { key: 'more', label: 'Lainnya', icon: 'more' },
];

/** Bottom bar on phones: 4 tabs, no animation; the active tab has a 4px orange bar on its top edge. */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  useT();
  const insets = useSafeAreaInsets();
  const heldCount = useHeldBadge();
  return (
    <View accessibilityRole="tablist" className="flex-row border-t-k border-ink bg-slip" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {TABS.map((it) => {
        const on = it.key === tab;
        return (
          <Tap
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(it.label)}
            onPress={() => onChange(it.key)}
            className="flex-1 items-center justify-center"
            style={({ pressed }) => ({ height: controls.navHeight, backgroundColor: pressed ? colors.tint : 'transparent' })}
          >
            {on ? <View className="absolute left-[18%] right-[18%] top-0 h-[4px] bg-fire" /> : null}
            <View>
              <Icon name={it.icon} size={22} color={on ? colors.ink : colors.mute} />
              {it.key === 'bills' && heldCount > 0 ? <Badge n={heldCount} /> : null}
            </View>
            <Text className={`mt-1 text-[14px] ${on ? 'font-body-700 text-ink' : 'font-body-600 text-mute'}`}>{t(it.label)}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** Left rail on wide screens (tablet, phone landscape): wordmark and 4 tabs; active is a slip card with an orange square. */
export function Rail({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  useT();
  const insets = useSafeAreaInsets();
  const { railWidth, phoneLandscape } = useLayout();
  const heldCount = useHeldBadge();
  return (
    <View
      accessibilityRole="tablist"
      className="border-r-k border-ink bg-paper"
      style={{ width: railWidth + insets.left, paddingLeft: insets.left, paddingTop: insets.top + 8 }}
    >
      <View className="mx-2 mb-3 items-center border-b-k border-ink pb-2.5">
        <Image source={BRAND_MARK} accessibilityLabel={BRAND.appName} style={{ width: phoneLandscape ? 36 : 48, height: phoneLandscape ? 36 : 48 }} />
      </View>
      {TABS.map((it) => {
        const on = it.key === tab;
        return (
          <Tap
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(it.label)}
            onPress={() => onChange(it.key)}
            className="mx-2 mb-1.5 items-center justify-center rounded-k"
            style={({ pressed }) => ({
              height: phoneLandscape ? 64 : 72,
              borderWidth: on ? 1.5 : 0,
              borderColor: colors.ink,
              backgroundColor: on ? colors.slip : pressed ? colors.tint : 'transparent',
            })}
          >
            {on ? <View className="absolute left-1.5 top-1.5 h-[10px] w-[10px] bg-fire" /> : null}
            <View>
              <Icon name={it.icon} size={22} color={on ? colors.ink : colors.mute} />
              {it.key === 'bills' && heldCount > 0 ? <Badge n={heldCount} /> : null}
            </View>
            <Text className={`mt-1 text-[14px] ${on ? 'font-body-700 text-ink' : 'font-body-600 text-mute'}`}>{t(it.label)}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** Held bills on the server, plus holds still waiting in the offline queue, minus held bills whose payment waits there. */
function useHeldBadge() {
  const { heldCount, shift } = useShellStore();
  const waiting = useCheckoutQueue().filter((e) => e.status === 'waiting' && e.shiftId === shift?.id);
  const holds = waiting.filter((e) => e.kind === 'hold').length;
  const paid = waiting.filter((e) => settlesHeldBill(e)).length;
  return Math.max(0, heldCount + holds - paid);
}

function Badge({ n }: { n: number }) {
  return (
    <View className="absolute -right-3 -top-2 min-w-[20px] items-center rounded-k border-k border-ink bg-fire px-1" style={{ height: 20 }}>
      <Text className="font-mono-600 text-[12px] text-ink">{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

/**
 * Network chip (DESIGN I4, I6). Hidden when online with an empty queue. Fire-soft "Offline · 3" while entries
 * wait, error-soft "Ditolak 1" when the server refused one, "Mengirim..." while syncing. On narrow phones only
 * the icon and number show; the full label stays in accessibilityLabel.
 */
export function NetChip({ onPress }: { onPress: () => void }) {
  useT();
  const { session } = useShellStore();
  const { width, wide, phoneLandscape } = useLayout();
  const queue = useCheckoutQueue().filter((e) => e.outletId === session?.outletId);
  const syncing = useQueueSyncing();
  const waiting = queue.filter((e) => e.status === 'waiting').length;
  const rejected = queue.filter((e) => e.status === 'conflict').length;
  const online = useOnline();
  if (!waiting && !rejected && online) return null;
  const error = rejected > 0;
  const full = error ? t('Ditolak {n}', { n: rejected }) : syncing ? t('Mengirim...') : waiting ? t('Offline · {n}', { n: waiting }) : t('Offline');
  const short = phoneLandscape || (!wide && width < 520);
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={full}
      onPress={onPress}
      className="h-[44px] flex-row items-center gap-1.5 rounded-k px-2.5"
      style={({ pressed }) => ({
        minWidth: 44,
        borderWidth: 1.5,
        borderColor: error ? colors.errorLine : colors.ink,
        backgroundColor: pressed ? colors.tint : error ? colors.errorSoft : colors.fireSoft,
      })}
    >
      <Icon name={error ? 'alert' : syncing ? 'sync' : 'offline'} size={18} color={error ? colors.error : colors.ink} />
      <Mono className="font-mono-600 text-[14px]" style={{ color: error ? colors.error : colors.ink }}>
        {short ? (error ? String(rejected) : waiting ? String(waiting) : '') : full}
      </Mono>
    </Tap>
  );
}

/** Screen header: title (Bricolage 30), mono sub line, network chip and bell on the right. */
export function Header({
  title,
  onBack,
  onQueue,
  onBell,
  right,
  center,
}: {
  title: string;
  onBack?: () => void;
  onQueue: () => void;
  onBell: () => void;
  right?: React.ReactNode;
  /** Replaces the title block (phone landscape on Jual: search and categories live in the header row). */
  center?: React.ReactNode;
}) {
  useT();
  const insets = useSafeAreaInsets();
  const { phoneLandscape } = useLayout();
  const { session, shift } = useShellStore();
  const { status } = useSubscription();
  const logo = phoneLandscape ? 32 : 44; // fixed box + contain: any logo aspect fits without stretching
  const sub = [session?.cashierName, shift ? t('Shift {n}', { n: shift.shiftNumber }) : t('belum ada shift'), session?.outletName].filter(Boolean).join(' · ');
  return (
    <View
      className={`flex-row items-center gap-2.5 border-b-k border-ink bg-paper px-4 ${phoneLandscape ? 'pb-1.5' : 'pb-3'}`}
      style={{ paddingTop: insets.top + (phoneLandscape ? 6 : 10) }}
    >
      {onBack ? <IconButton icon="chevron-left" label={t('Kembali')} onPress={onBack} /> : null}
      {session?.outletLogoUrl && !center ? (
        <Image
          source={{ uri: session.outletLogoUrl }}
          accessibilityIgnoresInvertColors
          accessibilityElementsHidden
          importantForAccessibility="no"
          resizeMode="contain"
          style={{ width: logo, height: logo }}
        />
      ) : null}
      {center ? (
        <View className="min-w-0 flex-1">{center}</View>
      ) : (
        <View className="min-w-0 flex-1">
          <Display size={phoneLandscape ? 22 : 30} numberOfLines={1} accessibilityRole="header">
            {title}
          </Display>
          <Mono numberOfLines={1} className="mt-0.5 text-[14px] text-mute">
            {sub}
          </Mono>
        </View>
      )}
      {right}
      {/* With `center` (Jual, phone landscape) the row belongs to search; the screen's banner shows the queue. */}
      {center ? null : <NetChip onPress={onQueue} />}
      <IconButton
        icon="bell"
        label={status?.unread ? t('Notifikasi, {n} belum dibaca', { n: status.unread }) : t('Notifikasi')}
        badge={status?.unread || undefined}
        onPress={onBell}
      />
    </View>
  );
}
