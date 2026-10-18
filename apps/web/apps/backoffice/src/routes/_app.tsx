import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import { getCachedAppContext, rememberAppContext } from '../lib/appContextCache';
import type { AppContext } from '../lib/types';
import { getBackofficeBootstrap } from '../server/app';

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    // Client-side sibling-menu navigation can reuse the short-lived shell
    // cache without a round trip just to re-check identity. This is only a UI
    // optimization: every server function that reads or mutates tenant data
    // must still authenticate the request and enforce permissions. A hard
    // reload has no browser cache and goes through the bootstrap below.
    const cached = getCachedAppContext();
    if (cached) return { session: cached.session, app: cached };

    const result = await getBackofficeBootstrap();
    if (!result.session || !result.app) throw redirect({ to: '/login' });
    if (!result.session.businessId) throw redirect({ to: '/onboarding', search: { step: 1 } });
    const app: AppContext = { ...result.app, session: result.session };
    rememberAppContext(app);
    return { session: result.session, app };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
