import { useI18n } from '@hermes-pos/ui';
import { FAQ } from '../content';

/** C8. Ten questions, the first one open. The same list is sent to search engines (see seo.ts). */
export function Faq() {
  const { t } = useI18n();
  return (
    <section id="faq" aria-labelledby="faq-t" className="wrap grid scroll-mt-6 gap-10 pt-28 lg:grid-cols-[5fr_7fr] lg:gap-16">
      <h2 id="faq-t" className="max-w-[9em] text-[clamp(36px,4.4vw,64px)]">
        {t('Yang biasa ditanyakan pemilik kafe.')}
      </h2>
      <div className="border-t-[1.5px] border-ink">
        {FAQ.map(([q, a], i) => (
          <details key={q} open={i === 0} className="group border-b-[1.5px] border-ink">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 py-5 text-[19px] font-medium sm:text-[20px] [&::-webkit-details-marker]:hidden">
              {t(q)}
              <span aria-hidden className="flex-none font-mono text-[24px] leading-none transition-transform duration-200 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-6 text-mute">{t(a)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
