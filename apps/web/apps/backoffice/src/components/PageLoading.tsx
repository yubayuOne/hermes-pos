import { Loading, SkCard, useI18n } from '@hermes-pos/ui';
import { Page } from './Page';

/** Skeleton shown while a page loader runs, so a menu click answers at once. `title` is an Indonesian dictionary key. */
export function PageLoading({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <Page title={t(title)}>
      <Loading className="grid gap-5">
        <SkCard />
        <SkCard />
      </Loading>
    </Page>
  );
}
