import { Select, useI18n } from '@hermes-pos/ui';
import { useApp } from '../lib/app';

/** Outlet filter on the toolbar of a list page. It is always visible, never inside the Filter dialog; full width on phones (D12). */
export function OutletFilter({ value, onChange, all = true }: { value: string | null; onChange: (id: string | null) => void; all?: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  return (
    <Select aria-label="Outlet" className="min-w-0 flex-1 md:w-[220px] md:flex-none" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {all && <option value="">{t('Semua outlet')}</option>}
      {app.outlets.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}
