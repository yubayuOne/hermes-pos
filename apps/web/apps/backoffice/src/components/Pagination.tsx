import { Button, useI18n } from '@hermes-pos/ui';

/** Rows per page for lists that are loaded whole (products, vouchers). */
export const PAGE_SIZE = 20;

/** The rows of one page (1-based), and how many pages there are. A page past the end shows the last one. */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

/** Previous / page n of m / next, for long lists (owner's request, 17 Oct 2026). Hidden with one page. */
export function Pagination({ page, pages, onPage, busy }: { page: number; pages: number; onPage: (page: number) => void; busy?: boolean }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return (
    <nav aria-label={t('Halaman')} className="mt-6 flex flex-wrap items-center justify-center gap-3">
      <Button disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
        {t('Sebelumnya')}
      </Button>
      <p className="font-mono text-[14px]" aria-live="polite">
        {t('Halaman {n} dari {m}', { n: page, m: pages })}
      </p>
      <Button disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
        {t('Berikutnya')}
      </Button>
    </nav>
  );
}
