import { useEffect, type ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router';
import { LangProvider, UI_EN, storedLang, useI18n, type Lang } from '@hermes-pos/ui';
import appCss from '../styles.css?url';
import { ErrorPage } from '../components/ErrorPage';
import { EN } from '../dict';
import { getLang } from '../lang';

const DICT = { ...UI_EN, ...EN };

export const Route = createRootRoute({
  beforeLoad: async () => ({ lang: await getLang() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Hermes POS backoffice' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', content: '#eef0ea' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  // The shell wraps every state, including the error and not-found screens, so they always have the
  // document, the language provider, and the fonts.
  shellComponent: Document,
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => {
    if (typeof console !== 'undefined') console.error(error);
    return <ErrorPage code={500} />;
  },
});

function NotFound() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <ErrorPage code={404} path={path} />;
}

function Document({ children }: { children: ReactNode }) {
  const lang = (Route.useRouteContext() as { lang?: Lang } | undefined)?.lang ?? 'id';
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        <LangProvider initial={lang} dict={DICT}>
          <LangSync />
          {children}
        </LangProvider>
        <Scripts />
      </body>
    </html>
  );
}

/** A choice saved in this browser before the cookie existed wins once after hydration. */
function LangSync() {
  const { lang, setLang } = useI18n();
  useEffect(() => {
    const saved = storedLang();
    if (saved && saved !== lang) setLang(saved);
    // Runs once after hydration only.
  }, []);
  return null;
}
