import { useState, type ReactNode } from 'react';
import { Button, Dialog, Field, Input, Select, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';

/**
 * One toolbar for every list page (owner's request, 25 Oct 2026): the search box, the outlet (always visible), one Filter
 * button whose dialog holds the other filters (each change applies at once), and the page's main action. Under it one
 * muted line says what is filtered, so nothing is hidden. `active` counts the dialog filters that differ from the default.
 * A page without a dialog filter leaves `children` out, and then no Filter button is shown.
 */
export function FilterBar({
  search,
  outlet,
  active = 0,
  summary,
  onReset,
  action,
  children,
}: {
  search?: ReactNode;
  outlet?: ReactNode;
  active?: number;
  summary?: string;
  onReset?: () => void;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {search && <div className="min-w-[180px] flex-1 md:max-w-[360px]">{search}</div>}
        {outlet}
        {children && (
          <Button onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex-none">
            {t('Filter')}
            {active > 0 && (
              <span
                className="ml-2 grid size-6 place-items-center rounded-full bg-ink font-mono text-small text-paper"
                aria-label={t('{n} aktif', { n: active })}
              >
                {active}
              </span>
            )}
          </Button>
        )}
        {action && <div className="w-full sm:ml-auto sm:w-auto">{action}</div>}
      </div>
      {summary && (
        <p className="text-small text-mute" role="status">
          {summary}
        </p>
      )}
      {children && (
        <Dialog
          open={open}
          wide
          onOpenChange={setOpen}
          title={t('Filter')}
          footer={
            <>
              <Button onClick={onReset} disabled={active === 0 || !onReset}>
                {t('Atur ulang')}
              </Button>
              <Button variant="fire" onClick={() => setOpen(false)}>
                {t('Selesai')}
              </Button>
            </>
          }
        >
          {children}
        </Dialog>
      )}
    </div>
  );
}

/** Outlet choice in a form (such as recording an expense). Filters use OutletFilter, which stays on the toolbar. */
export function OutletField({ value, onChange, all }: { value: string | null; onChange: (id: string | null) => void; all: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  return (
    <Field label="Outlet">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {all && <option value="">{t('Semua outlet')}</option>}
        {app.outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Search box for FilterBar: named by aria-label, the placeholder says what it searches. */
export function SearchBox({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        maxLength={40}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSubmit}
      />
    </form>
  );
}
