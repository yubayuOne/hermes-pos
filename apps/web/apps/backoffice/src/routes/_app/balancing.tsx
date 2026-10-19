import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Select, Tag, dateLong, isoDay, money, time, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination } from '../../components/Pagination';
import { PeriodFilter } from '../../components/PeriodFilter';
import { Stat } from '../../components/Stat';
import { useApp, useLock } from '../../lib/app';
import { type PeriodSearch, parsePeriod, periodRange } from '../../lib/period';
import { adjustmentSchema } from '../../lib/schemas';
import type { ShiftAdjustment, ShiftBalance } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { addAdjustment, listBalances } from '../../server/balancing';
import { pageHead } from '../../lang';

type Search = PeriodSearch & { outlet?: string; page?: number };
/** Shifts per page, as the server sends them (owner_list_shift_balances). */
const PAGE = 50;

export const Route = createFileRoute('/_app/balancing')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...parsePeriod(s),
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    page: Number.isInteger(s.page) && (s.page as number) > 1 ? (s.page as number) : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const range = periodRange(deps, today);
    const list = await listBalances({ data: { outletId: deps.outlet ?? null, ...range, tz, page: deps.page ?? 1 } });
    return { ...list, range, today };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Balancing|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Balancing|menu'),
  component: Balancing,
});

/**
 * D14. Balancing per shift (migration 071): what the cashier recorded stays as it is; the owner adds a signed line with a
 * reason for the drawer, the sales, or the expenses. The database writes the cash book and recomputes the variance.
 */
function Balancing() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/balancing' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const [adding, setAdding] = useState<ShiftBalance | null>(null);
  return (
    <Page
      title={t('Balancing|menu')}
      tools={<OutletFilter value={search.outlet ?? null} onChange={(id) => set({ outlet: id ?? undefined, page: undefined })} />}
    >
      <p className="max-w-[46em] text-mute">
        {t('Catatan kasir tidak diubah. Koreksi ditambahkan per shift dengan alasan; kalau salah, tambahkan koreksi kebalikannya.')}
      </p>
      <div className="mt-5">
        <PeriodFilter value={search} range={data.range} today={data.today} onChange={(patch) => set({ ...patch, page: undefined })} />
      </div>
      {data.rows.length === 0 ? (
        <Empty className="mt-6" title={t('Tidak ada shift di periode ini.')}>
          {t('Shift yang dibuka kasir di aplikasi muncul di sini.')}
        </Empty>
      ) : (
        <div className="mt-6 grid gap-4">
          {data.rows.map((s) => (
            <ShiftCard key={s.id} shift={s} onAdd={() => setAdding(s)} />
          ))}
        </div>
      )}
      <Pagination page={search.page ?? 1} pages={Math.max(1, Math.ceil(data.total / PAGE))} onPage={(p) => set({ page: p > 1 ? p : undefined })} />
      {adding && <AdjustDialog shift={adding} onClose={() => setAdding(null)} />}
    </Page>
  );
}

const KIND_LABEL: Record<ShiftAdjustment['kind'], string> = { cash: 'Kas laci', sales: 'Omzet', expense: 'Pengeluaran' };

