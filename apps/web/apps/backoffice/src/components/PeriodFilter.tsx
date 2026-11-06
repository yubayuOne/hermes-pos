import { Field, Input, Select, dateRange, useI18n } from '@hermes-pos/ui';
import type { Period, PeriodSearch } from '../lib/period';

const OPTIONS: ReadonlyArray<readonly [Period, string]> = [
  ['today', 'Hari ini'],
  ['month', 'Bulan ini'],
  ['last-month', 'Bulan lalu'],
  ['custom', 'Pilih tanggal'],
];

/**
 * Hari ini, Bulan ini, Bulan lalu, Pilih tanggal as one dropdown. Used inside a FilterBar dialog (prompt 3): `value` is the
 * draft and `onChange` stages a change. Pilih tanggal shows Dari and Sampai right here, filled from the period on screen.
 * The dialog's Selesai checks and applies the dates. `children` sits next to the dropdown.
 */
export function PeriodFilter({
  value,
  range,
  today,
  onChange,
  allTime,
  children,
}: {
  value: PeriodSearch;
  range: { from: string; to: string };
  today: string;
  onChange: (patch: PeriodSearch) => void;
  /** Adds "Semua waktu" first (customers list): the whole history. */
  allTime?: boolean;
  children?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const options = allTime ? [['all', 'Semua waktu'] as const, ...OPTIONS] : OPTIONS;
  const current = value.period ?? 'today';
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label={t('Periode')} className="w-full sm:w-[240px]">
          <Select
            value={current}
            onChange={(e) => {
              const v = e.target.value as Period;
              // Pilih tanggal starts from the period on screen; the dates are checked at Selesai.
              if (v === 'custom') return onChange({ period: 'custom', from: value.from ?? range.from, to: value.to ?? range.to });
              onChange({ period: v, from: undefined, to: undefined });
            }}
          >
            {options.map(([v, l]) => (
              <option key={v} value={v}>
                {v === 'custom' && value.period === 'custom' ? dateRange(range.from, range.to, lang) : t(l)}
              </option>
            ))}
          </Select>
        </Field>
        {children}
      </div>
      {current === 'custom' && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('Dari')}>
            <Input type="date" max={today} value={value.from ?? range.from} onChange={(e) => e.target.value && onChange({ from: e.target.value })} />
          </Field>
          <Field label={t('Sampai')}>
            <Input type="date" max={today} value={value.to ?? range.to} onChange={(e) => e.target.value && onChange({ to: e.target.value })} />
          </Field>
        </div>
      )}
    </>
  );
}

/** "hari ini", "bulan ini", "bulan lalu", or the dates. */
export function usePeriodLabel(value: PeriodSearch, range: { from: string; to: string }) {
  const { t, lang } = useI18n();
  const p = value.period ?? 'today';
  return p === 'all' ? t('semua waktu') : p === 'today' ? t('hari ini') : p === 'month' ? t('bulan ini') : p === 'last-month' ? t('bulan lalu') : dateRange(range.from, range.to, lang);
}
