import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Mono, Text } from './Text';
import { Button, ButtonRow } from './Button';
import { Card, Tag } from './bits';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from './Sheet';
import { useShellStore } from '../hooks/AppStore';
import { useNotify } from '../hooks/NotifyProvider';
import { useCheckoutQueue, useQueueSyncing } from '../services/transaction/useCheckoutQueue';
import { entryNumber, QueuedCheckout, removeQueued, retryQueued, syncCheckoutQueue } from '../services/transaction/offlineQueue';
import { AppNotification, listNotifications, markNotificationsRead, setUnread } from '../services/subscription/subscription';
import { colors } from '../theme';
import { fmtDate, fmtDateTime, fmtTime, money, t, useT } from '../i18n';

const itemsLine = (e: QueuedCheckout) => {
  const names = e.expense ? e.expense.items.map((i) => i.name) : e.items.map((i) => `${i.quantity}× ${i.name}`);
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
};

/** Sync the outlet's queue and say what happened. Shared by the banner, the chip, and the sheet. */
export function useQueueActions() {
  const notify = useNotify();
  const { session } = useShellStore();
  const sync = useCallback(async () => {
    if (!session) return;
    try {
      const r = await syncCheckoutQueue({ outletId: session.outletId });
      if (r.synced > 0) notify.success(t('Antrean offline terkirim'), t('{n} entri tercatat di server.', { n: r.synced }));
      else if (r.offline) notify.toast('warning', t('Belum ada internet'), t('Antrean tetap aman di perangkat dan dicoba lagi otomatis.'));
      if (r.conflicts > 0)
        notify.toast('error', t('Ada entri yang ditolak server'), t('{n} entri antrean perlu ditinjau. Ketuk chip Ditolak di atas.', { n: r.conflicts }));
    } catch (e) {
      void notify.fail(t('Sinkron gagal'), e, t('Antrean tetap tersimpan di perangkat.'));
    }
  }, [session, notify]);
  return { sync };
}

const entryTitle = (e: QueuedCheckout) =>
  e.kind === 'hold'
    ? t('Bill ditahan')
    : e.kind === 'update'
      ? t('Perubahan bill ditahan')
      : e.kind === 'expense'
        ? t('Pengeluaran')
        : e.kind === 'open_shift'
          ? t('Buka shift')
          : e.kind === 'close_shift'
            ? t('Tutup shift')
            : e.kind === 'temp_product'
              ? t('Menu sementara')
              : entryNumber(e);

const entryDetail = (e: QueuedCheckout) => {
  if (e.shiftOpen) return t('Kas awal {amount}.', { amount: money(e.shiftOpen.openingCash) });
  if (e.shiftClose) return t('Hitungan kas {amount}', { amount: money(e.shiftClose.physicalCash) });
  if (e.product) return `${e.product.name} · ${money(e.product.price)}`;
  return [
    money(e.total),
    itemsLine(e),
    e.customer.table ? t('Meja {n}', { n: e.customer.table }) : null,
    e.expense
      ? e.expense.paidFrom === 'drawer'
        ? t('kas laci')
        : t('bukan dari laci')
      : e.kind === 'hold' || e.kind === 'update'
        ? null
        : e.payment.method === 'qris'
          ? t('QRIS')
          : t('tunai'),
  ]
    .filter(Boolean)
    .join(' · ');
};

