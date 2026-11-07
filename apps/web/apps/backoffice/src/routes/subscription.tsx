import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  Chip,
  FormAlert,
  LangToggle,
  RCut,
  RRow,
  RTotal,
  Receipt,
  Tag,
  ToastHost,
  Wordmark,
  btn,
  cn,
  dateShort,
  isoDay,
  money,
  useI18n,
} from '@hermes-pos/ui';
import { PAID_PLANS, PLAN_NAME, addPeriod, planByCode, quote, saving, type PaidCode } from '../lib/plans';
import type { Payment } from '../lib/types';
import { useAction } from '../lib/useAction';
import { getAppContext } from '../server/app';
import { getSession } from '../server/auth';
import { listPayments, startMidtransPayment } from '../server/billing';
import { pageHead } from '../lang';

export const Route = createFileRoute('/subscription')({
  validateSearch: (s: Record<string, unknown>): { tab?: 'history'; invoice?: string } => ({
    tab: s.tab === 'history' ? 'history' : undefined,
    invoice: typeof s.invoice === 'string' ? s.invoice : undefined,
  }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/login' });
    if (!session.businessId) throw redirect({ to: '/onboarding', search: { step: 1 } });
    return { app: await getAppContext() };
  },
  loader: () => listPayments(),
  head: ({ match }) => pageHead(match.context.lang, 'Langganan'),
  component: Checkout,
});


/** E3. Manual bank transfer in four steps, plus billing history. Expired plans count from activation day. */
function Checkout() {
  const { t } = useI18n();
  const { app } = Route.useRouteContext();
  const payments = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/subscription' });
  const pending = payments.find((p) => p.status === 'pending' || p.status === 'submitted') ?? null;
  const extraOutlets = Math.max(app.subscription.extraOutlets, app.counts.outlets - 1);

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b-[1.5px] border-ink px-4 py-4 md:px-10">
        <Link to="/" className="flex items-baseline gap-3" aria-label={t('Ke backoffice')}>
          <Wordmark size={30} />
          <span className="hidden font-mono text-small text-mute sm:inline">
            {t('langganan')} · {app.business.name}
          </span>
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LangToggle />
          <nav aria-label={t('Bagian langganan')} className="flex gap-2">
            <Chip aria-current={search.tab !== 'history' ? 'page' : undefined} onClick={() => navigate({ search: {} })}>
              {t('Berlangganan')}
            </Chip>
            <Chip aria-current={search.tab === 'history' ? 'page' : undefined} onClick={() => navigate({ search: { tab: 'history' } })}>
              {t('Riwayat tagihan')}
            </Chip>
          </nav>
          <Link to="/" className="lnk px-1">
            {t('Ke backoffice')}
          </Link>
        </div>
      </header>
      <main id="content" className="mx-auto max-w-[1180px] px-4 pb-16 pt-6 md:px-10 md:pt-8">
        <ToastHost />
        {search.tab === 'history' ? (
          <History payments={payments} selected={search.invoice} onSelect={(id) => navigate({ search: { tab: 'history', invoice: id } })} />
        ) : (
          <Buy pending={pending} extraOutlets={extraOutlets} latest={payments[0] ?? null} />
        )}
      </main>
    </div>
  );
}

