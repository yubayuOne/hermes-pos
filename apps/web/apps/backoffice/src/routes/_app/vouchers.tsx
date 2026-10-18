import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Button,
  Check,
  Chip,
  ChipGroup,
  Dialog,
  Empty,
  Field,
  FormAlert,
  Input,
  Select,
  Switch,
  Tag,
  addDays,
  dateShort,
  isoDay,
  money,
  toast,
  useI18n,
} from '@hermes-pos/ui';
import { Page } from '../../components/Page';
import { PageLoading } from '../../components/PageLoading';
import { Pagination, pageOf } from '../../components/Pagination';
import { useApp, useLock } from '../../lib/app';
import { voucherSchema } from '../../lib/schemas';
import type { Voucher, VoucherStatus } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { listVoucherProducts, listVouchers, saveVoucher, setVoucherActive, type PickerProduct } from '../../server/vouchers';
import { pageHead } from '../../lang';

export const Route = createFileRoute('/_app/vouchers')({
  loader: () => listVouchers(),
  pendingMs: 150,
  pendingComponent: () => <PageLoading title="Voucher|menu" />,
  head: ({ match }) => pageHead(match.context.lang, 'Voucher|menu'),
  component: Vouchers,
});

const STATUS: Record<VoucherStatus, { label: string; tone: 'pine' | 'fire' | 'mute' | 'plain' }> = {
  active: { label: 'Aktif', tone: 'pine' },
  expired: { label: 'Kedaluwarsa', tone: 'mute' },
  used_up: { label: 'Habis', tone: 'fire' },
  inactive: { label: 'Nonaktif', tone: 'mute' },
};

