import type { ReactNode } from 'react';
import { LANDING_URL } from '../lib/plans';
import { Hl, LangToggle, RCut, RRow, Receipt, Tag, Wordmark, useI18n } from '@hermes-pos/ui';

/**
 * E1. Two panels: the promise and a pending receipt on paper (left), the form card on tint (right).
 * On phones the left panel shows only the wordmark so the form is visible at once.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,670px)_minmax(0,1fr)]">
      <aside aria-label={t('Tentang Hermes POS')} className="flex flex-col border-ink px-5 pb-6 pt-5 lg:border-r-[1.5px] lg:px-12 lg:pb-12 lg:pt-11">
        <div className="flex items-center justify-between gap-4">
          <a href={LANDING_URL} aria-label="Hermes POS">
            <Wordmark size={34} />
          </a>
          <LangToggle />
        </div>
        <div className="hidden lg:block">
          <p className="mt-8 font-display text-[clamp(44px,4.6vw,62px)] font-extrabold leading-[0.98] tracking-[-0.035em]">
            {t('Kasir yang')} <Hl>{t('tidak ikut mati')}</Hl> {t('saat internet mati.')}
          </p>
          <p className="mt-7 max-w-[30em] text-mute">
            {t('Penjualan tetap tercatat saat internet putus.')}
          </p>
          <Receipt ink torn className="mt-9 max-w-[380px]" label={t('Contoh struk tertunda')}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold uppercase">{t('Struk tertunda')}</span>
              <Tag>{t('contoh')}</Tag>
            </div>
            <RCut />
            <RRow l="TUNDA-3F9A2K" r="11:42" className="border-0" />
            <RRow l={t('2 item')} r="Rp40.000" className="border-0" />
            <RCut />
            <p className="text-small text-mute">{t('Tersimpan di perangkat. Terkirim saat online.')}</p>
          </Receipt>
        </div>
        <ul className="mt-auto hidden flex-wrap gap-2.5 pt-12 lg:flex">
          {['trial gratis 3 hari', 'jalan saat offline', 'tanpa kartu kredit'].map((x) => (
            <li key={x}>
              <Tag>{t(x)}</Tag>
            </li>
          ))}
        </ul>
      </aside>
      <main id="content" className="bg-tint px-4 pb-12 pt-6 sm:px-6 lg:px-10 lg:py-12">
        <div className="mx-auto w-full max-w-[460px] rounded border-[1.5px] border-ink bg-slip p-5 shadow-[var(--shadow-hard-4)] animate-pop sm:p-8 lg:mt-[4vh] lg:shadow-[var(--shadow-hard-6)]">
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[40px] sm:text-[44px]">{title}</h1>
      {sub && <p className="mt-3 text-mute">{sub}</p>}
    </div>
  );
}

/** "atau" divider and the Google button (monogram G, not the official logo). */
export function GoogleButton({ label, onClick, busy, busyLabel }: { label: string; onClick: () => void; busy?: boolean; busyLabel?: string }) {
  const { t } = useI18n();
  return (
    <>
      <div className="my-5 flex items-center gap-3 font-mono text-small text-mute" aria-hidden>
        <span className="h-0 flex-1 border-t border-dashed border-ink" />
        {t('atau')}
        <span className="h-0 flex-1 border-t border-dashed border-ink" />
      </div>
      <button type="button" className="btn btn-block" onClick={onClick} disabled={busy}>
        <span aria-hidden className="grid size-6 place-items-center rounded-[3px] border-[1.5px] border-ink bg-tint-2 font-mono text-small font-semibold">
          G
        </span>
        {busy && busyLabel ? busyLabel : label}
      </button>
    </>
  );
}
