import {
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useI18n } from '../i18n';
import { cn } from '../lib/utils';

/**
 * Field (DESIGN.md B .fld): visible label, optional "(opsional)", help under the input, error with role="alert".
 * The child input receives id, aria-invalid, and aria-describedby. When the input sits inside a wrapper
 * (an input with a button next to it), pass a function child and spread the props onto the input.
 */
type ControlProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };
export function Field({
  label,
  optional,
  help,
  error,
  children,
  className,
}: {
  label: ReactNode;
  optional?: boolean;
  help?: ReactNode;
  error?: string | null;
  children: ReactElement<Record<string, unknown>> | ((p: ControlProps) => ReactNode);
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
  const props: ControlProps = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy };
  const control = typeof children === 'function' ? children(props) : isValidElement(children) ? cloneElement(children, props) : children;
  return (
    <div className={cn('fld', className)}>
      <label htmlFor={id} className="fld-l">
        {label}
        {optional && <span className="opt"> {t('(opsional)')}</span>}
      </label>
      {control}
      {error && (
        <p id={errId} role="alert" className="ferr">
          {error}
        </p>
      )}
      {help && (
        <p id={helpId} className="help">
          {help}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('in', className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('in', className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('in', className)} {...rest}>
      {children}
    </select>
  );
}

/** Form-level error box above the buttons (DESIGN.md B dialog error). */
export function FormAlert({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="alert-box">
      {children}
    </div>
  );
}

/** Checkbox with its label. */
export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('check', className)}>
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}
