import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Popover } from 'radix-ui';
import { BellIcon, Sk, cn, dateShort, money, time, useI18n, type Vars } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import type { Notification } from '../lib/types';
import { listNotifications, markNotificationsRead } from '../server/app';

/**
 * Notification bell (DESIGN.md B .bell-p): badge with the unread count, a 380px panel under the header that
 * never leaves the content area, orange dot for unread and grey for read, and "Tandai sudah dibaca".
 * Text is built here from kind and params, so it follows the chosen language (PRD G2).
 */
export function Bell({ className }: { className?: string }) {
  const app = useApp();
  const router = useRouter();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(false);
  const unread = items ? items.filter((n) => !n.read).length : app.subscription.unread;

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    listNotifications()
      .then(setItems)
      .catch(() => setFailed(true));
  }, [open]);

  async function markAll() {
    if (!items) return;
    const ids = items.filter((n) => !n.read).map((n) => n.id);
    setItems(items.map((n) => ({ ...n, read: true })));
    await markNotificationsRead({ data: { ids } });
    await router.invalidate();
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn('relative grid size-12 flex-none place-items-center rounded border-[1.5px] border-ink bg-slip hover:bg-tint-2', className)}
        aria-label={unread ? t('Notifikasi, {n} belum dibaca', { n: unread }) : t('Notifikasi')}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="badge" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          className="z-40 w-[min(380px,calc(100vw-32px))] rounded border-[1.5px] border-ink bg-slip shadow-[var(--shadow-hard-4)] animate-pop"
        >
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
            <h2 className="text-[20px]">{t('Notifikasi')}</h2>
            {items && items.some((n) => !n.read) && (
              <button type="button" className="lnk text-[14px]" onClick={markAll}>
                {t('Tandai sudah dibaca')}
              </button>
            )}
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">
            {failed ? (
              <p className="px-4 py-5 text-mute">{t('Notifikasi belum bisa dimuat. Coba lagi nanti.')}</p>
            ) : !items ? (
              <div className="grid gap-3 p-4" role="status">
                <span className="sr-only">{t('Memuat data...')}</span>
                <Sk className="h-4 w-4/5" />
                <Sk className="h-4 w-3/5" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-5 text-mute">{t('Belum ada notifikasi.')}</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id} className="flex gap-3 border-b border-rule px-4 py-3.5 last:border-b-0">
                    <span aria-hidden className={`mt-1.5 size-2.5 flex-none ${n.read ? 'bg-disabled-line' : 'bg-fire'}`} />
                    <div className="min-w-0">
                      <p className={n.read ? 'text-mute' : 'font-medium'}>
                        {!n.read && <span className="sr-only">{t('Belum dibaca')}: </span>}
                        <NotificationText n={n} />
                      </p>
                      <p className="mt-1 font-mono text-[13px] text-mute">
                        {dateShort(n.createdAt, lang, app.business.timezone)} · {time(n.createdAt, app.business.timezone)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationText({ n }: { n: Notification }) {
  const app = useApp();
  const { t, lang } = useI18n();
  const p = n.params as Record<string, unknown>;
  const days = Number(p.days_left ?? p.days ?? p.threshold ?? 0);
  const at = (p.expires_at ?? p.expiresAt) as string | undefined;
  const vars: Vars = { n: days, date: at ? dateShort(at, lang, app.business.timezone) : '' };
  if (n.kind === 'refund') {
    const r: Vars = { amount: money(Number(p.amount ?? 0)), number: String(p.number ?? ''), cashier: String(p.cashier ?? ''), reason: String(p.reason ?? '') };
    return <>{t('Refund {amount} pada {number} oleh {cashier}. Alasan: {reason}', r)}</>;
  }
  if (n.kind === 'expense') {
    const e: Vars = { amount: money(Number(p.amount ?? 0)), cashier: String(p.cashier ?? '') };
    return (
      <>
        {p.paid_from === 'drawer'
          ? t('{cashier} mencatat pengeluaran {amount} dari kas laci. Periksa di menu Pengeluaran.', e)
          : t('{cashier} mencatat pengeluaran {amount}. Periksa di menu Pengeluaran.', e)}
      </>
    );
  }
  // Bookkeeping watch (076).
  const outlet = String(p.outlet ?? '');
  if (n.kind === 'void') {
    const r: Vars = { amount: money(Number(p.amount ?? 0)), number: String(p.number ?? ''), cashier: String(p.cashier ?? ''), reason: String(p.reason ?? '') };
    return <>{t('Void {amount} pada {number} oleh {cashier}. Alasan: {reason}', r)}</>;
  }
  if (n.kind === 'shift_difference') {
    const d: Vars = { n: String(p.shift ?? ''), outlet, cashier: String(p.cashier ?? ''), cash: money(Number(p.cash ?? 0)), qris: money(Number(p.qris ?? 0)) };
    return <>{t('Shift {n} di {outlet} ({cashier}) ditutup dengan selisih: kas {cash}, QRIS {qris}. Periksa di Tutup hari.', d)}</>;
  }
  if (n.kind === 'checks_failed') return <>{t('Ada angka yang tidak cocok di {outlet}. Periksa di Tutup hari.', { outlet })}</>;
  if (n.kind === 'day_not_closed') {
    const d: Vars = { outlet, n: Number(p.days ?? 0), date: p.date ? dateShort(`${String(p.date)}T12:00:00Z`, lang, 'UTC') : '' };
    return <>{t('{n} hari di {outlet} belum ditutup, mulai {date}. Tutup di menu Tutup hari.', d)}</>;
  }
  if (n.kind === 'shift_open_long') {
    return <>{t('Shift {n} di {outlet} ({cashier}) sudah buka lebih dari 16 jam.', { n: String(p.shift ?? ''), outlet, cashier: String(p.cashier ?? '') })}</>;
  }
  if (/expired/.test(n.kind)) return <>{t('Langganan berakhir. Perpanjang paket untuk membuka kunci.')}</>;
  if (/expiring/.test(n.kind) && days === 0) return <>{t('Langganan berakhir hari ini, {date}.', vars)}</>;
  if (/trial/.test(n.kind)) return <>{t('Trial berakhir {date}, {n} hari lagi.', vars)}</>;
  if (/subscription|expir|reminder/.test(n.kind)) return <>{t('Langganan berakhir {date}, {n} hari lagi.', vars)}</>;
  if (/variance/.test(n.kind)) return <>{t('Ada selisih kas di shift yang baru ditutup.')}</>;
  if (/stock/.test(n.kind)) return <>{t('Stok produk menipis.')}</>;
  return <>{n.kind}</>;
}
