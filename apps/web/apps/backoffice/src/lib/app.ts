import { getRouteApi } from '@tanstack/react-router';
import { useI18n } from '@hermes-pos/ui';

const appRoute = getRouteApi('/_app');

/** Shell data for any page inside the app layout. */
export function useApp() {
  return appRoute.useRouteContext().app;
}

/**
 * Expired state (G3): write buttons stay visible but disabled, labelled "Terkunci: langganan berakhir".
 * Spread `lock.props` on a button and render `lock.label(original)` as its text.
 */
export function useLock() {
  const app = useApp();
  const { t } = useI18n();
  const locked = app.subscription.state === 'expired';
  return {
    locked,
    props: locked ? { disabled: true, title: t('Terkunci: langganan berakhir') } : {},
    label: (text: string) => (locked ? t('Terkunci: langganan berakhir') : text),
  };
}
