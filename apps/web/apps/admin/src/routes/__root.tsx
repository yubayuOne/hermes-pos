import type { ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { LangProvider, UI_EN } from '@hermes-pos/ui';
import appCss from '../styles.css?url';

// The admin site is in Indonesian only; the UI dictionary still covers the shared components.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Hermes POS admin' },
      { name: 'robots', content: 'noindex' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: Document,
  component: Outlet,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        <LangProvider initial="id" dict={UI_EN}>
          {children}
        </LangProvider>
        <Scripts />
      </body>
    </html>
  );
}
