import { Select, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';

/** Outlet filter in the content header; full width on phones (D12). */
export function OutletFilter({ value, onChange, all = true }: { value: string | null; onChange: (id: string | null) => void; all?: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  return (
    <label className="flex w-full items-center gap-3 md:w-auto">
      <span className="flex-none text-body font-semibold">Outlet</span>
      <Select className="min-w-0 flex-1 md:w-[220px]" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {all && <option value="">{t('Semua outlet')}</option>}
        {app.outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
