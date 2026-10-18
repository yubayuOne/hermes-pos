import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button, Dialog, Empty, Field, FormAlert, Input, Select, Switch, Tag, time, useI18n } from '@hermes-pos/ui';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { VoidCodeCard } from '../../components/VoidCodeCard';
import { useApp, useLock } from '../../lib/app';
import { cashierCreateSchema, cashierPinSchema } from '../../lib/schemas';
import type { Cashier } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { createCashier, listCashiers, setCashierActive, setCashierPin } from '../../server/manage';
import { pageHead } from '../../lang';

export const Route = createFileRoute('/_app/cashiers')({
  loader: () => listCashiers(),
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Kasir|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Kasir|menu'),
  component: Cashiers,
});

/** D7. Cashiers have no email; they sign in with their name and a 6-digit PIN. */
function Cashiers() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const cashiers = Route.useLoaderData();
  const [adding, setAdding] = useState(false);
  const [pinFor, setPinFor] = useState<Cashier | null>(null);
  const toggle = useAction();

  function setActive(c: Cashier, active: boolean) {
    toggle.run(() => setCashierActive({ data: { cashierId: c.cashierId, active } }), {
      toastError: true,
      success: active ? t('{name} aktif lagi.', { name: c.name }) : t('{name} dinonaktifkan.', { name: c.name }),
      undo: () => setCashierActive({ data: { cashierId: c.cashierId, active: !active } }),
    });
  }

  return (
    <Page title={t('Kasir|menu')}>
      {cashiers.length > 0 && (
        <div className="flex justify-end">
          <Button variant="fire" className="w-full sm:w-auto" onClick={() => setAdding(true)} {...lock.props}>
            {lock.label(t('Tambah kasir'))}
          </Button>
        </div>
      )}
      {cashiers.length === 0 ? (
        <Empty
          className="mt-6"
          title={t('Belum ada kasir.')}
          action={
            <Button variant="fire" onClick={() => setAdding(true)} {...lock.props}>
              {lock.label(t('Tambah kasir'))}
            </Button>
          }
        >
          {t('Buat kasir pertama supaya aplikasi kasir bisa dipakai berjualan.')}
        </Empty>
      ) : (
        <div className="tbl-wrap mt-6">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Kasir')}</th>
                <th scope="col">Outlet</th>
                <th scope="col">Status</th>
                <th scope="col">PIN</th>
              </tr>
            </thead>
            <tbody>
              {cashiers.map((c, i) => {
                const locked = c.lockedUntil && new Date(c.lockedUntil).getTime() > Date.now();
                return (
                  <tr key={c.cashierId} style={{ animationDelay: `${i * 50}ms` }}>
                    <td data-l={t('Kasir')}>
                      <span className="font-semibold">{c.name}</span>
                      {locked && (
                        <Tag tone="fire" className="ml-2">
                          {t('terkunci sampai {time}', { time: time(c.lockedUntil!, app.business.timezone) })}
                        </Tag>
                      )}
                    </td>
                    <td data-l="Outlet">{c.outletName}</td>
                    <td data-l="Status">
                      <span className="inline-flex items-center gap-3">
                        <Switch
                          checked={c.isActive}
                          label={t('Kasir {name} aktif', { name: c.name })}
                          disabled={lock.locked || toggle.busy}
                          onChange={(v) => setActive(c, v)}
                        />
                        <span className="w-16 text-left text-[15px]">{c.isActive ? t('Aktif') : t('Nonaktif')}</span>
                      </span>
                    </td>
                    <td data-l="PIN">
                      <button type="button" className="lnk" onClick={() => setPinFor(c)} disabled={lock.locked}>
                        {lock.locked ? t('Terkunci') : t('Ubah PIN')}
                        <span className="sr-only"> {c.name}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-8 max-w-[640px]">
        <VoidCodeCard />
      </div>
      {adding && <AddCashier onClose={() => setAdding(false)} />}
      {pinFor && <ChangePin cashier={pinFor} onClose={() => setPinFor(null)} />}
    </Page>
  );
}

function AddCashier({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const app = useApp();
  const f = useForm({ name: '', outletId: app.outlets[0]?.id ?? '', pin: '' });
  const act = useAction();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(cashierCreateSchema);
    if (!data) return;
    const res = await act.run(() => createCashier({ data }), { success: t('Kasir {name} ditambahkan.', { name: data.name }), refreshAppContext: true });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Tambah kasir')}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button type="submit" form="add-cashier" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan kasir')}
          </Button>
        </>
      }
    >
      <form id="add-cashier" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Nama kasir')} error={f.errors.name && t(f.errors.name)} help={t('Tampil di daftar kasir aplikasi dan di laporan.')}>
          <Input autoFocus value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <Field label="Outlet" error={f.errors.outletId && t(f.errors.outletId)}>
          <Select value={f.values.outletId} onChange={(e) => f.set('outletId', e.target.value)}>
            {app.outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('PIN 6 digit')} error={f.errors.pin && t(f.errors.pin)}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="font-mono tracking-[0.3em]"
            value={f.values.pin}
            onChange={(e) => f.set('pin', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

function ChangePin({ cashier, onClose }: { cashier: Cashier; onClose: () => void }) {
  const { t } = useI18n();
  const f = useForm({ pin: '' });
  const act = useAction();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(cashierPinSchema, { cashierId: cashier.cashierId, pin: f.values.pin });
    if (!data) return;
    const res = await act.run(() => setCashierPin({ data }), { success: t('PIN {name} diganti.', { name: cashier.name }) });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Ubah PIN')}
      description={t('PIN baru untuk {name}. Disimpan sebagai hash dan berlaku langsung.', { name: cashier.name })}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button type="submit" form="change-pin" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan PIN')}
          </Button>
        </>
      }
    >
      <form id="change-pin" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('PIN baru')} error={f.errors.pin && t(f.errors.pin)}>
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="font-mono tracking-[0.3em]"
            value={f.values.pin}
            onChange={(e) => f.set('pin', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}
