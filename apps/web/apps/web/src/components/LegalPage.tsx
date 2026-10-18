import { Wordmark, useI18n } from '@hermes-pos/ui';
import { Footer } from './Closing';
import type { LegalDoc } from '../legal';

/** Terms of service or privacy policy in the visitor's language (legal.ts). */
export function LegalPage({ doc }: { doc: Record<'id' | 'en', LegalDoc> }) {
  const { t, lang } = useI18n();
  const d = doc[lang === 'en' ? 'en' : 'id'];
  return (
    <>
      <header className="wrap flex items-center justify-between gap-4 border-b-[1.5px] border-ink py-5">
        <a href="/" aria-label={t('Kembali ke beranda')}>
          <Wordmark size={24} />
        </a>
        <a href="/" className="text-[15px] underline-offset-4 hover:underline">
          {t('Kembali ke beranda')}
        </a>
      </header>
      <main id="content" className="wrap max-w-[46em] py-12">
        <h1 className="text-[clamp(36px,5vw,56px)]">{d.title}</h1>
        <p className="mt-2 font-mono text-[14px] text-mute">{d.updated}</p>
        <p className="mt-6 text-[18px]">{d.intro}</p>
        {d.sections.map((s) => (
          <section key={s.h} className="mt-10">
            <h2 className="text-[24px]">{s.h}</h2>
            {s.p.map((p) => (
              <p key={p} className="mt-3 text-[17px] leading-relaxed">
                {p}
              </p>
            ))}
          </section>
        ))}
      </main>
      <Footer />
    </>
  );
}
