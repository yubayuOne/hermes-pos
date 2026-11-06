import { useState, type ReactNode } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Select, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';
import { changedOnly } from '../lib/period';

/** What a filter dialog shows (`values`: the current filters with the draft on top) and how it stages a change. */
export type FilterDraft<T> = { values: T; set: (patch: Partial<T>) => void };

/**
 * One toolbar for every list page (owner's request, 25 Oct 2026): the search box, the outlet (always visible), one Filter
 * button whose dialog holds the other filters, and the page's main action. Under it one muted line says what is filtered,
 * so nothing is hidden. `active` counts the dialog filters that differ from the default.
 * Prompt 3: the dialog works on a draft. Changes stay in the draft until Selesai; Selesai checks it with `validate` (a
 * message keeps the dialog open) and applies only the fields that differ from `current`. Closing the dialog drops the draft.
 * `children` is a function of the draft; a page without a dialog filter leaves it out, and then no Filter button is shown.
 */
export function FilterBar<T extends object>({
  search,
  outlet,
  active = 0,
  summary,
  action,
  current,
  validate,
  onApply,
  children,
}: {
  search?: ReactNode;
  outlet?: ReactNode;
  active?: number;
  summary?: string;
  action?: ReactNode;
  current?: Partial<T>;
  validate?: (values: T) => string | null;
  onApply?: (changed: Partial<T>) => void;
  children?: ReactNode | ((draft: FilterDraft<T>) => ReactNode);
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<T>>({});
  const [error, setError] = useState<string | null>(null);
  const values = { ...current, ...draft } as T;
  const stage = (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch }));
  function close() {
    setOpen(false);
    setDraft({});
    setError(null);
  }
  function done() {
    const message = validate?.(values) ?? null;
    if (message) return setError(message);
    const changed = changedOnly(draft, current);
    if (Object.keys(changed).length > 0) onApply?.(changed);
    close();
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {search && <div className="w-full md:w-auto md:min-w-[180px] md:max-w-[360px] md:flex-1">{search}</div>}
        {outlet}
        {children && (
          <Button
            onClick={() => {
              setDraft({});
              setError(null);
              setOpen(true);
            }}
            aria-haspopup="dialog"
            className="flex-none"
          >
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
          onOpenChange={(o) => (o ? setOpen(true) : close())}
          title={t('Filter')}
          footer={
            <Button variant="fire" onClick={done}>
              {t('Selesai')}
            </Button>
          }
        >
          {typeof children === 'function' ? children({ values, set: stage }) : children}
          <FormAlert>{error && t(error)}</FormAlert>
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
