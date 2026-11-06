import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * An icon-only row action (edit, delete): a solid square with the name it acts on as its label and tooltip. 44px target;
 * delete is solid error red, edit solid pine.
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
      className={`inline-grid size-11 flex-none cursor-pointer place-items-center rounded border-[1.5px] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${tone === 'error' ? 'border-error bg-error' : 'border-pine bg-pine'}`}
      {...rest}
    >
      {children}
    </button>
  );
}
