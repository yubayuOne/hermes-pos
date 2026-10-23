// Turns Supabase and Postgres errors into Indonesian sentences that say how to fix the problem (DESIGN.md A8).
// The English dictionary translates these same sentences, so the UI always calls t(error).
export function describeError(error: unknown): string {
  const raw = typeof error === 'string' ? error : ((error as { message?: string })?.message ?? '');
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email, username, atau kata sandi salah.';
  if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi. Buka email dari kami dan klik tautannya.';
  if (m.includes('user already registered') || m.includes('already been registered')) return 'Email ini sudah terdaftar. Masuk dengan email itu.';
  if (m.includes('password should be at least') || m.includes('weak password')) return 'Kata sandi minimal 6 karakter.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
  if (m.includes('jwt expired') || m.includes('sesi berakhir') || m.includes('not authenticated')) return 'Sesi berakhir. Silakan masuk lagi.';
  if (m.includes('langganan berakhir') || m.includes('subscription expired')) return 'Langganan berakhir. Perpanjang paket untuk mengubah data.';
  // Plan limits from migration 030 carry a number; the sentence without it is translatable.
  if (/batas \d+ kasir/.test(m)) return 'Batas kasir aktif per outlet tercapai. Nonaktifkan kasir lain atau perpanjang paket.';
  if (/batas \d+ produk/.test(m)) return 'Batas produk aktif per outlet tercapai. Matikan produk lain atau perpanjang paket.';
  if (/batas \d+ outlet/.test(m)) return 'Batas outlet paket tercapai. Outlet tambahan diaktifkan setelah pembayaran.';
  if (m.includes('nama kasir sudah dipakai')) return 'Nama kasir sudah dipakai. Pakai nama lain.';
  if (m.includes('nama kategori sudah digunakan')) return 'Nama kategori sudah dipakai. Pakai nama lain.';
  if (m.includes('hanya owner')) return 'Hanya pemilik bisnis yang bisa melakukan ini.';
  if (m.includes('failed to fetch') || m.includes('fetch failed') || m.includes('network') || m.includes('econnrefused'))
    return 'Tidak dapat terhubung ke server. Periksa koneksi internet lalu coba lagi.';
  if (m.includes('environment variable')) return 'Server belum dikonfigurasi. Hubungi admin.';
  if (m.includes('duplicate key') || m.includes('unique')) return 'Data dengan nama itu sudah ada. Pakai nama lain.';
  // Ingredient errors (084) carry a name; the sentence without it is translatable.
  if (m.includes('satuan tidak cocok dengan bahan')) return 'Satuan tidak cocok dengan bahan. Pilih satuan dari jenis yang sama: berat, volume, atau pcs.';
  if (m.includes('dipakai di resep')) return 'Bahan ini dipakai di resep. Hapus dari resep itu dulu.';
  if (raw) return raw;
  return 'Terjadi kesalahan. Coba lagi.';
}
