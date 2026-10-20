import { useState } from 'react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Button, Field, FormAlert, Input, useI18n } from '@hermes-pos/ui';
import { AuthLayout, AuthTitle } from '../components/AuthLayout';
import { forgotSchema } from '../lib/schemas';
import { useForm } from '../lib/useForm';
import { requestPasswordReset } from '../server/auth';
import { pageHead } from '../lang';

export const Route = createFileRoute('/forgot-password')({
  head: ({ match }) => pageHead(match.context.lang, 'Lupa kata sandi'),
  component: Forgot,
});

function Forgot() {
  const { t } = useI18n();
  const f = useForm({ email: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = f.check(forgotSchema);
    if (!data) return;
    setBusy(true);
    const res = await requestPasswordReset({ data }).catch(() => ({
      ok: false as const,
      error: 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.',
    }));
    setBusy(false);
    if (!res.ok) return f.fail(res.error);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthLayout>
        <AuthTitle
          title={t('Tautan terkirim.')}
          sub={t('Kalau {email} terdaftar, tautannya sudah kami kirim. Berlaku 1 jam.', { email: f.values.email })}
        />
        <Link to="/login" className="btn btn-block">
          {t('Kembali ke halaman masuk')}
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <AuthTitle title={t('Lupa kata sandi.')} sub={t('Tulis email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.')} />
      <form method="post" noValidate onSubmit={submit} className="grid gap-4">
        <Field label="Email" error={f.errors.email && t(f.errors.email)}>
          <Input type="email" autoComplete="email" placeholder={t('nama@bisnis.com')} value={f.values.email} onChange={(e) => f.set('email', e.target.value)} />
        </Field>
        <FormAlert>{f.errors._ && t(f.errors._)}</FormAlert>
        <Button type="submit" variant="fire" block busy={busy} busyLabel={t('Mengirim...')}>
          {t('Kirim tautan')}
        </Button>
      </form>
      <p className="mt-6 text-[15px] text-mute">
        {t('Ingat kata sandinya?')}{' '}
        <Link to="/login" className="lnk lnk-inline text-ink">
          {t('Masuk')}
        </Link>
      </p>
    </AuthLayout>
  );
}