/** D10. Kasir types the code in the POS; the server checks and applies it (PRD C5). */
function Vouchers() {
  const { t, lang } = useI18n();
  const lock = useLock();
  const vouchers = Route.useLoaderData();
  const [editing, setEditing] = useState<Voucher | 'new' | null>(null);
  const toggle = useAction();
  const [page, setPage] = useState(1);
  const view = pageOf(vouchers, page);

  function setActive(v: Voucher, on: boolean) {
    toggle.run(() => setVoucherActive({ data: { id: v.id, active: on } }), {
      toastError: true,
      success: on ? t('Voucher {code} aktif.', { code: v.code }) : t('Voucher {code} dimatikan.', { code: v.code }),
      undo: () => setVoucherActive({ data: { id: v.id, active: !on } }),
    });
  }
  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t('Kode {code} disalin.', { code }));
    } catch {
      toast.error(t('Kode belum bisa disalin. Pilih dan salin manual.'));
    }
  }

  return (
    <Page title={t('Voucher|menu')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[46em] text-mute">
          {t(
            'Kasir mengetik kode voucher di aplikasi, lalu server memeriksa syaratnya dan memotong total. Voucher bisa untuk seluruh bill atau produk tertentu.',
          )}
        </p>
        {vouchers.length > 0 && (
          <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
            {lock.label(t('Buat voucher'))}
          </Button>
        )}
      </div>
      {vouchers.length === 0 ? (
        <Empty
          className="mt-6"
          title={t('Belum ada voucher.')}
          action={
            <Button variant="fire" onClick={() => setEditing('new')} {...lock.props}>
              {lock.label(t('Buat voucher'))}
            </Button>
          }
        >
          {t('Buat kode untuk promo, misalnya potongan 10% untuk belanja di atas Rp50.000.')}
        </Empty>
      ) : (
        <div className="tbl-wrap mt-6">
          <table className="tbl tbl-card">
            <thead>
              <tr>
                <th scope="col">{t('Kode')}</th>
                <th scope="col">{t('Potongan')}</th>
                <th scope="col">{t('Syarat')}</th>
                <th scope="col" className="num">
                  {t('Terpakai')}
                </th>
                <th scope="col">{t('Berlaku sampai')}</th>
                <th scope="col">Status</th>
                <th scope="col">{t('Aktif')}</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((v, i) => (
                <tr key={v.id} style={{ animationDelay: `${i * 50}ms` }}>
                  <td data-l={t('Kode')}>
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        disabled={lock.locked}
                        onClick={() => setEditing(v)}
                        className="rounded border-[1.5px] border-dashed border-ink px-2 py-1 font-mono text-[15px] font-semibold tracking-wider hover:bg-tint-2 disabled:hover:bg-transparent"
                        aria-label={t('Ubah voucher {code}', { code: v.code })}
                      >
                        {v.code}
                      </button>
                      <button type="button" className="lnk px-1 text-[14px]" onClick={() => copy(v.code)}>
                        {t('Salin')}
                        <span className="sr-only"> {v.code}</span>
                      </button>
                    </span>
                  </td>
                  <td data-l={t('Potongan')}>
                    <span className="font-mono">{v.discountType === 'percent' ? `${v.value}%` : money(v.value)}</span>
                    <span className="block text-[14px] text-mute">{v.scope === 'bill' ? t('seluruh bill') : t('{n} produk', { n: v.productIds.length })}</span>
                  </td>
                  <td data-l={t('Syarat')} className="text-[15px]">
                    {v.minSpend > 0 ? t('min. belanja {amount}', { amount: money(v.minSpend) }) : t('tanpa minimal')}
                  </td>
                  <td data-l={t('Terpakai')} className="num">
                    {v.quota ? (
                      `${v.usedCount} / ${v.quota}`
                    ) : (
                      <span>
                        {v.usedCount} <span className="font-sans text-[14px] text-mute">· {t('tanpa batas')}</span>
                      </span>
                    )}
                  </td>
                  <td data-l={t('Berlaku sampai')} className="font-mono text-[15px]">
                    {dateShort(v.expiresOn, lang)}
                  </td>
                  <td data-l="Status">
                    <Tag tone={STATUS[v.status].tone}>{t(STATUS[v.status].label)}</Tag>
                  </td>
                  <td data-l={t('Aktif')}>
                    <Switch
                      checked={v.isActive}
                      label={t('Voucher {code} aktif', { code: v.code })}
                      disabled={lock.locked || toggle.busy}
                      onChange={(on) => setActive(v, on)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={view.page} pages={view.pages} onPage={setPage} />
      {editing && <VoucherDialog voucher={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

function VoucherDialog({ voucher, onClose }: { voucher: Voucher | null; onClose: () => void }) {
  const { t } = useI18n();
  const app = useApp();
  const act = useAction();
  const today = isoDay(new Date(), app.business.timezone);
  const f = useForm({
    code: voucher?.code ?? '',
    scope: voucher?.scope ?? ('bill' as 'bill' | 'products'),
    discountType: voucher?.discountType ?? ('percent' as 'percent' | 'amount'),
    value: voucher ? String(voucher.value) : '',
    minSpend: voucher ? String(voucher.minSpend) : '0',
    quota: voucher?.quota ? String(voucher.quota) : '',
    expiresOn: voucher?.expiresOn ?? addDays(today, 30),
    productIds: voucher?.productIds ?? ([] as string[]),
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = f.values;
    if (v.expiresOn && v.expiresOn < today) return f.setErrors({ expiresOn: 'Tanggal berakhir tidak boleh sebelum hari ini.' });
    const data = f.check(voucherSchema, {
      id: voucher?.id ?? null,
      code: v.code,
      scope: v.scope,
      discountType: v.discountType,
      value: v.value === '' ? NaN : Number(v.value),
      minSpend: Number(v.minSpend || 0),
      quota: v.quota ? Number(v.quota) : null,
      expiresOn: v.expiresOn,
      productIds: v.productIds,
    });
    if (!data) return;
    const res = await act.run(() => saveVoucher({ data }), {
      success: voucher ? t('Voucher {code} disimpan.', { code: data.code }) : t('Voucher {code} dibuat.', { code: data.code }),
      refreshAppContext: !voucher,
    });
    if (res) onClose();
  }
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={voucher ? t('Ubah voucher') : t('Buat kode voucher')}
      footer={
        <>
          <Button onClick={onClose}>{t('Batal')}</Button>
          <Button type="submit" form="voucher" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan voucher')}
          </Button>
        </>
      }
    >
      <form id="voucher" noValidate onSubmit={save} className="grid gap-4">
        <Field label={t('Kode')} error={f.errors.code && t(f.errors.code)} help={t('4 sampai 12 huruf atau angka. Kasir mengetik kode ini.')}>
          {(p) => (
            <div className="flex gap-2">
              <Input
                {...p}
                autoFocus
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                className="font-mono uppercase tracking-wider"
                value={f.values.code}
                onChange={(e) => f.set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <Button className="flex-none" onClick={() => f.set('code', randomCode())}>
                {t('Buat acak')}
              </Button>
            </div>
          )}
        </Field>
        <div className="fld">
          <span className="fld-l">{t('Berlaku untuk')}</span>
          <ChipGroup
            label={t('Berlaku untuk')}
            value={f.values.scope}
            onChange={(v) => f.set('scope', v)}
            options={[
              { value: 'bill', label: t('Seluruh bill') },
              { value: 'products', label: t('Produk tertentu') },
            ]}
          />
        </div>
        {f.values.scope === 'products' && (
          <ProductPicker value={f.values.productIds} onChange={(ids) => f.set('productIds', ids)} error={f.errors.productIds} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="fld">
            <span className="fld-l">{t('Jenis potongan')}</span>
            <ChipGroup
              label={t('Jenis potongan')}
              value={f.values.discountType}
              onChange={(v) => f.set('discountType', v)}
              options={[
                { value: 'percent', label: t('Persen') },
                { value: 'amount', label: t('Nominal') },
              ]}
            />
          </div>
          <Field label={f.values.discountType === 'percent' ? t('Nilai (%)') : t('Nilai (Rp)')} error={f.errors.value && t(f.errors.value)}>
            <Input inputMode="numeric" className="font-mono" value={f.values.value} onChange={(e) => f.set('value', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('Minimal belanja (Rp)')} optional error={f.errors.minSpend && t(f.errors.minSpend)}>
            <Input inputMode="numeric" className="font-mono" value={f.values.minSpend} onChange={(e) => f.set('minSpend', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('Kuota pemakaian')} optional error={f.errors.quota && t(f.errors.quota)} help={t('Kosongkan untuk tanpa batas.')}>
            <Input inputMode="numeric" className="font-mono" value={f.values.quota} onChange={(e) => f.set('quota', e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field label={t('Berlaku sampai')} error={f.errors.expiresOn && t(f.errors.expiresOn)}>
          <Input type="date" min={today} value={f.values.expiresOn} onChange={(e) => f.set('expiresOn', e.target.value)} />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </form>
    </Dialog>
  );
}

/** Product picker: search, category filter, "x dari y produk dipilih", select all results, clear, 200px list, chips. */
function ProductPicker({ value, onChange, error }: { value: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const { t } = useI18n();
  // Fetched here, not in the page loader, so the voucher list opens without every product of every outlet.
  const [loaded, setLoaded] = useState<PickerProduct[] | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    listVoucherProducts().then(
      (rows) => live && setLoaded(rows),
      () => live && setLoaded('error'),
    );
    return () => {
      live = false;
    };
  }, []);
  const products = Array.isArray(loaded) ? loaded : [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const multiOutlet = new Set(products.map((p) => p.outlet)).size > 1;
  const results = products.filter((p) => (!cat || p.category === cat) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const chosen = new Set(value);
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="grid gap-3 rounded border-[1.5px] border-ink p-4" aria-invalid={error ? true : undefined}>
      <legend className="fld-l px-1">{t('Produk')}</legend>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Input type="search" aria-label={t('Cari produk')} placeholder={t('Cari produk')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label={t('Kategori')} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{t('Semua kategori')}</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[13px]" role="status">
          {t('{n} dari {total} produk dipilih', { n: value.length, total: products.length })}
        </p>
        <span className="flex gap-3">
          <button type="button" className="lnk text-[14px]" onClick={() => onChange([...new Set([...value, ...results.map((r) => r.id)])])}>
            {t('Pilih semua hasil')}
          </button>
          <button type="button" className="lnk text-[14px]" onClick={() => onChange([])}>
            {t('Kosongkan')}
          </button>
        </span>
      </div>
      <ul className="max-h-[200px] overflow-y-auto rounded border border-line bg-paper px-3">
        {results.length === 0 && (
          <li className="py-3 text-mute" role={loaded === 'error' ? 'alert' : undefined}>
            {loaded === null
              ? t('Memuat produk...')
              : loaded === 'error'
                ? t('Daftar produk belum bisa dimuat. Tutup lalu buka lagi.')
                : t('Tidak ada produk yang cocok.')}
          </li>
        )}
        {results.map((p) => (
          <li key={p.id} className="border-b border-rule last:border-b-0">
            <Check
              className="w-full pb-2.5"
              checked={chosen.has(p.id)}
              onChange={() => toggle(p.id)}
              label={
                <span>
                  {p.name} <span className="text-[13px] text-mute">{[p.category, multiOutlet ? p.outlet : ''].filter(Boolean).join(' · ')}</span>
                </span>
              }
            />
          </li>
        ))}
      </ul>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => {
            const p = products.find((x) => x.id === id);
            return (
              <Chip key={id} pressed onClick={() => toggle(id)} aria-label={t('Hapus {name} dari pilihan', { name: p?.name ?? '' })}>
                {p?.name ?? '…'} ×
              </Chip>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="ferr">
          {t(error)}
        </p>
      )}
    </fieldset>
  );
}
