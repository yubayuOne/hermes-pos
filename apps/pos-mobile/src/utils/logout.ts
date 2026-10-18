import { getQueueSnapshot } from '../services/transaction/offlineQueue';
import { t } from '../i18n';

type Notify = { confirm: (o: { title: string; message: string; hint?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean> };

/**
 * Always ask before the device signs out of the owner account: afterwards no cashier can sign in until the owner types
 * the email and password again. A non-empty offline queue gets the stronger warning (PRD E6). true = go ahead.
 */
export async function confirmSignOut(notify: Notify): Promise<boolean> {
  const waiting = getQueueSnapshot().length;
  if (waiting === 0) {
    return notify.confirm({
      title: t('Keluar dari akun pemilik?'),
      message: t('Setelah keluar, kasir tidak bisa masuk sampai pemilik mengetik email dan kata sandinya lagi di perangkat ini.'),
      confirmLabel: t('Keluar akun'),
      destructive: true,
    });
  }
  return notify.confirm({
    title: t('Keluar dengan antrean berisi?'),
    message: t('{n} entri antrean belum terkirim ke server.', { n: waiting }),
    hint: t('Antrean tetap tersimpan di perangkat dan dikirim saat akun yang sama masuk lagi dengan internet. Sebaiknya sinkronkan dulu.'),
    confirmLabel: t('Tetap keluar'),
    destructive: true,
  });
}
