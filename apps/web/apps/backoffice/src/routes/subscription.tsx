import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import {
  Button,
  Chip,
  Field,
  FormAlert,
  Input,
  LangToggle,
  RCut,
  RRow,
  RTotal,
  Receipt,
  StepNum,
  StepsBar,
  Tag,
  Textarea,
  ToastHost,
  Wordmark,
  addDays,
  btn,
  cn,
  dateShort,
  isoDay,
  money,
  toast,
  useI18n,
} from '@hermes-pos/ui';
import { BANK, PAID_PLANS, PLAN_NAME, SUPPORT, addMonths, perMonth, planByCode, quote, saving, type PaidCode } from '../lib/plans';
import { paymentSchema } from '../lib/schemas';
import type { Payment } from '../lib/types';
import { useForm } from '../lib/useForm';
import { getAppContext } from '../server/app';
import { getSession } from '../server/auth';
import { listPayments, submitPayment } from '../server/billing';
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

const STEP_NAMES = ['Paket', 'Transfer', 'Konfirmasi', 'Verifikasi'];

/** E3. Manual bank transfer in four steps, plus billing history. Expired plans count from activation day. */
function Checkout() {
  const { t } = useI18n();
  const { app } = Route.useRouteContext();
  const payments = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/subscription' });
  const pending = payments.find((p) => p.status === 'submitted') ?? null;
  const extraOutlets = Math.max(app.subscription.extraOutlets, app.counts.outlets - 1);

  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b-[1.5px] border-ink px-4 py-4 md:px-10">
        <Link to="/" className="flex items-baseline gap-3" aria-label={t('Ke backoffice')}>
          <Wordmark size={30} />
          <span className="hidden font-mono text-[13px] text-mute sm:inline">
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
  const router = useRouter();
  const sub = app.subscription;
  const tz = app.business.timezone;
  const expired = sub.state === 'expired';
  const [plan, setPlan] = useState<PaidCode>(
    (pending?.planCode as PaidCode | undefined) ?? (sub.plan === 'trial' || sub.plan === 'unlimited' ? 'monthly' : sub.plan),
  );
  const [step, setStep] = useState(pending ? 3 : 0);
  const [submitted, setSubmitted] = useState<Payment | null>(pending);
  const p = planByCode(plan);
  const total = quote(p, extraOutlets);
  const today = isoDay(new Date(), tz);
  // Active or trial: added to the remaining time. Expired: counted from the activation day.
  const base = expired ? today : isoDay(new Date(sub.expiresAt), tz);
  const newEnd = addMonths(base, p.months);
  const justVerified = latest?.status === 'verified' && latest.newExpiresAt && Date.now() - new Date(latest.createdAt).getTime() < 7 * 86_400_000;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,650px)_minmax(0,1fr)] lg:gap-11">
      <div className="min-w-0">
        {justVerified && !pending && step === 0 && (
          <div role="status" className="mb-6 rounded border-[1.5px] border-ink bg-pine-soft p-4">
            <p className="font-bold">{t('Pembayaran {inv} terverifikasi.', { inv: latest!.invoiceNumber })}</p>
            <p className="mt-1">{t('Paket aktif sampai {date}.', { date: dateShort(latest!.newExpiresAt!, lang, tz) })}</p>
            <Link to="/" className={`${btn('plain')} mt-3`}>
              {t('Kembali ke backoffice')}
            </Link>
          </div>
        )}
        <StepsBar steps={STEP_NAMES.map((s) => t(s))} current={step} label={t('Langkah pembayaran')} />
        <p className="mt-7 font-mono text-[14px] text-mute">{t('Langkah {n} dari 4', { n: step + 1 })}</p>
        {step === 0 && (
          <section aria-labelledby="s-t" className="animate-pop">
            <h1 id="s-t" className="page-t mt-1">
              {t('Pilih paket.')}
            </h1>
            <p className="mt-4 max-w-[34em] text-mute">
              {expired
                ? t('Langganan berakhir. Data aman; pilih paket untuk membuka kunci.')
                : t('Aktif sampai {date}. Perpanjangan menambah sisa waktu.', {
                    date: dateShort(sub.expiresAt, lang, tz),
                  })}
            </p>
            <div role="radiogroup" aria-label={t('Paket')} className="mt-7 grid gap-3 sm:grid-cols-3">
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
                    <span className="block font-mono text-[14px]">{t(x.name)}</span>
                    <span className="mt-1 block font-display text-[clamp(26px,2.4vw,30px)] font-extrabold leading-none tracking-[-0.03em]">
                      {money(x.price)}
                    </span>
                    <span className="mt-2 block font-mono text-[13px] text-mute">
                      {x.months === 1 ? t('per bulan') : t('{amount} per bulan', { amount: money(perMonth(x)) })}
                    </span>
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
                <li>{t('1 outlet. Outlet tambahan {price} per bulan.', { price: money(99_000) })}</li>
                <li>{t('3 kasir dan 100 produk per outlet.')}</li>
                <li>{t('Satu tanggal berakhir untuk seluruh bisnis.')}</li>
                <li>{t('Saat paket berakhir, data tidak dihapus. Fitur tulis terkunci sampai Anda memperpanjang.')}</li>
              </ul>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button variant="fire" onClick={() => setStep(1)}>
                {t('Lanjut ke pembayaran')}
              </Button>
              <span className="font-mono text-[15px] text-mute">Total {money(total)}</span>
            </div>
          </section>
        )}
        {step === 1 && <Transfer total={total} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && (
          <Confirm
            plan={plan}
            extraOutlets={extraOutlets}
            total={total}
            today={today}
            onBack={() => setStep(1)}
            onDone={async (pay) => {
              setSubmitted(pay);
              setStep(3);
              await router.invalidate();
            }}
          />
        )}
        {step === 3 && submitted && <Verify payment={submitted} />}
      </div>
      <aside aria-label={t('Rincian pesanan')} className="min-w-0">
        <Receipt ink torn>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold uppercase">{t('Rincian pesanan')}</span>
            <Tag>{submitted ? t('Diperiksa') : t('Draf')}</Tag>
          </div>
          <RCut />
          <RRow l={t('Faktur')} r={submitted?.invoiceNumber ?? t('belum terbit')} className="border-0 py-1.5" />
          <RRow l={t('Tanggal')} r={submitted ? dateShort(submitted.createdAt, lang, tz) : '-'} className="border-0 py-1.5" />
          <RRow l={t('Paket')} r={`${t(p.name)} · ${t(p.months === 1 ? '1 bulan' : '{n} bulan', { n: p.months })}`} className="border-0 py-1.5" />
          <RCut />
          <RRow l={t('Harga paket')} r={money(p.price)} className="border-0 py-1.5" />
          {extraOutlets > 0 && (
            <RRow
              l={t('Outlet tambahan {n} x {m} bln', { n: extraOutlets, m: p.months })}
              r={money(extraOutlets * 99_000 * p.months)}
              className="border-0 py-1.5"
            />
          )}
          <RTotal l="Total" r={money(submitted?.amountDue ?? total)} />
          <RCut />
          <RRow l={t('Setara per bulan')} r={money(Math.round(total / p.months))} className="border-0 py-1.5" />
          <RRow l={expired ? t('Berlaku sampai (perkiraan)') : t('Berlaku sampai')} r={dateShort(newEnd, lang, tz)} className="border-0 py-1.5" />
          <p className="mt-2 text-[13px] text-mute">
            {expired ? t('Masa aktif dihitung dari hari paket diaktifkan.') : t('Sisa waktu sekarang ditambahkan, tidak ada hari yang hilang.')}{' '}
            {extraOutlets > 0 && t('Outlet tambahan adalah perkiraan, jumlah akhir kami cocokkan saat verifikasi.')}
          </p>
        </Receipt>
      </aside>
    </div>
  );
}

