import { createFileRoute } from '@tanstack/react-router';
import { useI18n } from '@hermes-pos/ui';
import { BackofficeBand } from '../components/BackofficeBand';
import { Closing, Footer } from '../components/Closing';
import { Control } from '../components/Control';
import { Faq } from '../components/Faq';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { Pricing } from '../components/Pricing';
import { WorkDay } from '../components/WorkDay';

export const Route = createFileRoute('/')({ component: Landing });

function Landing() {
  const { t } = useI18n();
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-slip focus:p-3">
        {t('Langsung ke isi')}
      </a>
      <Header />
      <main id="content">
        <Hero />
        <Control />
        <WorkDay />
        <BackofficeBand />
        <Pricing />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
