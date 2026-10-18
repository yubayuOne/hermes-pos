import { cn } from '../lib/utils';

/** Brand name in one place (PRD X5). Set by the owner on 15 Oct 2026. */
export const BRAND = 'Hermes POS';
export const BRAND_UPPER = 'HERMES POS';
/** Emblem from the owner (Hermes on orange). Each app serves it from public/brand. */
export const BRAND_MARK = '/brand/hermes-pos-mark.webp';

/** Wordmark: the emblem plus the name in Bricolage 800 (DESIGN.md A6). The name stays text, so it reads and translates. */
/** `labelClassName` styles the name only, for example to keep just the mark on a very narrow header. */
export function Wordmark({ size = 26, className, labelClassName }: { size?: number; className?: string; labelClassName?: string }) {
  const mark = Math.round(size * 1.4);
  return (
    <span
      className={cn('inline-flex items-center gap-[0.35em] font-display font-extrabold leading-none tracking-[-0.04em]', className)}
      style={{ fontSize: size }}
    >
      <img
        src={BRAND_MARK}
        alt=""
        width={mark}
        height={mark}
        className="shrink-0 rounded-[6px] border-[1.5px] border-ink"
        style={{ width: mark, height: mark }}
      />
      <span className={labelClassName}>{BRAND}</span>
    </span>
  );
}
