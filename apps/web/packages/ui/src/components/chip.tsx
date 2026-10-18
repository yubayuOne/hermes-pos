import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Chip (DESIGN.md B): 44px, selected = pine with aria-pressed. */
export function Chip({
  pressed,
  dashed,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean; dashed?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed ?? undefined} className={cn('chip', dashed && 'chip-dash', className)} {...rest}>
      {children}
    </button>
  );
}

/** A row of mutually exclusive chips. */
export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => (
        <Chip key={o.value} pressed={o.value === value} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
