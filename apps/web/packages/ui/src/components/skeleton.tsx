import type { CSSProperties, ReactNode } from 'react';
import { useI18n } from '../i18n';
import { cn } from '../lib/utils';

export function Sk({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn('sk block', className)} style={style} />;
}

/** Skeleton shaped like the card it replaces: title, big number, three small numbers, bars. */
export function SkCard({ bars, className }: { bars?: boolean; className?: string }) {
  return (
    <div className={cn('slipc grid gap-4', className)} aria-hidden>
      <Sk className="h-4 w-40" />
      <Sk className="h-14 w-3/4" />
      <div className="grid grid-cols-3 gap-4">
        <Sk className="h-8" />
        <Sk className="h-8" />
        <Sk className="h-8" />
      </div>
      {bars && (
        <div className="flex h-32 items-end gap-2">
          {[60, 45, 70, 50, 80, 95, 65].map((h, i) => (
            <Sk key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Loading({ children, className }: { children?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" className={className}>
      <span className="sr-only">{t('Memuat data...')}</span>
      {children}
    </div>
  );
}
