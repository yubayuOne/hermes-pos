import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Tag, cn, dateLong, isoDay, money, time, useI18n } from '@hermes-pos/ui';
import { FilterBar } from '../../components/Filters';
import { Pagination } from '../../components/Pagination';
import { PeriodFilter, usePeriodLabel } from '../../components/PeriodFilter';
import { type PeriodSearch, parsePeriod, periodError, periodRange } from '../../lib/period';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useApp, useLock } from '../../lib/app';
import { cashMovementSchema } from '../../lib/schemas';
import type { CheckFailure, DayClose, DayShift, ShiftList, TrailEntry } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { addCashMovement, getDay, listShifts } from '../../server/closing';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; page?: number };

/** The shifts of a period, ten a page. Opens on this month, with the same period filter as the other lists. */
export const Route = createFileRoute('/_app/closing')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    period: parsePeriod(s).period ?? 'month',
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const today = isoDay(new Date(), context.app.business.timezone);
    const range = periodRange(deps, today);
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    const page = deps.page ?? 1;
    if (!outletId) return { outletId, range, today, page, list: { total: 0, rows: [] } as ShiftList, day: null as DayClose | null };
    const [list, day] = await Promise.all([
      listShifts({ data: { outletId, from: range.from, to: range.to, page } }),
      // One day only: its checks and the corrections of that day.
      range.from === range.to ? getDay({ data: { outletId, date: range.from } }) : Promise.resolve(null),
    ]);
    return { outletId, range, today, page, list, day };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Shift|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Shift|menu'),
  component: Closing,
});

/**
 * D14. One outlet, one business day: each shift's cash counted against what the records say, line by line, and the
 * automatic balance checks. A shift's difference is fixed here with Uang masuk / Uang keluar, on any day (078: no day lock).
 */
function Closing() {
  const { t, lang } = useI18n();
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/closing' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [moving, setMoving] = useState<{ shift: DayShift; direction: 'in' | 'out' } | null>(null);
  const app = useApp();
  const periodLabel = usePeriodLabel(search, data.range);
  const pages = Math.max(1, Math.ceil(data.list.total / 10));
  const outletName = app.outlets.find((o) => o.id === data.outletId)?.name;
  // Shifts of the page, grouped by business day (newest day first, as the server sends them).
  const byDay = data.list.rows.reduce<[string, DayShift[]][]>((acc, s) => {
    const day = s.businessDate ?? '';
    const last = acc[acc.length - 1];
    if (last && last[0] === day) last[1].push(s);
    else acc.push([day, [s]]);
    return acc;
  }, []);
  return (
    <Page title={t('Shift|menu')}>
      <FilterBar
        outlet={<OutletFilter all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />}
        active={search.period && search.period !== 'month' ? 1 : 0}
        summary={[outletName, periodLabel, t('{n} shift', { n: data.list.total })].filter(Boolean).join(' · ')}
        current={search}
        validate={(v) => periodError(v, data.today)}
        onApply={(c) => set({ ...c, page: undefined })}
      >
        {(d) => <PeriodFilter value={d.values} range={data.range} today={data.today} onChange={d.set} />}
      </FilterBar>
      {data.day && <Checks failures={data.day.checks} shifts={data.day.shifts} />}
      {data.list.total === 0 ? (
        <Empty className="mt-6" title={t('Tidak ada shift di periode ini.')}>
          {t('Shift yang dibuka kasir di aplikasi muncul di sini.')}
        </Empty>
      ) : (
        <div className="mt-6 grid gap-8">
          {byDay.map(([day, list]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="border-b-[1.5px] border-ink pb-2 font-display text-title font-extrabold">
                {dateLong(`${day}T12:00:00Z`, lang, 'UTC')}
              </h2>
              <div className="mt-4 grid gap-5">
                {list.map((s) => (
                  <ShiftCard key={s.id} shift={s} onMove={(direction) => setMoving({ shift: s, direction })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Pagination page={data.page} pages={pages} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
      {data.day && <Trail entries={data.day.trail} />}
      {moving && <MoveDialog shift={moving.shift} direction={moving.direction} onClose={() => setMoving(null)} />}
    </Page>
  );
}

/** Everything that undid or changed something that day (ACCOUNTING.md 5.2). */
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
      <ul className="mt-2 grid gap-1.5 text-small">
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
      <ul className="mt-2 grid list-disc gap-1 pl-5 text-body">
        {failures.map((f, i) => (
          <li key={i}>{text(f)}</li>
        ))}
      </ul>
      <p className="mt-2 text-small text-mute">{t('Hubungi dukungan HERMES POS dan sebutkan tanggal serta outlet ini.')}</p>
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

function ShiftCard({ shift: s, onMove }: { shift: DayShift; onMove: (direction: 'in' | 'out') => void }) {
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
          <p className="font-mono text-small text-mute">
            {time(s.openedAt, tz)} – {s.closedAt ? time(s.closedAt, tz) : t('masih buka')} · {t('{n} bill', { n: s.bills })} ·{' '}
            {t('omzet {amount}', { amount: money(s.netSales) })}
          </p>
        </div>
        {s.open ? <Tag tone="fire">{t('shift masih buka')}</Tag> : <Tag>{t('ditutup')}</Tag>}
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <section aria-label={t('Kas laci')}>
          <h3 className="font-mono text-small uppercase tracking-[0.04em] text-mute">{t('Kas laci')}</h3>
          <dl className="mt-1 text-body">
            <Row label={t('Kas awal')} value={s.opening} />
            <Row label={t('Penjualan tunai')} value={s.cashSales} />
            <Row label={t('Refund tunai')} value={s.cashRefunds} minus />
            {s.drawerExpenses !== 0 && <Row label={t('Pengeluaran dari laci')} value={s.drawerExpenses} minus />}
            {s.cashIn > 0 && <Row label={t('Uang masuk')} value={s.cashIn} />}
            {s.cashOut > 0 && <Row label={t('Uang keluar')} value={s.cashOut} minus />}
            <Row label={t('Kas seharusnya')} value={s.expected} strong />
            <Row label={t('Kas dihitung kasir')} value={s.counted} />
          </dl>
          {s.variance !== null && <Difference value={s.variance} />}
        </section>
        <section aria-label="QRIS">
          <h3 className="font-mono text-small uppercase tracking-[0.04em] text-mute">QRIS</h3>
          <dl className="mt-1 text-body">
            <Row label={t('Penjualan QRIS')} value={s.qrisSales} />
            <Row label={t('Refund QRIS')} value={s.qrisRefunds} minus />
            <Row label={t('QRIS seharusnya masuk')} value={s.qrisExpected} strong />
            <Row label={t('QRIS di aplikasi merchant')} value={s.qrisReported} />
          </dl>
          {s.qrisVariance !== null && <Difference value={s.qrisVariance} />}
        </section>
      </div>

      {(s.movements.length > 0 || s.oldCorrections.length > 0) && (
        <ul className="mt-4 grid gap-1.5 border-t border-rule pt-3 text-small" aria-label={t('Catatan uang laci')}>
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

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button sm onClick={() => onMove('in')} {...lock.props}>
          {lock.label(t('Uang masuk'))}
        </Button>
        <Button sm onClick={() => onMove('out')} {...lock.props}>
          {lock.label(t('Uang keluar'))}
        </Button>
      </div>
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
