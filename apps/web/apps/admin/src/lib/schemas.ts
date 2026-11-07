import { z } from 'zod';

export const parser =
  <S extends z.ZodType>(schema: S) =>
  (d: z.input<S>): z.output<S> =>
    schema.parse(d);

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Data tidak valid.');

export const loginSchema = z.object({
  email: z.string().trim().email('Isi email admin.').max(120),
  password: z.string().min(1, 'Isi kata sandi.').max(200),
});
export const paymentStatuses = ['pending', 'submitted', 'verified', 'rejected'] as const;
export const paymentListSchema = z.object({ status: z.enum(paymentStatuses).nullable(), page: z.number().int().min(1).max(10_000) });
export const paymentIdSchema = z.object({ id: uuid });
export const paymentRejectSchema = z.object({ id: uuid, reason: z.string().trim().min(3, 'Tulis alasan, minimal 3 huruf.').max(200, 'Maksimal 200 karakter.') });
