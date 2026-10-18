import { createFileRoute } from '@tanstack/react-router';
import { LegalPage } from '../components/LegalPage';
import { PRIVACY } from '../legal';

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Kebijakan Privasi · Hermes POS' }] }),
  component: () => <LegalPage doc={PRIVACY} />,
});
