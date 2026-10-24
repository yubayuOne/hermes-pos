import { useState } from 'react';
import { Button, Field, Input, addDays, dayDiff, useI18n } from '@hermes-pos/ui';

/** Date range form for Ringkasan and Laporan: both dates required, not after today, at most 366 days. */
export function CustomRange({
  today,
  initial,
  onApply,
}: {
  today: string;
  initial?: { from: string; to: string };
  onApply: (from: string, to: string) => void;
}) {
  const { t } = useI18n();
  const [from, setFrom] = useState(initial?.from ?? addDays(today, -6));
  const [to, setTo] = useState(initial?.to ?? today);
  const [error, setError] = useState<{ field: 'from' | 'to'; text: string } | null>(null);
  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!from) return setError({ field: 'from', text: 'Pilih tanggal mulai.' });
    if (!to) return setError({ field: 'to', text: 'Pilih tanggal akhir.' });
    if (to > today) return setError({ field: 'to', text: 'Tanggal akhir tidak boleh setelah hari ini.' });
    if (to < from) return setError({ field: 'to', text: 'Tanggal akhir tidak boleh sebelum tanggal mulai.' });
    if (dayDiff(from, to) + 1 > 366) return setError({ field: 'to', text: 'Rentang maksimal 366 hari.' });
    setError(null);
    onApply(from, to);
  }
  return (
    <form method="post" noValidate onSubmit={apply} className="mt-4 flex flex-wrap items-start gap-4 rounded border-[1.5px] border-ink bg-slip p-4">
      <Field label={t('Dari')} error={error?.field === 'from' ? t(error.text) : null} className="min-w-[160px] flex-1 sm:flex-none">
        <Input
          type="date"
          max={today}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <Field label={t('Sampai')} error={error?.field === 'to' ? t(error.text) : null} className="min-w-[160px] flex-1 sm:flex-none">
        <Input
          type="date"
          max={today}
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <Button type="submit" variant="fire" className="mt-[26px]">
        {t('Tampilkan')}
      </Button>
    </form>
  );
}
