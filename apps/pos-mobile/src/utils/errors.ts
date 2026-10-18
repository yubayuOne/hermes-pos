import { t } from '../i18n';

/**
 * Turns backend and network errors into sentences a cashier understands (PRD X6):
 * - message : what happened
 * - hint    : what to do next (optional)
 * Known server messages are mapped to dictionary keys so they follow the chosen language.
 */
export type ErrorInfo = { message: string; hint?: string; code?: string };

const NETWORK_RE = /network|timeout|timed out|fetch|connection|offline|abort/i;

export function errorText(error: unknown): string {
  if (typeof error === 'string') return error.replace(/^Error:\s*/i, '').trim();
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m.replace(/^Error:\s*/i, '').trim();
  }
  return '';
}

/** Hint from Postgres (`using hint = ...`), e.g. subscription_expired, plan_limit, voucher_*. */
export function errorHint(error: unknown): string {
  if (error && typeof error === 'object') {
    const h = (error as { hint?: unknown }).hint;
    if (typeof h === 'string') return h;
  }
  return '';
}

export const isExpiredError = (error: unknown) => errorHint(error) === 'subscription_expired' || /Langganan berakhir/.test(errorText(error));

export function describeError(error: unknown, fallback = t('Terjadi kesalahan. Silakan coba lagi.')): ErrorInfo {
  const message = errorText(error);
  const hint = errorHint(error);
  if (!message) return { message: fallback };

  if (isExpiredError(error)) {
    return { code: 'expired', message: t('Langganan berakhir.'), hint: t('Pemilik bisa memperpanjang paket di backoffice. Data tidak dihapus.') };
  }
  const held = message.match(/Masih ada (\d+) Bill Ditahan/i);
  if (held)
    return {
      message: t('Masih ada {n} bill ditahan.', { n: held[1] }),
      hint: t('Buka tab Bill, lalu bayar atau hapus bill yang ditahan. Setelah itu tutup shift lagi.'),
    };
  if (message.includes('Masih ada shift aktif'))
    return { message: t('Masih ada shift yang sedang berjalan.'), hint: t('Tutup shift yang aktif di tab Shift sebelum membuka shift baru.') };
  if (message.includes('Shift aktif tidak ditemukan') || (/shift (sudah|telah) ditutup/i.test(message) && !message.includes('bill ini'))) {
    return { message: t('Shift ini sudah tidak aktif.'), hint: t('Status shift disegarkan. Buka shift baru untuk lanjut jualan.') };
  }
  if (message.includes('Uang diterima kurang'))
    return { message: t('Uang diterima kurang dari total tagihan.'), hint: t('Masukkan nominal yang sama atau lebih besar dari total.') };
  if (message.includes('Stok produk tidak mencukupi'))
    return { message: t('Stok menu tidak cukup.'), hint: t('Kurangi jumlahnya, atau minta pemilik memperbarui stok di backoffice.') };
  if (message.includes('Sesi kasir tidak valid') || /jwt|not authenticated|invalid refresh token/i.test(message)) {
    return { message: t('Sesi kasir sudah tidak aktif.'), hint: t('Masuk lagi, lalu ulangi.') };
  }
  if (message.includes('Kas fisik tidak valid') || message.includes('Modal kas tidak valid'))
    return { message: t('Nominal kas tidak valid.'), hint: t('Masukkan angka 0 atau lebih.') };
  if (message.includes('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST')) {
    return { message: t('Pembayaran ini sudah punya identitas yang berbeda.'), hint: t('Kembali ke bill, lalu mulai pembayaran baru.') };
  }
  if (message.includes('Diskon tidak boleh membuat total'))
    return { message: t('Diskon tidak boleh membuat total jadi nol.'), hint: t('Kurangi diskon, lalu coba lagi.') };
  if (message.includes('Diskon melebihi harga')) return { message: t('Diskon melebihi harga.'), hint: t('Kurangi diskon, lalu coba lagi.') };
  if (message.includes('Shift bill ini sudah ditutup'))
    return { message: t('Shift bill ini sudah ditutup.'), hint: t('Bill dari shift yang sudah ditutup tidak bisa di-void karena laporannya sudah final.') };
  if (message.includes('Bill hasil Split Bill')) return { message: t('Bagian pisah bill tidak bisa di-void satu per satu.') };
  if (message.includes('Hanya bill yang sudah dibayar')) return { message: t('Hanya bill yang sudah dibayar yang bisa di-void.') };
  if (message.includes('Alasan pembatalan')) return { message: t('Tulis alasan void minimal 3 huruf.') };
  // Vouchers (032)
  if (hint === 'voucher_not_found' || message.includes('Kode voucher tidak ditemukan'))
    return { code: 'voucher', message: t('Kode voucher tidak ditemukan.'), hint: t('Periksa ejaannya, lalu coba lagi.') };
  if (hint === 'voucher_inactive') return { code: 'voucher', message: t('Voucher ini sudah dinonaktifkan pemilik.') };
  if (hint === 'voucher_expired') return { code: 'voucher', message: t('Voucher ini sudah berakhir.') };
  if (hint === 'voucher_used_up') return { code: 'voucher', message: t('Kuota voucher ini sudah habis.') };
  if (hint === 'voucher_min_spend') {
    const amount = message.match(/Rp[\d.,]+/)?.[0] ?? '';
    return { code: 'voucher', message: t('Belanja minimal {amount} untuk voucher ini.', { amount }) };
  }
  if (hint === 'voucher_with_bill_discount')
    return { code: 'voucher', message: t('Voucher tidak bisa digabung dengan diskon bill.'), hint: t('Hapus diskon bill dulu.') };
  if (hint === 'voucher_with_item_discount')
    return { code: 'voucher', message: t('Voucher menu tidak bisa digabung dengan diskon item di menu yang sama.'), hint: t('Hapus diskon itemnya dulu.') };
  if (hint === 'voucher_no_product') return { code: 'voucher', message: t('Voucher ini hanya untuk menu tertentu, dan menu itu tidak ada di bill.') };
  if (hint === 'voucher_too_large') return { code: 'voucher', message: t('Potongan voucher lebih besar dari total bill.') };
  if (hint === 'refund_window') return { code: 'refund', message: t('Refund hanya bisa dalam 24 jam setelah bill dibuat.') };
  if (hint === 'refund_exceeds')
    return { code: 'refund', message: t('Jumlah refund melebihi sisa item yang belum direfund.'), hint: t('Muat ulang rincian bill.') };
  if (hint === 'already_refunded') return { code: 'refund', message: t('Bill ini sudah direfund sebagian. Refund sisa item, bukan batalkan bill.') };
  if (hint === 'shift_other_device' || message.includes('Shift ini dibuka di HP lain'))
    return {
      code: 'shift_device',
      message: t('Shift ini dibuka di HP lain.'),
      hint: t('Jualan dan tutup shift hanya bisa di HP itu. Kalau HP itu hilang atau rusak, pemilik bisa memindahkannya di tab Shift.'),
    };
  if (hint === 'voucher_split') return { code: 'voucher', message: t('Voucher tidak bisa dipakai untuk pisah bill.') };
  if (hint === 'plan_limit' || /^Batas \d+/.test(message))
    return { message: t('Batas paket tercapai.'), hint: t('Pemilik bisa menambah paket atau menonaktifkan data lain di backoffice.') };
  if (NETWORK_RE.test(message))
    return { code: 'network', message: t('Koneksi ke server terputus.'), hint: t('Periksa internet di perangkat ini, lalu coba lagi.') };
  return { message };
}

/** PostgREST "JWT expired" and Postgres statement timeout: transient, safe to retry with the same key. */
const TRANSIENT_CODES = new Set(['PGRST301', '57014']);

/**
 * True when the client cannot know whether the server committed the checkout, or the failure is transient
 * (expired token after a long offline spell). An error with a database code means the server answered, so
 * the message text is not matched against the network words.
 */
export function isUnknownCheckoutOutcome(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && code) return TRANSIENT_CODES.has(code);
  return NETWORK_RE.test(errorText(error)) || /jwt expired/i.test(errorText(error));
}

export const isNetworkError = isUnknownCheckoutOutcome;