function Buy({ pending, extraOutlets, latest }: { pending: Payment | null; extraOutlets: number; latest: Payment | null }) {
  const { t, lang } = useI18n();
  const { app } = Route.useRouteContext();
  const act = useAction();
  const sub = app.subscription;
  const tz = app.business.timezone;
  const expired = sub.state === 'expired';
  const [plan, setPlan] = useState<PaidCode>(planByCode(pending?.planCode ?? sub.plan).code);
  const p = planByCode(plan);
  const total = quote(p, extraOutlets);
  const today = isoDay(new Date(), tz);
  // Active or trial: added to the remaining time. Expired: counted from the activation day.
  const base = expired ? today : isoDay(new Date(sub.expiresAt), tz);
  const newEnd = addPeriod(base, p);
  const justVerified = latest?.status === 'verified' && latest.newExpiresAt && Date.now() - new Date(latest.createdAt).getTime() < 7 * 86_400_000;

  // The database prices the plan and keeps one open order; Midtrans hosts the page the owner pays on.
  async function pay() {
    const res = await act.run(() => startMidtransPayment({ data: { plan, extraOutlets } }));
    if (res && res.ok && res.data) window.location.assign(res.data.url);
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,650px)_minmax(0,1fr)] lg:gap-11">
      <div className="min-w-0">
        {justVerified && (
          <div role="status" className="mb-6 rounded border-[1.5px] border-ink bg-pine-soft p-4">
            <p className="font-bold">{t('Pembayaran {inv} terverifikasi.', { inv: latest!.invoiceNumber })}</p>
            <p className="mt-1">{t('Paket aktif sampai {date}.', { date: dateShort(latest!.newExpiresAt!, lang, tz) })}</p>
            <Link to="/" className={`${btn('plain')} mt-3`}>
              {t('Kembali ke backoffice')}
            </Link>
          </div>
        )}
        {pending?.provider === 'midtrans' && (
          <div role="status" className="mb-6 rounded border-[1.5px] border-ink bg-fire-soft p-4">
            <p className="font-bold">{t('Pembayaran {inv} belum selesai.', { inv: pending.invoiceNumber })}</p>
            <p className="mt-1">{t('Paket aktif setelah Midtrans menerima pembayaran.')}</p>
          </div>
        )}
        {pending?.provider === 'manual' && (
          <div role="status" className="mb-6 rounded border-[1.5px] border-ink bg-slip p-4">
            <p className="font-bold">{t('Transfer {inv} sedang diperiksa.', { inv: pending.invoiceNumber })}</p>
          </div>
        )}
        <h1 className="page-t mt-1">{t('Pilih paket.')}</h1>
        <p className="mt-4 max-w-[34em] text-mute">
          {expired
            ? t('Langganan berakhir. Data aman; pilih paket untuk membuka kunci.')
            : t('Aktif sampai {date}. Perpanjangan menambah sisa waktu.', { date: dateShort(sub.expiresAt, lang, tz) })}
        </p>
        <div role="radiogroup" aria-label={t('Paket')} className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PAID_PLANS.map((x) => {
            const on = x.code === plan;
            return (
              <button
                key={x.code}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPlan(x.code)}
                className={cn(
                  'min-h-[140px] rounded border-[1.5px] border-ink p-4 text-left transition-colors',
                  on ? 'border-l-[12px] border-l-pine bg-pine-soft' : 'bg-slip hover:bg-tint-3',
                )}
              >
                <span className="block font-mono text-small">{t(x.name)}</span>
                <span className="mt-1 block font-mono text-small text-mute">
                  <s>{money(x.list)}</s>
                </span>
                <span className="mt-1 block font-display text-[clamp(26px,2.4vw,30px)] font-extrabold leading-none tracking-[-0.03em]">
                  {money(x.price)}
                </span>
                <span className="mt-2 block font-mono text-small text-mute">{t('per {unit}', { unit: t(x.unit) })}</span>
                {saving(x) > 0 && (
                  <Tag tone="fire" className="mt-2">
                    {t('hemat {amount}', { amount: money(saving(x)) })}
                  </Tag>
                )}
              </button>
            );
          })}
        </div>
        <div className="slipc mt-5">
          <h2 className="card-t">{t('Yang termasuk')}</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>{t('1 outlet. Outlet tambahan {price} per {unit}.', { price: money(p.extraOutlet), unit: t(p.unit) })}</li>
            <li>{t('3 kasir dan 100 produk per outlet.')}</li>
            <li>{t('Satu tanggal berakhir untuk seluruh bisnis.')}</li>
            <li>{t('Saat paket berakhir, data tidak dihapus. Fitur tulis terkunci sampai Anda memperpanjang.')}</li>
          </ul>
        </div>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button variant="fire" onClick={pay} busy={act.busy} busyLabel={t('Menyiapkan pembayaran...')}>
            {pending?.provider === 'midtrans' ? t('Lanjutkan pembayaran') : t('Bayar dengan Midtrans')}
          </Button>
          <span className="font-mono text-body text-mute">Total {money(total)}</span>
        </div>
      </div>
      <aside aria-label={t('Rincian pesanan')} className="min-w-0">
        <Receipt ink torn>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold uppercase">{t('Rincian pesanan')}</span>
            <Tag>{pending ? t('Menunggu') : t('Draf')}</Tag>
          </div>
          <RCut />
          <RRow l={t('Faktur')} r={pending?.invoiceNumber ?? t('belum terbit')} className="border-0 py-1.5" />
          <RRow l={t('Paket')} r={`${t(p.name)} · ${p.months > 0 ? t('{n} bulan', { n: p.months }) : t('{n} hari', { n: p.days })}`} className="border-0 py-1.5" />
          <RCut />
          <RRow l={t('Harga paket')} r={money(p.price)} className="border-0 py-1.5" />
          {extraOutlets > 0 && (
            <RRow
              l={t('Outlet tambahan {n} x {m}', { n: extraOutlets, m: money(p.extraOutlet) })}
              r={money(extraOutlets * p.extraOutlet)}
              className="border-0 py-1.5"
            />
          )}
          <RTotal l="Total" r={money(pending?.amountDue ?? total)} />
          <RCut />
          {p.months > 0 && <RRow l={t('Setara per bulan')} r={money(Math.round(total / p.months))} className="border-0 py-1.5" />}
          <RRow l={expired ? t('Berlaku sampai (perkiraan)') : t('Berlaku sampai')} r={dateShort(newEnd, lang, tz)} className="border-0 py-1.5" />
          <p className="mt-2 text-small text-mute">
            {expired ? t('Masa aktif dihitung dari hari paket diaktifkan.') : t('Sisa waktu sekarang ditambahkan, tidak ada hari yang hilang.')}
          </p>
        </Receipt>
      </aside>
    </div>
  );
}

