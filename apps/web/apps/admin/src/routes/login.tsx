import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Field, FormAlert, Input, Wordmark } from '@hermes-pos/ui';
import { describeError } from '../lib/errors';
import { signIn } from '../server/admin';

export const Route = createFileRoute('/login')({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await signIn({ data: { email, password } });
      if (!res.ok) return setError(res.error);
      await navigate({ to: '/admin', search: { page: 1 } });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[400px] content-center gap-6 px-4">
      <Wordmark size={32} />
      <h1 className="page-t">Masuk admin</h1>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Kata sandi">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormAlert>{error}</FormAlert>
        <Button type="submit" variant="fire" busy={busy} busyLabel="Memeriksa...">
          Masuk
        </Button>
      </form>
    </main>
  );
}
