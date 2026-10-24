import type { InputHTMLAttributes } from 'react';
import { Input, useI18n } from '@hermes-pos/ui';

/** Password field with a "Lihat" button. Extra props (id, aria-*) from Field go to the input itself. */
export function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="in-group">
      <Input {...rest} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="in-act lnk px-2 text-body" aria-pressed={show} onClick={onToggle}>
        {show ? t('Sembunyikan') : t('Lihat')}
      </button>
    </div>
  );
}
