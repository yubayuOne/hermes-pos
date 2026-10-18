import { createRouter } from '@tanstack/react-router';
import { ErrorPage } from './components/ErrorPage';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Load a page's data on hover or touch so the click finds it cached. A page opened again within a minute shows
    // its data at once with no request; later it still shows at once and refreshes in the background (kept 30 min).
    // Every write calls router.invalidate() (useAction), so the owner's own changes show right away.
    defaultPreload: 'intent',
    defaultStaleTime: 60_000,
    defaultPreloadStaleTime: 60_000,
    defaultGcTime: 30 * 60_000,
    // Data errors on any page show the 500 screen (DESIGN.md D3); unknown paths show 404.
    defaultErrorComponent: ({ error }) => {
      console.error(error);
      return <ErrorPage code={500} />;
    },
    defaultNotFoundComponent: () => <ErrorPage code={404} />,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
