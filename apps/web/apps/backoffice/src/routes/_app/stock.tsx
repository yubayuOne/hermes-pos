import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, amount, isoDay, useI18n } from '@hermes-pos/ui';
import { OutletFilter } from '../../components/OutletFilter';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useApp, useLock } from '../../lib/app';
import { opnameSaveSchema } from '../../lib/schemas';
import type { OpnameRow } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { listStockOpname, saveStockOpname } from '../../server/stock';
import { pageHead } from '../../lang';

type Search = { outlet?: string; date?: string };
/** One barang's typed cells. Blank = not typed. */
type Line = { opening: string; in: string; out: string; closing: string; note: string };

export const Route = createFileRoute('/_app/stock')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    outlet: typeof s.outlet === 'string' ? s.outlet : undefined,
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const tz = context.app.business.timezone;
    const today = isoDay(new Date(), tz);
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    // A day in the future is not counted: the sheet opens on today instead.
    const date = deps.date && deps.date <= today ? deps.date : today;
    if (!outletId) return { outletId, today, date, rows: [] as OpnameRow[] };
    return { outletId, today, date, rows: await listStockOpname({ data: { outletId, date } }) };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Stock Opname|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Stock Opname|menu'),
  component: StockOpname,
});

/** Blank = null; a comma or a dot both count as the decimal mark. */
const parse = (s: string): number | null => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
};

/** Selisih = Stok Akhir - (Stok Awal + Stok Masuk - Stok Keluar). null until both the count and the opening are known. */
function difference(r: OpnameRow, l: Line): number | null {
  const closing = parse(l.closing);
  const opening = r.openingEditable ? parse(l.opening) : r.opening;
  if (closing === null || opening === null) return null;
  return Math.round((closing - (opening + (parse(l.in) ?? 0) - (parse(l.out) ?? 0))) * 1000) / 1000;
}

function initial(rows: OpnameRow[]): Record<string, Line> {
  return Object.fromEntries(
    rows.map((r) => [
      r.ingredientId,
      {
        opening: r.openingEditable && r.opening !== null ? String(r.opening) : '',
        in: r.saved ? String(r.incoming) : '',
        out: r.saved ? String(r.out) : '',
        closing: r.closing !== null ? String(r.closing) : '',
        note: r.note ?? '',
      },
    ]),
  );
}

/**
 * Stock Opname (106, 107): every counted barang of one day. Stok Awal is carried from the day before (typed only the first
 * time). Stok Masuk, Stok Keluar and Stok Akhir are typed, Selisih is worked out. The note button keeps a reason.
 */
function StockOpname() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const app = useApp();
  const navigate = useNavigate({ from: '/stock' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const outlet = app.outlets.find((o) => o.id === data.outletId);

  return (
    <Page title={t('Stock Opname|menu')}>
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('Outlet')}>
          <OutletFilter all={false} value={data.outletId} onChange={(id) => set({ outlet: id ?? undefined })} />
        </Field>
        <Field label={t('Tanggal')}>
          <Input type="date" max={data.today} value={data.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        {outlet && <p className="pb-3 text-small text-mute">{outlet.name}</p>}
      </div>

      {data.rows.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada barang yang dihitung stoknya.')}>
          {t('Atur di halaman Barang, lalu isi stok di sini.')}
        </Empty>
      ) : (
        <OpnameSheet key={`${data.outletId}-${data.date}`} outletId={data.outletId ?? ''} date={data.date} rows={data.rows} />
      )}
    </Page>
  );
}

