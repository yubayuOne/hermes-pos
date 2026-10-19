import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Tag, cn, dateLong, dateShort, isoDay, money, time, useI18n } from '@hermes-pos/ui';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useApp, useLock } from '../../lib/app';
import { cashMovementSchema, dayLockSchema, dayReopenSchema } from '../../lib/schemas';
import type { CheckFailure, DayClose, DayShift, TrailEntry } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { addCashMovement, closeDay, getDay, reopenDay } from '../../server/closing';
import { pageHead } from '../../lang';

type Search = { outlet?: string; date?: string };
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export const Route = createFileRoute('/_app/closing')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    date: isDay(s.date) ? s.date : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const today = isoDay(new Date(), context.app.business.timezone);
    const date = deps.date && deps.date <= today ? deps.date : today;
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    if (!outletId) return { outletId, date, today, day: null };
    return { outletId, date, today, day: await getDay({ data: { outletId, date } }) };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Tutup hari|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Tutup hari|menu'),
  component: Closing,
});

/**
 * D14. One outlet, one business day: each shift's cash counted against what the records say, line by line, and the
 * automatic balance checks. Cash that went into or out of a drawer outside sales and expenses is recorded here.
 */
function Closing() {
  const { t, lang } = useI18n();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/closing' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [moving, setMoving] = useState<{ shift: DayShift; direction: 'in' | 'out' } | null>(null);
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const locked = !!data.day?.closed;
  return (
    <Page title={t('Tutup hari|menu')}>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
          <OutletField all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined })} />
        </div>
        <Field label={t('Tanggal')} className="w-full sm:w-[200px]">
          <Input type="date" max={data.today} value={data.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
      </div>
      {!data.day ? null : (
        <>
          <Checks failures={data.day.checks} shifts={data.day.shifts} />
          <DayStatus day={data.day} onClose={() => setDialog('close')} onReopen={() => setDialog('reopen')} />
          {data.day.shifts.length === 0 ? (
            <Empty className="mt-6" title={t('Tidak ada shift pada {date}.', { date: dateLong(`${data.date}T12:00:00Z`, lang, 'UTC') })}>
              {t('Shift yang dibuka kasir di aplikasi muncul di sini.')}
            </Empty>
          ) : (
            <div className="mt-6 grid gap-5">
              {data.day.shifts.map((s) => (
                <ShiftCard key={s.id} shift={s} locked={locked} onMove={(direction) => setMoving({ shift: s, direction })} />
              ))}
            </div>
          )}
          <Trail entries={data.day.trail} />
        </>
      )}
      {moving && <MoveDialog shift={moving.shift} direction={moving.direction} onClose={() => setMoving(null)} />}
      {dialog === 'close' && data.day && data.outletId && (
        <CloseDayDialog outletId={data.outletId} date={data.date} shifts={data.day.shifts} onClose={() => setDialog(null)} />
      )}
      {dialog === 'reopen' && data.outletId && <ReopenDialog outletId={data.outletId} date={data.date} onClose={() => setDialog(null)} />}
    </Page>
  );
}