function ShiftCard({ shift: s, onAdd }: { shift: ShiftBalance; onAdd: () => void }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const tz = useApp().business.timezone;
  const signed = (n: number) => `${n > 0 ? '+' : ''}${money(n)}`;
  return (
    <Card as="article" aria-label={t('Shift {n}, {date}', { n: s.shiftNumber, date: dateLong(`${s.businessDate}T12:00:00Z`, lang, 'UTC') })}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {dateLong(`${s.businessDate}T12:00:00Z`, lang, 'UTC')} · {t('Shift {n}', { n: s.shiftNumber })}
          </p>
          <p className="text-[14px] text-mute">
            {s.outletName} · {s.cashierName}
          </p>
        </div>
        {s.open && <Tag tone="fire">{t('shift masih buka')}</Tag>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 border-t-[1.5px] border-ink pt-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t('Omzet')} value={money(s.sales)} />
        <Stat label={t('Pengeluaran')} value={money(s.expenses)} />
        <Stat label={t('Kas seharusnya')} value={money(s.expectedCash)} />
        <Stat label={t('Kas dihitung')} value={s.closingCash === null ? '-' : money(s.closingCash)} />
        <Stat label={t('Selisih')} value={s.variance === null ? '-' : signed(s.variance)} />
      </dl>
      {s.adjustments.length > 0 && (
        <ul className="mt-4 grid gap-1.5 border-t border-rule pt-3 text-[14px]" aria-label={t('Koreksi')}>
          {s.adjustments.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">
                {t(KIND_LABEL[a.kind])}
                {a.category && ` (${t(a.category === 'belanja' ? 'Belanja' : 'Operasional')})`}
              </span>
              <span className="font-mono">{signed(a.amount)}</span>
              <span className="text-mute">
                · {a.reason} · {time(a.createdAt, tz)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Button sm onClick={onAdd} {...lock.props}>
          {lock.label(t('Tambah koreksi'))}
        </Button>
      </div>
    </Card>
  );
}

/** Six choices carry kind and direction in one dropdown; the amount is always typed as a positive number. */
const CHOICES = [
  { v: 'cash_in', kind: 'cash', sign: 1, label: 'Kas masuk ke laci', help: 'Kas seharusnya naik. Selisih shift ikut dihitung ulang.' },
  { v: 'cash_out', kind: 'cash', sign: -1, label: 'Kas keluar dari laci', help: 'Kas seharusnya turun. Selisih shift ikut dihitung ulang.' },
  { v: 'sales_up', kind: 'sales', sign: 1, label: 'Omzet ditambah', help: 'Omzet dan laba naik. Kas laci tidak berubah.' },
  { v: 'sales_down', kind: 'sales', sign: -1, label: 'Omzet dikurangi', help: 'Omzet dan laba turun. Kas laci tidak berubah.' },
  { v: 'expense_up', kind: 'expense', sign: 1, label: 'Pengeluaran ditambah', help: 'Total pengeluaran naik. Kas laci tidak berubah.' },
  { v: 'expense_down', kind: 'expense', sign: -1, label: 'Pengeluaran dikurangi', help: 'Total pengeluaran turun. Kas laci tidak berubah.' },
] as const;

function AdjustDialog({ shift: s, onClose }: { shift: ShiftBalance; onClose: () => void }) {
  const { t, lang } = useI18n();
  const act = useAction();
  const [choice, setChoice] = useState<(typeof CHOICES)[number]['v']>('cash_in');
  const [category, setCategory] = useState<'operasional' | 'belanja'>('belanja');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const c = CHOICES.find((x) => x.v === choice) ?? CHOICES[0];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const check = adjustmentSchema.safeParse({
      shiftId: s.id,
      kind: c.kind,
      amount: amount === '' ? Number.NaN : c.sign * Number(amount),
      category: c.kind === 'expense' ? category : null,
      reason,
    });
    if (!check.success) {
      setErrors(Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const res = await act.run(() => addAdjustment({ data: check.data }), {
      success: t('Koreksi shift {n} disimpan: {label} {amount}.', { n: s.shiftNumber, label: t(c.label), amount: money(Number(amount)) }),
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Tambah koreksi')}
      description={`${dateLong(`${s.businessDate}T12:00:00Z`, lang, 'UTC')} · ${t('Shift {n}', { n: s.shiftNumber })} · ${s.outletName}`}
      footer={
        <>
          <Button onClick={onClose} disabled={act.busy}>
            {t('Batal')}
          </Button>
          <Button type="submit" form="adjust" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan koreksi')}
          </Button>
        </>
      }
    >
      <form id="adjust" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Jenis')} help={t(c.help)}>
          <Select value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)}>
            {CHOICES.map((x) => (
              <option key={x.v} value={x.v}>
                {t(x.label)}
              </option>
            ))}
          </Select>
        </Field>
        {c.kind === 'expense' && (
          <Field label={t('Kategori')} error={errors.category && t(errors.category)}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="belanja">{t('Belanja')}</option>
              <option value="operasional">{t('Operasional')}</option>
            </Select>
          </Field>
        )}
        <Field label={t('Nominal (Rp)')} error={errors.amount && t(errors.amount)}>
          <Input
            inputMode="numeric"
            maxLength={13}
            className="font-mono"
            value={amount && Number(amount).toLocaleString('id-ID')}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Field>
        <Field label={t('Alasan')} error={errors.reason && t(errors.reason)}>
          <Input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}
