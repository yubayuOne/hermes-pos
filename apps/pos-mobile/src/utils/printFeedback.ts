import type { PrintResult } from '../services/printer/types';
import type { Notify } from '../hooks/NotifyProvider';
import { t } from '../i18n';

/**
 * One way to report print results (PRD D: reportPrintResult):
 * - no printer for that role -> warning with the way to set one up
 * - a printer failed         -> error with its name and what to check
 * - success                  -> toast
 * A failing printer never cancels a payment; callers only report.
 */
export function reportPrintResult(
  notify: Notify,
  results: PrintResult[],
  copy: { missingTitle: string; missingMessage: string; successTitle: string; successMessage?: string },
): boolean {
  if (!results.length) {
    void notify.warning(copy.missingTitle, copy.missingMessage, { hint: t('Buka Lainnya, Printer, lalu pilih peran yang sesuai untuk salah satu printer.') });
    return false;
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    void notify.error(t('Cetak gagal'), failed.map((r) => `${r.printerName}: ${r.error ?? t('Printer tidak merespons.')}`).join('\n'), {
      hint: t('Pastikan printer menyala, kertas terisi, dan masih terpasang di Bluetooth Android. Lalu cetak lagi.'),
    });
    return false;
  }
  notify.success(copy.successTitle, copy.successMessage);
  return true;
}
