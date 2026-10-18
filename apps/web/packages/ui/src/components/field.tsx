import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Dialog as D, Popover as P } from 'radix-ui';
import { useI18n } from '../i18n';
import { cn } from '../lib/utils';
import { CloseIcon } from './icons';

/**
 * Field (DESIGN.md B .fld): visible label, optional "(opsional)", help under the input, error with role="alert".
 * The child input receives id, aria-invalid, and aria-describedby. When the input sits inside a wrapper
 * (an input with a button next to it), pass a function child and spread the props onto the input.
 */
type ControlProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };
export function Field({
  label,
  optional,
  help,
  error,
  children,
  className,
}: {
  label: ReactNode;
  optional?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: ReactElement<Record<string, unknown>> | ((p: ControlProps) => ReactNode);
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
  const props: ControlProps = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy };
  const control = typeof children === 'function' ? children(props) : isValidElement(children) ? cloneElement(children, props) : children;
  return (
    <div className={cn('fld', className)}>
      <label htmlFor={id} className="fld-l">
        {label}
        {optional && <span className="opt"> {t('(opsional)')}</span>}
      </label>
      {control}
      {error && (
        <p id={errId} role="alert" className="ferr">
          {error}
        </p>
      )}
      {help && (
        <p id={helpId} className="help">
          {help}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('in', className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('in', className)} {...rest} />;
}
type Opt = { value: string; label: string };
/** Up to this many options: a dropdown under the field. More: a popup list, with a search box from SEARCH_FROM up. */
const FEW = 6;
const SEARCH_FROM = 9;

const textOf = (n: ReactNode): string =>
  Children.toArray(n)
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : ''))
    .join('');

function optionsOf(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (c) => {
    if (isValidElement<{ value?: unknown; children?: ReactNode }>(c) && c.type === 'option') {
      out.push({ value: String(c.props.value ?? ''), label: textOf(c.props.children) });
    }
  });
  return out;
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
};

/**
 * Same API as a native <select> with <option> children, drawn in the design instead of the phone's own picker
 * (owner's request, 18 Oct 2026): a dropdown under the field for a few options, a popup list for many. The trigger is
 * a combobox named by its Field label; onChange receives an event-like object, callers read e.target.value.
 */
export function Select({
  className,
  children,
  value = '',
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: SelectProps) {
  const { t } = useI18n();
  const autoId = useId();
  const tid = id ?? autoId;
  const listId = `${tid}-list`;
  const opts = optionsOf(children);
  const few = opts.length <= FEW;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const current = opts.find((o) => o.value === String(value));
  const shown = query.trim() ? opts.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : opts;

  const toggle = (next: boolean) => {
    if (next) setTitle(ariaLabel ?? (document.getElementById(tid) as HTMLButtonElement | null)?.labels?.[0]?.textContent ?? t('Pilih'));
    else setQuery('');
    setOpen(next);
  };
  const pick = (v: string) => {
    toggle(false);
    if (v !== String(value)) onChange?.({ target: { value: v }, currentTarget: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>);
  };
  // Opening puts the focus on the chosen option, so arrows start from there.
  const focusChosen = (e: Event) => {
    e.preventDefault();
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus());
  };

  const trigger = (
    <button
      id={tid}
      type="button"
      role="combobox"
      disabled={disabled}
      aria-haspopup={few ? 'listbox' : 'dialog'}
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      className={cn('in in-sel flex items-center text-left', className)}
    >
      <span className={cn('min-w-0 flex-1 truncate', !current && 'text-mute')}>{current?.label ?? t('Pilih')}</span>
    </button>
  );
  const options = <OptionList ref={list} id={listId} opts={shown} value={String(value)} label={title} onPick={pick} />;

  if (few) {
    return (
      <P.Root open={open} onOpenChange={toggle}>
        <P.Trigger asChild>{trigger}</P.Trigger>
        <P.Portal>
          <P.Content
            align="start"
            sideOffset={4}
            collisionPadding={12}
            onOpenAutoFocus={focusChosen}
            className="z-[70] max-h-[min(320px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] min-w-[180px] overflow-y-auto rounded border-[1.5px] border-ink bg-slip p-1 shadow-[var(--shadow-hard-3)]"
          >
            {options}
          </P.Content>
        </P.Portal>
      </P.Root>
    );
  }
  return (
    <D.Root open={open} onOpenChange={toggle}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className="dlg-back z-[60]" />
        <D.Content
          className="dlg z-[61] flex flex-col overflow-hidden"
          aria-describedby={undefined}
          onOpenAutoFocus={opts.length >= SEARCH_FROM ? undefined : focusChosen}
        >
          <div className="flex items-start justify-between gap-4">
            <D.Title className="dlg-t">{title}</D.Title>
            <D.Close className="-mr-2 -mt-2 inline-grid size-11 flex-none place-items-center rounded hover:bg-tint" aria-label={t('Tutup')}>
              <CloseIcon />
            </D.Close>
          </div>
          {opts.length >= SEARCH_FROM && (
            <input
              type="search"
              className="in mt-4"
              placeholder={t('Cari')}
              aria-label={t('Cari')}
              aria-controls={listId}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="-mx-1 mt-3 min-h-0 flex-1 overflow-y-auto px-1">{options}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Options as a listbox: arrows, Home and End move, Enter or Space picks, Esc closes (Radix). */
function OptionList({
  ref,
  id,
  opts,
  value,
  label,
  onPick,
}: {
  ref: RefObject<HTMLDivElement | null>;
  id: string;
  opts: Opt[];
  value: string;
  label: string;
  onPick: (v: string) => void;
}) {
  const { t } = useI18n();
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null || !items.length) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  };
  if (!opts.length) return <p className="px-3 py-2 text-mute">{t('Tidak ada yang cocok.')}</p>;
  return (
    <div ref={ref} id={id} role="listbox" aria-label={label} onKeyDown={move} className="grid gap-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          onClick={() => onPick(o.value)}
          className="flex min-h-11 w-full items-center gap-2.5 rounded px-3 text-left text-[16px] outline-offset-[-2px] hover:bg-tint-2 focus-visible:bg-tint-2 aria-selected:font-semibold"
        >
          {/* Same marker as the active page in the sidebar (DESIGN.md D1). */}
          <span aria-hidden className={cn('size-2.5 flex-none', o.value === value ? 'bg-fire' : 'bg-transparent')} />
          <span className="min-w-0 break-words">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Form-level error box above the buttons (DESIGN.md B dialog error). */
export function FormAlert({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="alert-box">
      {children}
    </div>
  );
}

/** Checkbox with its label. */
export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('check', className)}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
