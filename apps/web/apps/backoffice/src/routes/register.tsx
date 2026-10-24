import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Button, Check, Field, FormAlert, Input, useI18n } from '@hermes-pos/ui';
import { AuthLayout, AuthTitle, GoogleButton } from '../components/AuthLayout';
import { PasswordInput } from '../components/PasswordInput';
import { StrengthMeter } from '../components/StrengthMeter';
import { PRIVACY_URL, TERMS_URL } from '../lib/plans';
import { registerSchema, username as usernameSchema } from '../lib/schemas';
import { useForm } from '../lib/useForm';
import { getSession, googleUrl, signUp, usernameAvailable } from '../server/auth';
import { pageHead } from '../lang';

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    const session = await getSession();
    if (session) throw redirect({ to: session.businessId ? '/' : '/onboarding' });
  },
  head: ({ match }) => pageHead(match.context.lang, 'Daftar trial'),
  component: Register,
});

function Register() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const f = useForm({ business: '', username: '', email: '', password: '', terms: false });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'form' | 'google' | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function checkUsername() {
    const u = usernameSchema.safeParse(f.values.username);
    if (!u.success) return;
    const free = await usernameAvailable({ data: u.data }).catch(() => true);
    if (!free) f.setErrors((e) => ({ ...e, username: 'Username sudah dipakai. Pilih username lain.' }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(registerSchema);
    if (!data) return;
    setBusy('form');
    try {
      const res = await signUp({ data });
      if (!res.ok) return f.fail(res.error, res.field);
      if (res.data === 'ready') await navigate({ to: '/onboarding' });
      else setSent(data.email);
    } catch {
      f.fail('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.');
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    // The terms apply to Google sign-up too (DESIGN.md E1).
    if (!f.values.terms) return f.setErrors({ terms: 'Setujui syarat layanan untuk membuat akun.' });
    setBusy('google');
    const res = await googleUrl({ data: { next: '/onboarding' } }).catch(() => null);
    if (res?.ok && res.data) window.location.href = res.data;
    else {
      setBusy(null);
      f.fail(res && !res.ok ? res.error : 'Masuk dengan Google belum aktif. Pakai email dan kata sandi.');
    }
  }

  if (sent) {
    return (
      <AuthLayout>
        <AuthTitle
          title={t('Cek email Anda.')}
          sub={t('Buka tautan yang kami kirim ke {email} untuk melanjutkan.', { email: sent })}
        />
        <p className="text-body text-mute">{t('Tidak ada email? Lihat folder spam, atau daftar lagi dengan email yang benar.')}</p>
        <Button className="mt-6" onClick={() => setSent(null)}>
          {t('Ubah email')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthTitle title={t('Coba gratis 3 hari.')} sub={t('1 outlet, 2 kasir, 40 produk. Tidak perlu kartu kredit.')} />
      <form method="post" noValidate onSubmit={submit} className="grid gap-4">
        <Field label={t('Nama bisnis')} error={f.errors.business && t(f.errors.business)}>
          <Input
            autoComplete="organization"
            placeholder={t('Contoh: Kopi Pojok')}
            value={f.values.business}
            onChange={(e) => f.set('business', e.target.value)}
          />
        </Field>
        <Field
          label="Username"
          error={f.errors.username && t(f.errors.username)}
          help={t('3 sampai 20 karakter: huruf kecil, angka, titik, atau garis bawah.')}
        >
          <Input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="kopipojok"
            value={f.values.username}
            onChange={(e) => f.set('username', e.target.value.toLowerCase())}
            onBlur={checkUsername}
          />
        </Field>
        <Field label="Email" error={f.errors.email && t(f.errors.email)}>
          <Input type="email" autoComplete="email" placeholder={t('nama@bisnis.com')} value={f.values.email} onChange={(e) => f.set('email', e.target.value)} />
        </Field>
        <Field label={t('Kata sandi')} error={f.errors.password && t(f.errors.password)}>
          <PasswordInput
            autoComplete="new-password"
            value={f.values.password}
            onChange={(v) => f.set('password', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        <StrengthMeter pw={f.values.password} email={f.values.email} />
        <div>
          <Check
            label={t('Saya setuju dengan syarat layanan dan kebijakan privasi.')}
            checked={f.values.terms}
            aria-invalid={f.errors.terms ? true : undefined}
            onChange={(e) => f.set('terms', e.target.checked)}
          />
          <p className="mt-1 flex gap-4 pl-8 text-small">
            <a href={TERMS_URL} target="_blank" rel="noopener" className="underline underline-offset-4">
              {t('Baca syarat layanan')}
            </a>
            <a href={PRIVACY_URL} target="_blank" rel="noopener" className="underline underline-offset-4">
              {t('Baca kebijakan privasi')}
            </a>
          </p>
          {f.errors.terms && (
            <p role="alert" className="ferr mt-1">
              {t(f.errors.terms)}
            </p>
          )}
        </div>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
        <Button type="submit" variant="fire" block busy={busy === 'form'} busyLabel={t('Membuat akun...')} disabled={busy !== null}>
          {t('Buat akun dan mulai trial')}
        </Button>
      </form>
      <GoogleButton
        label={t('Daftar dengan Google')}
        onClick={google}
        busy={busy !== null}
        busyLabel={busy === 'google' ? t('Membuka Google...') : undefined}
      />
      <p className="mt-6 text-body text-mute">
        {t('Sudah punya akun?')}{' '}
        <Link to="/login" className="lnk lnk-inline text-ink">
          {t('Masuk')}
        </Link>
      </p>
    </AuthLayout>
  );
}