/** Offline queue (DESIGN I5.18): entries with number, time, amount, items, status, and the refusal reason. */
export function QueueSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useT();
  const notify = useNotify();
  const { session } = useShellStore();
  const queue = useCheckoutQueue().filter((e) => e.outletId === session?.outletId);
  const syncing = useQueueSyncing();
  const { sync } = useQueueActions();

  const discard = async (e: QueuedCheckout) => {
    const ok = await notify.confirm({
      title: t('Hapus entri antrean ini?'),
      message: `${entryTitle(e)} · ${entryDetail(e)}`,
      hint:
        e.kind === 'open_shift'
          ? t('Penjualan di shift ini akan ditolak server kalau pembukaannya dihapus. Hapus hanya kalau memang batal.')
          : e.kind === 'expense'
            ? t('Pengeluaran ini tidak akan masuk laporan. Hapus hanya kalau sudah dicatat ulang atau memang batal.')
            : (e.kind ?? 'checkout') === 'checkout'
              ? t('Penjualan ini tidak akan masuk laporan. Hapus hanya kalau sudah dicatat ulang atau memang batal.')
              : t('Entri ini tidak akan sampai ke server. Hapus hanya kalau memang batal.'),
      confirmLabel: t('Hapus entri'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeQueued(e.id);
      notify.success(t('Entri antrean dihapus'));
    } catch (err) {
      void notify.fail(t('Entri belum terhapus'), err);
    }
  };

  const retry = async (e: QueuedCheckout) => {
    await retryQueued(e.id);
    await sync();
  };

  return (
    <Sheet visible={visible} onClose={onClose} size="tall" label={t('Antrean offline')}>
      <SheetHeader
        title={t('Antrean offline')}
        subtitle={t('Belum tercatat di server. Dikirim berurutan saat internet ada; tutup shift selalu terkirim paling akhir.')}
        onClose={onClose}
      />
      <SheetBody contentClassName="gap-2.5">
        {queue.length === 0 ? (
          <Text className="py-6 text-center text-[15px] text-mute">{t('Antrean kosong. Semua penjualan sudah tercatat di server.')}</Text>
        ) : null}
        {queue.map((e) => {
          const rejected = e.status === 'conflict';
          return (
            <View
              key={e.id}
              className="gap-2 rounded-k px-3.5 py-3"
              style={{ borderWidth: 1.5, borderColor: rejected ? colors.errorLine : colors.ink, backgroundColor: rejected ? colors.errorSoft : colors.slip }}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Mono className="font-mono-600 min-w-0 flex-1 text-[15px]" numberOfLines={1}>
                  {entryTitle(e)} · {fmtTime(e.queuedAt)}
                </Mono>
                <Tag label={rejected ? t('ditolak') : t('menunggu')} tone={rejected ? 'error' : 'fire'} />
              </View>
              <Text className="text-[14px] text-mute">{entryDetail(e)}</Text>
              {rejected && e.lastError ? (
                <Text className="font-body-600 text-[14px] text-error">
                  {(e.kind ?? 'checkout') !== 'checkout'
                    ? t('Ditolak server: {reason} Entri tidak dihapus otomatis. Tinjau bersama pemilik.', { reason: e.lastError })
                    : t('Ditolak server: {reason} Uang sudah diterima, jadi entri tidak dihapus otomatis. Tinjau bersama pemilik.', { reason: e.lastError })}
                </Text>
              ) : e.attempts > 0 ? (
                <Mono className="text-[13px] text-mute">
                  {t('Dicoba {n}× · terakhir {time}', { n: e.attempts, time: e.lastAttemptAt ? fmtTime(e.lastAttemptAt) : '-' })}
                </Mono>
              ) : null}
              <ButtonRow>
                <Button size="sm" variant="danger" label={t('Hapus')} onPress={() => void discard(e)} />
                {rejected ? <Button size="sm" variant="pine" label={t('Coba lagi')} disabled={syncing} onPress={() => void retry(e)} /> : null}
              </ButtonRow>
            </View>
          );
        })}
        <Text className="mt-1 text-[13px] text-mute">
          {t(
            'Sinkron berjalan otomatis saat masuk, saat aplikasi dibuka lagi, dan tiap 30 detik selama antrean berisi. Setiap entri memakai kunci yang sama, jadi tidak pernah tercatat dua kali.',
          )}
        </Text>
      </SheetBody>
      <ActionFooter>
        <Button
          size="lg"
          variant="pine"
          label={syncing ? t('Mengirim...') : t('Sinkronkan')}
          loading={syncing}
          disabled={!queue.some((e) => e.status === 'waiting')}
          onPress={() => void sync()}
        />
      </ActionFooter>
    </Sheet>
  );
}

/** Notification text from kind and params, in the chosen language (PRD G2). */
export function notificationText(n: AppNotification) {
  const p = n.params as Record<string, unknown>;
  const date = typeof p.expires_at === 'string' ? fmtDate(p.expires_at) : '';
  const days = Number(p.days_left ?? p.threshold ?? 0);
  if (n.kind === 'refund')
    return t('Refund {amount} pada {number} oleh {cashier}. Alasan: {reason}', {
      amount: money(Number(p.amount ?? 0)),
      number: String(p.number ?? ''),
      cashier: String(p.cashier ?? '-'),
      reason: String(p.reason ?? '-'),
    });
  if (/expired/.test(n.kind)) return t('Langganan berakhir. Penjualan baru dikunci sampai pemilik memperpanjang paket.');
  if (/trial/.test(n.kind)) return t('Trial berakhir {date}, {n} hari lagi.', { date, n: days });
  if (/expir/.test(n.kind)) return t('Langganan berakhir {date}, {n} hari lagi.', { date, n: days });
  return n.kind;
}

/** Bell (DESIGN I5.19): subscription notices with an orange dot when unread, and Tandai sudah dibaca. */
export function BellSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useT();
  const notify = useNotify();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setItems(await listNotifications(30));
    } catch {
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, []);
  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const unread = (items ?? []).filter((n) => !n.readAt).length;
  const markAll = async () => {
    setMarking(true);
    try {
      await markNotificationsRead();
      setItems((list) => (list ?? []).map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch (e) {
      void notify.fail(t('Belum bisa menandai'), e);
    } finally {
      setMarking(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} label={t('Notifikasi')}>
      <SheetHeader title={t('Notifikasi')} subtitle={unread ? t('{n} belum dibaca', { n: unread }) : t('Semua sudah dibaca')} onClose={onClose} />
      <SheetBody contentClassName="gap-0">
        {items === null ? (
          <View className="items-center py-8" accessibilityLabel={t('Memuat data...')}>
            <ActivityIndicator color={colors.ink} />
          </View>
        ) : null}
        {error ? <Text className="pb-3 text-[14px] text-error">{t('Notifikasi belum bisa dimuat. Periksa internet.')}</Text> : null}
        {items && items.length === 0 && !error ? <Text className="py-6 text-center text-[15px] text-mute">{t('Belum ada notifikasi.')}</Text> : null}
        {(items ?? []).map((n, i) => (
          <View
            key={n.id}
            accessible
            accessibilityLabel={`${n.readAt ? '' : `${t('Belum dibaca')}. `}${notificationText(n)}. ${fmtDateTime(n.createdAt)}`}
            className={`flex-row gap-3 py-3 ${i ? 'border-t border-rule' : ''}`}
          >
            <View className="mt-1.5 h-[10px] w-[10px] border-k border-ink" style={{ backgroundColor: n.readAt ? colors.disabledLine : colors.fire }} />
            <View className="min-w-0 flex-1">
              <Text className={`text-[15px] ${n.readAt ? '' : 'font-body-600'}`}>{notificationText(n)}</Text>
              <Mono className="mt-1 text-[13px] text-mute">{fmtDateTime(n.createdAt)}</Mono>
            </View>
          </View>
        ))}
        <Card className="mt-3 bg-paper">
          <Text className="text-[14px] text-mute">
            {t('Kasir hanya bisa melihat. Pemilik memperpanjang paket dari backoffice, menu Pengaturan, tab Langganan.')}
          </Text>
        </Card>
      </SheetBody>
      <ActionFooter>
        {unread ? (
          <Button variant="pine" label={t('Tandai sudah dibaca')} loading={marking} onPress={() => void markAll()} />
        ) : (
          <Button label={t('Tutup')} onPress={onClose} />
        )}
      </ActionFooter>
    </Sheet>
  );
}
