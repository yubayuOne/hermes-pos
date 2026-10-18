import { createServerFn } from '@tanstack/react-start';
import type { Lang } from '@hermes-pos/ui';
import { EN } from './dict';

// Read on the server so the first paint is in the chosen language.
export const getLang = createServerFn({ method: 'GET' }).handler(async (): Promise<Lang> => {
  const { getCookie } = await import('@tanstack/react-start/server');
  return getCookie('hermes-pos-lang') === 'en' ? 'en' : 'id';
});

/** Route `head` with the page title in the language from the root context; `key` is a dictionary key. */
export function pageHead(lang: Lang | undefined, key: string) {
  const id = key.split('|')[0];
  return { meta: [{ title: `${lang === 'en' ? (EN[key] ?? id) : id} · Hermes POS backoffice` }] };
}
