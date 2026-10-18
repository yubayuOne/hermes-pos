import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useNotify } from '../../hooks/NotifyProvider';
import { getQueueSnapshot, isSyncing, loadQueue, subscribeQueue, syncCheckoutQueue, QueuedCheckout } from './offlineQueue';
import { isOnline, subscribeNetwork } from '../network/network';
import { t } from '../../i18n';

const SYNC_INTERVAL_MS = 30000;

/** Current queue contents (updates automatically). */
export function useCheckoutQueue(): QueuedCheckout[] {
  return useSyncExternalStore(subscribeQueue, getQueueSnapshot, getQueueSnapshot);
}

/** True while a sync is running (the network chip shows "Mengirim..."). */
export function useQueueSyncing(): boolean {
  return useSyncExternalStore(subscribeQueue, isSyncing, isSyncing);
}

/**
 * Mount ONCE at the app root. Loads the queue and sends it when a session is active, when the app
 * returns to the foreground, when the internet comes back, and every 30 seconds while entries are waiting.
 */
export function useCheckoutQueueSync(who: { outletId: string } | null) {
  const notify = useNotify();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const outletId = who?.outletId;

  useEffect(() => {
    if (!outletId) return;
    let live = true;

    const run = async () => {
      try {
        const r = await syncCheckoutQueue({ outletId });
        if (!live || r.shared) return;
        if (r.synced > 0) {
          notifyRef.current.success(t('Antrean offline terkirim'), t('{n} entri tercatat di server.', { n: r.synced }));
        }
        if (r.conflicts > 0) {
          notifyRef.current.toast(
            'error',
            t('Ada entri yang ditolak server'),
            t('{n} entri antrean perlu ditinjau. Ketuk chip Ditolak di atas.', { n: r.conflicts }),
          );
        }
      } catch {
        /* the next sync will try again */
      }
    };

    void loadQueue().then(
      () => {
        if (live && getQueueSnapshot().length) void run();
      },
      () => undefined,
    );
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && getQueueSnapshot().some((i) => i.status === 'waiting')) void run();
    });
    const timer = setInterval(() => {
      if (isOnline() && getQueueSnapshot().some((i) => i.status === 'waiting')) void run();
    }, SYNC_INTERVAL_MS);
    // Internet back: send at once instead of waiting for the next tick.
    const unNet = subscribeNetwork(() => {
      if (isOnline() && getQueueSnapshot().some((i) => i.status === 'waiting')) void run();
    });

    return () => {
      live = false;
      sub.remove();
      unNet();
      clearInterval(timer);
    };
  }, [outletId]);
}