function OpnameSheet({ outletId, date, rows }: { outletId: string; date: string; rows: OpnameRow[] }) {
  const { t } = useI18n();
  const act = useAction();
  const lock = useLock();
  const [lines, setLines] = useState<Record<string, Line>>(() => initial(rows));
  const [noteFor, setNoteFor] = useState<string | null>(null);
  // A saved day, or the day before changing, starts the sheet again from the server's rows.
  useEffect(() => setLines(initial(rows)), [rows]);

  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ({ ...ls, [id]: { ...ls[id], ...patch } as Line }));
  const counted = rows.filter((r) => parse(lines[r.ingredientId]?.closing ?? '') !== null);

  async function save() {
    // The first count of a barang needs its opening stock; the server checks the rest.
    const missing = counted.find((r) => r.openingEditable && parse(lines[r.ingredientId]?.opening ?? '') === null);
    if (missing) return act.setError(t('Stok awal {name}: isi angka.', { name: missing.name }));
    const check = opnameSaveSchema.safeParse({
      outletId,
      date,
      rows: counted.map((r) => {
        const l = lines[r.ingredientId] as Line;
        return {
          ingredientId: r.ingredientId,
          opening: r.openingEditable ? parse(l.opening) : null,
          in: parse(l.in) ?? 0,
          out: parse(l.out) ?? 0,
          closing: parse(l.closing) as number,
          note: l.note,
        };
      }),
    });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    await act.run(() => saveStockOpname({ data: check.data }), { success: t('Stock opname disimpan.') });
  }

  return (
    <div className="mt-6 grid gap-5">
      <div className="tbl-wrap">
        <table className="tbl tbl-card">
          <thead>
            <tr>
              <th scope="col" className="min-w-48">
                {t('Barang')}
              </th>
              <th scope="col" className="num">
                {t('Stok awal')}
              </th>
              <th scope="col" className="num">
                {t('Stok masuk')}
              </th>
              <th scope="col" className="num">
                {t('Stok keluar')}
              </th>
              <th scope="col" className="num">
                {t('Stok akhir')}
              </th>
              <th scope="col" className="num">
                {t('Selisih')}
              </th>
              <th scope="col">
                <span className="sr-only">{t('Catatan')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = lines[r.ingredientId] ?? { opening: '', in: '', out: '', closing: '', note: '' };
              const diff = difference(r, l);
              return (
                <tr key={r.ingredientId}>
                  <td data-l={t('Barang')} className="min-w-48">
                    <span className="font-semibold">{r.name}</span>
                    <span className="block text-small text-mute">
                      {r.category || t('Tanpa kategori')} · {r.unit}
                    </span>
                  </td>
                  <td data-l={t('Stok awal')} className="num">
                    {r.openingEditable ? (
                      <Input
                        inputMode="decimal"
                        className="font-mono text-right"
                        aria-label={`${t('Stok awal')} ${r.name}`}
                        value={l.opening}
                        onChange={(e) => set(r.ingredientId, { opening: e.target.value })}
                      />
                    ) : (
                      amount(r.opening ?? 0)
                    )}
                  </td>
                  <td data-l={t('Stok masuk')} className="num">
                    <Input
                      inputMode="decimal"
                      className="font-mono text-right"
                      aria-label={`${t('Stok masuk')} ${r.name}`}
                      value={l.in}
                      onChange={(e) => set(r.ingredientId, { in: e.target.value })}
                    />
                  </td>
                  <td data-l={t('Stok keluar')} className="num">
                    <Input
                      inputMode="decimal"
                      className="font-mono text-right"
                      aria-label={`${t('Stok keluar')} ${r.name}`}
                      value={l.out}
                      onChange={(e) => set(r.ingredientId, { out: e.target.value })}
                    />
                  </td>
                  <td data-l={t('Stok akhir')} className="num">
                    <Input
                      inputMode="decimal"
                      className="font-mono text-right"
                      aria-label={`${t('Stok akhir')} ${r.name}`}
                      value={l.closing}
                      onChange={(e) => set(r.ingredientId, { closing: e.target.value })}
                    />
                  </td>
                  <td data-l={t('Selisih')} className={`num font-semibold ${diff !== null && diff !== 0 ? 'text-error' : ''}`}>
                    {diff === null ? '—' : `${diff > 0 ? '+' : ''}${amount(diff)}`}
                  </td>
                  <td data-l="" className="text-right">
                    <Button sm onClick={() => setNoteFor(r.ingredientId)}>
                      {l.note ? t('Ubah catatan') : t('Catatan selisih')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-small text-mute">{t('{n} barang dihitung', { n: counted.length })}</p>
          <Button variant="fire" onClick={save} disabled={counted.length === 0 || act.busy} {...lock.props} busy={act.busy} busyLabel={t('Menyimpan...')}>
            {lock.label(t('Simpan stock opname'))}
          </Button>
        </div>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </Card>

      {noteFor && (
        <NoteDialog
          name={rows.find((r) => r.ingredientId === noteFor)?.name ?? ''}
          note={lines[noteFor]?.note ?? ''}
          onSave={(note) => {
            set(noteFor, { note });
            setNoteFor(null);
          }}
          onClose={() => setNoteFor(null)}
        />
      )}
    </div>
  );
}

function NoteDialog({ name, note, onSave, onClose }: { name: string; note: string; onSave: (note: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(note);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Catatan selisih {name}', { name })}
      description={t('Misalnya tumpah, rusak, atau salah hitung. Catatan ikut tersimpan saat stock opname disimpan.')}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button variant="fire" onClick={() => onSave(value.trim())}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      <Field label={t('Catatan')} help={`${value.trim().length}/200`}>
        <Input maxLength={200} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Dialog>
  );
}
