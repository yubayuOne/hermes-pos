import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ToastHost, btn, dateLong, dateShort, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { Bell } from './Bell';

/**
 * Content header (DESIGN.md D1 .hd): mono date (hidden on phones), page title, then ID/EN, optional filter,
 * and the bell. Under it: the subscription banner and the toasts, then the page.
 */
export function Page({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
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
        <SubscriptionBanner />
      </div>
      <ToastHost className="mt-3 print:hidden" />
      <div className="mt-6 print:mt-0">{children}</div>
    </main>
  );
}

/** D2 banner, on every page once the plan has expired. Before that the bell reminds once a day (migration 069). */
function SubscriptionBanner() {
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
  return null;
}
