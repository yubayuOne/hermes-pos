import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ToastHost, btn, dateLong, dateShort, isoDay, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { Bell } from './Bell';

/**
 * Content header (DESIGN.md D1 .hd): mono date (hidden on phones), page title, then ID/EN, optional filter,
 * and the bell. Under it: the subscription banner and the toasts, then the page.
 */
export function Page({ title, tools, slimBanner, children }: { title: string; tools?: ReactNode; slimBanner?: boolean; children: ReactNode }) {
  const app = useApp();
  const { lang } = useI18n();
  return (
    <main id="content" className="px-4 pb-[72px] pt-[22px] md:px-5 md:pt-6 lg:px-10 lg:pt-[30px] print:!p-0">
      {/* Phone: the bell is in the top bar (AppShell), the page's filter takes the full second row. */}
      <header className="relative flex flex-wrap items-end gap-x-6 gap-y-4 border-b-[1.5px] border-ink pb-5 print:hidden">
        <div className="min-w-0 flex-1">
          <p className="hidden font-mono text-[14px] text-mute md:block">{dateLong(new Date(), lang, app.business.timezone)}</p>
          <h1 className="page-t mt-1 break-words">{title}</h1>
        </div>
        <div className="hidden flex-none md:order-last md:block">
          <Bell />
        </div>
        {tools && <div className="w-full min-w-0 md:w-auto">{tools}</div>}
      </header>
      <div className="mt-5 grid gap-3 empty:hidden print:hidden">
        <SubscriptionBanner slim={slimBanner} />
      </div>
      <ToastHost className="mt-3 print:hidden" />
      <div className="mt-6 print:mt-0">{children}</div>
    </main>
  );
}

/** D2 banners: slim on Summary for trial or active in the reminder window; large on every page when expired. */
function SubscriptionBanner({ slim }: { slim?: boolean }) {
  const app = useApp();
  const { t, lang } = useI18n();
  const sub = app.subscription;
  const date = dateShort(sub.expiresAt, lang, app.business.timezone);
  if (sub.state === 'expired') {
    return (
      <section
        role="status"
        aria-labelledby="sub-t"
        className="flex flex-wrap items-center justify-between gap-5 rounded border-[1.5px] border-l-[12px] border-ink border-l-fire bg-slip px-5 py-5 md:px-7"
      >
        <div className="max-w-[46em]">
          <h2 id="sub-t" className="text-[24px]">
            {t('Langganan berakhir pada {date}.', { date })}
          </h2>
          <p className="mt-2 text-mute">
            {t('Aplikasi tetap terbuka, tetapi penjualan baru dan perubahan data terkunci. Laporan dan riwayat masih bisa dilihat.')}
          </p>
        </div>
        <Link to="/subscription" className={btn('fire')}>
          {t('Perpanjang paket')}
        </Link>
      </section>
    );
  }
  if (!slim) return null;
  const remind = sub.state === 'trial' || sub.daysLeft <= 30;
  if (!remind) return null;
  // Same day count the sidebar shows; dates are compared in the business time zone.
  const today = isoDay(new Date(), app.business.timezone);
  const endsToday = isoDay(new Date(sub.expiresAt), app.business.timezone) === today;
  return (
    <section role="status" className="flex flex-wrap items-center justify-between gap-4 rounded border-[1.5px] border-ink bg-fire-soft p-3 pl-4 md:pl-5">
      <div>
        <p className="text-[16px] font-bold">
          {sub.state === 'trial'
            ? t('Trial berakhir {date}, {n} hari lagi.', { date, n: sub.daysLeft })
            : endsToday
              ? t('Langganan berakhir hari ini, {date}.', { date })
              : t('Langganan berakhir {date}, {n} hari lagi.', { date, n: sub.daysLeft })}
        </p>
        <p className="mt-0.5 text-[14px] text-mute">
          {sub.state === 'trial'
            ? t('Pilih paket sebelum trial habis supaya kasir tetap bisa berjualan.')
            : t('Perpanjangan menambah sisa waktu, jadi tidak ada hari yang hilang.')}
        </p>
      </div>
      <Link to="/subscription" className={btn('plain')}>
        {t('Lihat paket')}
      </Link>
    </section>
  );
}
