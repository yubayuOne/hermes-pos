import type { ReactNode } from 'react';

/** One figure under its label inside a <dl> (Ringkasan, Pengeluaran, Outlet, Langganan). Long amounts wrap, never cut off. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-small text-mute">{label}</dt>
      <dd className="mt-1 break-words font-mono text-heading font-medium tabular-nums">{value}</dd>
    </div>
  );
}
