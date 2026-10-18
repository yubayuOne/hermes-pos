import { create } from 'zustand';
import { useI18n } from '../i18n';
import { cn } from '../lib/utils';
import { CloseIcon } from './icons';

/**
 * Toast (DESIGN.md B): floats at the bottom of the screen, role="status", always has Close; reversible
 * actions also get Undo, which restores the previous state. Success = pine-soft, error = fire-soft.
 */
type Toast = { id: number; tone: 'ok' | 'err'; text: string; undo?: () => void | Promise<void> };
type Store = { items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void };

let seq = 0;
export const useToasts = create<Store>((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.undo ? 9000 : 6000);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (text: string, undo?: Toast['undo']) => useToasts.getState().push({ tone: 'ok', text, undo }),
  error: (text: string) => useToasts.getState().push({ tone: 'err', text }),
};

export function ToastHost({ className }: { className?: string }) {
  const { items, dismiss } = useToasts();
  const { t } = useI18n();
  return (
    // Floating (owner's request, 18 Oct 2026): bottom centre on phones, bottom right from sm up, never moves the page.
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-[80] grid justify-items-center gap-2 empty:hidden sm:left-auto sm:right-6 sm:justify-items-end',
        className,
      )}
    >
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-[360px] items-center gap-2 rounded border-[1.5px] border-ink py-1 pl-3 pr-1 text-[14px] shadow-[var(--shadow-hard-3)] animate-pop',
            it.tone === 'ok' ? 'bg-pine-soft' : 'bg-fire-soft',
          )}
        >
          <span className="min-w-0 flex-1 py-1.5 font-semibold">{it.text}</span>
          {it.undo && (
            <button
              type="button"
              className="lnk flex-none px-2"
              onClick={async () => {
                dismiss(it.id);
                await it.undo?.();
              }}
            >
              {t('Batalkan')}
            </button>
          )}
          <button
            type="button"
            className="grid size-9 flex-none place-items-center rounded hover:bg-tint"
            aria-label={t('Tutup')}
            onClick={() => dismiss(it.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
