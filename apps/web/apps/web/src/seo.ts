import { EN } from './dict';
import { FAQ, PLANS, SITE } from './content';

export const TITLE = 'Hermes POS: aplikasi kasir Android dengan kontrol kas untuk kafe';
export const DESCRIPTION =
  'Aplikasi kasir Android untuk kafe dan restoran kecil: void dan refund butuh kode pemilik, kas laci terhitung, tetap jalan saat offline. Trial gratis 3 hari.';

// head() runs outside the language provider, so it looks up the dictionary directly.
export const tr = (lang: string | undefined, text: string) => (lang === 'en' ? (EN[text] ?? text) : text);

/**
 * Structured data for search engines. It repeats only what the page shows: the app, its real prices, and the FAQ.
 * No ratings, review counts, or company data, because none exist yet.
 */
export function structuredData(lang: string | undefined) {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Hermes POS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Android',
      inLanguage: lang === 'en' ? 'en' : 'id',
      description: tr(lang, DESCRIPTION),
      url: SITE.url,
      offers: PLANS.map((p) => ({
        '@type': 'Offer',
        name: tr(lang, p.name),
        price: String(p.price),
        priceCurrency: 'IDR',
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({
        '@type': 'Question',
        name: tr(lang, q),
        acceptedAnswer: { '@type': 'Answer', text: tr(lang, a) },
      })),
    },
  ];
  // "<" is escaped so the JSON can never close the script tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
