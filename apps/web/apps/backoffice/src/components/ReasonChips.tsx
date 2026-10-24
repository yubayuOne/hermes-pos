import { useI18n } from '@hermes-pos/ui';

/** One tap fills the reason with a common cause; the text box stays for anything else. */
export function ReasonChips({ options, onPick }: { options: string[]; onPick: (reason: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('Pilihan alasan')}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(t(o))}
          className="min-h-11 rounded-full border border-rule px-4 text-body hover:bg-tint"
        >
          {t(o)}
        </button>
      ))}
    </div>
  );
}
