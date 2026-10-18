import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

export type ButtonVariant = 'fire' | 'ink' | 'plain' | 'ghost';

/** Class string for a button look, for links that should look like buttons. */
export function btn(variant: ButtonVariant = 'plain', opts: { sm?: boolean; block?: boolean } = {}) {
  return cn('btn', variant !== 'plain' && `btn-${variant}`, opts.sm && 'btn-sm', opts.block && 'btn-block');
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  sm?: boolean;
  block?: boolean;
  /** While true the button is disabled and shows busyLabel, so an action can never be sent twice. */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
};

export function Button({ variant = 'plain', sm, block, busy, busyLabel, className, disabled, type = 'button', children, ...rest }: Props) {
  return (
    <button type={type} className={cn(btn(variant, { sm, block }), className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
