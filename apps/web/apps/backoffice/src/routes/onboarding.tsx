import { useState } from 'react';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { Button, ChipGroup, Field, FormAlert, Input, LangToggle, StepNum, Wordmark, btn, cn, useI18n } from '@hermes-pos/ui';
import { BUSINESS_TYPES } from '../lib/plans';
import { cashierCreateSchema, onboardBusinessSchema, onboardOutletSchema, productSchema, type businessTypes } from '../lib/schemas';
import { useForm } from '../lib/useForm';
import { getSession } from '../server/auth';
import { createCashier, createCategory, saveProduct } from '../server/manage';
import { createBusiness, getOnboardingState } from '../server/onboarding';
import { pageHead } from '../lang';

const STEPS = [
  ['Bisnis', 'Nama dan jenis usaha'],
  ['Outlet', 'Lokasi pertama'],
  ['Kasir', 'Nama dan PIN'],
  ['Produk', 'Menu awal'],
  ['Selesai', 'Periksa dan mulai'],
] as const;
export const Route = createFileRoute('/onboarding')({
  validateSearch: (s: Record<string, unknown>): { step?: number } => ({ step: Number(s.step) >= 1 && Number(s.step) <= 5 ? Number(s.step) : undefined }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/login' });
  },
  loader: () => getOnboardingState(),
  head: ({ match }) => pageHead(match.context.lang, 'Data awal'),
  component: Onboarding,
});

