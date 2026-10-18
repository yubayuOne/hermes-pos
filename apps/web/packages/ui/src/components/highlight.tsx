import type { ReactNode } from 'react';

/** Orange marker (DESIGN.md B .hl). One per screen. */
export function Hl({ children }: { children: ReactNode }) {
  return <span className="hl">{children}</span>;
}
