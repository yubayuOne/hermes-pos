import type { ReactNode } from 'react';

/** Charts of the Laporan (prompt 5): plain divs and one small SVG, no new library. Each has a text version for readers. */

const TONE: Record<string, string> = { pine: 'bg-pine', fire: 'bg-fire', pale: 'bg-pine/40', mute: 'bg-mute' };
/** Labels and values are shown on every bar when there are at most this many. */
export const FEW = 16;
/** Long periods are cut into blocks of this many weeks, so a table or a grid fits an A4 sheet. */
export const BLOCK = 13;
export const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export type Bar = { label: string; value: number; tone?: string };

/** Vertical bars. The highest bar is orange, partial periods are pale (tone 'pale'). */
export function ColumnBars({ bars, format, caption, height = 150 }: { bars: Bar[]; format: (v: number) => string; caption: string; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const top = bars.length && bars.some((b) => b.value > 0) ? bars.findIndex((b) => b.value === max) : -1;
  const few = bars.length <= FEW;
  const every = Math.ceil(bars.length / 10);
  return (
    <figure className="rp-keep">
      <div className="flex items-end gap-[3px] border-b-[1.5px] border-ink" style={{ height }} role="img" aria-label={caption}>
        {bars.map((b, i) => (
          <div key={`${b.label}-${i}`} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {few && <span className="mb-1 text-center font-mono text-[10px] leading-none">{format(b.value)}</span>}
            <div className={b.tone ?? (i === top ? 'bg-fire' : 'bg-pine')} style={{ height: `${(b.value / max) * (few ? 80 : 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden>
        {bars.map((b, i) => (
          <span key={`${b.label}-${i}`} className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-mute">
            {few || i % every === 0 ? b.label : ''}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{bars.map((b) => `${b.label} ${format(b.value)}`).join(', ')}</figcaption>
    </figure>
  );
}

/** Horizontal bars for a ranking: label, bar, value and an optional share. */
export function HBars({ rows, format, caption }: { rows: { label: string; value: number; share?: number }[]; format: (v: number) => string; caption: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="rp-keep" role="img" aria-label={caption}>
      <ul className="grid gap-1.5">
        {rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[12px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="font-mono">
              {format(r.value)}
              {r.share !== undefined && <span className="text-mute"> · {r.share.toFixed(1).replace('.', ',')}%</span>}
            </span>
            <span className="col-span-2 h-2.5 bg-rule">
              <span className={`block h-full ${i === 0 ? 'bg-fire' : 'bg-pine'}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{rows.map((r) => `${r.label} ${format(r.value)}`).join(', ')}</figcaption>
    </figure>
  );
}

/** Stacked bars per column: two parts (for example cash and QRIS bills). */
export function StackedBars({
  cols,
  aLabel,
  bLabel,
  caption,
}: {
  cols: { label: string; a: number; b: number }[];
  aLabel: string;
  bLabel: string;
  caption: string;
}) {
  const max = Math.max(1, ...cols.map((c) => c.a + c.b));
  return (
    <figure className="rp-keep">
      <div className="flex items-end gap-[3px] border-b-[1.5px] border-ink" style={{ height: 150 }} role="img" aria-label={caption}>
        {cols.map((c, i) => (
          <div key={`${c.label}-${i}`} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-col-reverse" style={{ height: `${((c.a + c.b) / max) * 100}%` }}>
              <div className="bg-pine" style={{ height: `${c.a + c.b ? (c.a / (c.a + c.b)) * 100 : 0}%` }} />
              <div className="bg-fire" style={{ height: `${c.a + c.b ? (c.b / (c.a + c.b)) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden>
        {cols.map((c, i) => (
          <span key={`${c.label}-${i}`} className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-mute">
            {cols.length <= FEW || i % Math.ceil(cols.length / 10) === 0 ? c.label : ''}
          </span>
        ))}
      </div>
      <figcaption className="mt-1 flex gap-4 text-[11px] text-mute">
        <span>
          <span className="mr-1 inline-block size-2.5 bg-pine align-middle" aria-hidden />
          {aLabel}
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 bg-fire align-middle" aria-hidden />
          {bLabel}
        </span>
      </figcaption>
      <span className="sr-only">{cols.map((c) => `${c.label} ${c.a} ${c.b}`).join(', ')}</span>
    </figure>
  );
}

/** Lines over the same labels (one line per series). Values are written on the points only when there are at most FEW. */
export function LineChart({
  labels,
  series,
  format,
  caption,
}: {
  labels: string[];
  series: { name: string; values: number[]; tone?: string }[];
  format: (v: number) => string;
  caption: string;
}): ReactNode {
  const W = 600;
  const H = 180;
  const P = 24;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (labels.length <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (labels.length - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const few = labels.length <= FEW;
  const every = Math.ceil(labels.length / 10);
  const stroke = (tone?: string) => (tone === 'fire' ? 'var(--color-fire)' : tone === 'mute' ? 'var(--color-mute)' : 'var(--color-pine)');
  return (
    <figure className="rp-keep">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={caption}>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="var(--color-ink)" strokeWidth={1.5} />
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline fill="none" stroke={stroke(s.tone)} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {few &&
              s.values.map((v, i) => (
                <text key={i} x={x(i)} y={y(v) - 6 - si * 10} textAnchor="middle" fontSize={11} fontFamily="monospace" fill={stroke(s.tone)}>
                  {format(v)}
                </text>
              ))}
          </g>
        ))}
        {labels.map((l, i) =>
          few || i % every === 0 ? (
            <text key={`${l}-${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="var(--color-mute)">
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-[11px] text-mute">
        {series.map((s) => (
          <span key={s.name}>
            <span className="mr-1 inline-block h-[3px] w-4 align-middle" style={{ background: stroke(s.tone) }} aria-hidden />
            {s.name}
          </span>
        ))}
      </figcaption>
      <span className="sr-only">
        {series.map((s) => `${s.name}: ${labels.map((l, i) => `${l} ${format(s.values[i] ?? 0)}`).join(', ')}`).join('. ')}
      </span>
    </figure>
  );
}

/** Grid for a period: rows are weekdays (Monday first), columns are weeks. null = outside the period (grey). */
export function Heatmap({
  rows,
  cols,
  cells,
  format,
  caption,
}: {
  rows: string[];
  cols: string[];
  cells: (number | null)[][];
  format: (v: number) => string;
  caption: string;
}) {
  const max = Math.max(1, ...cells.flat().map((v) => v ?? 0));
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="rp-tbl min-w-full text-center" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col" className="text-left" />
            {cols.map((c) => (
              <th key={c} scope="col" className="text-center font-mono text-[10px]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <th scope="row" className="text-left text-[11px] font-normal text-mute">
                {r}
              </th>
              {cells[ri].map((v, ci) => (
                <td key={ci} className="p-0.5">
                  <div
                    className={`rounded-[2px] py-1 font-mono text-[10px] ${v === null ? 'bg-rule text-mute' : 'bg-pine text-paper'}`}
                    style={v === null ? undefined : { opacity: 0.25 + 0.75 * (v / max) }}
                  >
                    {v === null ? '' : format(v)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const toneClass = (tone?: string) => (tone ? TONE[tone] : undefined);
