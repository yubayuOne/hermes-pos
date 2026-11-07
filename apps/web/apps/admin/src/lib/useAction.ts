import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { toast } from '@hermes-pos/ui';
import { describeError } from './errors';
import type { ActionResult } from './types';

/** Runs a server action with busy and error state; a confirmed write refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      void router.invalidate().catch((err) => console.error('Failed to refresh page data:', err));
      if (opts.success) toast.success(opts.success);
      return res;
    } catch (err) {
      setError(describeError(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}
