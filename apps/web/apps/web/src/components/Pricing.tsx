import { btn, money, useI18n } from '@hermes-pos/ui';
import { EXTRA_OUTLET, LINKS, PLANS, perMonth, saving } from '../content';

/** C7. Four plans, no plan highlighted. ≤980px each plan becomes a two-column card. */
export function Pricing() {
  const { t } = useI18n();
  const cols = ['Paket', 'Durasi', 'Harga', 'Setara per bulan', 'Hemat dari bulanan'];
  return (
    <section id="pricing" aria-labelledby="pricing-t" className="wrap scroll-mt-6 pt-28">
      <h2 id="pricing-t" className="max-w-[14em] text-[clamp(36px,4.4vw,64px)]">
        {t('Satu harga per bisnis, bukan per perangkat.')}
      </h2>
      <p className="mt-5 text-mute">{t('Semua paket berbayar berisi 1 outlet, 3 kasir, dan 100 produk per outlet.')}</p>
      <table className="mt-14 w-full border-collapse">
        <thead className="hidden lg:table-header-group">
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="border-b-[1.5px] border-ink pb-3 text-left text-[14px] font-normal text-mute">
                {t(c)}
              </th>
            ))}
            <th className="border-b-[1.5px] border-ink">
              <span className="sr-only">{t('Aksi')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="grid gap-4 lg:table-row-group">
          {PLANS.map((p) => {
            const trial = p.months === 0;
            const cells: [string, string, boolean][] = [
              [t('Durasi'), t(p.duration), false],
              [t('Harga'), trial ? t('Gratis') : money(p.price), true],
              [t('Setara per bulan'), trial ? '-' : money(perMonth(p.price, p.months)), false],
              [t('Hemat dari bulanan'), trial || p.months === 1 ? '-' : money(saving(p.price, p.months)), false],
            ];
            return (
              <tr
                key={p.code}
                className="grid grid-cols-2 gap-x-4 gap-y-3 rounded border-[1.5px] border-ink bg-slip p-5 lg:table-row lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0"
              >
                <th scope="row" className="col-span-2 text-left font-normal lg:border-b-[1.5px] lg:border-ink lg:px-3 lg:py-6">
                  <span className="font-display text-[28px] font-extrabold tracking-[-0.03em]">{t(p.name)}</span>
                  {'note' in p && <span className="block max-w-[16em] text-[14px] text-mute">{t(p.note)}</span>}
                </th>
                {cells.map(([label, value, strong]) => (
                  <td key={label} className="lg:border-b-[1.5px] lg:border-ink lg:px-3 lg:py-6">
                    <span className="block text-[13px] text-mute lg:hidden">{label}</span>
                    <span className={strong ? 'font-mono font-semibold' : label === t('Durasi') ? '' : 'font-mono'}>{value}</span>
                  </td>
                ))}
                <td className="col-span-2 pt-2 lg:border-b-[1.5px] lg:border-ink lg:px-3 lg:py-6 lg:text-right">
                  <a href={LINKS.register} className={`${btn(trial ? 'fire' : 'plain', { sm: true })} w-full lg:w-auto lg:min-w-[82px]`}>
                    {trial ? t('Daftar') : t('Pesan')}
                    <span className="sr-only"> {t(p.name)}</span>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-20">
        <div>
          <h3 className="text-[28px]">{t('Outlet tambahan {price} per bulan.', { price: money(EXTRA_OUTLET) })}</h3>
          <p className="mt-3 text-mute">
            {t(
              'Dihitung proporsional dengan sisa masa aktif, dengan satu tanggal berakhir untuk semua outlet. Contoh: 3 outlet berarti 1 termasuk paket dan 2 tambahan, {total} per bulan.',
              { total: money(EXTRA_OUTLET * 2) },
            )}
          </p>
        </div>
        <p className="text-mute">
          {t(
            'Pembayaran pertama lewat transfer bank, lalu kami aktifkan paket Anda. Perpanjangan menambah sisa waktu, tidak mulai dari hari bayar. Saat paket berakhir, aplikasi tetap terbuka tetapi fitur terkunci, dan data tidak dihapus.',
          )}
        </p>
      </div>
    </section>
  );
}
