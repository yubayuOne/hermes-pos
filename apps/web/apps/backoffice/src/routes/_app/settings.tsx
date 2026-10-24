import { useState } from 'react';
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ChipGroup,
  Field,
  FormAlert,
  Input,
  LangToggle,
  RCut,
  RRow,
  RTotal,
  Receipt,
  Select,
  Switch,
  Tag,
  amount,
  btn,
  cn,
  dateLong,
  dateShort,
  money,
  time,
  useI18n,
} from '@hermes-pos/ui';
import { Page } from '../../components/Page';
import { PasswordInput } from '../../components/PasswordInput';
import { Stat } from '../../components/Stat';
import { StrengthMeter } from '../../components/StrengthMeter';
import { useApp, useLock } from '../../lib/app';
import { clearAppContextCache } from '../../lib/appContextCache';
import { BUSINESS_TYPES, EXTRA_OUTLET, PAID_PLANS, PLAN_NAME, TIMEZONES } from '../../lib/plans';
import { businessSchema, changePasswordSchema, profileSchema, receiptSchema } from '../../lib/schemas';
import type { NotifySettings, ReceiptSettings } from '../../lib/types';
import { useAction } from '../../lib/useAction';
import { useForm } from '../../lib/useForm';
import { signOut } from '../../server/auth';
import { changePassword, saveBusiness, saveNotify, saveProfile, saveReceipt } from '../../server/settings';
import { pageHead } from '../../lang';

// One question per tab: who am I, what is my business, what does the receipt show, what do I get told, what do I pay.
const TABS = [
  { value: 'profile', label: 'Profil', hint: 'Data pemilik akun, bahasa, kata sandi, dan keluar dari akun.' },
  { value: 'business', label: 'Bisnis', hint: 'Nama bisnis, jenis usaha, kota, dan zona waktu untuk semua outlet.' },
  { value: 'receipt', label: 'Struk', hint: 'Bagian mana yang tampil di struk kasir, dengan pratinjau.' },
  { value: 'notifications', label: 'Notifikasi', hint: 'Pemberitahuan apa yang muncul di lonceng.' },
  { value: 'subscription', label: 'Langganan', hint: 'Paket, masa aktif, dan pemakaian.' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export const Route = createFileRoute('/_app/settings')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.some((x) => x.value === s.tab && x.value !== 'profile') ? (s.tab as Tab) : undefined,
  }),
  head: ({ match }) => pageHead(match.context.lang, 'Pengaturan'),
  component: Settings,
});

/** D11. Five tabs, each one topic. Data that belongs to an outlet (address, logo, receipt text) is on the Outlets page. */
function Settings() {
  const { t } = useI18n();
  const tab = Route.useSearch().tab ?? 'profile';
  const navigate = useNavigate({ from: '/settings' });
  const current = TABS.find((x) => x.value === tab) ?? TABS[0];
  return (
    <Page title={t('Pengaturan')}>
      <nav aria-label={t('Bagian pengaturan')} className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <Chip
            key={x.value}
            aria-current={tab === x.value ? 'page' : undefined}
            onClick={() => navigate({ search: { tab: x.value === 'profile' ? undefined : x.value }, replace: true })}
          >
            {t(x.label)}
          </Chip>
        ))}
      </nav>
      <p className="mt-4 text-mute">{t(current.hint)}</p>
      <div className="mt-5">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'business' && <BusinessTab />}
        {tab === 'receipt' && <ReceiptTab />}
        {tab === 'notifications' && (
          <div className="max-w-[640px]">
            <NotifyCard />
          </div>
        )}
        {tab === 'subscription' && <SubscriptionTab />}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- Profile
