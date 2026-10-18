import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { toast, useI18n } from '@hermes-pos/ui';
import { describeError } from './errors';
import { clearAppContextCache } from './appContextCache';
import type { ActionResult } from './types';

/**
 * Runs a server action with busy/error state and success feedback.
 * Route data is revalidated in the background after a confirmed write so a
 * slow list refresh does not keep the form or switch disabled.
 */
export function useAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(
    fn: () => Promise<ActionResult<T>>,
    opts: { success?: string; undo?: () => Promise<unknown>; toastError?: boolean; refreshAppContext?: boolean } = {},
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        if (opts.toastError) toast.error(t(res.error));
        else setError(res.error);
        return null;
      }

      if (opts.refreshAppContext) clearAppContextCache();
      void router.invalidate().catch((err) => console.error('Failed to refresh page data:', err));
      if (opts.success) {
        const undo = opts.undo;
        toast.success(
          opts.success,
          undo
            ? async () => {
                await undo();
                if (opts.refreshAppContext) clearAppContextCache();
                await router.invalidate();
              }
            : undefined,
        );
      }
      return res;
    } catch (err) {
      const msg = describeError(err);
      if (opts.toastError) toast.error(t(msg));
      else setError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}
