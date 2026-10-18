import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Empty state (DESIGN.md B Kosong): display title 40px, one sentence with the next step, at most one action. */
export function Empty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('slipc grid justify-items-start gap-3 py-10', className)}>
      <h2 className="text-[32px] md:text-[40px]">{title}</h2>
      {children && <p className="max-w-[40em] text-mute">{children}</p>}
      {action && <div className="mt-2 flex flex-wrap gap-3">{action}</div>}
    </div>
  );
}
