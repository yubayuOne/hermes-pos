import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { FormAlert, useI18n } from '@hermes-pos/ui';
import { AuthLayout, AuthTitle } from '../components/AuthLayout';
import { exchangeCode } from '../server/auth';

// Only internal paths, so the link can never send someone to another site.
const SAFE_NEXT = new Set(['/', '/onboarding', '/reset-password']);

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s.code === 'string' ? s.code : undefined,
    next: typeof s.next === 'string' ? s.next : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.code) return { error: 'Tautan tidak lengkap. Buka lagi tautan dari email.' };
    const res = await exchangeCode({ data: { code: deps.code } });
    if (!res.ok) return { error: res.error };
    throw redirect({ to: SAFE_NEXT.has(deps.next ?? '') ? (deps.next as '/') : '/' });
  },
  component: Callback,
});

function Callback() {
  const { t } = useI18n();
  const { error } = Route.useLoaderData();
  return (
    <AuthLayout>
      <AuthTitle title={t('Tautan tidak berlaku.')} />
      <FormAlert>{t(error)}</FormAlert>
      <Link to="/login" className="btn btn-block mt-5">
        {t('Ke halaman masuk')}
      </Link>
    </AuthLayout>
  );
}
