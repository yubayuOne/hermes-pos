import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { LangToggle, RCut, RRow, Receipt, Tag, Wordmark, btn, dateLong, time, useI18n } from '@hermes-pos/ui';
import { LANDING_URL, SUPPORT } from '../lib/plans';

/** E4. 404 and 500: big number with the marker, title, explanation, two buttons, and a receipt on the right. */
export function ErrorPage({ code, path }: { code: 404 | 500; path?: string }) {
  const { t, lang } = useI18n();
  const [retrying, setRetrying] = useState(false);
  const ref = useMemo(() => 'ERR-' + Math.random().toString(36).slice(2, 9).toUpperCase(), []);
  const now = new Date();
  const is404 = code === 404;
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-4 border-b-[1.5px] border-ink px-5 py-5 md:px-10">
        <a href={LANDING_URL} aria-label="Hermes POS">
          <Wordmark size={30} />
        </a>
        <div className="flex items-center gap-4">
          <LangToggle />
          <a href={LANDING_URL} className="lnk">
            {t('Ke beranda')}
          </a>
        </div>
      </header>
      <main id="content" className="mx-auto grid max-w-[1180px] items-center gap-14 px-5 py-12 md:px-10 lg:grid-cols-[7fr_5fr] lg:py-16">
        <div>
          <Tag tone={is404 ? 'plain' : 'fire'}>{is404 ? t('kode 404 · halaman tidak ditemukan') : t('kode 500 · galat di server kami')}</Tag>
          <p aria-hidden className="mt-6 font-display text-[clamp(120px,16vw,220px)] font-extrabold leading-[0.8] tracking-[-0.05em]">
            <span className="hl">{code}</span>
          </p>
          <h1 className="mt-6 text-[clamp(38px,4.4vw,52px)]">{is404 ? t('Halaman ini tidak ada di struk kami.') : t('Ada yang macet di pihak kami.')}</h1>
          <p className="mt-4 max-w-[34em] text-mute">
            {is404
              ? t('Tautannya mungkin salah ketik, atau halamannya sudah dipindahkan. Data bisnis Anda tidak terpengaruh.')
              : t('Ini bukan salah Anda. Coba muat ulang halaman dalam beberapa saat.')}
          </p>
          {!is404 && (
            <div className="mt-6 max-w-[460px] rounded border-[1.5px] border-l-[12px] border-ink border-l-fire bg-slip px-5 py-4">
              <p className="font-bold">{t('Aplikasi kasir tetap bisa dipakai.')}</p>
              <p className="mt-1 text-[15px] text-mute">{t('Transaksi tersimpan di perangkat kasir dan terkirim otomatis saat sistem pulih.')}</p>
            </div>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {is404 ? (
              <>
                <a href={LANDING_URL} className={btn('fire')}>
                  {t('Kembali ke beranda')}
                </a>
                <Link to="/" className={btn('plain')}>
                  {t('Buka backoffice')}
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={btn('fire')}
                  disabled={retrying}
                  onClick={() => {
                    setRetrying(true);
                    window.location.reload();
                  }}
                >
                  {retrying ? t('Mencoba lagi...') : t('Muat ulang halaman')}
                </button>
                <a href={LANDING_URL} className={btn('plain')}>
                  {t('Kembali ke beranda')}
                </a>
              </>
            )}
          </div>
          {is404 ? (
            <nav aria-label={t('Mungkin Anda mencari')} className="mt-10 max-w-[460px]">
              <p className="font-semibold">{t('Mungkin Anda mencari:')}</p>
              <ul className="mt-3 rounded border-[1.5px] border-ink bg-slip">
                {(
                  [
                    ['/login', 'Masuk'],
                    ['/register', 'Daftar trial 3 hari'],
                    ['/subscription', 'Bayar langganan'],
                  ] as const
                ).map(([to, label]) => (
                  <li key={to} className="border-b border-rule last:border-b-0">
                    <Link to={to} className="flex min-h-[52px] items-center justify-between px-4 font-semibold hover:bg-tint-3">
                      {t(label)} <span className="font-mono text-[13px] font-normal text-mute">{to}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <p className="mt-8 max-w-[34em] text-[15px] text-mute">
              {t('Masalah berlanjut? Hubungi kami di WhatsApp {wa} atau email {email} dan sebutkan kode referensi di samping.', {
                wa: SUPPORT.whatsapp,
                email: SUPPORT.email,
              })}
            </p>
          )}
        </div>
        <Receipt ink torn className="mx-auto w-full max-w-[380px]" label={is404 ? t('Struk tidak ditemukan') : t('Laporan galat')}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold uppercase">{is404 ? t('Struk tidak ditemukan') : t('Laporan galat')}</span>
            <Tag tone={is404 ? 'plain' : 'fire'}>{code}</Tag>
          </div>
          <RCut />
          {is404 ? (
            <>
              <RRow l={t('Halaman')} r="?" className="border-0" />
              <RRow l={t('Alamat')} r={<span className="break-all">{path ?? '/'}</span>} className="border-0" />
              <RRow l="Total" r="Rp0" className="border-0" />
            </>
          ) : (
            <>
              <RRow l={t('Referensi')} r={ref} className="border-0" />
              <RRow l={t('Waktu')} r={`${dateLong(now, lang)} ${time(now)}`} className="border-0" />
            </>
          )}
          <RCut />
          <p className="text-[13px] text-mute">{is404 ? t('Tidak ada transaksi yang terhapus.') : t('Data bisnis Anda aman.')}</p>
        </Receipt>
      </main>
    </div>
  );
}
