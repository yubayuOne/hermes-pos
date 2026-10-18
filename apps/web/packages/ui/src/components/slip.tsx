import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Card (DESIGN.md B .slipc). */
export function Card({
  className,
  children,
  as: As = 'section',
  ...rest
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <As className={cn('slipc', className)} {...rest}>
      {children}
    </As>
  );
}
export function CardTitle({ children, sub, id, className }: { children: ReactNode; sub?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={className}>
      <h2 id={id} className="card-t">
        {children}
      </h2>
      {sub && <p className="mt-1.5 text-[14px] text-mute">{sub}</p>}
    </div>
  );
}

/** Receipt (DESIGN.md B .slip/.torn): mono, dashed rows, optional torn bottom edge. */
export function Receipt({ torn, ink, className, children, label }: { torn?: boolean; ink?: boolean; className?: string; children: ReactNode; label?: string }) {
  return (
    <div className={cn('slip', ink && 'slip-ink', torn && 'torn', className)} role={label ? 'figure' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
export function RRow({ l, r, className }: { l: ReactNode; r?: ReactNode; className?: string }) {
  return (
    <div className={cn('row', className)}>
      <span>{l}</span>
      {r !== undefined && <span>{r}</span>}
    </div>
  );
}
export function RTotal({ l, r }: { l: ReactNode; r: ReactNode }) {
  return (
    <div className="total">
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}
export function RCut() {
  return <hr className="cut" />;
}
