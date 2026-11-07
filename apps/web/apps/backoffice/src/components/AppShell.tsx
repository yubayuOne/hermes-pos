import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Dialog as D } from 'radix-ui';
import { CloseIcon, MenuIcon, Wordmark, cn, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { rememberAppContext } from '../lib/appContextCache';
import { NAV_FOLD_OVER, NAV_GROUPS, type NavTo } from '../lib/nav';
import { Bell } from './Bell';


/**
 * D1. Desktop: sidebar 264px (232px at ≤980px) and content scroll separately. ≤760px: a 60px top bar with
 * a hamburger, and the sidebar becomes a drawer that closes on ✕, the backdrop, Esc, or choosing a page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const app = useApp();
  // Seed the browser-only cache on hydration; avoid a module-level tenant cache on the server.
  useEffect(() => {
    rememberAppContext(app);
  }, []);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(false);
    // A new menu starts at its top: on tablet and desktop the content column scrolls, not the window.
    content.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [path]);
  return (
    // minmax(0,1fr) row: an auto row grows to the page's height and scrolls the whole window, sidebar included.
    <div className="md:grid md:h-dvh md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)] print:!block print:!h-auto">
      <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b-[1.5px] border-ink bg-paper px-4 md:hidden print:hidden">
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger
            className="grid size-11 flex-none place-items-center rounded border-[1.5px] border-ink bg-slip transition-colors hover:bg-tint-2 active:bg-tint aria-expanded:bg-tint"
            aria-label={t('Buka menu')}
          >
            <MenuIcon />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-pine/45" />
            <D.Content
              className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col overflow-y-auto border-r-[1.5px] border-ink bg-paper shadow-[6px_0_0_var(--color-ink)] animate-drawer"
              aria-describedby={undefined}
            >
              <D.Title className="sr-only">{t('Menu backoffice')}</D.Title>
              <SidebarBody
                close={
                  <D.Close className="-mr-1 grid size-11 flex-none place-items-center rounded hover:bg-tint" aria-label={t('Tutup menu')}>
                    <CloseIcon />
                  </D.Close>
                }
              />
            </D.Content>
          </D.Portal>
        </D.Root>
        {/* The bell lives here on phones (owner's request, 18 Oct 2026); time left is in Pengaturan, Langganan. */}
        <Bell className="ml-auto size-11" />
      </header>
      <aside
        aria-label={t('Navigasi backoffice')}
        className="relative hidden flex-col overflow-hidden border-r-[1.5px] border-ink bg-paper md:flex print:!hidden"
      >
        <SidebarBody />
      </aside>
      {/* relative: absolute children (sr-only chart captions) must scroll inside this column, not stretch the window. */}
      <div ref={content} className="min-w-0 md:relative md:overflow-y-auto print:!overflow-visible">
        {children}
      </div>
    </div>
  );
}

/** `close`: the drawer's ✕, set beside the wordmark so it never sits on top of it. */
function SidebarBody({ close }: { close?: ReactNode }) {
  const app = useApp();
  const { t } = useI18n();
  const c = app.counts;
  // The drawer and the sidebar can both be mounted, so each copy needs its own heading ids.
  const id = useId();
  // The owner's choice (Pengaturan > Menu): hidden menus are left out; a group left empty is left out too.
  const hidden = app.business.sidebarHidden ?? [];
  const meta: Partial<Record<NavTo, number>> = { '/products': c.products, '/vouchers': c.vouchers, '/outlets': c.outlets, '/cashiers': c.cashiers };
  const groups = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => !hidden.includes(i.to)) })).filter((g) => g.items.length > 0);
  return (
    <div className={cn('flex h-full min-h-0 flex-col px-4 pb-5', close ? 'pt-3' : 'pt-6')}>
      <div className="px-2.5">
        <div className="flex items-center justify-between gap-2">
          <Wordmark size={close ? 26 : 32} />
          {close}
        </div>
        <p className="mt-2 truncate font-mono text-small text-mute">backoffice · {app.business.name || '[NAMA BISNIS]'}</p>
      </div>
      {/* Only the menu scrolls on a short screen; the title and Pengaturan stay in view. */}
      <nav aria-label={t('Menu utama')} className="-mx-1 mt-6 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-1 pb-3">
        {groups.map((g, i) => (
          <NavGroup key={g.label} id={`${id}-${i}`} label={g.label} items={g.items.map((it) => ({ ...it, meta: meta[it.to] }))} />
        ))}
      </nav>
      <div className="border-t-[1.5px] border-ink pt-3">
        <NavLink to="/settings">{t('Pengaturan')}</NavLink>
      </div>
    </div>
  );
}

/**
 * A group of menus. With more than NAV_FOLD_OVER items it folds into a dropdown, open when the page you are on is in it.
 */
function NavGroup({ id, label, items }: { id: string; label: string; items: { to: NavTo; label: string; meta?: string | number }[] }) {
  const { t } = useI18n();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const foldable = items.length > NAV_FOLD_OVER;
  const current = items.some((i) => (i.to === '/' ? path === '/' : path.startsWith(i.to)));
  const [open, setOpen] = useState(!foldable || current);
  const headingId = `${id}-h`;
  const listId = `${id}-l`;
  const title = t(`${label}|menu`);
  return (
    <section aria-labelledby={headingId}>
      {foldable ? (
        <h2 id={headingId}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded px-2.5 text-left text-small font-semibold text-mute hover:text-ink"
          >
            <span>{title}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cn('flex-none transition-transform duration-150', open && 'rotate-180')}>
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </h2>
      ) : (
        <h2 id={headingId} className="px-2.5 pb-1.5 text-small font-semibold text-mute">
          {title}
        </h2>
      )}
      <ul id={listId} hidden={!open} className="grid gap-1">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink to={it.to} meta={it.meta}>
              {t(`${it.label}|menu`)}
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NavLink({ to, children, meta }: { to: NavTo | '/settings'; children: ReactNode; meta?: string | number }) {
  return (
    <Link
      to={to}
      preload="intent"
      preloadDelay={0}
      activeOptions={{ exact: to === '/', includeSearch: false }}
      className="group flex min-h-11 items-center gap-2.5 md:min-h-10 rounded border-[1.5px] border-transparent px-2.5 text-body font-medium transition-[background-color,transform] duration-150 hover:translate-x-[3px] hover:bg-tint aria-[current=page]:translate-x-0 aria-[current=page]:border-ink aria-[current=page]:bg-slip"
    >
      <span aria-hidden className="hidden size-2.5 flex-none bg-fire group-aria-[current=page]:block" />
      <span className="flex-1 truncate">{children}</span>
      {meta !== undefined && <span className={cn('font-mono text-small text-mute')}>{meta}</span>}
    </Link>
  );
}