/** Everything that undid or changed something that day, to review before locking it (ACCOUNTING.md 5.2). */
function Trail({ entries }: { entries: TrailEntry[] }) {
  const { t } = useI18n();
  const tz = useApp().business.timezone;
  if (entries.length === 0) return null;
  const label: Record<TrailEntry['kind'], string> = {
    void: t('Void'),
    correction: t('Koreksi bill'),
    refund: t('Refund'),
    expense_cancel: t('Pengeluaran dibatalkan'),
    stock_adjustment: t('Penyesuaian stok'),
    stock_opname: t('Hitung stok'),
  };
  return (
    <Card as="section" aria-label={t('Koreksi dan pembatalan')} className="mt-5">
      <h2 className="font-semibold">{t('Koreksi dan pembatalan')}</h2>
      <ul className="mt-2 grid gap-1.5 text-[14px]">
        {entries.map((e, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="font-semibold">{label[e.kind]}</span>
            {e.ref && <span className="font-mono">{e.ref}</span>}
            <span className="font-mono">{money(e.amount)}</span>
            <span className="text-mute">
              {e.reason && `· ${e.reason} `}· {time(e.at, tz)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The day's lock (075). A closed day cannot change anywhere: the cashier app and this backoffice both get refused. The
 * owner closes it once every shift is closed and every check is clean, and can reopen it with a reason.
 */
function DayStatus({ day, onClose, onReopen }: { day: DayClose; onClose: () => void; onReopen: () => void }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const tz = useApp().business.timezone;
  const c = day.closed;
  const openShifts = day.shifts.some((s) => s.open);
  if (!c && day.shifts.length === 0) return null;
  return (
    <Card as="section" aria-label={t('Status hari')} className="mt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {c ? t('Hari sudah ditutup dan dikunci.') : t('Hari belum ditutup.')}
            {c && <Tag tone="pine">{t('terkunci')}</Tag>}
          </p>
          <p className="mt-1 text-[15px] text-mute">
            {c
              ? t(
                  'Bill, kas, dan pengeluaran hari itu tidak bisa diubah lagi. Koreksi yang ketahuan kemudian dicatat di hari yang masih buka, misalnya lewat refund.',
                )
              : openShifts
                ? t('Tutup semua shift di aplikasi kasir dulu.')
                : day.checks.length > 0
                  ? t('Selesaikan angka yang tidak cocok dulu.')
                  : t('Kalau semua sudah dicek, tutup dan kunci harinya agar laporannya tidak berubah lagi.')}
          </p>
          {c && (
            <dl className="mt-2 text-[15px]">
              <Row label={t('QRIS tercatat')} value={c.qrisBook} />
              <Row label={t('QRIS masuk rekening')} value={c.qrisSettled} />
            </dl>
          )}
          {c?.qrisDifference != null && <Difference value={c.qrisDifference} />}
        </div>
        {c ? (
          <Button sm onClick={onReopen} {...lock.props}>
            {lock.label(t('Buka kunci'))}
          </Button>
        ) : (
          <Button variant="fire" onClick={onClose} disabled={openShifts || day.checks.length > 0 || lock.props.disabled}>
            {lock.label(t('Tutup dan kunci hari'))}
          </Button>
        )}
      </div>
      {day.log.length > 0 && (
        <ul className="mt-4 grid gap-1 border-t border-rule pt-3 text-[14px] text-mute" aria-label={t('Riwayat tutup hari')}>
          {day.log.map((g, i) => (
            <li key={i}>
              <span className="font-semibold text-ink">{g.action === 'close' ? t('Ditutup') : t('Dibuka lagi')}</span> · {dateShort(g.at, lang, tz)}{' '}
              {time(g.at, tz)}
              {g.reason && ` · ${g.reason}`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CloseDayDialog({ outletId, date, shifts, onClose }: { outletId: string; date: string; shifts: DayShift[]; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [bank, setBank] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Preview only: the database takes the QRIS total from its own records when the day closes.
  const qrisBook = shifts.reduce((n, s) => n + (s.qrisReported ?? s.qrisExpected), 0);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = dayLockSchema.safeParse({ outletId, date, qrisSettled: bank === '' ? null : Number(bank), note });
    if (!check.success) return setErrors(Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    const res = await act.run(() => closeDay({ data: check.data }), { success: t('Hari ditutup dan dikunci.') });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Tutup dan kunci hari')}
      description={t('Setelah dikunci, bill, kas, dan pengeluaran hari itu tidak bisa diubah. Kunci bisa dibuka lagi dengan alasan.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="close-day" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Tutup dan kunci')}
          </Button>
        </>
      }
    >
      <form id="close-day" noValidate onSubmit={save} className="grid gap-4">
        <p className="text-[15px]">{t('QRIS tercatat: {amount}.', { amount: money(qrisBook) })}</p>
        <Field
          label={t('QRIS masuk rekening (Rp)')}
          error={errors.qrisSettled && t(errors.qrisSettled)}
          help={t('Lihat mutasi rekening. Kosongkan kalau dananya belum masuk; selisihnya dihitung saat diisi.')}
        >
          <Input
            inputMode="numeric"
            maxLength={13}
            className="font-mono"
            value={bank && Number(bank).toLocaleString('id-ID')}
            onChange={(e) => setBank(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Field>
        <Field label={t('Catatan (opsional)')} error={errors.note && t(errors.note)}>
          <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

function ReopenDialog({ outletId, date, onClose }: { outletId: string; date: string; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = dayReopenSchema.safeParse({ outletId, date, reason });
    if (!check.success) return setError(check.error.issues[0]?.message ?? '');
    setError('');
    const res = await act.run(() => reopenDay({ data: check.data }), { success: t('Kunci hari dibuka.') });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Buka kunci hari')}
      description={t('Hari itu bisa diubah lagi sampai ditutup ulang. Alasannya tercatat di riwayat.')}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="reopen-day" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Buka kunci')}
          </Button>
        </>
      }
    >
      <form id="reopen-day" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Alasan')} error={error && t(error)} help={t('Contoh: bill salah bayar baru ketahuan.')}>
          <Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

/** The automatic checks in plain words. Every rule is in docs/ACCOUNTING.md section 1. */
function Checks({ failures, shifts }: { failures: CheckFailure[]; shifts: DayShift[] }) {
  const { t } = useI18n();
  if (shifts.length === 0) return null;
  if (failures.length === 0)
    return (
      <p role="status" className="mt-5 rounded border-[1.5px] border-ink bg-pine-soft px-4 py-3 font-semibold">
        {t('Semua angka hari ini cocok: setiap bill, uang tunai, QRIS, dan produk seimbang.')}
      </p>
    );
  const text = (f: CheckFailure) => {
    const d = f.detail;
    switch (f.rule) {
      case 'P1':
        return t('Satu catatan tidak seimbang (selisih {amount}).', { amount: money(Number(d.difference)) });
      case 'P2':
        return t('Bill {number}: total tidak sama dengan item, diskon, atau pembayarannya.', { number: String(d.number ?? '') });
      case 'P3':
        return t('Omzet bersih ({sales}) tidak sama dengan uang yang diterima ({received}).', {
          sales: money(Number(d.netSales)),
          received: money(Number(d.received)),
        });
      case 'P4':
        return t('Total per produk ({products}) tidak sama dengan omzet ({sales}).', {
          products: money(Number(d.byProduct)),
          sales: money(Number(d.netSales)),
        });
      case 'P7':
        return t('Stok {name} ({stock}) tidak sama dengan riwayat stoknya ({book}).', {
          name: String(d.name ?? ''),
          stock: String(d.stock ?? ''),
          book: String(d.book ?? ''),
        });
      default:
        return t('Shift {n}: buku kas tidak cocok dengan catatan kasnya.', { n: String(d.shiftNumber ?? '') });
    }
  };
  return (
    <section role="alert" className="mt-5 rounded border-[1.5px] border-ink bg-fire-soft px-4 py-3">
      <p className="font-semibold">{t('Ada angka yang tidak cocok. Laporan hari ini belum bisa dipercaya penuh.')}</p>
      <ul className="mt-2 grid list-disc gap-1 pl-5 text-[15px]">
        {failures.map((f, i) => (
          <li key={i}>{text(f)}</li>
        ))}
      </ul>
      <p className="mt-2 text-[14px] text-mute">{t('Ini bukan kesalahan kasir biasa. Hubungi dukungan HERMES POS dan sebutkan tanggal dan outlet ini.')}</p>
    </section>
  );
}

function Row({ label, value, strong, minus }: { label: string; value: number | null; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4 py-1.5', strong && 'border-t-[1.5px] border-ink pt-2 font-semibold')}>
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums">{value === null ? '-' : `${minus && value > 0 ? '−' : ''}${money(value)}`}</dd>
    </div>
  );
}

function Difference({ value: v }: { value: number }) {
  const { t } = useI18n();
  return (
    <p className={cn('mt-2 rounded px-3 py-2 font-semibold', v === 0 ? 'bg-pine-soft' : 'bg-fire-soft')}>
      {v === 0 ? t('Cocok') : v < 0 ? t('Kurang {amount}', { amount: money(-v) }) : t('Lebih {amount}', { amount: money(v) })}
    </p>
  );
}

function ShiftCard({ shift: s, locked, onMove }: { shift: DayShift; locked: boolean; onMove: (direction: 'in' | 'out') => void }) {
  const { t } = useI18n();
  const lock = useLock();
  const tz = useApp().business.timezone;
  return (
    <Card as="article" aria-label={t('Shift {n}', { n: s.shiftNumber })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {t('Shift {n}', { n: s.shiftNumber })} · {s.cashierName}
          </p>
          <p className="font-mono text-[14px] text-mute">
            {time(s.openedAt, tz)} – {s.closedAt ? time(s.closedAt, tz) : t('masih buka')} · {t('{n} bill', { n: s.bills })} ·{' '}
            {t('omzet {amount}', { amount: money(s.netSales) })}
          </p>
        </div>
        {s.open ? <Tag tone="fire">{t('shift masih buka')}</Tag> : <Tag>{t('ditutup')}</Tag>}
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <section aria-label={t('Kas laci')}>
          <h3 className="font-mono text-[13px] uppercase tracking-[0.04em] text-mute">{t('Kas laci')}</h3>
          <dl className="mt-1 text-[15px]">
            <Row label={t('Kas awal')} value={s.opening} />
            <Row label={t('Penjualan tunai')} value={s.cashSales} />
            <Row label={t('Refund tunai')} value={s.cashRefunds} minus />
            <Row label={t('Pengeluaran dari laci')} value={s.drawerExpenses} minus />
            {s.cashIn > 0 && <Row label={t('Uang masuk')} value={s.cashIn} />}
            {s.cashOut > 0 && <Row label={t('Uang keluar')} value={s.cashOut} minus />}
            <Row label={t('Kas seharusnya')} value={s.expected} strong />
            <Row label={t('Kas dihitung kasir')} value={s.counted} />
          </dl>
          {s.variance !== null && <Difference value={s.variance} />}
        </section>
        <section aria-label="QRIS">
          <h3 className="font-mono text-[13px] uppercase tracking-[0.04em] text-mute">QRIS</h3>
          <dl className="mt-1 text-[15px]">
            <Row label={t('Penjualan QRIS')} value={s.qrisSales} />
            <Row label={t('Refund QRIS')} value={s.qrisRefunds} minus />
            <Row label={t('QRIS seharusnya masuk')} value={s.qrisExpected} strong />
            <Row label={t('QRIS di aplikasi merchant')} value={s.qrisReported} />
          </dl>
          {s.qrisVariance !== null && <Difference value={s.qrisVariance} />}
        </section>
      </div>

      {(s.movements.length > 0 || s.oldCorrections.length > 0) && (
        <ul className="mt-4 grid gap-1.5 border-t border-rule pt-3 text-[14px]" aria-label={t('Catatan uang laci')}>
          {s.movements.map((m) => (
            <li key={m.id} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{m.direction === 'in' ? t('Uang masuk') : t('Uang keluar')}</span>
              <span className="font-mono">{money(m.amount)}</span>
              <span className="text-mute">
                · {m.reason} · {time(m.createdAt, tz)}
              </span>
            </li>
          ))}
          {s.oldCorrections.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-2 text-mute">
              <span className="font-semibold">{a.kind === 'sales' ? t('Koreksi omzet lama') : t('Koreksi pengeluaran lama')}</span>
              <span className="font-mono">{money(a.amount)}</span>
              <span>· {a.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button sm onClick={() => onMove('in')} {...lock.props}>
            {lock.label(t('Uang masuk'))}
          </Button>
          <Button sm onClick={() => onMove('out')} {...lock.props}>
            {lock.label(t('Uang keluar'))}
          </Button>
        </div>
      )}
    </Card>
  );
}

function MoveDialog({ shift: s, direction, onClose }: { shift: DayShift; direction: 'in' | 'out'; onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = cashMovementSchema.safeParse({ shiftId: s.id, direction, amount: amount === '' ? Number.NaN : Number(amount), reason });
    if (!check.success) return setErrors(Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    const res = await act.run(() => addCashMovement({ data: check.data }), {
      success:
        direction === 'in'
          ? t('Uang masuk {amount} dicatat di shift {n}.', { amount: money(check.data.amount), n: s.shiftNumber })
          : t('Uang keluar {amount} dicatat di shift {n}.', { amount: money(check.data.amount), n: s.shiftNumber }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={direction === 'in' ? t('Uang masuk ke laci') : t('Uang keluar dari laci')}
      description={
        direction === 'in'
          ? t('Uang yang ditambahkan ke laci, bukan dari penjualan. Kas seharusnya shift {n} naik.', { n: s.shiftNumber })
          : t('Uang yang diambil dari laci, bukan pengeluaran. Kas seharusnya shift {n} turun.', { n: s.shiftNumber })
      }
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="move" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      <form id="move" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Nominal (Rp)')} error={errors.amount && t(errors.amount)}>
          <Input
            inputMode="numeric"
            maxLength={13}
            className="font-mono"
            value={amount && Number(amount).toLocaleString('id-ID')}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Field>
        <Field
          label={t('Alasan')}
          error={errors.reason && t(errors.reason)}
          help={direction === 'in' ? t('Contoh: tambah uang kecil dari brankas.') : t('Contoh: diambil pemilik, disetor ke bank.')}
        >
          <Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}