function ProfileTab() {
  const { t } = useI18n();
  const app = useApp();
  const p = app.profile;
  const f = useForm({
    fullName: p?.fullName ?? '',
    username: p?.username ?? app.session.username ?? '',
    email: app.session.email,
    whatsapp: p?.whatsapp ?? '',
  });
  const act = useAction();
  const [emailNote, setEmailNote] = useState(false);
  const initials = (f.values.fullName || app.business.name || 'C')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(profileSchema);
    if (!data) return;
    const res = await act.run(() => saveProfile({ data }), { success: t('Profil disimpan.') });
    if (res && res.ok && res.data === 'email') setEmailNote(true);
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[7fr_5fr]">
      <Card>
        <div className="flex items-center gap-5">
          <span aria-hidden className="grid size-[84px] flex-none place-items-center rounded bg-pine font-display text-[34px] font-extrabold text-paper">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="card-t truncate">{f.values.fullName || t('Pemilik')}</p>
            <p className="mt-1 font-mono text-[14px] text-mute">
              {t('pemilik')} · @{p?.username ?? f.values.username}
            </p>
          </div>
        </div>
        <form method="post" noValidate onSubmit={save} className="mt-7 grid gap-4">
          <Field label={t('Nama lengkap')} error={f.errors.fullName && t(f.errors.fullName)}>
            <Input autoComplete="name" value={f.values.fullName} onChange={(e) => f.set('fullName', e.target.value)} />
          </Field>
          <Field label="Username" error={f.errors.username && t(f.errors.username)} help={t('Huruf kecil. Dipakai untuk masuk.')}>
            <Input autoCapitalize="none" spellCheck={false} value={f.values.username} onChange={(e) => f.set('username', e.target.value.toLowerCase())} />
          </Field>
          <Field
            label="Email"
            error={f.errors.email && t(f.errors.email)}
            help={emailNote ? t('Tautan konfirmasi dikirim ke email baru. Email berganti setelah tautan dibuka.') : undefined}
          >
            <Input type="email" autoComplete="email" value={f.values.email} onChange={(e) => f.set('email', e.target.value)} />
          </Field>
          <Field label="WhatsApp" optional error={f.errors.whatsapp && t(f.errors.whatsapp)}>
            <Input type="tel" inputMode="tel" autoComplete="tel" value={f.values.whatsapp} onChange={(e) => f.set('whatsapp', e.target.value)} />
          </Field>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
          <div>
            <Button type="submit" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan profil')}
            </Button>
          </div>
        </form>
      </Card>
      <div className="grid gap-5">
        <LanguageCard />
        <PasswordCard />
        <SessionCard />
      </div>
    </div>
  );
}

