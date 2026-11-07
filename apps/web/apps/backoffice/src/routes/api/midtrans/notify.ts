import { createFileRoute } from '@tanstack/react-router';

// Midtrans posts every payment status here. The handler checks Midtrans' signature before anything changes (110).
export const Route = createFileRoute('/api/midtrans/notify')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { midtransNotify } = await import('../../../server/billing');
        return midtransNotify(request);
      },
    },
  },
});
