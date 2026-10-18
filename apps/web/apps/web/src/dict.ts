import type { Dict } from '@hermes-pos/ui';

// English for the landing page, keyed by the Indonesian text in the markup (DESIGN.md A8).
// Change wording here and in the markup together so both languages stay aligned.
export const EN: Dict = {
  // Page title and description
  'Hermes POS: aplikasi kasir Android dengan kontrol kas untuk kafe': 'Hermes POS: an Android till with cash control for cafes',
  'Aplikasi kasir Android untuk kafe dan restoran kecil: void dan refund butuh kode pemilik, kas laci terhitung, tetap jalan saat offline. Trial gratis 3 hari.':
    'An Android till for cafes and small restaurants: voids and refunds need the owner’s code, drawer cash adds up, and it keeps working offline. Free 3-day trial.',
  // Header
  'Hermes POS, kembali ke atas': 'Hermes POS, back to top',
  'Bagian halaman': 'Page sections',
  'Kontrol kas': 'Cash control',
  'Satu hari kerja': 'One working day',
  Backoffice: 'Backoffice',
  'Harga paket': 'Pricing',
  'Tanya jawab': 'FAQ',
  Kontak: 'Contact',
  Masuk: 'Sign in',
  'Coba gratis 3 hari': 'Try free for 3 days',
  'Langsung ke isi': 'Skip to content',

  // Hero and facts
  'Tahu ke mana uang laci pergi,': 'Know where the drawer money went,',
  'walau Anda tidak di toko.': 'even when you are not in the shop.',
  '{brand} adalah aplikasi kasir Android untuk kafe dan restoran kecil. Void dan refund butuh kode Anda, dan pengeluaran dari laci langsung mengurangi kas yang seharusnya ada. Internet mati pun, tidak ada transaksi yang hilang atau tercatat dua kali.':
    '{brand} is an Android till for cafes and small restaurants. Voids and refunds need your code, and money taken from the drawer lowers the expected cash at once. Even with the internet down, no transaction is lost or recorded twice.',
  'Lihat kontrol kas': 'See cash control',
  'Contoh buku kas shift': 'Sample shift cash book',
  'Tutup shift': 'Close shift',
  contoh: 'sample',
  'Kas awal': 'Opening cash',
  'Penjualan tunai': 'Cash sales',
  'Pengeluaran dari laci': 'Drawer expenses',
  'Kas seharusnya': 'Expected cash',
  'Hitungan kasir': 'Cashier count',
  Selisih: 'Variance',
  'Selisih terlihat saat shift ditutup, bukan di akhir bulan. Contoh tampilan.':
    'The variance shows when the shift closes, not at the end of the month. Sample view.',
  'Fakta singkat': 'Quick facts',
  'Android, HP dan tablet': 'Android, phones and tablets',
  'Printer Bluetooth 58 mm dan 80 mm': 'Bluetooth printers, 58 mm and 80 mm',
  'Tunai dan QRIS': 'Cash and QRIS',

  // Cash control
  'Kasir menjalankan toko. Pemilik memegang kuncinya.': 'The cashier runs the shop. The owner holds the key.',
  'Void, refund, dan uang keluar dari laci memengaruhi kas. Di sini ketiganya punya aturan dan meninggalkan jejak.':
    'Voids, refunds, and money leaving the drawer all change the cash. Here each one has a rule and leaves a trace.',
  'Void dan refund tidak jalan tanpa kode Anda.': 'Voids and refunds do not go through without your code.',
  'Kasir tidak bisa membatalkan bill yang sudah dibayar sendirian. Anda membuat kode persetujuan 6 digit di backoffice, dan kasir meminta Anda mengetiknya di perangkat. Alasannya wajib diisi, lima kali salah mengunci void selama 5 menit, dan refund per item hanya untuk bill berumur sampai 24 jam. Setiap refund masuk ke lonceng notifikasi Anda.':
    'A cashier cannot cancel a paid bill alone. You set a 6-digit approval code in the backoffice, and the cashier asks you to type it on the device. A reason is required, five wrong codes lock voids for 5 minutes, and item refunds only work on bills up to 24 hours old. Every refund lands in your notification bell.',
  'Uang keluar dari laci ikut terhitung.': 'Money taken from the drawer is counted.',
  'Kasir mencatat pengeluaran di aplikasi dan memilih apakah uangnya dari laci. Yang dari laci langsung mengurangi kas yang seharusnya ada. Anda bisa mengoreksi catatannya di backoffice, dan selisih shift dihitung ulang.':
    'The cashier records an expense in the app and chooses whether the money came from the drawer. Drawer money lowers the expected cash at once. You can correct the entry in the backoffice, and the shift variance is recalculated.',
  'Laporan shift sampai ke WhatsApp.': 'The shift report reaches WhatsApp.',
  'Di akhir shift, satu ketukan membuka WhatsApp dengan laporan siap kirim. Struknya juga bisa dicetak ulang kapan saja.':
    'At the end of a shift, one tap opens WhatsApp with the report ready to send. The slip can also be reprinted any time.',
  'Contoh persetujuan void': 'Sample void approval',
  'Void bill': 'Void bill',
  Alasan: 'Reason',
  'Salah pesan': 'Wrong order',
  'Kode persetujuan pemilik': 'Owner approval code',
  'Lima kali salah: terkunci 5 menit.': 'Five wrong codes: locked for 5 minutes.',
  'Contoh pengeluaran dari laci': 'Sample drawer expense',
  Sebelum: 'Before',
  Sesudah: 'After',
  'Es batu 3 kg, dari laci': 'Ice, 3 kg, from the drawer',
  'Contoh laporan shift untuk WhatsApp': 'Sample shift report for WhatsApp',
  'Laporan shift 2': 'Shift 2 report',
  'Outlet Utama · contoh': 'Main outlet · sample',
  'Penjualan bersih': 'Net sales',
  'Refund 1: Salah pesan': 'Refund 1: Wrong order',
  Pengeluaran: 'Expenses',
  'Selisih kas': 'Cash variance',
  'Kirim ke WA': 'Send to WA',

  // One working day
  'Satu hari kerja, dari buka sampai tutup.': 'One working day, from opening to closing.',
  'Contoh hari di satu kafe. Jam dan angkanya ilustrasi, urutan dan cara kerjanya nyata.':
    'A sample day at one cafe. The hours and numbers are illustrations; the order and the way it works are real.',
  'Buka shift dengan kas awal.': 'Open the shift with opening cash.',
  'Kasir memilih nama dan mengetik PIN 6 digit, tanpa akun email. Kas awal langsung jadi entri pertama di buku kas shift. Satu kasir hanya bisa punya satu shift terbuka.':
    'The cashier picks their name and types a 6-digit PIN, no email account needed. Opening cash becomes the first entry in the shift’s cash book. A cashier can have only one open shift.',
  'kas awal': 'opening cash',
  'total bill': 'bill total',
  'Jam ramai, satu tangan memegang nampan.': 'Rush hour, one hand holding a tray.',
  'Diskon persen atau rupiah, per item atau per bill. Catatan seperti "tanpa es" tercetak di struk tanpa mengubah harga. Bill bisa ditahan, dipanggil lagi, dan dipisah tanpa sisa rupiah yang melenceng.':
    'Discounts in percent or rupiah, per item or per bill. Notes like "no ice" print on the receipt without changing the price. Bills can be held, recalled, and split without a stray rupiah.',
  antrean: 'queue',
  '3 menunggu': '3 waiting',
  'Sinyal hilang. Jualan jalan terus.': 'Signal lost. Sales keep going.',
  'Bill yang belum terkirim masuk antrean di perangkat dengan nomor sementara, dan struk sementara tetap bisa dicetak. Saat internet kembali, tiap bill dikirim ulang dengan kunci yang sama, jadi server menolak duplikat. Buka shift, tutup shift, dan void butuh internet.':
    'Bills that have not been sent wait in a queue on the device with a provisional number, and a provisional receipt still prints. When the internet returns, each bill is resent with the same key, so the server rejects duplicates. Opening a shift, closing a shift, and voids need the internet.',
  tercetak: 'printed',
  '3 kertas': '3 slips',
  'Satu pesanan, tiga kertas.': 'One order, three slips.',
  'Tetapkan printer per peran: kasir, dapur, bar. Kertas 58 mm atau 80 mm, merek Epson, iware, taffware, nyk, odi, atau printer ESC/POS lain. Printer yang macet tidak menggagalkan pembayaran.':
    'Assign printers by role: cashier, kitchen, bar. 58 mm or 80 mm paper, Epson, iware, taffware, nyk, odi, or any other ESC/POS printer. A jammed printer never fails a payment.',
  'selisih kas': 'cash variance',
  'Tutup shift. Server yang menghitung.': 'Close the shift. The server does the math.',
  'Setiap penjualan tunai, void, dan refund tunai masuk ke buku kas otomatis. Kasir hanya menghitung uang di laci, dan selisih terhadap kas seharusnya langsung terlihat. Shift tidak bisa ditutup selama ada bill tertahan atau antrean offline.':
    'Every cash sale, void, and cash refund goes into the cash book automatically. The cashier only counts the money in the drawer, and the variance against expected cash shows at once. A shift cannot close while bills are held or the offline queue is not empty.',
  'Contoh form buka shift': 'Sample open shift form',
  Kasir: 'Cashier',
  Outlet: 'Outlet',
  'Nama kasir': 'Cashier name',
  'Buka shift': 'Open shift',
  'Contoh bill': 'Sample bill',
  Catatan: 'Note',
  'Diskon item 10%': 'Item discount 10%',
  Diskon: 'Discount',
  Tahan: 'Hold',
  'Pisah bill': 'Split bill',
  'Bayar tunai': 'Pay cash',
  'Contoh antrean offline': 'Sample offline queue',
  'Sinkron otomatis tiap 30 detik selama antrean belum kosong.': 'Syncs every 30 seconds while the queue is not empty.',
  'Contoh struk pelanggan, tiket dapur, dan tiket bar': 'Sample customer receipt, kitchen ticket, and bar ticket',
  Struk: 'Receipt',
  pelanggan: 'customer',
  Tiket: 'Ticket',
  dapur: 'kitchen',
  bar: 'bar',
  'Contoh pemeriksaan sebelum tutup shift': 'Sample checks before closing a shift',
  'Bill tertahan': 'Held bills',
  'Antrean offline': 'Offline queue',

  // Backoffice band
  'Setelah tutup, pemilik membaca angkanya dari rumah.': 'After closing, the owner reads the numbers from home.',
  'Backoffice dibuka di browser dengan akun pemilik yang sama dengan aplikasi kasir.':
    'The backoffice opens in a browser with the same owner account as the cashier app.',
  Laporan: 'Reports',
  'penjualan, laba, dan kas, gabungan atau per outlet dan per kasir, plus 10 produk terlaris. Siap cetak.':
    'for sales, profit, and cash, combined or per outlet and per cashier, plus the 10 best sellers. Ready to print.',
  'dicatat kasir per shift dan bisa Anda koreksi kapan saja. Kas dan selisih shift dihitung ulang.':
    'are recorded by cashiers per shift and you can correct them any time. Cash and the shift variance are recalculated.',
  'Per outlet': 'Per outlet',
  'logo, alamat, dan teks struk diatur di tiap outlet. Satu HP terikat ke satu outlet, dan server menolak PIN dari outlet lain.':
    'logo, address, and receipt text are set for each outlet. One phone is tied to one outlet, and the server refuses PINs from other outlets.',
  'Menu dan kasir': 'Menu and cashiers',
  'disiapkan dari browser, bahkan sebelum perangkat kasir ada. PIN diganti tanpa memegang perangkatnya.':
    'are set up from the browser, even before a cashier device exists. PINs change without touching the device.',
  Lonceng: 'Bell',
  'refund dan pengeluaran dari kasir muncul di sini, juga pengingat sebelum langganan berakhir.':
    'refunds and cashier expenses show up here, along with reminders before the subscription ends.',
  'Data usaha Anda saja.': 'Only your business data.',
  'Pemisahan antarbisnis dijaga di database, bukan hanya disembunyikan di layar.': 'Businesses are separated in the database, not just hidden on screen.',
  'Contoh tampilan backoffice': 'Sample backoffice view',
  'Ringkasan|menu': 'Summary',
  'Laporan|menu': 'Reports',
  'Outlet|menu': 'Outlets',
  'Kasir|menu': 'Cashiers',
  'Produk|menu': 'Products',
  'Pengeluaran|menu': 'Expenses',
  'Voucher|menu': 'Vouchers',
  Pengaturan: 'Settings',
  'Ringkasan · hari ini · semua outlet': 'Summary · today · all outlets',
  'data contoh': 'sample data',

  // Pricing
  'Satu harga per bisnis, bukan per perangkat.': 'One price per business, not per device.',
  'Semua paket berbayar berisi 1 outlet, 3 kasir, dan 100 produk per outlet.': 'Every paid plan includes 1 outlet, 3 cashiers, and 100 products per outlet.',
  Paket: 'Plan',
  Durasi: 'Duration',
  Harga: 'Price',
  'Setara per bulan': 'Per month',
  'Hemat dari bulanan': 'Saves vs monthly',
  Aksi: 'Action',
  Trial: 'Trial',
  Bulanan: 'Monthly',
  '6 bulan': '6 months',
  Tahunan: 'Annual',
  '3 hari': '3 days',
  '1 bulan': '1 month',
  '12 bulan': '12 months',
  Gratis: 'Free',
  'Bisnis baru, satu kali. 2 kasir, 40 produk per outlet.': 'New businesses, once. 2 cashiers, 40 products per outlet.',
  Daftar: 'Sign up',
  Pesan: 'Order',
  'Outlet tambahan {price} per bulan.': 'Extra outlets {price} per month.',
  'Dihitung proporsional dengan sisa masa aktif, dengan satu tanggal berakhir untuk semua outlet. Contoh: 3 outlet berarti 1 termasuk paket dan 2 tambahan, {total} per bulan.':
    'Prorated against the remaining time, with one expiry date for all outlets. Example: 3 outlets means 1 included in the plan and 2 extra, {total} per month.',
  'Pembayaran pertama lewat transfer bank, lalu kami aktifkan paket Anda. Perpanjangan menambah sisa waktu, tidak mulai dari hari bayar. Saat paket berakhir, aplikasi tetap terbuka tetapi fitur terkunci, dan data tidak dihapus.':
    'The first payment is by bank transfer, then we activate your plan. A renewal adds to the remaining time instead of starting on the payment day. When a plan ends, the app stays open with features locked, and no data is deleted.',

  // FAQ (the questions and answers live in content.ts)
  'Yang biasa ditanyakan pemilik kafe.': 'What cafe owners usually ask.',
  'Bisakah kasir membatalkan bill sendiri?': 'Can a cashier cancel a bill alone?',
  'Tidak untuk bill yang sudah dibayar. Void dan refund butuh kode persetujuan 6 digit dari pemilik, dan alasannya wajib diisi. Lima kali salah kode mengunci void selama 5 menit. Refund per item hanya untuk bill berumur sampai 24 jam, dan pemilik mendapat notifikasi di backoffice.':
    'Not for a bill that has been paid. Voids and refunds need a 6-digit approval code from the owner, and a reason is required. Five wrong codes lock voids for 5 minutes. Item refunds only work on bills up to 24 hours old, and the owner gets a notification in the backoffice.',
  'Bagaimana pengeluaran kasir dicatat?': 'How are cashier expenses recorded?',
  'Kasir mencatat di menu Shift: nama barang, jenis (operasional atau belanja), jumlah, harga, dan apakah uangnya dari laci. Yang dari laci langsung mengurangi kas yang seharusnya ada, jadi selisih tidak muncul gara-gara beli es batu. Pemilik mendapat notifikasi dan bisa mengoreksi catatannya di backoffice; kas dan selisih shift dihitung ulang.':
    'The cashier records it in the Shift menu: item name, type (operating or purchase), quantity, price, and whether the money came from the drawer. Drawer money lowers the expected cash at once, so a variance does not appear just because someone bought ice. The owner gets a notification and can correct the entry in the backoffice; cash and the shift variance are recalculated.',
  'Bagaimana laporan shift sampai ke saya?': 'How does the shift report reach me?',
  'Di akhir shift, kasir mengetuk Kirim ke WA. WhatsApp terbuka dengan laporan siap kirim dan kasir memilih penerimanya. Isinya penjualan setelah refund, setiap refund beserta alasannya, pengeluaran, kas, dan selisih. Laporan yang sama bisa dicetak ulang, dan angkanya juga ada di backoffice.':
    'At the end of the shift, the cashier taps Send to WA. WhatsApp opens with the report ready and the cashier picks the recipient. It holds sales after refunds, each refund with its reason, expenses, cash, and the variance. The same report can be reprinted, and the numbers are also in the backoffice.',
  'Bagaimana kalau internet mati di tengah jam ramai?': 'What if the internet drops during rush hour?',
  'Kasir tetap jualan. Bill masuk antrean di perangkat dengan nomor finalnya, struk tetap bisa dicetak, dan setiap bill terkirim tepat satu kali saat internet kembali. Buka dan tutup shift serta catat pengeluaran juga bisa offline. Memilih kasir (cek PIN), void, dan refund butuh internet.':
    'The cashier keeps selling. Bills wait in a queue on the device with their final number, the receipt still prints, and each bill is sent exactly once when the internet returns. Opening and closing a shift and recording expenses also work offline. Picking a cashier (PIN check), voids, and refunds need the internet.',
  'Syarat layanan': 'Terms of service',
  'Kebijakan privasi': 'Privacy policy',
  'Kembali ke beranda': 'Back to the home page',
  'Apakah satu HP bisa dipakai untuk beberapa outlet?': 'Can one phone serve several outlets?',
  'Tidak. Setiap HP terikat ke satu outlet yang dipilih sekali saat masuk pertama kali. Daftar kasirnya hanya berisi kasir outlet itu, dan server menolak PIN dari outlet lain. Untuk memindahkan HP, keluar akun lalu masuk lagi sebagai pemilik.':
    'No. Each phone is tied to one outlet, chosen once at first sign-in. Its cashier list only holds that outlet’s cashiers, and the server refuses PINs from other outlets. To move a phone, sign out and sign in again as the owner.',
  'Printer apa saja yang bisa dipakai?': 'Which printers work?',
  'Printer thermal Bluetooth ESC/POS dengan kertas 58 mm atau 80 mm, misalnya Epson, iware, taffware, nyk, atau odi. Satu pesanan bisa dicetak ke printer kasir, dapur, dan bar sekaligus. Logo, alamat, dan teks struk diatur per outlet.':
    'Bluetooth ESC/POS thermal printers with 58 mm or 80 mm paper, such as Epson, iware, taffware, nyk, or odi. One order can print to the cashier, kitchen, and bar printers at once. Logo, address, and receipt text are set per outlet.',
  'Apakah setiap kasir perlu akun sendiri?': 'Does every cashier need an account?',
  'Tidak. Kasir tidak punya email. Pemilik membuat kasir di backoffice dengan nama dan PIN 6 digit. Di aplikasi, kasir memilih namanya lalu mengetik PIN. Lima kali salah PIN mengunci kasir itu selama 5 menit.':
    'No. Cashiers have no email. The owner creates cashiers in the backoffice with a name and a 6-digit PIN. In the app, a cashier picks their name and types the PIN. Five wrong PINs lock that cashier for 5 minutes.',
  'Bisa bayar pelanggan dengan QRIS atau e-wallet?': 'Can customers pay with QRIS or e-wallets?',
  'Bisa, lewat QRIS milik outlet (termasuk dari e-wallet). Kasir mengonfirmasi setelah pembayaran berhasil; belum terhubung otomatis ke bank.':
    "Yes, through the outlet's own QRIS (e-wallets included). The cashier confirms once the payment succeeds; it is not linked to the bank automatically yet.",
  'Apa batasan selama trial 3 hari?': 'What are the limits during the 3-day trial?',
  'Satu outlet, dua kasir, dan 40 produk per outlet. Trial berlaku sekali untuk bisnis baru. Setelah 3 hari, pilih paket untuk membuka kunci; data yang sudah Anda isi tetap ada.':
    'One outlet, two cashiers, and 40 products per outlet. The trial applies once, to new businesses. After 3 days, choose a plan to unlock; the data you entered stays.',
  'Apa yang terjadi saat langganan berakhir?': 'What happens when the subscription ends?',
  'Aplikasi dan backoffice tetap bisa dibuka, tetapi penjualan baru, shift baru, dan penambahan kasir atau produk terkunci. Laporan dan riwayat tetap bisa dilihat. Data tidak dihapus.':
    'The app and backoffice still open, but new sales, new shifts, and adding cashiers or products are locked. Reports and history stay visible. No data is deleted.',

  // Closing
  'Coba tiga hari di kafe Anda.': 'Try it for three days at your cafe.',
  'Saya sudah punya akun': 'I already have an account',
  'Ringkasan pesanan trial': 'Trial order summary',
  'Pesanan Anda': 'Your order',
  'Produk per outlet': 'Products per outlet',
  'Rekening pembayaran paket': 'Bank account for plan payments',
};
