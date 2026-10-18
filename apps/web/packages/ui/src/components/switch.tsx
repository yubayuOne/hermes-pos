import { cn } from '../lib/utils';

/** Switch (DESIGN.md B .sw): 56x32, role="switch", 44px hit area. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('sw-hit', className)}
    >
      <span className="sw" aria-hidden />
    </button>
  );
}
