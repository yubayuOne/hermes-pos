import { useEffect, useRef, useState } from 'react';
import { LangToggle, Wordmark, btn, cn, useI18n } from '@hermes-pos/ui';
import { LINKS } from '../content';

const NAV = [
  ['control', 'Kontrol kas'],
  ['workday', 'Satu hari kerja'],
  ['backoffice', 'Backoffice'],
  ['pricing', 'Harga paket'],
  ['faq', 'Tanya jawab'],
  ['contact', 'Kontak'],
] as const;
type SectionId = (typeof NAV)[number][0];

/**
 * C2. Stays at the top while the page scrolls. The section under the header is marked in the nav (scroll spy); on
 * ≤1023px the links are one row that scrolls sideways and keeps the current one in view. Its height is published as
 * --hdr so anchor jumps land below it (styles.css).
 */
export function Header() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const active = useActiveSection(ref);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--hdr', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header id="top" ref={ref} className="sticky top-0 z-40 border-b-[1.5px] border-ink bg-paper">
      <div className="wrap flex items-center gap-3 py-3 sm:gap-6 sm:py-4">
        <a href="#top" aria-label={t('Hermes POS, kembali ke atas')} className="flex-none">
          {/* Below 420px only the mark fits next to the language switch and Masuk; the name stays for screen readers. */}
          <Wordmark size={22} labelClassName="max-[419px]:sr-only" />
        </a>
        <nav aria-label={t('Bagian halaman')} className="hidden flex-1 lg:block">
          <NavLinks active={active} />
        </nav>
        <div className="ml-auto flex flex-none items-center gap-2 sm:gap-3">
          <LangToggle />
          <a href={LINKS.login} className={btn('plain', { sm: true })}>
            {t('Masuk')}
          </a>
          <a href={LINKS.register} className={`${btn('ink', { sm: true })} hidden sm:inline-flex`}>
            {t('Coba gratis 3 hari')}
          </a>
        </div>
      </div>
      <nav aria-label={t('Bagian halaman')} className="wrap lg:hidden">
        <NavLinks active={active} scroller />
      </nav>
    </header>
  );
}

function NavLinks({ active, scroller }: { active: SectionId | null; scroller?: boolean }) {
  const { t } = useI18n();
  const list = useRef<HTMLUListElement>(null);

  // Keep the current section's link in view inside the sideways row.
  useEffect(() => {
    const ul = list.current;
    const a = active && ul?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!scroller || !ul || !a) return;
    ul.scrollTo({ left: a.offsetLeft - (ul.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
  }, [active, scroller]);

  return (
    <ul ref={list} className={cn('flex gap-1 whitespace-nowrap lg:gap-2', scroller && '-mx-1 overflow-x-auto pb-1 [scrollbar-width:none]')}>
      {NAV.map(([id, label]) => (
        <li key={id}>
          <a
            href={`#${id}`}
            data-id={id}
            aria-current={active === id ? 'location' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center border-b-[3px] border-transparent px-2.5 text-[16px] font-medium hover:border-ink',
              active === id && 'border-fire font-semibold',
            )}
          >
            {t(label)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The last section whose top has passed under the sticky header; the last one once the page bottom is reached. */
function useActiveSection(header: React.RefObject<HTMLElement | null>): SectionId | null {
  const [active, setActive] = useState<SectionId | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (header.current?.offsetHeight ?? 0) + 32;
      let current: SectionId | null = null;
      for (const [id] of NAV) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = NAV[NAV.length - 1][0];
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [header]);
  return active;
}
