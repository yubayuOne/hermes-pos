import { useState } from 'react';
import { Chip, dateRange, useI18n } from '@hermes-pos/ui';
import type { PeriodSearch } from '../lib/period';
import { CustomRange } from './CustomRange';

const PRESETS = [
  ['today', 'Hari ini'],
  ['month', 'Bulan ini'],
  ['last-month', 'Bulan lalu'],
] as const;

/** Hari ini, Bulan ini, Bulan lalu, Pilih tanggal. `children` sits at the end of the chip row. */
export function PeriodFilter({
  value,
  range,
  today,
  onChange,
  children,
}: {
  value: PeriodSearch;
  range: { from: string; to: string };
  today: string;
  onChange: (patch: PeriodSearch) => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(value.period === 'custom');
  return (
    <>
      {/* Phone: the four chips as an even 2 × 2 grid; from sm up one wrapping row. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label={t('Periode')}>
        {PRESETS.map(([v, l]) => (
          <Chip
            key={v}
            className="justify-center"
            pressed={(value.period ?? 'today') === v && !custom}
            onClick={() => {
              setCustom(false);
              onChange({ period: v === 'today' ? undefined : v, from: undefined, to: undefined });
            }}
          >
            {t(l)}
          </Chip>
        ))}
        <Chip className="justify-center" pressed={custom} onClick={() => setCustom(true)} aria-expanded={custom}>
          {t('Pilih tanggal')}
        </Chip>
        {/* Below sm the extras take a full row of their own; from sm they flow on with the chips. */}
        {children && <div className="col-span-2 flex flex-wrap items-center gap-2 sm:contents">{children}</div>}
      </div>
      {custom && (
        <CustomRange today={today} initial={value.period === 'custom' ? range : undefined} onApply={(from, to) => onChange({ period: 'custom', from, to })} />
      )}
    </>
  );
}

/** "hari ini", "bulan ini", "bulan lalu", or the dates. */
export function usePeriodLabel(value: PeriodSearch, range: { from: string; to: string }) {
  const { t, lang } = useI18n();
  const p = value.period ?? 'today';
  return p === 'today' ? t('hari ini') : p === 'month' ? t('bulan ini') : p === 'last-month' ? t('bulan lalu') : dateRange(range.from, range.to, lang);
}
