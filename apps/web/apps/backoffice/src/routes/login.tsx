import { useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Button, Check, Field, FormAlert, Input, useI18n } from '@hermes-pos/ui';
import { AuthLayout, AuthTitle, GoogleButton } from '../components/AuthLayout';
import { PasswordInput } from '../components/PasswordInput';
import { loginSchema } from '../lib/schemas';
import { useForm } from '../lib/useForm';
import { getSession, googleUrl, signIn } from '../server/auth';
import { pageHead } from '../lang';

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const session = await getSession();
    if (session) throw redirect({ to: session.businessId ? '/' : '/onboarding' });
  },
  head: ({ match }) => pageHead(match.context.lang, 'Masuk'),
  component: SignIn,
});

function SignIn() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const f = useForm({ identifier: '', password: '', remember: true });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'form' | 'google' | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(loginSchema);
    if (!data) return;
    setBusy('form');
    try {
      const res = await signIn({ data });
      if (!res.ok) return f.fail(res.error, res.field);
      await navigate({ to: '/' });
    } catch {
      f.fail('Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.');
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy('google');
    const res = await googleUrl({ data: { next: '/' } }).catch(() => null);
    if (res?.ok && res.data) window.location.href = res.data;
    else {
      setBusy(null);
      f.fail(res && !res.ok ? res.error : 'Masuk dengan Google belum aktif. Pakai email dan kata sandi.');
    }
  }

  return (
    <AuthLayout>
      <AuthTitle title={t('Masuk.')} sub={t('Untuk pemilik bisnis. Kasir masuk lewat aplikasi dengan PIN.')} />
      <form method="post" noValidate onSubmit={submit} className="grid gap-4">
        <Field label={t('Email atau username')} error={f.errors.identifier && t(f.errors.identifier)}>
          <Input
            autoComplete="username"
            inputMode="email"
            placeholder={t('nama@bisnis.com atau kopipojok')}
            value={f.values.identifier}
            onChange={(e) => f.set('identifier', e.target.value)}
          />
        </Field>
        <Field label={t('Kata sandi')} error={f.errors.password && t(f.errors.password)}>
          <PasswordInput
            value={f.values.password}
            onChange={(v) => f.set('password', v)}
            show={show}
            onToggle={() => setShow(!show)}
            autoComplete="current-password"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <Check label={t('Ingat saya di perangkat ini')} checked={f.values.remember} onChange={(e) => f.set('remember', e.target.checked)} />
          <Link to="/forgot-password" className="lnk">
            {t('Lupa kata sandi?')}
          </Link>
        </div>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
        <Button type="submit" variant="fire" block busy={busy === 'form'} busyLabel={t('Memeriksa...')} disabled={busy !== null}>
          {t('Masuk')}
        </Button>
      </form>
      <GoogleButton
        label={t('Lanjut dengan Google')}
        onClick={google}
        busy={busy !== null}
        busyLabel={busy === 'google' ? t('Membuka Google...') : undefined}
      />
      <p className="mt-6 text-[15px] text-mute">
        {t('Belum punya akun?')}{' '}
        <Link to="/register" className="lnk lnk-inline text-ink">
          {t('Daftar trial gratis')}
        </Link>
      </p>
    </AuthLayout>
  );
}
