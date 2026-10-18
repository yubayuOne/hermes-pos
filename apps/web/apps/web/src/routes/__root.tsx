import { useEffect, type ReactNode } from 'react';
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { LangProvider, UI_EN, storedLang, useI18n } from '@hermes-pos/ui';
import appCss from '../styles.css?url';
import { SITE } from '../content';
import { EN } from '../dict';
import { getLang } from '../lang';
import { DESCRIPTION, TITLE, structuredData, tr } from '../seo';

const DICT = { ...UI_EN, ...EN };
const OG_IMAGE = `${SITE.url}/brand/hermes-pos-og.jpg`;

export const Route = createRootRoute({
  loader: () => getLang(),
  head: ({ loaderData: lang }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: tr(lang, TITLE) },
      { name: 'description', content: tr(lang, DESCRIPTION) },
      { name: 'robots', content: 'index, follow, max-image-preview:large' },
      { name: 'theme-color', content: '#eef0ea' },
      { property: 'og:site_name', content: 'Hermes POS' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: SITE.url },
      { property: 'og:locale', content: lang === 'en' ? 'en_US' : 'id_ID' },
      { property: 'og:title', content: tr(lang, TITLE) },
      { property: 'og:description', content: tr(lang, DESCRIPTION) },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Hermes POS' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: tr(lang, TITLE) },
      { name: 'twitter:description', content: tr(lang, DESCRIPTION) },
      { name: 'twitter:image', content: OG_IMAGE },
    ],
    links: [
      { rel: 'canonical', href: SITE.url },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
    scripts: [{ type: 'application/ld+json', children: structuredData(lang) }],
  }),
  component: Root,
});

function Root() {
  const lang = Route.useLoaderData();
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        <LangProvider initial={lang} dict={DICT}>
          <LangSync />
          <Outlet />
        </LangProvider>
        <Scripts />
      </body>
    </html>
  );
}

/** A choice saved in this browser before the cookie existed still wins once after hydration. */
function LangSync(): ReactNode {
  const { lang, setLang } = useI18n();
  useEffect(() => {
    const saved = storedLang();
    if (saved && saved !== lang) setLang(saved);
    // Runs once after hydration only.
  }, []);
  return null;
}