function History({ payments, selected, onSelect }: { payments: Payment[]; selected?: string; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { app } = Route.useRouteContext();
  const tz = app.business.timezone;
  const current = payments.find((p) => p.id === selected) ?? payments[0];
  const STATUS = { pending: ['Menunggu bayar', 'mute'], submitted: ['Diperiksa', 'fire'], verified: ['Lunas', 'pine'], rejected: ['Ditolak', 'mute'] } as const;
  if (payments.length === 0) {
    return (
      <div className="slipc py-10">
        <h1 className="text-[32px] md:text-[40px]">{t('Belum ada tagihan.')}</h1>
        <p className="mt-3 text-mute">{t('Faktur muncul di sini setelah Anda mengirim konfirmasi transfer.')}</p>
        <Link to="/subscription" search={{}} className={`${btn('fire')} mt-5`}>
          {t('Pilih paket dan bayar')}
        </Link>
      </div>
    );
  }
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section aria-labelledby="h-t">
        <h1 id="h-t" className="page-t">
          {t('Riwayat tagihan')}
        </h1>
        <div className="tbl-wrap mt-6">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Faktur')}</th>
                <th scope="col">{t('Tanggal')}</th>
                <th scope="col">{t('Paket')}</th>
                <th scope="col" className="num">
                  {t('Jumlah')}
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={p.id === current?.id ? 'bg-tint-3' : ''}>
                  <td data-l={t('Faktur')}>
                    <button type="button" className="lnk font-mono text-body" aria-pressed={p.id === current?.id} onClick={() => onSelect(p.id)}>
                      {p.invoiceNumber}
                    </button>
                  </td>
                  <td data-l={t('Tanggal')} className="font-mono text-body">
                    {dateShort(p.createdAt, lang, tz)}
                  </td>
                  <td data-l={t('Paket')}>{t(PLAN_NAME[p.planCode])}</td>
                  <td data-l={t('Jumlah')} className="num">
                    {money(p.amountDue)}
                  </td>
                  <td data-l="Status">
                    <Tag tone={STATUS[p.status][1]}>{t(STATUS[p.status][0])}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {current && (
        <Receipt ink torn label={t('Faktur {inv}', { inv: current.invoiceNumber })}>
          <div className="head">
            <Wordmark size={22} />
            <p className="mt-1 text-small uppercase text-mute">
              {t('Faktur')} · {current.invoiceNumber}
            </p>
          </div>
          <RCut />
          <RRow l={t('Bisnis')} r={app.business.name} className="border-0 py-1.5" />
          <RRow l={t('Tanggal')} r={dateShort(current.createdAt, lang, tz)} className="border-0 py-1.5" />
          <RRow l={t('Paket')} r={t(PLAN_NAME[current.planCode])} className="border-0 py-1.5" />
          <RRow l={t('Harga paket')} r={money(planByCode(current.planCode).price)} className="border-0 py-1.5" />
          {current.extraOutlets > 0 && (
            <RRow
              l={t('Outlet tambahan {n} x {m}', { n: current.extraOutlets, m: money(planByCode(current.planCode).extraOutlet) })}
              r={money(current.amountDue - planByCode(current.planCode).price)}
              className="border-0 py-1.5"
            />
          )}
          <RTotal l="Total" r={money(current.amountDue)} />
          <RRow l={t('Dibayar')} r={money(current.amountPaid)} className="border-0 py-1.5" />
          <RRow l={t('Pengirim')} r={`${current.senderName} · ${current.bankName}`} className="border-0 py-1.5" />
          <RRow l="Status" r={t(STATUS[current.status][0])} className="border-0 py-1.5" />
          {current.newExpiresAt && <RRow l={t('Berlaku sampai')} r={dateShort(current.newExpiresAt, lang, tz)} className="border-0 py-1.5" />}
          {current.rejectReason && (
            <p className="mt-2 text-small">
              {t('Alasan')}: {current.rejectReason}
            </p>
          )}
        </Receipt>
      )}
    </div>
  );
}
