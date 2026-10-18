import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export function Tag({ tone = 'plain', className, children }: { tone?: 'plain' | 'fire' | 'pine' | 'mute'; className?: string; children: ReactNode }) {
  return <span className={cn('tag', tone !== 'plain' && `tag-${tone}`, className)}>{children}</span>;
}
