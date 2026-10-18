import { createFileRoute } from '@tanstack/react-router';
import { LegalPage } from '../components/LegalPage';
import { TERMS } from '../legal';

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Syarat Layanan · Hermes POS' }] }),
  component: () => <LegalPage doc={TERMS} />,
});
