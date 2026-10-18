import { useState } from 'react';
import { Button, Select, dateRange, useI18n } from '@hermes-pos/ui';
import type { PeriodSearch } from '../lib/period';
import { CustomRange } from './CustomRange';

const OPTIONS = [
  ['today', 'Hari ini'],
  ['month', 'Bulan ini'],
  ['last-month', 'Bulan lalu'],
  ['custom', 'Pilih tanggal'],
] as const;

/**
 * Hari ini, Bulan ini, Bulan lalu, Pilih tanggal as one dropdown (owner's request, 18 Oct 2026: fewer buttons in a row).
 * Pilih tanggal opens the date form under it; it closes once the dates are shown, and Ubah tanggal opens it again. `children` sits next to the dropdown (a note, or a link such as Laporan).
 */
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
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false);
  const current = editing ? 'custom' : (value.period ?? 'today');
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex w-full items-center gap-3 sm:w-auto">
          <span className="flex-none text-[15px] font-semibold">{t('Periode')}</span>
          <Select
            className="min-w-0 flex-1 sm:w-[220px]"
            value={current}
            onChange={(e) => {
              const v = e.target.value as (typeof OPTIONS)[number][0];
              setEditing(v === 'custom');
              if (v === 'custom') return;
              onChange({ period: v === 'today' ? undefined : v, from: undefined, to: undefined });
            }}
          >
            {OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {v === 'custom' && value.period === 'custom' ? dateRange(range.from, range.to, lang) : t(l)}
              </option>
            ))}
          </Select>
        </label>
        {value.period === 'custom' && !editing && (
          <Button sm onClick={() => setEditing(true)}>
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
  return p === 'today' ? t('hari ini') : p === 'month' ? t('bulan ini') : p === 'last-month' ? t('bulan lalu') : dateRange(range.from, range.to, lang);
}
