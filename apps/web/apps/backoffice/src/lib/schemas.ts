import { z } from 'zod';

/**
 * Validation shared by forms (in the browser, to show errors under each field) and server functions.
 * Messages are Indonesian sentences that say how to fix the problem; the English dictionary translates them.
 */
export const parser =
  <S extends z.ZodType>(schema: S) =>
  (d: z.input<S>): z.output<S> =>
    schema.parse(d);

/** First error per field, for forms. */
export function fieldErrors(schema: z.ZodType, value: unknown): Record<string, string> {
  const res = schema.safeParse(value);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Data tidak valid.');
// Same check as isDay in period.ts (tests run plain Node, which cannot resolve an import between these files).
const day = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(Date.parse(v) || 0).toISOString().slice(0, 10) === v, 'Pilih tanggal.');
/** Same limit as CustomRange, checked again on the server: a hand-made URL must not ask for decades of data. */
export const rangeCheck: [(v: { from: string; to: string }) => boolean, { path: string[]; message: string }] = [
  (v) => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 366,
  { path: ['to'], message: 'Rentang maksimal 366 hari.' },
];
const email = z.string().trim().toLowerCase().pipe(z.email('Tulis email yang benar, misalnya nama@bisnis.com.'));
const req = (msg: string, max: number, maxMsg?: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .max(max, maxMsg ?? `Maksimal ${max} karakter.`);
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,20}$/, 'Username 3 sampai 20 karakter: huruf kecil, angka, titik, atau garis bawah.');
export const password = z.string().min(6, 'Kata sandi minimal 6 karakter.');
export const pin = z.string().regex(/^[0-9]{6}$/, 'PIN harus 6 digit angka.');
const rupiah = (msg: string) => z.number({ error: msg }).int(msg).min(0, msg).max(1_000_000_000, msg);

// ---------- Account ----------
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Isi email atau username.'),
  password: z.string().min(1, 'Isi kata sandi.'),
  remember: z.boolean(),
});
export const registerSchema = z
  .object({
    business: req('Isi nama bisnis.', 60),
    username,
    email,
    password,
    terms: z.literal(true, { error: 'Setujui syarat layanan untuk membuat akun.' }),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, { path: ['password'], message: 'Kata sandi harus berbeda dari email Anda.' });
export const forgotSchema = z.object({ email });
export const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Ulangi kata sandi yang sama.' });
export const codeSchema = z.object({ code: z.string().min(1) });
export const oauthSchema = z.object({ next: z.enum(['/', '/onboarding']) });

// ---------- Onboarding ----------
export const businessTypes = ['kafe', 'restoran', 'kedai', 'bakeri', 'lainnya'] as const;
export const timezones = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'] as const;
export const onboardBusinessSchema = z.object({
  name: req('Isi nama bisnis.', 60),
  type: z.enum(businessTypes, { error: 'Pilih jenis usaha.' }),
  city: z.string().trim().max(60, 'Maksimal 60 karakter.'),
  username: username.optional(),
});
export const onboardOutletSchema = z.object({
  business: onboardBusinessSchema,
  outlet: req('Isi nama outlet.', 60),
  address: z.string().trim().max(200, 'Maksimal 200 karakter.'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{0,20}$/, 'Nomor telepon hanya angka, spasi, atau +.'),
});

// ---------- Outlets ----------
// Same limits as migrations 027, 047, and 048. Empty header or footer means no text of its own.
const receiptText = z.string().trim().max(120, 'Maksimal 120 karakter.');
export const receiptTextSchema = z.object({ header: receiptText, footer: receiptText });
export const outletUpdateSchema = z.object({
  outletId: uuid,
  isActive: z.boolean(),
  name: req('Isi nama outlet.', 60),
  address: z.string().trim().max(200, 'Maksimal 200 karakter.'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ -]{0,20}$/, 'Nomor telepon hanya angka, spasi, atau +.'),
  header: receiptText,
  footer: receiptText,
});

// ---------- Cashiers ----------
export const cashierCreateSchema = z.object({ outletId: uuid, name: req('Nama kasir wajib diisi.', 40), pin });
export const cashierPinSchema = z.object({ cashierId: uuid, pin });
export const cashierActiveSchema = z.object({ cashierId: uuid, active: z.boolean() });

// ---------- Catalog ----------
export const outletRefSchema = z.object({ outletId: uuid });
export const categorySchema = z.object({ outletId: uuid, name: req('Isi nama kategori.', 20, 'Nama kategori maksimal 20 huruf.') });
export const productSchema = z.object({
  id: uuid.nullish(),
  outletId: uuid,
  categoryId: uuid.nullable(),
  name: req('Nama produk wajib diisi.', 60),
  price: rupiah('Harga jual harus lebih dari Rp0.').refine((v) => v > 0, 'Harga jual harus lebih dari Rp0.'),
  hpp: rupiah('HPP harus angka, boleh Rp0.'),
  trackStock: z.boolean(),
  stock: rupiah('Stok awal harus angka, boleh 0.'),
  station: z.enum(['kitchen', 'bar']),
});
export const productActiveSchema = z.object({ id: uuid, active: z.boolean() });

