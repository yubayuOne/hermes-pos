import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * An icon-only row action (edit, delete). The name it acts on is the accessible label and the tooltip. 44px target;
 * delete is in the error colour, edit in ink.
 */
export function IconAction({
  label,
  tone = 'ink',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'ink' | 'error'; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid size-11 flex-none place-items-center rounded border-[1.5px] bg-paper hover:bg-tint disabled:opacity-50 ${tone === 'error' ? 'border-error-line text-error' : 'border-ink text-ink'}`}
      {...rest}
    >
      {children}
    </button>
  );
}
