import type { ReactNode } from 'react';
import { Receipt, amount, cn, useI18n } from '@hermes-pos/ui';

/**
 * C5. Five rows from opening to closing. Each row: hour column, text, and one product mock-up.
 * Text and mock-up swap sides on every other row (RHYTHM 3). Hours and numbers are illustrations.
 */
export function WorkDay() {
  const { t } = useI18n();
  return (
    <section id="workday" aria-labelledby="workday-t" className="wrap scroll-mt-6 pt-28">
      <h2 id="workday-t" className="max-w-[12em] text-[clamp(36px,4.4vw,64px)]">
        {t('Satu hari kerja, dari buka sampai tutup.')}
      </h2>
      <p className="mt-6 max-w-[34em] text-mute">{t('Contoh hari di satu kafe. Jam dan angkanya ilustrasi, urutan dan cara kerjanya nyata.')}</p>
      <div className="mt-14 border-t-[1.5px] border-ink">
        <Row hour="07:00" stat={[t('kas awal'), '300.000']} title={t('Buka shift dengan kas awal.')} mock={<OpenShift />}>
          {t(
            'Kasir memilih nama dan mengetik PIN 6 digit, tanpa akun email. Kas awal langsung jadi entri pertama di buku kas shift. Satu kasir hanya bisa punya satu shift terbuka.',
          )}
        </Row>
        <Row alt hour="09:30" stat={[t('total bill'), '57.600']} title={t('Jam ramai, satu tangan memegang nampan.')} mock={<Bill />}>
          {t(
            'Diskon persen atau rupiah, per item atau per bill. Catatan seperti "tanpa es" tercetak di struk tanpa mengubah harga. Bill bisa ditahan, dipanggil lagi, dan dipisah tanpa sisa rupiah yang melenceng.',
          )}
        </Row>
        <Row hour="12:15" stat={[t('antrean'), t('3 menunggu')]} title={t('Sinyal hilang. Jualan jalan terus.')} mock={<Queue />}>
          {t(
            'Bill yang belum terkirim masuk antrean di perangkat dengan nomor sementara, dan struk sementara tetap bisa dicetak. Saat internet kembali, tiap bill dikirim ulang dengan kunci yang sama, jadi server menolak duplikat. Buka shift, tutup shift, dan void butuh internet.',
          )}
        </Row>
        <Row alt hour="12:16" stat={[t('tercetak'), t('3 kertas')]} title={t('Satu pesanan, tiga kertas.')} mock={<Tickets />}>
          {t(
            'Tetapkan printer per peran: kasir, dapur, bar. Kertas 58 mm atau 80 mm, merek Epson, iware, taffware, nyk, odi, atau printer ESC/POS lain. Printer yang macet tidak menggagalkan pembayaran.',
          )}
        </Row>
        <Row hour="22:00" stat={[t('selisih kas'), 'Rp0']} title={t('Tutup shift. Server yang menghitung.')} mock={<CloseChecks />}>
          {t(
            'Setiap penjualan tunai, void, dan refund tunai masuk ke buku kas otomatis. Kasir hanya menghitung uang di laci, dan selisih terhadap kas seharusnya langsung terlihat. Shift tidak bisa ditutup selama ada bill tertahan atau antrean offline.',
          )}
        </Row>
      </div>
    </section>
  );
}

function Row({
  hour,
  stat,
  title,
  children,
  mock,
  alt,
}: {
  hour: string;
  stat: [string, string];
  title: string;
  children: ReactNode;
  mock: ReactNode;
  alt?: boolean;
}) {
  return (
    <article className="grid gap-6 border-b-[1.5px] border-ink py-12 lg:grid-cols-[150px_1fr] lg:gap-0 lg:py-16">
      <div className="flex items-baseline gap-5 lg:block">
        <p className="font-mono text-[28px] leading-none tabular-nums">{hour}</p>
        <p className="font-mono text-[13px] leading-snug text-mute lg:mt-5">
          {stat[0]}
          <br className="hidden lg:block" />
          <span className="text-ink lg:text-[14px]"> {stat[1]}</span>
        </p>
      </div>
      <div className={cn('grid items-start gap-8 lg:gap-16', alt ? 'lg:grid-cols-[6fr_5fr]' : 'lg:grid-cols-[5fr_6fr]')}>
        <div className={cn(alt && 'lg:order-2')}>
          <h3 className="text-[30px] sm:text-[36px]">{title}</h3>
          <p className="mt-4 text-mute">{children}</p>
        </div>
        <div className={cn('min-w-0 max-w-[480px]', alt && 'lg:order-1')}>{mock}</div>
      </div>
    </article>
  );
}

const box = 'border border-line bg-slip font-mono text-[14px] tabular-nums';

