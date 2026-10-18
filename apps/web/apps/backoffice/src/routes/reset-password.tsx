import { useState } from 'react';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Button, Field, FormAlert, useI18n } from '@hermes-pos/ui';
import { AuthLayout, AuthTitle } from '../components/AuthLayout';
import { PasswordInput } from '../components/PasswordInput';
import { StrengthMeter } from '../components/StrengthMeter';
import { resetSchema } from '../lib/schemas';
import { useForm } from '../lib/useForm';
import { getSession, updatePassword } from '../server/auth';
import { pageHead } from '../lang';

// Reached from the email link: /auth/callback exchanges the code for a session, then sends the owner here.
export const Route = createFileRoute('/reset-password')({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: '/forgot-password' });
    return { email: session.email };
  },
  head: ({ match }) => pageHead(match.context.lang, 'Kata sandi baru'),
  component: Reset,
});

function Reset() {
  const { t } = useI18n();
  const { email } = Route.useRouteContext();
  const f = useForm({ password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(resetSchema);
    if (!data) return;
    setBusy(true);
    const res = await updatePassword({ data }).catch(() => ({
      ok: false as const,
      error: 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.',
    }));
    setBusy(false);
    if (!res.ok) return f.fail(res.error);
    setDone(true);
  }

  if (done) {
    return (
      <AuthLayout>
        <AuthTitle title={t('Kata sandi diganti.')} sub={t('Mulai sekarang masuk dengan kata sandi baru.')} />
        <Link to="/" className="btn btn-fire btn-block">
          {t('Buka Backoffice')}
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <AuthTitle title={t('Kata sandi baru.')} sub={t('Untuk akun {email}.', { email })} />
      <form method="post" noValidate onSubmit={submit} className="grid gap-4">
        <Field label={t('Kata sandi baru')} error={f.errors.password && t(f.errors.password)}>
          <PasswordInput
            autoComplete="new-password"
            value={f.values.password}
            onChange={(v) => f.set('password', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        <StrengthMeter pw={f.values.password} email={email} />
        <Field label={t('Ulangi kata sandi baru')} error={f.errors.confirm && t(f.errors.confirm)}>
          <PasswordInput
            autoComplete="new-password"
            value={f.values.confirm}
            onChange={(v) => f.set('confirm', v)}
            show={show}
            onToggle={() => setShow(!show)}
          />
        </Field>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
        <Button type="submit" variant="fire" block busy={busy} busyLabel={t('Menyimpan...')}>
          {t('Simpan kata sandi')}
        </Button>
      </form>
    </AuthLayout>
  );
}
