import { useState, type ReactNode } from 'react';
import { Button, Dialog, Field, Input, Select, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';

/**
 * One toolbar for list pages (owner's request, 18 Oct 2026: too many filters in a row): a search box, a Filter button
 * whose dialog holds every other filter (each change applies at once), and the page's main action. Under it one muted
 * line says what is filtered, so nothing is hidden. `active` counts filters that differ from the default.
 */
export function FilterBar({
  search,
  active,
  summary,
  onReset,
  action,
  children,
}: {
  search: ReactNode;
  active: number;
  summary: string;
  onReset: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1 md:max-w-[360px]">{search}</div>
        <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
          {t('Filter')}
          {active > 0 && (
            <span
              className="ml-2 grid size-6 place-items-center rounded-full bg-ink font-mono text-[13px] text-paper"
              aria-label={t('{n} aktif', { n: active })}
            >
              {active}
            </span>
          )}
        </Button>
        {action && <div className="w-full sm:ml-auto sm:w-auto">{action}</div>}
      </div>
      <p className="text-[14px] text-mute" role="status">
        {summary}
      </p>
      <Dialog
        open={open}
        wide
        onOpenChange={setOpen}
        title={t('Filter')}
        footer={
          <>
            <Button onClick={onReset} disabled={active === 0}>
              {t('Atur ulang')}
            </Button>
            <Button variant="ink" onClick={() => setOpen(false)}>
              {t('Selesai')}
            </Button>
          </>
        }
      >
        {children}
      </Dialog>
    </div>
  );
}

/** Outlet choice inside the Filter dialog. `all` adds "Semua outlet" (value null). */
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