function LanguageCard() {
  const { t } = useI18n();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t('Bahasa')}</CardTitle>
        <LangToggle />
      </div>
      <p className="mt-3 text-[15px] text-mute">{t('Bahasa tampilan backoffice. Pilihan diingat di perangkat ini.')}</p>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useI18n();
  const app = useApp();
  const f = useForm({ current: '', password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const act = useAction();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(changePasswordSchema);
    if (!data) return;
    const res = await act.run(() => changePassword({ data }), { success: t('Kata sandi diganti.') });
    if (res) f.setValues({ current: '', password: '', confirm: '' });
  }
  return (
    <Card>
      <CardTitle>{t('Ganti kata sandi')}</CardTitle>
      <form method="post" noValidate onSubmit={save} className="mt-5 grid gap-4">
        <Field label={t('Kata sandi saat ini')} error={f.errors.current && t(f.errors.current)}>
          <PasswordInput
            autoComplete="current-password"
            value={f.values.current}
            onChange={(v) => f.set('current', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        <Field label={t('Kata sandi baru')} error={f.errors.password && t(f.errors.password)}>
          <PasswordInput
            autoComplete="new-password"
            value={f.values.password}
            onChange={(v) => f.set('password', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        {f.values.password && <StrengthMeter pw={f.values.password} email={app.session.email} />}
        <Field label={t('Ulangi kata sandi baru')} error={f.errors.confirm && t(f.errors.confirm)}>
          <PasswordInput
            autoComplete="new-password"
            value={f.values.confirm}
            onChange={(v) => f.set('confirm', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        <FormAlert>{act.error && t(act.error)}</FormAlert>
        <div>
          <Button type="submit" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {t('Ganti kata sandi')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SessionCard() {
  const { t } = useI18n();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function out() {
    setBusy(true);
    await signOut();
    clearAppContextCache();
    await router.navigate({ to: '/login' });
  }
  return (
    <Card>
      <CardTitle>{t('Sesi')}</CardTitle>
      {confirm ? (
        <div className="mt-4 rounded border-[1.5px] border-ink bg-fire-soft p-4" role="alert">
          <p className="font-semibold">{t('Keluar dari Backoffice di perangkat ini?')}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button busy={busy} busyLabel={t('Keluar...')} onClick={out} autoFocus>
              {t('Ya, keluar')}
            </Button>
            <Button onClick={() => setConfirm(false)}>{t('Batal')}</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-mute">{t('Aplikasi kasir tidak ikut keluar.')}</p>
          <Button className="mt-4" onClick={() => setConfirm(true)}>
            {t('Keluar dari akun')}
          </Button>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Business
function BusinessTab() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const b = app.business;
  const biz = useForm({ name: b.name, type: b.type, city: b.city, timezone: b.timezone });
  const saveB = useAction();

  async function submitBusiness(e: React.FormEvent) {
    e.preventDefault();
    const data = biz.check(businessSchema);
    if (data) await saveB.run(() => saveBusiness({ data }), { success: t('Data bisnis disimpan.'), refreshAppContext: true });
  }

  return (
    <div className="max-w-[720px]">
      <Card>
        <CardTitle>{t('Data bisnis')}</CardTitle>
        <form method="post" noValidate onSubmit={submitBusiness} className="mt-5 grid gap-4">
          <Field label={t('Nama bisnis')} error={biz.errors.name && t(biz.errors.name)}>
            <Input value={biz.values.name} onChange={(e) => biz.set('name', e.target.value)} />
          </Field>
          <div className="fld">
            <span className="fld-l">{t('Jenis usaha')}</span>
            <ChipGroup
              label={t('Jenis usaha')}
              value={biz.values.type}
              onChange={(v) => biz.set('type', v)}
              options={BUSINESS_TYPES.map((o) => ({ value: o.value, label: t(o.label) }))}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Kota')} optional error={biz.errors.city && t(biz.errors.city)}>
              <Input value={biz.values.city} onChange={(e) => biz.set('city', e.target.value)} />
            </Field>
            <Field label={t('Zona waktu')} help={t('Berlaku untuk semua outlet. Dipakai untuk tanggal di laporan dan struk.')}>
              <Select value={biz.values.timezone} onChange={(e) => biz.set('timezone', e.target.value as typeof b.timezone)}>
                {TIMEZONES.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label} · {z.value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormAlert>{saveB.error && t(saveB.error)}</FormAlert>
          <div>
            <Button type="submit" variant="fire" busy={saveB.busy} busyLabel={t('Menyimpan...')} {...lock.props}>
              {lock.label(t('Simpan data bisnis'))}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Receipt
function ReceiptTab() {
  const { t } = useI18n();
  const app = useApp();
  const lock = useLock();
  const rec = useForm<ReceiptSettings>({ ...app.business.receipt });
  const saveR = useAction();

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    const data = rec.check(receiptSchema);
    if (data) await saveR.run(() => saveReceipt({ data }), { success: t('Pengaturan struk disimpan.') });
  }
  const switches: [keyof ReceiptSettings, string][] = [
    ['show_logo', 'Logo'],
    ['show_header', 'Teks atas'],
    ['show_address', 'Alamat outlet'],
    ['show_phone', 'Telepon outlet'],
    ['show_cashier', 'Nama kasir'],
    ['show_notes', 'Catatan item'],
    ['show_footer', 'Teks bawah'],
  ];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[7fr_5fr]">
      <Card>
        <CardTitle sub={t('Nomor bill, waktu, item, dan total selalu tercetak. Lebar kertas mengikuti printer.')}>{t('Isi struk')}</CardTitle>
        <div className="mt-4 rounded border-[1.5px] border-ink bg-paper p-4">
          <p className="font-semibold">{t('Diatur per outlet')}</p>
          <p className="mt-1 text-[15px] text-mute">
            {t(
              'Isinya diatur per outlet di halaman Outlet.',
            )}{' '}
            <Link to="/outlets" className="lnk">
              {t('Buka halaman Outlet')}
            </Link>
          </p>
        </div>
        <form method="post" noValidate onSubmit={submitReceipt} className="mt-5 grid gap-5">
          <fieldset>
            <legend className="fld-l">{t('Tampil di struk')}</legend>
            <ul className="mt-2 grid sm:grid-cols-2 sm:gap-x-8">
              {switches.map(([key, label]) => (
                <li key={key} className="flex items-center justify-between gap-3 border-b border-rule">
                  <span>{t(label)}</span>
                  <Switch checked={Boolean(rec.values[key])} label={t(label)} onChange={(v) => rec.set(key, v as never)} />
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="rounded border-[1.5px] border-ink bg-paper p-4">
            <p className="font-semibold">
              {t('Pajak dan biaya layanan')}{' '}
              <Tag tone="fire" className="ml-1">
                {t('segera hadir')}
              </Tag>
            </p>
            <p className="mt-1 text-[15px] text-mute">
              {t('Pajak dan biaya layanan belum dihitung.')}
            </p>
          </div>
          <FormAlert>{saveR.error && t(saveR.error)}</FormAlert>
          <div>
            <Button type="submit" variant="fire" busy={saveR.busy} busyLabel={t('Menyimpan...')} {...lock.props}>
              {lock.label(t('Simpan struk'))}
            </Button>
          </div>
        </form>
      </Card>
      <div className="xl:sticky xl:top-6">
        <ReceiptPreview r={rec.values} />
      </div>
    </div>
  );
}

/**
 * Live preview: changes with every switch above, for the outlet chosen on top (its own address, phone, header, and
 * footer, as on the POS). Sample items and amounts are labelled "contoh".
 */
function ReceiptPreview({ r }: { r: ReceiptSettings }) {
  const { t, lang } = useI18n();
  const app = useApp();
  const [outletId, setOutletId] = useState(app.outlets[0]?.id ?? '');
  const outlet = app.outlets.find((o) => o.id === outletId) ?? app.outlets[0];
  const header = outlet?.receiptHeader;
  const footer = outlet?.receiptFooter || t('Terima kasih');
  const now = new Date();
  return (
    <section aria-label={t('Pratinjau struk')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="card-t">{t('Pratinjau struk')}</h2>
        <Tag>{t('contoh')}</Tag>
      </div>
      {app.outlets.length > 1 && (
        <ChipGroup
          className="mb-3"
          label={t('Pratinjau untuk outlet')}
          value={outlet?.id ?? ''}
          onChange={setOutletId}
          options={app.outlets.map((o) => ({ value: o.id, label: o.name }))}
        />
      )}
      <Receipt ink torn className="mx-auto max-w-[360px]">
        <div className="head grid gap-0.5">
          {r.show_logo &&
            (outlet?.logoUrl ? (
              <img src={outlet.logoUrl} alt="" className="mx-auto mb-2 h-10 w-20 object-contain" />
            ) : (
              <span className="mx-auto mb-2 grid h-10 w-20 place-items-center border border-dashed border-ink text-[12px] text-mute">[LOGO]</span>
            ))}
          <span className="font-semibold uppercase">{app.business.name}</span>
          {outlet && <span className="uppercase">{outlet.name}</span>}
          {r.show_address && <span className="text-mute">{outlet?.address || `[${t('Alamat outlet')}]`}</span>}
          {r.show_phone && <span className="text-mute">{outlet?.phone || `[${t('Telepon outlet')}]`}</span>}
          {r.show_header && header && <span className="mt-1 whitespace-pre-line">{header}</span>}
        </div>
        <RCut />
        <RRow l="#HPOS-0001" r={`${dateShort(now, lang, app.business.timezone)} ${time(now, app.business.timezone)}`} className="border-0 py-1" />
        {r.show_cashier && <RRow l={t('Kasir')} r={`[${t('Nama kasir')}]`} className="border-0 py-1" />}
        <RCut />
        <RRow l="2 × Kopi susu" r={amount(44000)} className="border-0 pb-0" />
        {r.show_notes && <p className="text-mute"> tanpa es</p>}
        <RRow l="1 × Roti bakar" r={amount(18000)} className="border-0" />
        <RCut />
        <RTotal l="Total" r={amount(62000)} />
        <RRow l={t('Tunai')} r={amount(100000)} className="border-0 py-1" />
        <RRow l={t('Kembali|kembalian')} r={amount(38000)} className="border-0 py-1" />
        {r.show_footer && footer && (
          <>
            <RCut />
            <p className="text-center whitespace-pre-line">{footer}</p>
          </>
        )}
      </Receipt>
      <p className="sr-only">{dateLong(now, lang)}</p>
    </section>
  );
}

function NotifyCard() {
  const { t } = useI18n();
  const app = useApp();
  const [n, setN] = useState<NotifySettings>(app.business.notify);
  const act = useAction();
  function toggle(key: keyof NotifySettings, v: boolean) {
    const next = { ...n, [key]: v };
    setN(next);
    act
      .run(() => saveNotify({ data: next }), { toastError: true, success: t('Notifikasi disimpan.') })
      .then((res) => {
        if (!res) setN(n);
      });
  }
  const rows: [keyof NotifySettings, string, string][] = [
    ['subscription', 'Pengingat langganan', '30, 21, 14, dan 7 hari sebelum berakhir'],
    ['cash_variance', 'Selisih kas shift', 'Saat shift ditutup dengan selisih'],
    ['low_stock', 'Stok menipis', 'Untuk produk yang stoknya dilacak'],
  ];
  return (
    <Card>
      <CardTitle>{t('Notifikasi')}</CardTitle>
      <ul className="mt-3">
        {rows.map(([key, label, sub]) => (
          <li key={key} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
            <span>
              <span className="block font-medium">{t(label)}</span>
              <span className="block text-[13px] text-mute">{t(sub)}</span>
            </span>
            <Switch checked={n[key]} label={t(label)} disabled={act.busy} onChange={(v) => toggle(key, v)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- Subscription
function SubscriptionTab() {
  const { t, lang } = useI18n();
  const app = useApp();
  const sub = app.subscription;
  const expired = sub.state === 'expired';
  const date = dateShort(sub.expiresAt, lang, app.business.timezone);
  const daysAgo = Math.max(0, Math.round((Date.now() - new Date(sub.expiresAt).getTime()) / 86_400_000));
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[7fr_5fr]">
      <div className="grid gap-5">
        <section
          aria-label={t('Paket saat ini')}
          className={cn('slipc border-l-[12px]', sub.state === 'active' ? 'border-l-pine' : 'border-l-fire bg-fire-soft')}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[14px]">
              {t('Paket saat ini')} · {t(PLAN_NAME[sub.plan])}
            </p>
            <Tag tone={expired ? 'fire' : sub.state === 'trial' ? 'fire' : 'pine'}>
              {expired ? t('Berakhir') : sub.state === 'trial' ? 'Trial' : t('Aktif')}
            </Tag>
          </div>
          {sub.plan === 'unlimited' ? (
            // Granted by the admin (migration 065): no end date to count down to.
            <p className="mt-4 font-display text-[clamp(56px,7vw,96px)] font-extrabold leading-[0.9] tracking-[-0.04em]">{t('Selamanya')}</p>
          ) : (
            <>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-[clamp(96px,11vw,140px)] font-extrabold leading-[0.85] tracking-[-0.05em]">{sub.daysLeft}</span>
                <span className="text-[26px] font-medium">{expired ? t('hari tersisa') : t('hari lagi')}</span>
              </p>
              <dl className="mt-6 grid grid-cols-2 gap-6 border-t-[1.5px] border-ink pt-5 sm:max-w-[420px]">
                <Stat label={t('Berlaku sampai')} value={date} />
                <Stat label={t('Sisa waktu')} value={expired ? t('Habis {n} hari lalu', { n: daysAgo }) : t('{n} hari', { n: sub.daysLeft })} />
              </dl>
            </>
          )}
          {expired && (
            <p className="mt-5">
              {t(
                'Terkunci: penjualan, shift, serta tambah outlet, kasir, dan produk. Data tidak dihapus.',
              )}
            </p>
          )}
        </section>
        <Card>
          <CardTitle>{t('Pemakaian')}</CardTitle>
          <ul className="mt-4 font-[450]">
            <UsageRow label={t('Outlet (1 termasuk paket + tambahan)')} value={t('{n} dari {max}', { n: app.counts.outlets, max: sub.limits.outlets })} />
            {sub.usage.map((u) => (
              <UsageRow
                key={`c${u.outletId}`}
                label={t('Kasir aktif, {outlet}', { outlet: u.name })}
                value={t('{n} dari {max}', { n: u.cashiers, max: sub.limits.cashiers })}
              />
            ))}
            {sub.usage.map((u) => (
              <UsageRow
                key={`p${u.outletId}`}
                label={t('Produk aktif, {outlet}', { outlet: u.name })}
                value={t('{n} dari {max}', { n: u.products, max: sub.limits.products })}
              />
            ))}
          </ul>
          <p className="mt-4 text-[14px] text-mute">{t('Outlet tambahan {price} per bulan, dihitung proporsional.', { price: money(EXTRA_OUTLET) })}</p>
        </Card>
      </div>
      <Receipt torn className={cn('border-[1.5px] border-ink font-sans text-[16px]', expired && 'bg-fire-soft')}>
        <h2 className="text-[clamp(30px,3vw,38px)]">{expired ? t('Perpanjang untuk membuka kunci.') : t('Perpanjang atau ganti paket.')}</h2>
        <p className="mt-3 text-mute">{t('Perpanjangan menambah sisa waktu Anda, bukan mulai dari hari bayar.')}</p>
        <ul className="mt-5">
          {PAID_PLANS.map((p) => (
            <li key={p.code} className="row font-sans">
              <span>{t(p.name)}</span>
              <span className="font-mono font-semibold">{money(p.price)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[15px] text-mute">
          {t('Bayar lewat transfer bank, kami periksa manual.')}
        </p>
        <Link to="/subscription" className={`${btn('fire')} mt-5`}>
          {t('Pilih paket dan bayar')}
        </Link>
      </Receipt>
    </div>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-4 border-b border-dashed border-rule py-2.5 last:border-b-0">
      <span>{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </li>
  );
}