function OpenShift() {
  const { t } = useI18n();
  return (
    <div className={cn(box, 'p-[22px]')} aria-label={t('Contoh form buka shift')} role="figure">
      <MRow l={t('Kasir')} r={`[${t('Nama kasir')}]`} />
      <MRow l="PIN" r="• • • • • •" />
      <MRow l={t('Kas awal')} r="Rp300.000" last />
      <div className="mt-4 grid min-h-12 place-items-center rounded bg-pine font-sans text-[15px] font-semibold text-paper">{t('Buka shift')}</div>
    </div>
  );
}

function Bill() {
  const { t } = useI18n();
  return (
    <div className={cn(box, 'p-[22px]')} aria-label={t('Contoh bill')} role="figure">
      <MRow l="2 × Kopi susu" r={amount(44000)} plain />
      <p className="-mt-1 pb-3 text-[13px] text-mute">
        {t('Catatan')}: tanpa es · {t('Diskon item 10%')}
      </p>
      <MRow l="1 × Roti bakar" r={amount(18000)} />
      <MRow l="Subtotal" r={amount(62000)} />
      <MRow l={t('Diskon')} r={amount(-4400)} />
      <MRow l={<b className="font-semibold">Total</b>} r={<b className="font-semibold">{amount(57600)}</b>} last />
      <div className="mt-4 flex gap-2 font-sans text-[14px] font-medium">
        <span className="grid min-h-11 place-items-center rounded border-[1.5px] border-ink px-3">{t('Tahan')}</span>
        <span className="grid min-h-11 place-items-center rounded border-[1.5px] border-ink px-3">{t('Pisah bill')}</span>
        <span className="grid min-h-11 flex-1 place-items-center rounded border-[1.5px] border-ink bg-fire px-3">{t('Bayar tunai')}</span>
      </div>
    </div>
  );
}

function Queue() {
  const { t } = useI18n();
  return (
    <div className={box} aria-label={t('Contoh antrean offline')} role="figure">
      <div className="flex justify-between bg-pine px-[22px] py-4 text-[13px] font-semibold text-paper">
        <span>OFFLINE</span>
        <span>{t('3 menunggu')}</span>
      </div>
      {[
        ['TUNDA-7F3A2C', 62000],
        ['TUNDA-1B90D4', 35000],
        ['TUNDA-C48E19', 18000],
      ].map(([n, v]) => (
        <div key={n} className="flex justify-between border-b border-rule px-[22px] py-3.5">
          <span>{n}</span>
          <span>{amount(v as number)}</span>
        </div>
      ))}
      <p className="px-[22px] py-3.5 text-[13px] text-mute">{t('Sinkron otomatis tiap 30 detik selama antrean belum kosong.')}</p>
    </div>
  );
}

function Tickets() {
  const { t } = useI18n();
  const items: [string, string, string[]][] = [
    [t('Struk'), t('pelanggan'), ['2 × Kopi susu', 'tanpa es', '1 × Roti bakar', '', amount(57600)]],
    [t('Tiket'), t('dapur'), ['1 × Roti bakar']],
    [t('Tiket'), t('bar'), ['2 × Kopi susu', 'tanpa es']],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label={t('Contoh struk pelanggan, tiket dapur, dan tiket bar')} role="figure">
      {items.map(([a, b, lines], i) => (
        <Receipt key={b} torn className={cn('p-3.5 text-[13px] leading-relaxed', i === 1 && 'lg:mt-5', i === 2 && 'lg:mt-2')}>
          <p className="font-semibold">{a}</p>
          <p className="mb-2 text-mute">{b}</p>
          {lines.map((l, j) =>
            l ? (
              <p key={j} className={j === lines.length - 1 && i === 0 ? 'mt-1 font-semibold' : ''}>
                {l}
              </p>
            ) : (
              <br key={j} />
            ),
          )}
        </Receipt>
      ))}
    </div>
  );
}

function CloseChecks() {
  const { t } = useI18n();
  return (
    <div className={cn(box, 'px-[22px] pt-3')} aria-label={t('Contoh pemeriksaan sebelum tutup shift')} role="figure">
      <MRow l={t('Bill tertahan')} r="0" />
      <MRow l={t('Antrean offline')} r="0" />
      <MRow l={t('Kas seharusnya')} r={amount(2874000)} />
      <MRow l={t('Hitungan kasir')} r={amount(2874000)} last />
      <div className="-mx-[22px] mt-3 flex justify-between bg-fire px-[22px] py-4 font-semibold">
        <span>{t('Selisih')}</span>
        <span>Rp0</span>
      </div>
    </div>
  );
}

function MRow({ l, r, last, plain }: { l: ReactNode; r: ReactNode; last?: boolean; plain?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4 py-2.5', !last && !plain && 'border-b border-dashed border-rule')}>
      <span>{l}</span>
      <span className="text-right">{r}</span>
    </div>
  );
}
