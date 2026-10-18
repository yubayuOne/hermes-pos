export { money, num } from '../i18n';
export const digitsOnly = (value: string | number | null | undefined) => String(value ?? '').replace(/\D/g, '');
