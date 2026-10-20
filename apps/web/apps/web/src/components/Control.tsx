import type { ReactNode } from 'react';
import { Tag, amount, cn, useI18n } from '@hermes-pos/ui';

const box = 'border border-line bg-paper font-mono text-[14px] tabular-nums';

/**
 * C5a. Why an owner who is not in the shop can trust the till. The void and refund approval is bigger than the other two
 * because it is the rule that stops money from leaving; the drawer correction and WhatsApp report sit beside it. Every amount is
 * an illustration and says so.
 */
export function Control() {
  const { t } = useI18n();
  return (
    <section id="control" aria-labelledby="control-t" className="wrap scroll-mt-6 pt-28">
      <h2 id="control-t" className="max-w-[13em] text-[clamp(36px,4.4vw,64px)]">
        {t('Kasir menjalankan toko. Pemilik memegang kuncinya.')}
      </h2>
      <p className="mt-6 max-w-[36em] text-mute">
        {t('Void, refund, dan uang keluar dari laci memengaruhi kas. Di sini ketiganya punya aturan dan meninggalkan jejak.')}
      </p>
      <div className="mt-14 grid items-start gap-6 lg:grid-cols-[7fr_5fr]">
        <article className="slipc grid gap-8 sm:grid-cols-[1fr_minmax(0,260px)] sm:items-start lg:grid-cols-1 xl:grid-cols-[1fr_minmax(0,280px)]">
          <div>
            <h3 className="text-[clamp(28px,3vw,40px)]">{t('Void dan refund tidak jalan tanpa kode Anda.')}</h3>
            <p className="mt-4 text-mute">
              {t(
                'Kasir tidak bisa membatalkan bill yang sudah dibayar sendirian. Anda membuat kode persetujuan 6 digit di backoffice, dan kasir meminta Anda mengetiknya di perangkat. Alasannya wajib diisi, lima kali salah mengunci void selama 5 menit, dan refund per item hanya untuk bill berumur sampai 24 jam. Setiap refund masuk ke lonceng notifikasi Anda.',
              )}
            </p>
          </div>
          <Approval />
        </article>
        <div className="grid gap-6">
          <Side title={t('Selisih laci diperbaiki dengan satu catatan.')} mock={<Correction />}>
            {t('Uang laci kurang? Catat Uang masuk. Lebih? Catat Uang keluar. Selisih shift dihitung ulang dan alasannya tersimpan.')}
          </Side>
          <Side title={t('Laporan shift sampai ke WhatsApp.')} mock={<Report />}>
            {t('Di akhir shift, satu ketukan membuka WhatsApp dengan laporan siap kirim. Struknya juga bisa dicetak ulang kapan saja.')}
          </Side>
        </div>
      </div>
    </section>
  );
}

function Side({ title, children, mock }: { title: string; children: ReactNode; mock: ReactNode }) {
  return (
    <article className="slipc">
      <h3 className="text-[26px] sm:text-[30px]">{title}</h3>
      <p className="mt-3 text-mute">{children}</p>
      <div className="mt-6">{mock}</div>
    </article>
  );
}

function Row({ l, r, bold, last }: { l: ReactNode; r: ReactNode; bold?: boolean; last?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4 py-2', !last && 'border-b border-dashed border-rule', bold && 'font-semibold')}>
      <span>{l}</span>
      <span className="text-right">{r}</span>
    </div>
  );
}

function Approval() {
  const { t } = useI18n();
  return (
    <div className={cn(box, 'p-[18px]')} role="figure" aria-label={t('Contoh persetujuan void')}>
      <p className="text-[13px] text-mute">{t('Void bill')} · #HPOS-20261015-00012</p>
      <Row l={t('Alasan')} r={t('Salah pesan')} />
      <Row l="Total" r={amount(62000)} last />
      <p className="mt-3 text-[13px] text-mute">{t('Kode persetujuan pemilik')}</p>
      <div aria-hidden className="mt-2 flex gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="grid h-11 flex-1 place-items-center border-[1.5px] border-ink bg-slip text-[18px]">
            {i < 4 ? '•' : ''}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-mute">{t('Lima kali salah: terkunci 5 menit.')}</p>
    </div>
  );
}

function Correction() {
  const { t } = useI18n();
  return (
    <div className={cn(box, 'px-[18px] pt-2')} role="figure" aria-label={t('Contoh koreksi selisih laci')}>
      <div className="flex items-center justify-between gap-3 pb-1 text-[13px] text-mute">
        <span>{t('Shift 2')}</span>
        <Tag>{t('contoh')}</Tag>
      </div>
      <Row l={t('Selisih')} r={`- ${amount(5000)}`} />
      <Row l={t('Uang masuk: kasir mengganti')} r={`+ ${amount(5000)}`} />
      <Row l={t('Selisih sesudah')} r="Rp0" bold last />
    </div>
  );
}

function Report() {
  const { t } = useI18n();
  return (
    <div role="figure" aria-label={t('Contoh laporan shift untuk WhatsApp')}>
      <div className={cn(box, 'px-[18px] pt-3')}>
        <p className="font-semibold">{t('Laporan shift 2')}</p>
        <p className="pb-2 text-[13px] text-mute">{t('Outlet Utama · contoh')}</p>
        <Row l={t('Penjualan bersih')} r={amount(4280000)} />
        <Row l={t('Refund 1: Salah pesan')} r={amount(22000)} />
        <Row l={t('Selisih kas')} r="Rp0" last />
      </div>
      <div className="mt-3 grid min-h-11 place-items-center rounded bg-pine font-sans text-[15px] font-semibold text-paper">{t('Kirim ke WA')}</div>
    </div>
  );
}
