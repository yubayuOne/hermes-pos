import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Dialog as D } from 'radix-ui';
import { CloseIcon, MenuIcon, Tag, Wordmark, cn, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { rememberAppContext } from '../lib/appContextCache';
import { PLAN_NAME } from '../lib/plans';

type NavItem = { to: '/' | '/outlets' | '/cashiers' | '/products' | '/expenses' | '/vouchers'; label: string; meta?: string | number };

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
  const sub = app.subscription;
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
        <Link to="/" preload="intent" preloadDelay={0} aria-label={t('Ringkasan')} className="flex-none">
          <Wordmark size={20} labelClassName="max-[359px]:sr-only" />
        </Link>
        {/* min-w-0 + truncate: the plan tag shortens instead of widening the page; below 400px only the days show. */}
        <Tag className="ml-auto block min-w-0 truncate">
          <span className="max-[399px]:sr-only">{t(PLAN_NAME[sub.plan])} · </span>
          {sub.plan === 'unlimited' ? t('selamanya') : sub.state === 'expired' ? t('berakhir') : t('{n} hari', { n: sub.daysLeft })}
        </Tag>
      </header>
      <aside
        aria-label={t('Navigasi backoffice')}
        className="relative hidden flex-col overflow-y-auto border-r-[1.5px] border-ink bg-paper md:flex print:!hidden"
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
  const items: NavItem[] = [
    { to: '/', label: 'Ringkasan' },
    { to: '/outlets', label: 'Outlet', meta: c.outlets },
    { to: '/cashiers', label: 'Kasir', meta: c.cashiers },
    { to: '/products', label: 'Produk', meta: c.products },
    { to: '/expenses', label: 'Pengeluaran' },
    { to: '/vouchers', label: 'Voucher', meta: c.vouchers },
  ];
  return (
    <div className={cn('flex min-h-full flex-col px-4 pb-5', close ? 'pt-3' : 'pt-6')}>
      <div className="px-2.5">
        <div className="flex items-center justify-between gap-2">
          <Wordmark size={close ? 26 : 32} />
          {close}
        </div>
        <p className="mt-2 truncate font-mono text-[13px] text-mute">backoffice · {app.business.name || '[NAMA BISNIS]'}</p>
      </div>
      <nav aria-label={t('Menu utama')} className="mt-7">
        <ul className="grid gap-1">
          {items.map((it) => (
            <li key={it.to}>
              <NavLink to={it.to} meta={it.meta}>
                {t(`${it.label}|menu`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-8 flex-1" />
      <div className="border-t-[1.5px] border-ink pt-3">
        <NavLink to="/settings">{t('Pengaturan')}</NavLink>
      </div>
    </div>
  );
}

function NavLink({ to, children, meta }: { to: NavItem['to'] | '/settings'; children: ReactNode; meta?: string | number }) {
  return (
    <Link
      to={to}
      preload="intent"
      preloadDelay={0}
      activeOptions={{ exact: to === '/', includeSearch: false }}
      className="group flex min-h-11 items-center gap-2.5 rounded border-[1.5px] border-transparent px-2.5 text-[16px] font-medium transition-[background-color,transform] duration-150 hover:translate-x-[3px] hover:bg-tint aria-[current=page]:translate-x-0 aria-[current=page]:border-ink aria-[current=page]:bg-slip"
    >
      <span aria-hidden className="hidden size-2.5 flex-none bg-fire group-aria-[current=page]:block" />
      <span className="flex-1 truncate">{children}</span>
      {meta !== undefined && <span className={cn('font-mono text-[13px] text-mute')}>{meta}</span>}
    </Link>
  );
}
