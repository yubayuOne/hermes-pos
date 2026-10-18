import { LangToggle, Wordmark, btn, useI18n } from '@hermes-pos/ui';
import { LINKS } from '../content';

const NAV = [
  ['#control', 'Kontrol kas'],
  ['#workday', 'Satu hari kerja'],
  ['#backoffice', 'Backoffice'],
  ['#pricing', 'Harga paket'],
  ['#faq', 'Tanya jawab'],
  ['#contact', 'Kontak'],
] as const;

/** C2. One row on desktop; on ≤620px the links become one row that scrolls sideways. */
export function Header() {
  const { t } = useI18n();
  return (
    <header id="top" className="wrap border-b-[1.5px] border-ink">
      <div className="flex items-center gap-6 py-5">
        <a href="#top" aria-label={t('Hermes POS, kembali ke atas')} className="flex-none">
          <Wordmark size={26} />
        </a>
        <nav aria-label={t('Bagian halaman')} className="hidden flex-1 lg:block">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LangToggle />
          <a href={LINKS.login} className={btn('plain', { sm: true })}>
            {t('Masuk')}
          </a>
          <a href={LINKS.register} className={`${btn('ink', { sm: true })} hidden sm:inline-flex`}>
            {t('Coba gratis 3 hari')}
          </a>
        </div>
      </div>
      <nav aria-label={t('Bagian halaman')} className="-mx-5 overflow-x-auto px-5 pb-3 lg:hidden">
        <NavLinks />
      </nav>
    </header>
  );
}

function NavLinks() {
  const { t } = useI18n();
  return (
    <ul className="flex gap-1 whitespace-nowrap lg:gap-2">
      {NAV.map(([href, label]) => (
        <li key={href}>
          <a href={href} className="inline-flex min-h-11 items-center px-2.5 text-[16px] font-medium decoration-2 underline-offset-[6px] hover:underline">
            {t(label)}
          </a>
        </li>
      ))}
    </ul>
  );
}
