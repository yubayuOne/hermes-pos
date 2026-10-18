import { cn } from '../lib/utils';

/**
 * Bar chart (DESIGN.md B Grafik batang): pine bars, one orange bar (today or the peak), mono value above each
 * bar, axis labels below, helper lines every 44px, and a caption sentence.
 */
export function BarChart({
  values,
  labels,
  accent,
  valueLabel,
  caption,
  ariaLabel,
  height = 190,
}: {
  values: number[];
  labels: string[];
  accent: number;
  valueLabel: (v: number) => string;
  caption?: string;
  ariaLabel: string;
  height?: number;
}) {
  const max = Math.max(1, ...values);
  const room = height - 24;
  return (
    <figure className="grid gap-2">
      <div role="img" aria-label={ariaLabel} className="relative border-b-[1.5px] border-ink" style={{ height }}>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(to top, var(--color-tint-2) 1px, transparent 1px)', backgroundSize: '100% 44px' }}
        />
        <div className="relative flex h-full items-end gap-1 sm:gap-1.5">
          {values.map((v, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-stretch justify-end">
              <span className="mb-1 truncate text-center font-mono text-[13px] leading-none tabular-nums">{v > 0 ? valueLabel(v) : ''}</span>
              <span
                className={cn('block origin-bottom animate-grow', i === accent ? 'bg-fire' : 'bg-pine')}
                style={{ height: `${v > 0 ? Math.max(3, (v / max) * room) : 0}px`, animationDelay: `${i * 40}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="flex gap-1 sm:gap-1.5">
        {labels.map((l, i) => (
          <span key={i} className={cn('min-w-0 flex-1 truncate text-center font-mono text-[13px]', i === accent ? 'text-ink' : 'text-mute')}>
            {l}
          </span>
        ))}
      </div>
      {caption && <figcaption className="sr-only">{caption}</figcaption>}
    </figure>
  );
}

/** List row with a 6px bar (DESIGN.md B .lr + .lbar). */
export function ListBar({
  name,
  value,
  sub,
  ratio,
  top,
  rank,
  delay = 0,
}: {
  name: string;
  value: string;
  sub?: string;
  ratio: number;
  top?: boolean;
  rank?: number;
  delay?: number;
}) {
  return (
    <li className="grid gap-1 border-b border-rule py-3 last:border-b-0">
      <div className="flex items-baseline gap-3">
        {rank !== undefined && <span className="w-5 flex-none font-mono text-[13px] text-mute">{rank}</span>}
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className="num font-semibold">{value}</span>
      </div>
      {sub && <span className={cn('text-[13px] text-mute', rank !== undefined && 'pl-8')}>{sub}</span>}
      <div className={cn('lbar mt-1', top && 'top', rank !== undefined && 'ml-8')}>
        <span style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, animationDelay: `${delay}ms` }} />
      </div>
    </li>
  );
}
