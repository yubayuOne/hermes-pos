import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button, Check, Dialog, Field, FormAlert, Input, Tag, Textarea, cn, money, useI18n } from '@hermes-pos/ui';
import { OutletLogo } from '../../components/OutletLogo';
import { Page } from '../../components/Page';
import { Stat } from '../../components/Stat';
import { useApp, useLock } from '../../lib/app';
import { EXTRA_OUTLET, SUPPORT } from '../../lib/plans';
import { outletUpdateSchema } from '../../lib/schemas';
import type { Outlet } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { applyReceiptText, updateOutlet } from '../../server/manage';
import { pageHead } from '../../lang';

export const Route = createFileRoute('/_app/outlets')({
  head: ({ match }) => pageHead(match.context.lang, 'Outlet|menu'),
  component: Outlets,
});

/** D6. One card per outlet; the first is included in the plan (pine edge), the rest are extra (fire edge). */
function Outlets() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState<Outlet | null>(null);
  const sub = app.subscription;
  return (
    <Page title={t('Outlet|menu')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[44em] text-mute">
          {t('Paket berisi 1 outlet. Outlet tambahan {price} per bulan.', {
            price: money(EXTRA_OUTLET),
          })}
        </p>
        <Button variant="fire" onClick={() => setInfo(true)} {...lock.props}>
          {lock.label(t('Tambah outlet'))}
        </Button>
      </div>
      <ul className="mt-6 grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
        {app.outlets.map((o, i) => {
          const usage = sub.usage.find((u) => u.outletId === o.id);
          const included = i === 0;
          return (
            <li
              key={o.id}
              className={cn('slipc animate-rise border-l-[12px]', included ? 'border-l-pine' : 'border-l-fire')}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="card-t text-[28px]">{o.name}</h2>
                <Tag tone={included ? 'pine' : 'fire'}>{included ? t('termasuk paket') : t('tambahan')}</Tag>
              </div>
              <p className="mt-2 text-mute">{o.address || `[${t('Alamat outlet')}]`}</p>
              {o.phone && <p className="font-mono text-small text-mute">{o.phone}</p>}
              <Button sm className="mt-3" onClick={() => setEditing(o)} {...lock.props}>
                {lock.label(t('Ubah data outlet'))}
                <span className="sr-only"> {o.name}</span>
              </Button>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-dashed border-ink pt-4">
                <Stat label={t('Kasir aktif')} value={`${usage?.cashiers ?? '-'} / ${sub.limits.cashiers}`} />
                <Stat label={t('Produk aktif')} value={`${usage?.products ?? '-'} / ${sub.limits.products}`} />
              </dl>
              <OutletLogo outlet={o} />
              {!o.isActive && (
                <Tag tone="mute" className="mt-4">
                  {t('Nonaktif')}
                </Tag>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={info}
        onOpenChange={setInfo}
        title={t('Tambah outlet')}
        description={t('{price} per outlet per bulan, aktif setelah dibayar.', {
          price: money(EXTRA_OUTLET),
        })}
        footer={
          <Button variant="fire" onClick={() => setInfo(false)}>
            {t('Mengerti')}
          </Button>
        }
      >
        <p>
          {t(
            'Hubungi WhatsApp {wa} untuk menambah outlet.',
            { wa: SUPPORT.whatsapp },
          )}
        </p>
      </Dialog>
      {editing && <EditOutlet outlet={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

/** Name, address, phone, and the outlet's receipt text (the only place it is typed). "Semua outlet" copies the two texts to every outlet. */
function EditOutlet({ outlet, onClose }: { outlet: Outlet; onClose: () => void }) {
  const { t } = useI18n();
  const app = useApp();
  const [all, setAll] = useState(false);
  const f = useForm({
    name: outlet.name,
    address: outlet.address ?? '',
    phone: outlet.phone ?? '',
    header: outlet.receiptHeader ?? '',
    footer: outlet.receiptFooter ?? '',
  });
  const act = useAction();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(outletUpdateSchema, { ...f.values, outletId: outlet.id, isActive: outlet.isActive });
    if (!data) return;
    const res = await act.run(
      async () => {
        const saved = await updateOutlet({ data });
        return saved.ok && all ? applyReceiptText({ data: { header: data.header, footer: data.footer } }) : saved;
      },
      { success: t('Data outlet {name} disimpan.', { name: data.name }), refreshAppContext: true },
    );
    if (res) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Ubah data outlet')}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button type="submit" form="edit-outlet" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan')}
          </Button>
        </>
      }
    >
      <form id="edit-outlet" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Nama outlet')} error={f.errors.name && t(f.errors.name)}>
          <Input autoFocus value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <Field
          label={t('Alamat')}
          optional
          error={f.errors.address && t(f.errors.address)}
          help={t('Tercetak di struk bila "Alamat outlet" aktif di Pengaturan.')}
        >
          <Input autoComplete="street-address" value={f.values.address} onChange={(e) => f.set('address', e.target.value)} />
        </Field>
        <Field label={t('Telepon')} optional error={f.errors.phone && t(f.errors.phone)}>
          <Input inputMode="tel" autoComplete="tel" value={f.values.phone} onChange={(e) => f.set('phone', e.target.value)} />
        </Field>
        <Field
          label={t('Teks di atas struk outlet ini')}
          optional
          error={f.errors.header && t(f.errors.header)}
          help={t('{n} / 120 karakter', { n: f.values.header.length })}
        >
          <Textarea rows={2} maxLength={120} className="min-h-0" value={f.values.header} onChange={(e) => f.set('header', e.target.value)} />
        </Field>
        <Field
          label={t('Teks di bawah struk outlet ini')}
          optional
          error={f.errors.footer && t(f.errors.footer)}
          help={t('Kosong: tercetak "Terima kasih". {n} / 120 karakter', { n: f.values.footer.length })}
        >
          <Textarea rows={2} maxLength={120} className="min-h-0" value={f.values.footer} onChange={(e) => f.set('footer', e.target.value)} />
        </Field>
        {app.outlets.length > 1 && <Check label={t('Pakai kedua teks ini untuk semua outlet')} checked={all} onChange={(e) => setAll(e.target.checked)} />}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}