function Transfer({ total, onBack, onNext }: { total: number; onBack: () => void; onNext: () => void }) {
  const { t } = useI18n();
  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(done));
    } catch {
      toast.error(t('Belum bisa disalin. Pilih dan salin manual.'));
    }
  }
  return (
    <section aria-labelledby="s-t" className="animate-pop">
      <h1 id="s-t" className="page-t mt-1">
        {t('Transfer ke rekening kami.')}
      </h1>
      <div className="slipc mt-7">
        <p className="font-mono text-[14px] text-mute">{t('Jumlah yang ditransfer')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <p className="big-num">{money(total)}</p>
          <Button onClick={() => copy(String(total), 'Jumlah disalin.')}>{t('Salin jumlah')}</Button>
        </div>
        <dl className="mt-6 grid gap-3 border-t-[1.5px] border-ink pt-5 sm:grid-cols-3">
          {[
            ['Bank', BANK.bank],
            ['Nomor rekening', BANK.account],
            ['Atas nama', BANK.holder],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[14px] text-mute">{t(k)}</dt>
              <dd className="mt-1 break-words font-mono font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ol className="mt-5 grid gap-3">
        {['Transfer tepat sesuai jumlah di atas supaya mudah dicocokkan.', 'Simpan bukti transfer.', 'Isi konfirmasi di langkah berikutnya.'].map((x, i) => (
          <li key={x} className="flex gap-3">
            <StepNum n={i + 1} state="todo" />
            <span className="pt-1">{t(x)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 rounded border-[1.5px] border-ink bg-fire-soft p-4">
        <p className="font-semibold">{t('Belum ada pembayaran otomatis.')}</p>
        <p className="mt-1 text-[15px]">
          {t('Transfer diperiksa manual pada {hours}.', { hours: t(SUPPORT.hours) })}
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={onBack}>{t('Kembali')}</Button>
        <Button variant="fire" onClick={onNext}>
          {t('Saya sudah transfer')}
        </Button>
      </div>
    </section>
  );
}

function Confirm({
  plan,
  extraOutlets,
  total,
  today,
  onBack,
  onDone,
}: {
  plan: PaidCode;
  extraOutlets: number;
  total: number;
  today: string;
  onBack: () => void;
  onDone: (p: Payment) => void;
}) {
  const { t } = useI18n();
  const f = useForm({ sender: '', bank: '', date: today, amount: String(total), note: '' });
  const [busy, setBusy] = useState(false);
  const differs = f.values.amount !== '' && Number(f.values.amount) !== total;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (f.values.date > today) return f.setErrors({ date: 'Tanggal transfer tidak boleh setelah hari ini.' });
    const data = f.check(paymentSchema, {
      plan,
      extraOutlets,
      sender: f.values.sender,
      bank: f.values.bank,
      date: f.values.date,
      amount: f.values.amount === '' ? NaN : Number(f.values.amount),
      note: f.values.note,
    });
    if (!data) return;
    setBusy(true);
    const res = await submitPayment({ data }).catch(() => ({
      ok: false as const,
      error: 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.',
    }));
    setBusy(false);
    if (!res.ok || !res.data) return f.fail(res.ok ? 'Terjadi kesalahan. Coba lagi.' : res.error);
    onDone(res.data);
  }
  return (
    <section aria-labelledby="s-t" className="animate-pop">
      <h1 id="s-t" className="page-t mt-1">
        {t('Konfirmasi transfer.')}
      </h1>
      <p className="mt-4 text-mute">{t('Data ini kami cocokkan dengan mutasi rekening.')}</p>
      <form method="post" noValidate onSubmit={send} className="slipc mt-7 grid gap-4">
        <Field label={t('Nama pengirim')} error={f.errors.sender && t(f.errors.sender)} help={t('Sesuai nama di rekening pengirim.')}>
          <Input autoComplete="name" value={f.values.sender} onChange={(e) => f.set('sender', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Bank asal')} error={f.errors.bank && t(f.errors.bank)}>
            <Input placeholder={t('Contoh: BCA')} value={f.values.bank} onChange={(e) => f.set('bank', e.target.value)} />
          </Field>
          <Field label={t('Tanggal transfer')} error={f.errors.date && t(f.errors.date)}>
            <Input type="date" max={today} min={addDays(today, -30)} value={f.values.date} onChange={(e) => f.set('date', e.target.value)} />
          </Field>
        </div>
        <Field
          label={t('Jumlah yang ditransfer (Rp)')}
          error={f.errors.amount && t(f.errors.amount)}
          help={
            differs ? (
              <span className="font-semibold text-error">
                {t('Berbeda dari tagihan {amount}. Tetap bisa dikirim; kami cocokkan saat verifikasi.', { amount: money(total) })}
              </span>
            ) : undefined
          }
        >
          <Input inputMode="numeric" className="font-mono" value={f.values.amount} onChange={(e) => f.set('amount', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field
          label={t('Catatan')}
          optional
          error={f.errors.note && t(f.errors.note)}
          help={t('Bukti transfer bisa dikirim ke WhatsApp {wa}.', { wa: SUPPORT.whatsapp })}
        >
          <Textarea rows={3} className="min-h-0" maxLength={300} value={f.values.note} onChange={(e) => f.set('note', e.target.value)} />
        </Field>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onBack}>{t('Kembali')}</Button>
          <Button type="submit" variant="fire" busy={busy} busyLabel={t('Mengirim...')}>
            {t('Kirim konfirmasi')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Verify({ payment }: { payment: Payment }) {
  const { t, lang } = useI18n();
  const { app } = Route.useRouteContext();
  const stages: [string, string, 'done' | 'now' | 'todo'][] = [
    [t('Paket dipilih'), t(PLAN_NAME[payment.planCode]), 'done'],
    [t('Transfer'), money(payment.amountPaid), 'done'],
    [t('Konfirmasi terkirim'), dateShort(payment.createdAt, lang, app.business.timezone), 'done'],
    [t('Diperiksa tim kami'), t('Pada {hours}', { hours: t(SUPPORT.hours) }), 'now'],
    [t('Paket aktif'), t('Tanggal berakhir baru tampil di sidebar'), 'todo'],
  ];
  return (
    <section aria-labelledby="s-t" className="animate-pop">
      <h1 id="s-t" className="page-t mt-1">
        {t('Sedang kami periksa.')}
      </h1>
      <p className="mt-4 text-mute">
        {t('Konfirmasi {inv} sudah masuk. Halaman ini boleh ditutup.', {
          inv: payment.invoiceNumber,
        })}
      </p>
      <ol className="slipc mt-7 grid gap-0">
        {stages.map(([title, sub, s], i) => (
          <li key={title} aria-current={s === 'now' ? 'step' : undefined} className="relative flex gap-4 pb-5 last:pb-0">
            {i < stages.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-32px)] border-l-[1.5px] border-dashed border-ink" />}
            <StepNum n={i + 1} state={s} />
            <span className="pt-0.5">
              <span className={cn('block font-semibold', s === 'todo' && 'text-mute')}>{title}</span>
              <span className="block text-[14px] text-mute">{sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/" className={btn('plain')}>
          {t('Kembali ke backoffice')}
        </Link>
      </div>
    </section>
  );
}

function History({ payments, selected, onSelect }: { payments: Payment[]; selected?: string; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { app } = Route.useRouteContext();
  const tz = app.business.timezone;
  const current = payments.find((p) => p.id === selected) ?? payments[0];
  const STATUS = { submitted: ['Diperiksa', 'fire'], verified: ['Lunas', 'pine'], rejected: ['Ditolak', 'mute'] } as const;
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
                    <button type="button" className="lnk font-mono text-[15px]" aria-pressed={p.id === current?.id} onClick={() => onSelect(p.id)}>
                      {p.invoiceNumber}
                    </button>
                  </td>
                  <td data-l={t('Tanggal')} className="font-mono text-[15px]">
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
            <p className="mt-1 text-[13px] uppercase text-mute">
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
              l={t('Outlet tambahan {n} x {m} bln', { n: current.extraOutlets, m: planByCode(current.planCode).months })}
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
            <p className="mt-2 text-[13px]">
              {t('Alasan')}: {current.rejectReason}
            </p>
          )}
        </Receipt>
      )}
    </div>
  );
}