/** E2. Five steps; Cashier and Product can be skipped; trial limits are shown. */
function Onboarding() {
  const { t } = useI18n();
  const state = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/onboarding' });
  // Steps 1 and 2 are done once the business exists; never show them again.
  const step = state.business ? Math.max(3, search.step ?? 3) : Math.min(2, search.step ?? 1);
  const go = (n: number) => navigate({ search: { step: n } });
  const [biz, setBiz] = useState<Biz>({
    name: state.businessName,
    type: 'kafe' as (typeof businessTypes)[number],
    city: '',
    username: state.hasProfile ? undefined : (state.username ?? ''),
  });

  return (
    <div className="grid min-h-dvh md:grid-cols-[320px_minmax(0,1fr)]">
      <aside aria-label={t('Langkah data awal')} className="flex flex-col border-ink bg-paper px-5 py-5 md:border-r-[1.5px] md:px-7 md:py-9">
        <div className="flex items-center justify-between gap-3">
          <Wordmark size={32} />
          <LangToggle />
        </div>
        <p className="mt-2 font-mono text-small text-mute">{t('data awal · trial 3 hari')}</p>
        <ol className="mt-8 hidden gap-2 md:grid">
          {STEPS.map(([title, sub], i) => {
            const n = i + 1;
            const s = n < step ? 'done' : n === step ? 'now' : 'todo';
            return (
              <li
                key={title}
                aria-current={s === 'now' ? 'step' : undefined}
                className={cn('flex items-center gap-3.5 rounded border-[1.5px] px-2.5 py-2.5', s === 'now' ? 'border-ink bg-slip' : 'border-transparent')}
              >
                <StepNum n={n} state={s} />
                <span>
                  <span className="block font-semibold leading-tight">{t(title)}</span>
                  <span className="block text-small text-mute">{t(sub)}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 md:mt-auto" role="status">
          <p className="font-mono text-small">{t('Langkah {n} dari 5', { n: step })}</p>
          <div className="mt-2 h-2 border-[1.5px] border-ink bg-slip" aria-hidden>
            <div className="h-full bg-fire transition-[width] duration-300" style={{ width: `${(step / 5) * 100}%` }} />
          </div>
        </div>
      </aside>
      <main id="content" className="bg-tint px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-[720px]">
          {step === 1 && (
            <StepBusiness
              value={biz}
              needsUsername={!state.hasProfile}
              onNext={(v) => {
                setBiz(v);
                go(2);
              }}
            />
          )}
          {step === 2 && <StepOutlet business={biz} onBack={() => go(1)} onDone={() => go(3)} />}
          {step === 3 && state.outlet && <StepCashier outletId={state.outlet.id} count={state.cashiers} onNext={() => go(4)} />}
          {step === 4 && state.outlet && <StepProduct outletId={state.outlet.id} count={state.products} onBack={() => go(3)} onNext={() => go(5)} />}
          {step === 5 && <StepDone />}
        </div>
      </main>
    </div>
  );
}

function StepCard({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="step-t" className="slipc animate-pop">
      <p className="font-mono text-small text-mute">{t('langkah {n} dari 5', { n })}</p>
      <h1 id="step-t" className="mt-2 text-[clamp(36px,4vw,48px)]">
        {title}
      </h1>
      <p className="mt-3 text-mute">{sub}</p>
      <div className="mt-7 grid gap-5">{children}</div>
    </section>
  );
}

type Biz = { name: string; type: (typeof businessTypes)[number]; city: string; username?: string };

function StepBusiness({ value, needsUsername, onNext }: { value: Biz; needsUsername: boolean; onNext: (v: Biz) => void }) {
  const { t } = useI18n();
  const f = useForm<Biz>(value);
  function next(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(onboardBusinessSchema);
    if (data) onNext({ ...data, username: data.username });
  }
  return (
    <form method="post" noValidate onSubmit={next}>
      <StepCard n={1} title={t('Ceritakan bisnis Anda.')} sub={t('Nama ini tampil di struk dan laporan. Semuanya bisa diubah nanti.')}>
        <Field label={t('Nama bisnis')} error={f.errors.name && t(f.errors.name)}>
          <Input autoFocus placeholder={t('Contoh: Kopi Pojok')} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <div className="fld">
          <span className="fld-l" id="type-l">
            {t('Jenis usaha')}
          </span>
          <ChipGroup
            label={t('Jenis usaha')}
            value={f.values.type}
            onChange={(v) => f.set('type', v)}
            options={BUSINESS_TYPES.map((o) => ({ value: o.value, label: t(o.label) }))}
          />
        </div>
        <Field label={t('Kota')} optional error={f.errors.city && t(f.errors.city)}>
          <Input autoComplete="address-level2" placeholder={t('Contoh: Bandung')} value={f.values.city} onChange={(e) => f.set('city', e.target.value)} />
        </Field>
        {needsUsername && (
          <Field
            label="Username"
            error={f.errors.username && t(f.errors.username)}
            help={t('3 sampai 20 karakter: huruf kecil, angka, titik, atau garis bawah.')}
          >
            <Input
              autoCapitalize="none"
              spellCheck={false}
              placeholder="kopipojok"
              value={f.values.username ?? ''}
              onChange={(e) => f.set('username', e.target.value.toLowerCase())}
            />
          </Field>
        )}
      </StepCard>
      <div className="mt-6 flex justify-end">
        <Button type="submit" variant="fire">
          {t('Lanjut')}
        </Button>
      </div>
    </form>
  );
}

function StepOutlet({ business, onBack, onDone }: { business: Biz; onBack: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const f = useForm({ outlet: 'Outlet Utama', address: '', phone: '' });
  const [busy, setBusy] = useState(false);
  async function next(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(onboardOutletSchema, { business, ...f.values });
    if (!data) return;
    setBusy(true);
    const res = await createBusiness({ data }).catch(() => ({
      ok: false as const,
      error: 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.',
      field: undefined,
    }));
    setBusy(false);
    if (!res.ok) {
      // A taken username belongs to step 1.
      if (res.field === 'username') return onBack();
      return f.fail(res.error, res.field);
    }
    await router.invalidate();
    onDone();
  }
  return (
    <form method="post" noValidate onSubmit={next}>
      <StepCard n={2} title={t('Di mana outlet pertama?')} sub={t('Trial berisi 1 outlet. Outlet tambahan bisa diaktifkan setelah berlangganan.')}>
        <Field label={t('Nama outlet')} error={f.errors.outlet && t(f.errors.outlet)}>
          <Input autoFocus value={f.values.outlet} onChange={(e) => f.set('outlet', e.target.value)} />
        </Field>
        <Field label={t('Alamat')} optional error={f.errors.address && t(f.errors.address)} help={t('Bisa tampil di struk.')}>
          <Input autoComplete="street-address" value={f.values.address} onChange={(e) => f.set('address', e.target.value)} />
        </Field>
        <Field label={t('Telepon outlet')} optional error={f.errors.phone && t(f.errors.phone)}>
          <Input type="tel" autoComplete="tel" inputMode="tel" value={f.values.phone} onChange={(e) => f.set('phone', e.target.value)} />
        </Field>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
      </StepCard>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button onClick={onBack}>{t('Kembali')}</Button>
        <Button type="submit" variant="fire" busy={busy} busyLabel={t('Menyiapkan bisnis...')}>
          {t('Simpan dan lanjut')}
        </Button>
      </div>
    </form>
  );
}

function StepCashier({ outletId, count, onNext }: { outletId: string; count: number; onNext: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const f = useForm({ name: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const full = count >= 2;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(cashierCreateSchema, { outletId, ...f.values });
    if (!data) return;
    setBusy(true);
    const res = await createCashier({ data }).catch(() => ({
      ok: false as const,
      error: 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.',
    }));
    setBusy(false);
    if (!res.ok) return f.fail(res.error);
    await router.invalidate();
    onNext();
  }
  return (
    <form method="post" noValidate onSubmit={save}>
      <StepCard
        n={3}
        title={t('Siapa yang jaga kasir?')}
        sub={t('Kasir masuk dengan nama dan PIN 6 digit. Trial: maksimal 2 kasir.')}
      >
        {count > 0 && <p className="rounded border-[1.5px] border-ink bg-pine-soft px-4 py-3 font-semibold">{t('{n} kasir sudah dibuat.', { n: count })}</p>}
        {!full && (
          <>
            <Field label={t('Nama kasir')} error={f.errors.name && t(f.errors.name)}>
              <Input autoFocus placeholder={t('Contoh: Sari')} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
            </Field>
            <Field label={t('PIN 6 digit')} error={f.errors.pin && t(f.errors.pin)} help={t('Disimpan sebagai hash. Bisa diganti kapan saja di menu Kasir.')}>
              <Input
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                className="font-mono tracking-[0.3em]"
                value={f.values.pin}
                onChange={(e) => f.set('pin', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </>
        )}
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
      </StepCard>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button onClick={onNext}>{full ? t('Lanjut') : t('Lewati dulu')}</Button>
        {!full && (
          <Button type="submit" variant="fire" busy={busy} busyLabel={t('Menyimpan...')}>
            {t('Simpan kasir')}
          </Button>
        )}
      </div>
    </form>
  );
}

function StepProduct({ outletId, count, onBack, onNext }: { outletId: string; count: number; onBack: () => void; onNext: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const f = useForm({ name: '', category: '', price: '', hpp: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const product = {
      outletId,
      categoryId: null,
      name: f.values.name,
      price: Number(f.values.price || NaN),
      hpp: Number(f.values.hpp || 0),
      trackStock: false,
      stock: 0,
      station: 'kitchen' as const,
    };
    const data = f.check(productSchema, product);
    if (!data) return;
    setBusy(true);
    try {
      let categoryId: string | null = null;
      if (f.values.category.trim()) {
        const cat = await createCategory({ data: { outletId, name: f.values.category.trim() } });
        if (!cat.ok) return f.fail(cat.error, 'category');
        categoryId = cat.data ?? null;
      }
      const res = await saveProduct({ data: { ...data, categoryId } });
      if (!res.ok) return f.fail(res.error);
      await router.invalidate();
      f.setValues({ name: '', category: f.values.category, price: '', hpp: '' });
      onNext();
    } catch {
      f.fail('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" noValidate onSubmit={save}>
      <StepCard n={4} title={t('Satu menu untuk mulai.')} sub={t('Menu lengkap bisa ditambah nanti di menu Produk. Trial: maksimal 40 produk per outlet.')}>
        {count > 0 && <p className="rounded border-[1.5px] border-ink bg-pine-soft px-4 py-3 font-semibold">{t('{n} produk sudah dibuat.', { n: count })}</p>}
        <Field label={t('Nama produk')} error={f.errors.name && t(f.errors.name)}>
          <Input autoFocus placeholder={t('Contoh: Kopi susu')} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} />
        </Field>
        <Field label={t('Kategori')} optional error={f.errors.category && t(f.errors.category)}>
          <Input placeholder={t('Contoh: Minuman')} maxLength={20} value={f.values.category} onChange={(e) => f.set('category', e.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('Harga jual (Rp)')} error={f.errors.price && t(f.errors.price)}>
            <Input inputMode="numeric" className="font-mono" value={f.values.price} onChange={(e) => f.set('price', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('HPP (Rp)')} optional error={f.errors.hpp && t(f.errors.hpp)} help={t('Modal per porsi, untuk menghitung laba.')}>
            <Input inputMode="numeric" className="font-mono" value={f.values.hpp} onChange={(e) => f.set('hpp', e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
      </StepCard>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button onClick={onBack}>{t('Kembali')}</Button>
        <Button onClick={onNext}>{t('Lewati dulu')}</Button>
        <Button type="submit" variant="fire" busy={busy} busyLabel={t('Menyimpan...')}>
          {t('Simpan produk')}
        </Button>
      </div>
    </form>
  );
}

function StepDone() {
  const { t } = useI18n();
  const s = Route.useLoaderData();
  const rows: [string, string][] = [
    [t('Bisnis'), s.business?.name ?? '-'],
    [t('Outlet'), s.outlet?.name ?? '-'],
    [t('Kasir'), String(s.cashiers)],
    [t('Produk'), String(s.products)],
  ];
  return (
    <StepCard n={5} title={t('Siap jualan.')} sub={t('Trial 3 hari dimulai hari ini. Data yang Anda isi tetap ada setelah trial berakhir.')}>
      <dl className="slip slip-ink">
        {rows.map(([k, v]) => (
          <div key={k} className="row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h2 className="card-t">{t('Tiga langkah berikutnya')}</h2>
        <ol className="mt-3 grid gap-2.5">
          {[
            'Pasang aplikasi kasir Hermes POS di HP atau tablet Android.',
            'Masuk di aplikasi dengan akun pemilik yang sama.',
            'Pilih nama kasir, ketik PIN, lalu buka shift dengan kas awal.',
          ].map((x, i) => (
            <li key={x} className="flex gap-3">
              <StepNum n={i + 1} state="todo" />
              <span className="pt-1">{t(x)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex justify-end">
        <a href="/" className={btn('fire')}>
          {t('Buka Backoffice')}
        </a>
      </div>
    </StepCard>
  );
}
