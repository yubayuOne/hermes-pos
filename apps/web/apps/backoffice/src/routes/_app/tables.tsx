import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Empty, Field, FormAlert, Input, Switch, Tag, time, useI18n } from '@hermes-pos/ui';
import { OutletField } from '../../components/Filters';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { useApp, useLock } from '../../lib/app';
import { tableSchema } from '../../lib/schemas';
import type { OutletTable } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { listTables, saveTable, setTableActive } from '../../server/tables';
import { pageHead } from '../../lang';

type Search = { outlet?: string };

export const Route = createFileRoute('/_app/tables')({
  validateSearch: (s: Record<string, unknown>): Search => ({ outlet: typeof s.outlet === 'string' ? s.outlet : undefined }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const outletId = deps.outlet ?? context.app.outlets[0]?.id ?? null;
    return { outletId, tables: outletId ? await listTables({ data: { outletId } }) : ([] as OutletTable[]) };
  },
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Meja|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Meja|menu'),
  component: Tables,
});

/** Tables of the outlet. The cashier picks one for each dine-in bill; a table with a held bill cannot be renamed or turned off. */
function Tables() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const navigate = useNavigate({ from: '/tables' });
  const { outletId, tables } = Route.useLoaderData();
  const [editing, setEditing] = useState<OutletTable | 'new' | null>(null);
  const toggle = useAction();

  function setActive(tb: OutletTable, active: boolean) {
    toggle.run(() => setTableActive({ data: { id: tb.id, active } }), {
      toastError: true,
      success: active ? t('Meja {name} aktif lagi.', { name: tb.name }) : t('Meja {name} dinonaktifkan.', { name: tb.name }),
    });
  }

  const add = (
    <Button variant="fire" className="w-full sm:w-auto" onClick={() => setEditing('new')} {...lock.props}>
      {lock.label(t('Tambah meja'))}
    </Button>
  );

  return (
    <Page title={t('Meja|menu')}>
      {app.outlets.length > 1 && (
        <OutletField all={false} value={outletId} onChange={(id) => navigate({ search: { outlet: id ?? undefined }, replace: true })} />
      )}
      {tables.length === 0 ? (
        <Empty className="mt-6" title={t('Belum ada meja.')} action={add}>
          {t('Kasir memilih meja untuk setiap bill makan di tempat. Bill yang ditahan wajib punya meja.')}
        </Empty>
      ) : (
        <>
          <div className="mt-6 flex justify-end">{add}</div>
          <div className="tbl-wrap mt-6">
            <table className="tbl tbl-card">
              <thead>
                <tr>
                  <th scope="col">{t('Meja')}</th>
                  <th scope="col">{t('Status')}</th>
                  <th scope="col">{t('Aktif')}</th>
                  <th scope="col">
                    <span className="sr-only">{t('Ubah')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tables.map((tb, i) => (
                  <tr key={tb.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <td data-l={t('Meja')}>
                      <span className="font-semibold">{tb.name}</span>
                    </td>
                    <td data-l={t('Status')}>
                      {tb.occupied ? (
                        <Tag tone="fire">{t('Terisi sejak {time}', { time: tb.since ? time(tb.since, app.business.timezone) : '-' })}</Tag>
                      ) : (
                        t('Kosong')
                      )}
                    </td>
                    <td data-l={t('Aktif')}>
                      <span className="inline-flex items-center gap-3">
                        <Switch
                          checked={tb.isActive}
                          label={t('Meja {name} aktif', { name: tb.name })}
                          disabled={lock.locked || toggle.busy}
                          onChange={(v) => setActive(tb, v)}
                        />
                        <span className="w-16 text-left text-[15px]">{tb.isActive ? t('Aktif') : t('Nonaktif')}</span>
                      </span>
                    </td>
                    <td>
                      <Button sm onClick={() => setEditing(tb)} disabled={lock.locked} aria-label={t('Ubah meja {name}', { name: tb.name })}>
                        {t('Ubah')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && outletId && <TableDialog outletId={outletId} table={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function TableDialog({ outletId, table, onClose }: { outletId: string; table: OutletTable | null; onClose: () => void }) {
  const { t } = useI18n();
  const f = useForm({ outletId, id: table?.id ?? null, name: table?.name ?? '' });
  const act = useAction();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(tableSchema);
    if (!data) return;
    const res = await act.run(() => saveTable({ data }), { success: t('Meja {name} disimpan.', { name: data.name }) });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={table ? t('Ubah meja') : t('Tambah meja')}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button type="submit" form="save-table" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      <form id="save-table" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Nama meja')} error={f.errors.name && t(f.errors.name)} help={t('Contoh: 1, 2, Teras. Kasir memilih meja dari nama ini.')}>
          <Input autoFocus maxLength={20} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}
