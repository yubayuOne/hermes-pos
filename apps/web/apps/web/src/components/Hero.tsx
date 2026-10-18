import { BRAND_UPPER, Hl, RCut, RRow, Receipt, Wordmark, amount, btn, useI18n } from '@hermes-pos/ui';
import { LINKS } from '../content';

/** C3 and C4. The slip on the right shows the promise in the headline: a cash variance that is visible the moment the shift closes. */
export function Hero() {
  const { t } = useI18n();
  return (
    <>
      <section aria-labelledby="hero-t" className="wrap grid items-start gap-14 pb-20 pt-14 lg:grid-cols-[7fr_5fr] lg:gap-16 lg:pt-20">
        <div>
          <h1 id="hero-t" className="text-[clamp(44px,6.2vw,96px)]">
            {t('Tahu ke mana uang laci pergi,')} <Hl>{t('walau Anda tidak di toko.')}</Hl>
          </h1>
          <p className="mt-8 max-w-[30em] text-[19px] text-mute sm:text-[21px]">
            {t(
              '{brand} adalah aplikasi kasir Android untuk kafe dan restoran kecil. Void dan refund butuh kode Anda, dan pengeluaran dari laci langsung mengurangi kas yang seharusnya ada. Internet mati pun, tidak ada transaksi yang hilang atau tercatat dua kali.',
              { brand: BRAND_UPPER },
            )}
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a href={LINKS.register} className={btn('fire')}>
              {t('Coba gratis 3 hari')}
            </a>
            <a href="#control" className={btn('plain')}>
              {t('Lihat kontrol kas')}
            </a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[446px] pl-10 sm:pl-14 lg:mt-4">
          <div aria-hidden className="absolute bottom-[-32px] left-0 right-7 top-8 bg-fire" />
          <Receipt torn className="animate-feed shadow-none" label={t('Contoh buku kas shift')}>
            <div className="head pb-1">
              <Wordmark size={22} />
              <p className="mt-1 text-[13px] uppercase text-mute">
                {t('Tutup shift')} · {t('contoh')}
              </p>
            </div>
            <RCut />
            <RRow l={t('Kas awal')} r={amount(300000)} className="border-0 py-1.5" />
            <RRow l={t('Penjualan tunai')} r={`+ ${amount(2650000)}`} className="border-0 py-1.5" />
            <RRow l="Void" r={`- ${amount(76000)}`} className="border-0 py-1.5" />
            <RRow l={t('Pengeluaran dari laci')} r={`- ${amount(35000)}`} className="border-0 py-1.5" />
            <RCut />
            <RRow
              l={<b className="font-semibold">{t('Kas seharusnya')}</b>}
              r={<b className="font-semibold">{amount(2839000)}</b>}
              className="border-0 py-1.5"
            />
            <RRow l={t('Hitungan kasir')} r={amount(2834000)} className="border-0 py-1.5" />
            <div className="mt-3 flex justify-between bg-fire px-4 py-3 font-semibold">
              <span>{t('Selisih')}</span>
              <span>{`- ${amount(5000)}`}</span>
            </div>
            <p className="mt-3 text-[13px] text-mute">{t('Selisih terlihat saat shift ditutup, bukan di akhir bulan. Contoh tampilan.')}</p>
          </Receipt>
        </div>
      </section>
      <section aria-label={t('Fakta singkat')} className="wrap grid border-t-[1.5px] border-ink lg:grid-cols-3">
        {['Android, HP dan tablet', 'Printer Bluetooth 58 mm dan 80 mm', 'Tunai dan QRIS'].map((f, i) => (
          <p key={f} className={`py-5 font-medium ${i > 0 ? 'border-t border-line lg:border-t-0' : ''}`}>
            {t(f)}
          </p>
        ))}
      </section>
    </>
  );
}
