import { useI18n, type Lang } from '../i18n';
import { cn } from '../lib/utils';

/** ID | EN toggle in every header (DESIGN.md A8). */
export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const opts: Lang[] = ['id', 'en'];
  return (
    <div
      role="group"
      aria-label={t('Bahasa')}
      className={cn('inline-flex h-11 flex-none overflow-hidden rounded border-[1.5px] border-ink bg-slip', className)}
    >
      {opts.map((l, i) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={cn(
            'min-w-11 px-3 font-mono text-[13px] font-semibold uppercase',
            i > 0 && 'border-l-[1.5px] border-ink',
            lang === l ? 'bg-pine text-paper' : 'hover:bg-tint-2',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