// ---------- Vouchers ----------
export const voucherSchema = z
  .object({
    id: uuid.nullish(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,12}$/, 'Kode 4 sampai 12 huruf atau angka, tanpa spasi.'),
    scope: z.enum(['bill', 'products']),
    discountType: z.enum(['percent', 'amount']),
    value: z.number({ error: 'Isi nilai potongan.' }),
    minSpend: z.number().min(0, 'Minimal belanja tidak boleh negatif.'),
    quota: z.number().int().min(1, 'Kuota minimal 1, atau kosongkan untuk tanpa batas.').nullable(),
    expiresOn: day,
    productIds: z.array(uuid),
  })
  .superRefine((v, ctx) => {
    if (v.discountType === 'percent' && (v.value < 1 || v.value > 100))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Potongan persen harus 1 sampai 100.' });
    if (v.discountType === 'amount' && v.value < 1000) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Potongan nominal minimal Rp1.000.' });
    else if (v.discountType === 'amount' && !Number.isInteger(v.value))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Potongan nominal tanpa koma.' });
    if (v.scope === 'products' && v.productIds.length === 0) ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'Pilih minimal satu produk.' });
  });
export const voucherActiveSchema = z.object({ id: uuid, active: z.boolean() });

// ---------- Expenses (POS migrations 040, 041; owner cancel and add, 073) ----------
/** Same list as the check in migrations 040, 041 and the POS. */
export const EXPENSE_UNITS = ['kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin'] as const;
export const expenseItemSchema = z.object({
  name: req('Tulis nama barang atau biaya.', 60, 'Nama barang maksimal 60 huruf.'),
  category: z.enum(['operasional', 'belanja'], { error: 'Pilih kategori.' }),
  quantity: z
    .number({ error: 'Jumlah harus angka.' })
    .gt(0, 'Jumlah harus lebih dari 0.')
    .max(100000, 'Jumlah maksimal 100.000.')
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Jumlah maksimal 3 angka di belakang koma.'),
  unit: z.enum(EXPENSE_UNITS, { error: 'Pilih satuan.' }),
  amount: z
    .number({ error: 'Harga total harus angka.' })
    .int('Harga total tanpa koma.')
    .gt(0, 'Harga total harus lebih dari Rp0.')
    .max(100_000_000, 'Harga total maksimal Rp100.000.000.'),
});
export const expenseAddSchema = z.object({
  shiftId: uuid,
  items: z.array(expenseItemSchema).min(1, 'Isi minimal satu barang.').max(30, 'Maksimal 30 barang sekali simpan.'),
});
export const expenseCancelSchema = z.object({
  itemId: uuid,
  reason: z.string().trim().min(3, 'Tulis alasan, minimal 3 huruf.').max(200, 'Maksimal 200 karakter.'),
});
export const expenseListSchema = z
  .object({
    outletId: uuid.nullable(),
    from: day,
    to: day,
    tz: z.enum(timezones),
    /** createdAt of the last row already shown; null = first page. */
    before: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(...rangeCheck);
// ---------- Settings ----------
export const profileSchema = z.object({
  fullName: z.string().trim().max(80, 'Maksimal 80 karakter.'),
  username,
  email,
  whatsapp: z
    .string()
    .trim()
    .regex(/^[0-9+ ]{0,20}$/, 'Nomor WhatsApp hanya angka, spasi, atau +.'),
});
export const changePasswordSchema = z
  .object({ current: z.string().min(1, 'Isi kata sandi saat ini.'), password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Ulangi kata sandi yang sama.' })
  .refine((v) => v.password !== v.current, { path: ['password'], message: 'Kata sandi baru harus berbeda dari yang lama.' });
export const businessSchema = z.object({
  name: req('Isi nama bisnis.', 60),
  type: z.enum(businessTypes, { error: 'Pilih jenis usaha.' }),
  city: z.string().trim().max(60, 'Maksimal 60 karakter.'),
  timezone: z.enum(timezones),
});
// Header and footer text are per outlet (outletUpdateSchema); only the switches are business-wide.
export const receiptSchema = z.object({
  show_logo: z.boolean(),
  show_header: z.boolean(),
  show_address: z.boolean(),
  show_phone: z.boolean(),
  show_cashier: z.boolean(),
  show_notes: z.boolean(),
  show_tax: z.boolean(),
  show_footer: z.boolean(),
});
/** Owner approval code for voids on the POS (migration 032). */
export const voidCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Kode persetujuan harus 6 digit angka.') });

export const notifySchema = z.object({ subscription: z.boolean(), cash_variance: z.boolean(), low_stock: z.boolean() });

// ---------- Summary ----------
export const summarySchema = z.object({ from: day, to: day, outletId: uuid.nullable() });
export const productSalesSchema = z.object({ outletId: uuid, from: day, to: day, tz: z.enum(timezones) }).refine(...rangeCheck);

// ---------- Transactions (migrations 028, 034, 066, 067, 073) ----------
export const billListSchema = z
  .object({
    outletId: uuid.nullable(),
    from: day,
    to: day,
    tz: z.enum(timezones),
    status: z.enum(['completed', 'voided', 'all']),
    q: z.string().trim().max(40),
    page: z.number().int().min(1).max(10_000),
  })
  .refine(...rangeCheck);
export const billRefSchema = z.object({ id: uuid });
export const billVoidSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(3, 'Tulis alasan pembatalan, minimal 3 huruf.').max(200, 'Maksimal 200 karakter.'),
});
/** Same rules as owner_correct_bill (073): the whole new list, lines of the bill by itemId, new products by productId. */
const lineQty = z.number({ error: 'Jumlah harus angka.' }).int('Jumlah tanpa koma.').min(0, 'Jumlah tidak boleh minus.').max(9999, 'Jumlah maksimal 9.999.');
const reason = z.string().trim().min(3, 'Tulis alasan, minimal 3 huruf.').max(200, 'Maksimal 200 karakter.');
export const billCorrectionSchema = z.object({
  id: uuid,
  items: z
    .array(
      // A line already on the bill (itemId) or a new product (productId), never both.
      z.object({ itemId: uuid.optional(), productId: uuid.optional(), quantity: lineQty }).refine((v) => !v.itemId !== !v.productId, 'Data tidak valid.'),
    )
    .max(200, 'Maksimal 200 item.')
    .refine((v) => v.some((i) => i.quantity > 0), 'Bill harus berisi minimal satu item.'),
  paymentMethod: z.enum(['cash', 'qris']),
  customerName: z.string().trim().max(40, 'Nama pelanggan maksimal 40 karakter.'),
  tableNumber: z.string().trim().max(6, 'Nomor meja maksimal 6 karakter.'),
  reason,
});

// ---------- Tutup hari (073) ----------
export const dayCloseSchema = z.object({ outletId: uuid, date: day });
export const cashMovementSchema = z.object({
  shiftId: uuid,
  direction: z.enum(['in', 'out']),
  amount: z
    .number({ error: 'Isi nominal.' })
    .int('Nominal tanpa koma.')
    .gt(0, 'Nominal harus lebih dari Rp0.')
    .max(1_000_000_000, 'Nominal maksimal Rp1.000.000.000.'),
  reason,
});
// ---------- Stock (074) ----------
const stockQty = z
  .number({ error: 'Jumlah harus angka.' })
  .refine((v) => Number.isFinite(v) && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Jumlah maksimal 3 angka di belakang koma.')
  .refine((v) => Math.abs(v) < 1_000_000, 'Jumlah terlalu besar.');
/** Same rules as owner_stock_document: stock in > 0, an adjustment signed and not 0 with a reason, a count >= 0. */
export const stockDocumentSchema = z
  .object({
    outletId: uuid,
    kind: z.enum(['stock_in', 'adjustment', 'opname']),
    reason: z.string().trim().max(200, 'Maksimal 200 karakter.'),
    lines: z
      .array(z.object({ productId: uuid, qty: stockQty }))
      .min(1, 'Isi jumlah minimal satu produk.')
      .max(500, 'Maksimal 500 produk.')
      .refine((ls) => new Set(ls.map((l) => l.productId)).size === ls.length, 'Satu produk hanya boleh sekali.'),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'adjustment' && v.reason.length < 3) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Tulis alasan, minimal 3 huruf.' });
    for (const l of v.lines) {
      if (v.kind === 'stock_in' && l.qty <= 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Jumlah stok masuk harus lebih dari 0.' });
      if (v.kind === 'adjustment' && l.qty === 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Jumlah penyesuaian tidak boleh 0.' });
      if (v.kind === 'opname' && l.qty < 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Hasil hitung tidak boleh minus.' });
    }
  });
export const stockDocumentListSchema = z
  .object({ outletId: uuid, from: day, to: day, tz: z.enum(timezones), page: z.number().int().min(1).max(10_000) })
  .refine(...rangeCheck);

// ---------- Billing ----------
export const paymentSchema = z.object({
  plan: z.enum(['monthly', 'semiannual', 'annual']),
  extraOutlets: z.number().int().min(0).max(50),
  sender: z.string().trim().min(2, 'Isi nama pengirim sesuai nama di rekening.').max(80, 'Maksimal 80 karakter.'),
  bank: z.string().trim().min(2, 'Isi nama bank asal transfer.').max(40, 'Maksimal 40 karakter.'),
  date: day,
  amount: z.number({ error: 'Isi jumlah yang ditransfer.' }).int().min(1, 'Isi jumlah yang ditransfer.'),
  note: z.string().trim().max(300, 'Maksimal 300 karakter.'),
});
