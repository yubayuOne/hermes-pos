import { createServerFn } from '@tanstack/react-start';
import type { Lang } from '@hermes-pos/ui';

// The language cookie is read on the server so the first paint is already in the visitor's language.
export const getLang = createServerFn({ method: 'GET' }).handler(async (): Promise<Lang> => {
  const { getCookie } = await import('@tanstack/react-start/server');
  return getCookie('hermes-pos-lang') === 'en' ? 'en' : 'id';
});
