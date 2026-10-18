import { cn, useI18n } from '@hermes-pos/ui';

/** Strength 0 to 4 from the two visible rules plus length (DESIGN.md E1). Any characters count (owner's choice, 18 Oct 2026). */
export function passwordRules(pw: string, email: string) {
  const rules = [
    { label: 'Minimal 6 karakter', ok: pw.length >= 6 },
    { label: 'Berbeda dari email Anda', ok: pw.length > 0 && pw.toLowerCase() !== email.trim().toLowerCase() },
  ];
  const passed = rules.filter((r) => r.ok).length;
  const score = !pw ? 0 : passed < rules.length ? 1 : pw.length >= 14 && /[^a-zA-Z0-9]/.test(pw) ? 4 : pw.length >= 11 ? 3 : 2;
  return { rules, score };
}
const LEVELS = ['', 'Lemah', 'Cukup', 'Baik', 'Kuat'];

export function StrengthMeter({ pw, email }: { pw: string; email: string }) {
  const { t } = useI18n();
  const { rules, score } = passwordRules(pw, email);
  return (
    <div className="grid gap-2">
      {pw && (
        <div className="flex items-center gap-3">
          <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={cn('h-1.5 border border-ink', i <= score ? (score >= 3 ? 'bg-pine' : 'bg-fire') : 'bg-tint-2')} />
            ))}
          </div>
          <span className="w-14 font-mono text-[13px]" aria-live="polite">
            {t(LEVELS[score])}
          </span>
        </div>
      )}
      <ul className="grid gap-1 text-[13px] text-mute">
        {rules.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'grid size-4 place-items-center border-[1.5px] text-[11px] leading-none',
                r.ok ? 'border-pine bg-pine text-paper' : 'border-ink bg-slip',
              )}
            >
              {r.ok ? '✓' : ''}
            </span>
            <span className={r.ok ? 'text-pine' : ''}>{t(r.label)}</span>
            <span className="sr-only">{r.ok ? t('terpenuhi') : t('belum')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
