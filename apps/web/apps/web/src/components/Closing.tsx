import { RCut, RRow, RTotal, Receipt, Wordmark, btn, useI18n } from '@hermes-pos/ui';
import { LINKS, SITE } from '../content';

/** C9. Final call to action, contact, footer. */
export function Closing() {
  const { t } = useI18n();
  return (
    <>
      <section aria-labelledby="cta-t" className="wrap grid items-center gap-14 pb-16 pt-32 lg:grid-cols-[7fr_5fr]">
        <div>
          <h2 id="cta-t" className="text-[clamp(48px,7.4vw,112px)]">
            {t('Coba tiga hari di kafe Anda.')}
          </h2>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a href={LINKS.register} className={btn('fire')}>
              {t('Coba gratis 3 hari')}
            </a>
            <a href={LINKS.login} className={btn('plain')}>
              {t('Saya sudah punya akun')}
            </a>
          </div>
        </div>
        <Receipt torn className="mx-auto w-full max-w-[400px]" label={t('Ringkasan pesanan trial')}>
          <div className="head">
            <Wordmark size={22} />
            <p className="mt-1 text-[13px] uppercase text-mute">{t('Pesanan Anda')}</p>
          </div>
          <RCut />
          <RRow l={t('Paket')} r="Trial" />
          <RRow l={t('Durasi')} r={t('3 hari')} />
          <RRow l="Outlet" r="1" />
          <RRow l={t('Kasir|menu')} r="2" />
          <RRow l={t('Produk per outlet')} r="40" />
          <RTotal l="Total" r="Rp0" />
        </Receipt>
      </section>
      <section id="contact" aria-label={t('Kontak')} className="wrap grid scroll-mt-6 gap-6 border-t-[1.5px] border-ink py-8 lg:grid-cols-3">
        {[
          ['WhatsApp', SITE.whatsapp],
          ['Email', SITE.email],
          [t('Rekening pembayaran paket'), SITE.bankAccount],
        ].map(([l, v]) => (
          <div key={l}>
            <p className="text-[15px] text-mute">{l}</p>
            <p className="mt-1 break-words font-mono text-[17px]">{v}</p>
          </div>
        ))}
      </section>
    </>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="wrap flex flex-wrap items-center justify-between gap-4 pb-10 pt-6 text-[15px] text-mute">
      <p>
        <Wordmark size={18} className="text-ink" /> · © {SITE.year}
      </p>
      <nav aria-label={t('Syarat layanan')} className="flex gap-5">
        <a href="/terms" className="underline-offset-4 hover:underline">
          {t('Syarat layanan')}
        </a>
        <a href="/privacy" className="underline-offset-4 hover:underline">
          {t('Kebijakan privasi')}
        </a>
      </nav>
    </footer>
  );
}
