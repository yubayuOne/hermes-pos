import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { CloseIcon } from './icons';

/**
 * Dialog (DESIGN.md B .dlg). Radix traps focus, closes on Esc, and returns focus to the trigger.
 * A dialog opened from another dialog (new category from the product dialog) is rendered as a second
 * Dialog; closing it returns to the first one, which stays mounted underneath.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="dlg-back" />
        <D.Content className="dlg" style={wide ? { width: 'min(560px, calc(100vw - 32px))' } : undefined}>
          <div className="flex items-start justify-between gap-4">
            <D.Title className="dlg-t">{title}</D.Title>
            <D.Close className="-mr-2 -mt-2 inline-grid size-11 flex-none place-items-center rounded hover:bg-tint" aria-label={t('Tutup')}>
              <CloseIcon />
            </D.Close>
          </div>
          {description ? <D.Description className="mt-3 text-mute">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          {children && <div className="mt-5 grid gap-4">{children}</div>}
          {footer && <div className="dlg-foot">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
