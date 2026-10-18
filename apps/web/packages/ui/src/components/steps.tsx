import { cn } from '../lib/utils';

export type StepState = 'now' | 'done' | 'todo';

/** Step marker box (DESIGN.md B): now = fire, done = pine with a check, todo = slip. */
export function StepNum({ n, state }: { n: number; state: StepState }) {
  return (
    <span className="step-n" data-s={state} aria-hidden>
      {state === 'done' ? '✓' : n}
    </span>
  );
}

/** Horizontal steps (Checkout). On phones only the numbers show. */
export function StepsBar({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol
      aria-label={label}
      className="grid overflow-hidden rounded border-[1.5px] border-ink bg-slip"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const state: StepState = i < current ? 'done' : i === current ? 'now' : 'todo';
        return (
          <li
            key={s}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex items-center justify-center gap-3 border-b-4 px-2 py-2.5 sm:justify-start sm:px-3',
              i > 0 && 'border-l-[1.5px] border-l-ink',
              i === current ? 'border-b-fire' : 'border-b-transparent',
            )}
          >
            <StepNum n={i + 1} state={state} />
            <span className={cn('hidden truncate font-semibold sm:inline', state === 'todo' && 'text-mute')}>{s}</span>
            <span className="sr-only sm:hidden">{s}</span>
          </li>
        );
      })}
    </ol>
  );
}
