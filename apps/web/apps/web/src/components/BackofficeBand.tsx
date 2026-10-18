import { amount, cn, useI18n } from '@hermes-pos/ui';

/** C6. Full-width pine band with the same window the real backoffice shows. */
export function BackofficeBand() {
  const { t } = useI18n();
  const points: [string, string][] = [
    [t('Laporan'), t('penjualan, laba, dan kas, gabungan atau per outlet dan per kasir, plus 10 produk terlaris. Siap cetak.')],
    [t('Pengeluaran'), t('dicatat kasir per shift dan bisa Anda koreksi kapan saja. Kas dan selisih shift dihitung ulang.')],
    [t('Per outlet'), t('logo, alamat, dan teks struk diatur di tiap outlet. Satu HP terikat ke satu outlet, dan server menolak PIN dari outlet lain.')],
    [t('Menu dan kasir'), t('disiapkan dari browser, bahkan sebelum perangkat kasir ada. PIN diganti tanpa memegang perangkatnya.')],
    [t('Lonceng'), t('refund dan pengeluaran dari kasir muncul di sini, juga pengingat sebelum langganan berakhir.')],
    [t('Data usaha Anda saja.'), t('Pemisahan antarbisnis dijaga di database, bukan hanya disembunyikan di layar.')],
  ];
  return (
    <section id="backoffice" aria-labelledby="bo-t" className="mt-28 scroll-mt-0 bg-pine py-20 text-paper lg:py-28">
      <div className="wrap grid items-start gap-14 lg:grid-cols-[5fr_6fr] lg:gap-[72px]">
        <div>
          <h2 id="bo-t" className="text-[clamp(36px,4.4vw,64px)] text-paper">
            {t('Setelah tutup, pemilik membaca angkanya dari rumah.')}
          </h2>
          <p className="mt-6 text-pine-text">{t('Backoffice dibuka di browser dengan akun pemilik yang sama dengan aplikasi kasir.')}</p>
          <ul className="mt-10 border-t border-pine-line">
            {points.map(([b, rest]) => (
              <li key={b} className="border-b border-pine-line py-4">
                <b className="font-display font-extrabold tracking-[-0.02em]">{b}</b> {rest}
              </li>
            ))}
          </ul>
        </div>
        <Window />
      </div>
    </section>
  );
}

function Window() {
  const { t } = useI18n();
  const menu = ['Ringkasan', 'Laporan', 'Outlet', 'Kasir', 'Produk', 'Pengeluaran', 'Voucher'];
  const bars = [3.1, 2.6, 3.4, 2.9, 3.9, 5.1, 4.3];
  const cashiers: [string, number][] = [
    ['Sari', 1420000],
    ['Dedi', 1630000],
    ['Budi', 760000],
    ['Wulan', 470000],
  ];
  return (
    <div
      role="figure"
      aria-label={t('Contoh tampilan backoffice')}
      className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded bg-slip text-ink lg:grid-cols-[150px_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col border-b border-line bg-paper p-3 lg:border-b-0 lg:border-r">
        <ul className="flex gap-1 overflow-x-auto text-[14px] lg:block lg:space-y-1">
          {menu.map((m, i) => (
            <li key={m} className={cn('flex min-h-9 items-center gap-2 whitespace-nowrap rounded px-2.5', i === 0 && 'border-[1.5px] border-ink bg-slip')}>
              {i === 0 && <span aria-hidden className="size-2.5 bg-fire" />}
              {t(`${m}|menu`)}
            </li>
          ))}
        </ul>
        <div className="mt-auto hidden pt-16 lg:block">
          <p className="border-t-[1.5px] border-ink px-2.5 pt-3 text-[14px]">{t('Pengaturan')}</p>
        </div>
      </div>
      <div className="min-w-0 p-5 sm:p-7">
        <div className="flex flex-wrap justify-between gap-2 text-[14px]">
          <span className="font-semibold">{t('Ringkasan · hari ini · semua outlet')}</span>
          <span className="font-mono text-[13px] text-mute">{t('data contoh')}</span>
        </div>
        <p className="mt-3 font-display text-[clamp(34px,4vw,52px)] font-extrabold leading-none tracking-[-0.035em]">Rp4.280.000</p>
        <div aria-hidden className="mt-6 flex h-28 items-end gap-2 border-b border-ink">
          {bars.map((b, i) => (
            <span
              key={i}
              className={cn('flex-1 origin-bottom animate-grow', i === bars.length - 1 ? 'bg-fire' : 'bg-pine')}
              style={{ height: `${(b / 5.1) * 100}%`, animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>
        <ul className="mt-4 font-mono text-[13px]">
          {cashiers.map(([n, v]) => (
            <li key={n} className="flex justify-between border-b border-dashed border-rule py-2 last:border-b-0">
              <span>{n}</span>
              <span>{amount(v)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
