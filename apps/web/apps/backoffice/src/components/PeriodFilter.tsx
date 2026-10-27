import { useState } from 'react';
import { Button, Field, Select, dateRange, useI18n } from '@hermes-pos/ui';
import type { Period, PeriodSearch } from '../lib/period';
import { CustomRange } from './CustomRange';

const OPTIONS: ReadonlyArray<readonly [Period, string]> = [
  ['today', 'Hari ini'],
  ['month', 'Bulan ini'],
  ['last-month', 'Bulan lalu'],
  ['custom', 'Pilih tanggal'],
];

/**
 * Hari ini, Bulan ini, Bulan lalu, Pilih tanggal as one dropdown (owner's request, 18 Oct 2026: fewer buttons in a row).
 * Pilih tanggal opens the date form under it; it closes once the dates are shown, and Ubah tanggal opens it again. `children` sits next to the dropdown (a note, or a link such as Laporan).
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
  const [editing, setEditing] = useState(false);
  const options = allTime ? [['all', 'Semua waktu'] as const, ...OPTIONS] : OPTIONS;
  const current = editing ? 'custom' : (value.period ?? 'today');
  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Field label={t('Periode')} className="w-full sm:w-[240px]">
          <Select
            value={current}
            onChange={(e) => {
              const v = e.target.value as Period;
              setEditing(v === 'custom');
              if (v === 'custom') return;
              // 'today' goes out too: the lists that do not know it drop it, so they still show today.
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
        {value.period === 'custom' && !editing && (
          <Button sm className="mb-1" onClick={() => setEditing(true)}>
            {t('Ubah tanggal')}
          </Button>
        )}
        {children}
      </div>
      {editing && (
        <CustomRange
          today={today}
          initial={value.period === 'custom' ? range : undefined}
          onApply={(from, to) => {
            setEditing(false);
            onChange({ period: 'custom', from, to });
          }}
        />
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
