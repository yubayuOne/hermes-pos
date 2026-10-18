import { create } from 'zustand';
import { useI18n } from '../i18n';
import { cn } from '../lib/utils';

/**
 * Toast (DESIGN.md B): shown right under the content header, role="status", always has Close; reversible
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
    <div role="status" aria-live="polite" className={cn('grid gap-2 empty:hidden', className)}>
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded border-[1.5px] border-ink py-1 pl-4 pr-2 animate-pop',
            it.tone === 'ok' ? 'bg-pine-soft' : 'bg-fire-soft',
          )}
        >
          <span className="py-2 font-semibold">{it.text}</span>
          <span className="flex gap-2">
            {it.undo && (
              <button
                type="button"
                className="lnk px-2"
                onClick={async () => {
                  dismiss(it.id);
                  await it.undo?.();
                }}
              >
                {t('Batalkan')}
              </button>
            )}
            <button type="button" className="lnk px-2" onClick={() => dismiss(it.id)}>
              {t('Tutup')}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
