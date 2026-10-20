// Every brand name, address, price, and placeholder of the landing page lives here (PRD H, X5).
// Placeholders in square brackets must be replaced before release (DESIGN.md H1).

export const SITE = {
  // The env values win; otherwise localhost while developing and the real domains in a build.
  url: import.meta.env?.VITE_LANDING_URL ?? (import.meta.env?.DEV ? 'http://localhost:3000' : 'https://hermes-pos.com'),
  backoffice: import.meta.env?.VITE_BACKOFFICE_URL ?? (import.meta.env?.DEV ? 'http://localhost:3001' : 'https://backoffice.hermes-pos.com'),
  whatsapp: '0851-5858-3200',
  email: 'yubayu2004@gmail.com',
  bankAccount: 'BCA 0865432122 a.n. [ATAS NAMA]',
  year: 2026,
};

export const LINKS = {
  login: `${SITE.backoffice}/login`,
  register: `${SITE.backoffice}/register`,
};

/** Prices in rupiah. Per month and savings are computed, not typed, so they always match. */
export const MONTHLY = 149_000;
export const EXTRA_OUTLET = 99_000;
export const PLANS = [
  { code: 'trial', name: 'Trial', months: 0, duration: '3 hari', price: 0, note: 'Bisnis baru, satu kali. 2 kasir, 40 produk per outlet.' },
  { code: 'monthly', name: 'Bulanan', months: 1, duration: '1 bulan', price: 149_000 },
  { code: 'semiannual', name: '6 bulan', months: 6, duration: '6 bulan', price: 699_000 },
  { code: 'annual', name: 'Tahunan', months: 12, duration: '12 bulan', price: 1_399_000 },
] as const;

/**
 * Questions owners ask, in the order that sells the product. Shown in the FAQ section and sent to search engines as
 * FAQPage data, so the two always match. Every answer states what the app and the database really do today.
 */
export const FAQ: [string, string][] = [
  [
    'Bisakah kasir membatalkan bill sendiri?',
    'Tidak untuk bill yang sudah dibayar. Void dan refund butuh kode persetujuan 6 digit dari pemilik, dan alasannya wajib diisi. Lima kali salah kode mengunci void selama 5 menit. Refund per item hanya untuk bill berumur sampai 24 jam, dan pemilik mendapat notifikasi di backoffice.',
  ],
  [
    'Bagaimana pengeluaran dicatat?',
    'Anda mencatatnya di backoffice, menu Pengeluaran: nama barang, jenis (operasional atau belanja), jumlah, dan harga. Pengeluaran masuk laporan dan laba rugi, tanpa mengubah kas laci.',
  ],
  [
    'Bagaimana laporan shift sampai ke saya?',
    'Di akhir shift, kasir mengetuk Kirim ke WA. WhatsApp terbuka dengan laporan siap kirim dan kasir memilih penerimanya. Isinya penjualan setelah refund, setiap refund beserta alasannya, kas, dan selisih. Laporan yang sama bisa dicetak ulang, dan angkanya juga ada di backoffice.',
  ],
  [
    'Bagaimana kalau internet mati di tengah jam ramai?',
    'Kasir tetap jualan. Bill masuk antrean di perangkat dengan nomor finalnya, struk tetap bisa dicetak, dan setiap bill terkirim tepat satu kali saat internet kembali. Buka dan tutup shift serta catat pengeluaran juga bisa offline. Memilih kasir (cek PIN), void, dan refund butuh internet.',
  ],
  [
    'Apakah satu HP bisa dipakai untuk beberapa outlet?',
    'Tidak. Setiap HP terikat ke satu outlet yang dipilih sekali saat masuk pertama kali. Daftar kasirnya hanya berisi kasir outlet itu, dan server menolak PIN dari outlet lain. Untuk memindahkan HP, keluar akun lalu masuk lagi sebagai pemilik.',
  ],
  [
    'Printer apa saja yang bisa dipakai?',
    'Printer thermal Bluetooth ESC/POS dengan kertas 58 mm atau 80 mm, misalnya Epson, iware, taffware, nyk, atau odi. Satu pesanan bisa dicetak ke printer kasir, dapur, dan bar sekaligus. Logo, alamat, dan teks struk diatur per outlet.',
  ],
  [
    'Apakah setiap kasir perlu akun sendiri?',
    'Tidak. Kasir tidak punya email. Pemilik membuat kasir di backoffice dengan nama dan PIN 6 digit. Di aplikasi, kasir memilih namanya lalu mengetik PIN. Lima kali salah PIN mengunci kasir itu selama 5 menit.',
  ],
  [
    'Bisa bayar pelanggan dengan QRIS atau e-wallet?',
    'Bisa, lewat QRIS milik outlet (termasuk dari e-wallet). Kasir mengonfirmasi setelah pembayaran berhasil; belum terhubung otomatis ke bank.',
  ],
  [
    'Apa batasan selama trial 3 hari?',
    'Satu outlet, dua kasir, dan 40 produk per outlet. Trial berlaku sekali untuk bisnis baru. Setelah 3 hari, pilih paket untuk membuka kunci; data yang sudah Anda isi tetap ada.',
  ],
  [
    'Apa yang terjadi saat langganan berakhir?',
    'Aplikasi dan backoffice tetap bisa dibuka, tetapi penjualan baru, shift baru, dan penambahan kasir atau produk terkunci. Laporan dan riwayat tetap bisa dilihat. Data tidak dihapus.',
  ],
];

export const perMonth = (price: number, months: number) => Math.round(price / months);
export const saving = (price: number, months: number) => MONTHLY * months - price;
