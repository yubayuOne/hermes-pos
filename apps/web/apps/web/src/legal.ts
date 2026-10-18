import { SITE } from './content';

/**
 * Terms of service and privacy policy, Indonesian and English. Kept as whole documents per language instead of
 * dictionary keys: legal text is read and revised as a document, and a sentence-by-sentence dictionary would let the
 * two versions drift. Every statement describes what the apps and the database really do (owner's request, 18 Oct
 * 2026). Draft: to be checked by the owner or a lawyer before it is relied on.
 */
export type LegalDoc = { title: string; updated: string; intro: string; sections: { h: string; p: string[] }[] };

const contact = `WhatsApp ${SITE.whatsapp} atau email ${SITE.email}`;
const contactEn = `WhatsApp ${SITE.whatsapp} or email ${SITE.email}`;

export const TERMS: Record<'id' | 'en', LegalDoc> = {
  id: {
    title: 'Syarat Layanan',
    updated: 'Berlaku sejak 18 Oktober 2026',
    intro:
      'Syarat ini mengatur pemakaian Hermes POS: aplikasi kasir Android, backoffice di backoffice.hermes-pos.com, dan situs hermes-pos.com. Dengan membuat akun, Anda menyetujui syarat ini.',
    sections: [
      {
        h: '1. Layanan',
        p: [
          'Hermes POS membantu kafe dan restoran kecil mencatat penjualan, shift, kas laci, pengeluaran, voucher, dan laporan. Pemilik mengelola bisnis lewat backoffice; kasir berjualan lewat aplikasi Android dengan akun pemilik dan PIN kasir masing-masing.',
          'Hermes POS adalah alat pencatatan. Hermes POS bukan penyedia pembayaran: pembayaran QRIS terjadi di QRIS milik outlet Anda dan dikonfirmasi oleh kasir, bukan diproses oleh kami.',
        ],
      },
      {
        h: '2. Akun',
        p: [
          'Satu akun pemilik untuk satu bisnis. Anda bertanggung jawab menjaga kata sandi akun, PIN kasir, dan kode persetujuan void, serta atas semua yang dilakukan dengan akun dan PIN tersebut.',
          'Data yang Anda isikan saat mendaftar harus benar. Kami dapat menangguhkan akun yang memakai data palsu atau dipakai melanggar hukum.',
        ],
      },
      {
        h: '3. Trial dan paket',
        p: [
          'Bisnis baru mendapat trial 3 hari satu kali, dengan batas satu outlet, dua kasir, dan 40 produk per outlet.',
          'Setelah trial, layanan berlanjut dengan paket berbayar (Bulanan, 6 bulan, atau Tahunan) dengan harga yang tertera di hermes-pos.com saat pembelian. Outlet tambahan ditagih per bulan.',
          'Pembayaran dilakukan dengan transfer bank ke rekening yang tertera di backoffice. Kami memeriksa setiap transfer secara manual; masa aktif ditambahkan setelah transfer terverifikasi. Perpanjangan menambah sisa waktu, jadi tidak ada hari yang hilang.',
          'Paket yang sudah aktif tidak dapat dikembalikan dananya, kecuali kami gagal mengaktifkan paket setelah transfer terverifikasi atau terjadi kesalahan tagihan dari pihak kami.',
        ],
      },
      {
        h: '4. Saat langganan berakhir',
        p: [
          'Aplikasi dan backoffice tetap bisa dibuka. Penjualan baru, shift baru, dan penambahan outlet, kasir, atau produk terkunci sampai paket diperpanjang. Laporan dan riwayat tetap bisa dilihat. Data tidak dihapus karena langganan berakhir.',
        ],
      },
      {
        h: '5. Data Anda',
        p: [
          'Data bisnis, menu, transaksi, dan laporan adalah milik Anda. Kami memakainya hanya untuk menjalankan layanan, sebagaimana dijelaskan di Kebijakan Privasi.',
          'Anda bertanggung jawab atas data yang Anda masukkan, termasuk nama pelanggan atau nomor meja yang dicatat kasir.',
        ],
      },
      {
        h: '6. Pemakaian yang dilarang',
        p: [
          'Anda tidak boleh memakai Hermes POS untuk kegiatan yang melanggar hukum, mencoba masuk ke data bisnis lain, mengganggu atau membebani layanan secara sengaja, membongkar atau memodifikasi aplikasi untuk melewati batasan paket, atau menjual kembali layanan tanpa izin tertulis dari kami.',
        ],
      },
      {
        h: '7. Ketersediaan dan perubahan layanan',
        p: [
          'Kami berusaha menjaga layanan tetap berjalan, tetapi tidak menjamin layanan selalu tersedia tanpa gangguan. Aplikasi kasir tetap mencatat penjualan saat internet putus dan mengirimnya saat internet kembali; beberapa fungsi (memilih kasir, void, dan refund) butuh internet.',
          'Kami dapat memperbarui aplikasi, fitur, dan harga. Perubahan harga tidak berlaku untuk masa aktif yang sudah dibayar.',
        ],
      },
      {
        h: '8. Batas tanggung jawab',
        p: [
          'Angka di Hermes POS dihitung dari data yang dicatat di aplikasi. Periksa laporan Anda secara berkala, terutama pembayaran QRIS yang dikonfirmasi manual oleh kasir. Sejauh diizinkan hukum, kami tidak bertanggung jawab atas kerugian tidak langsung, kehilangan keuntungan, atau kerugian akibat kesalahan pencatatan, penyalahgunaan PIN atau kata sandi, perangkat yang rusak atau hilang, maupun gangguan printer dan jaringan. Tanggung jawab kami paling banyak sebesar biaya langganan yang Anda bayar dalam 3 bulan terakhir.',
        ],
      },
      {
        h: '9. Mengakhiri layanan',
        p: [
          `Anda dapat berhenti memakai layanan kapan saja. Untuk menghapus akun dan data bisnis, hubungi kami lewat ${contact}. Kami dapat menangguhkan atau mengakhiri akun yang melanggar syarat ini.`,
        ],
      },
      {
        h: '10. Hukum yang berlaku dan perubahan syarat',
        p: [
          'Syarat ini tunduk pada hukum Republik Indonesia. Perselisihan diselesaikan lebih dulu secara musyawarah.',
          'Kami dapat mengubah syarat ini. Perubahan penting diberitahukan lewat backoffice atau email sebelum berlaku. Tanggal berlaku di atas selalu menunjukkan versi terbaru.',
        ],
      },
      { h: '11. Kontak', p: [`Pertanyaan tentang syarat ini: ${contact}.`] },
    ],
  },
  en: {
    title: 'Terms of Service',
    updated: 'Effective 18 October 2026',
    intro:
      'These terms govern the use of Hermes POS: the Android cashier app, the backoffice at backoffice.hermes-pos.com, and the website hermes-pos.com. By creating an account you accept these terms.',
    sections: [
      {
        h: '1. The service',
        p: [
          'Hermes POS helps cafés and small restaurants record sales, shifts, the cash drawer, expenses, vouchers, and reports. The owner runs the business from the backoffice; cashiers sell in the Android app with the owner account and their own cashier PIN.',
          'Hermes POS is a record-keeping tool, not a payment provider: QRIS payments go through your outlet’s own QRIS and are confirmed by the cashier; we do not process them.',
        ],
      },
      {
        h: '2. Your account',
        p: [
          'One owner account per business. You are responsible for keeping the account password, cashier PINs, and the void approval code safe, and for everything done with them.',
          'The details you give when signing up must be true. We may suspend an account that uses false details or is used unlawfully.',
        ],
      },
      {
        h: '3. Trial and plans',
        p: [
          'A new business gets one 3-day trial, limited to one outlet, two cashiers, and 40 products per outlet.',
          'After the trial the service continues on a paid plan (Monthly, 6 months, or Annual) at the price shown on hermes-pos.com at the time of purchase. Extra outlets are billed per month.',
          'Payment is by bank transfer to the account shown in the backoffice. We check every transfer by hand; time is added once the transfer is verified. A renewal adds to the time left, so no days are lost.',
          'An active plan is not refundable, unless we fail to activate a plan after a verified transfer or we made a billing error.',
        ],
      },
      {
        h: '4. When a subscription ends',
        p: [
          'The app and the backoffice still open. New sales, new shifts, and adding outlets, cashiers, or products are locked until the plan is renewed. Reports and history stay readable. No data is deleted because a subscription ended.',
        ],
      },
      {
        h: '5. Your data',
        p: [
          'Your business data, menu, transactions, and reports belong to you. We use them only to run the service, as described in the Privacy Policy.',
          'You are responsible for the data you enter, including customer names or table numbers recorded by cashiers.',
        ],
      },
      {
        h: '6. What you may not do',
        p: [
          'Do not use Hermes POS for unlawful activity, try to reach another business’s data, deliberately disrupt or overload the service, take apart or modify the app to get around plan limits, or resell the service without our written permission.',
        ],
      },
      {
        h: '7. Availability and changes',
        p: [
          'We work to keep the service running but do not promise it is always available without interruption. The cashier app keeps recording sales while the internet is down and sends them when it returns; some functions (picking a cashier, voids, and refunds) need internet.',
          'We may update the app, features, and prices. A price change does not apply to time already paid for.',
        ],
      },
      {
        h: '8. Limitation of liability',
        p: [
          'The figures in Hermes POS come from what is recorded in the app. Check your reports regularly, especially QRIS payments confirmed by hand by cashiers. As far as the law allows, we are not liable for indirect loss, lost profit, or loss caused by recording mistakes, misuse of a PIN or password, broken or lost devices, or printer and network problems. Our liability is at most the subscription fees you paid in the last 3 months.',
        ],
      },
      {
        h: '9. Ending the service',
        p: [
          `You may stop using the service at any time. To delete your account and business data, contact us by ${contactEn}. We may suspend or end an account that breaks these terms.`,
        ],
      },
      {
        h: '10. Governing law and changes',
        p: [
          'These terms are governed by the laws of the Republic of Indonesia. Disputes are first settled by discussion.',
          'We may change these terms. Important changes are announced in the backoffice or by email before they apply. The date above always shows the current version.',
        ],
      },
      { h: '11. Contact', p: [`Questions about these terms: ${contactEn}.`] },
    ],
  },
};

export const PRIVACY: Record<'id' | 'en', LegalDoc> = {
  id: {
    title: 'Kebijakan Privasi',
    updated: 'Berlaku sejak 18 Oktober 2026',
    intro:
      'Kebijakan ini menjelaskan data apa yang dikumpulkan Hermes POS, untuk apa, di mana disimpan, dan hak Anda atasnya, sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi.',
    sections: [
      {
        h: '1. Data yang kami kumpulkan',
        p: [
          'Akun pemilik: nama lengkap, username, email, nomor WhatsApp (opsional), dan kata sandi. Kata sandi disimpan sebagai hash oleh layanan autentikasi; kami tidak dapat membacanya.',
          'Bisnis dan outlet: nama bisnis, jenis usaha, kota, zona waktu, nama, alamat, dan telepon outlet, logo, serta teks struk.',
          'Kasir: nama kasir dan PIN 6 digit. PIN disimpan sebagai hash dan tidak pernah dikirim ke perangkat.',
          'Operasional: produk dan harga, bill beserta itemnya, catatan item, diskon, voucher, void dan refund beserta alasannya, shift, kas laci, dan pengeluaran. Nama pelanggan dan nomor meja hanya dicatat kalau kasir mengisinya.',
          'Pembayaran langganan: nama pengirim, bank asal, tanggal, jumlah transfer, dan catatan yang Anda isi saat konfirmasi.',
          'Perangkat: ID acak yang dibuat aplikasi saat dipasang dan kode terminal per outlet, untuk mengikat shift ke HP yang membukanya dan memberi nomor bill. Kami tidak mengambil lokasi, kontak, foto galeri, atau data pribadi lain di HP.',
        ],
      },
      {
        h: '2. Untuk apa data dipakai',
        p: [
          'Menjalankan layanan: masuk ke akun, mencatat penjualan, menghitung kas, menyusun laporan, mengirim notifikasi di backoffice dan aplikasi, serta memeriksa pembayaran langganan.',
          'Menjaga keamanan: membatasi percobaan masuk dan PIN yang salah, serta memisahkan data antarbisnis.',
          'Menghubungi Anda soal akun dan langganan. Kami tidak memakai data Anda untuk iklan dan tidak menjualnya.',
        ],
      },
      {
        h: '3. Cookie dan penyimpanan di browser',
        p: [
          'Backoffice memakai cookie HttpOnly untuk menjaga sesi masuk. Situs dan backoffice menyimpan pilihan bahasa di cookie dan penyimpanan browser. Kami tidak memakai cookie iklan atau alat analitik pihak ketiga.',
        ],
      },
      {
        h: '4. Di mana data disimpan dan siapa yang memprosesnya',
        p: [
          'Data disimpan di Supabase (basis data, autentikasi, dan penyimpanan berkas seperti logo outlet), yang bertindak sebagai pemroses data untuk kami. Situs dan backoffice dijalankan di penyedia hosting web, dan email akun (verifikasi dan atur ulang kata sandi) dikirim lewat penyedia layanan email. Pemroses ini hanya memproses data untuk menjalankan layanan.',
          'Server penyedia tersebut dapat berada di luar Indonesia. Kami memilih penyedia yang menerapkan pelindungan data yang layak.',
          'Aplikasi kasir menyimpan salinan katalog, shift, dan antrean penjualan offline di HP, supaya tetap bisa dipakai saat internet putus. Salinan ini dihapus saat akun keluar dari HP, kecuali antrean yang belum terkirim.',
          'Saat kasir mengetuk Kirim ke WA, laporan shift dibuka di WhatsApp di HP itu dan dikirim oleh kasir sendiri; kami tidak membaca pesan WhatsApp.',
        ],
      },
      {
        h: '5. Keamanan',
        p: [
          'Koneksi memakai HTTPS. Setiap bisnis hanya dapat membaca datanya sendiri, dan perubahan data selalu diperiksa di server. Sesi aplikasi kasir disimpan di penyimpanan aman perangkat. Tidak ada sistem yang sepenuhnya bebas risiko; jaga kata sandi dan PIN Anda, dan beri tahu kami bila menduga akun Anda disalahgunakan.',
        ],
      },
      {
        h: '6. Berapa lama data disimpan',
        p: [
          'Data akun dan bisnis disimpan selama akun aktif, termasuk setelah langganan berakhir, supaya Anda dapat melanjutkan kapan saja. Notifikasi yang sudah dibaca dihapus setelah 90 hari. Kunci teknis untuk mencegah transaksi ganda dihapus setelah 90 hari.',
          'Kalau Anda meminta akun dihapus, kami menghapus data akun dan bisnis, kecuali yang wajib kami simpan menurut hukum, misalnya catatan pembayaran langganan.',
        ],
      },
      {
        h: '7. Hak Anda',
        p: [
          `Anda berhak meminta akses ke data pribadi Anda, membetulkannya, menghapusnya, menarik persetujuan, dan meminta salinannya. Sebagian besar dapat Anda ubah sendiri di Pengaturan. Untuk permintaan lain, hubungi kami lewat ${contact}; kami menanggapinya dalam waktu yang wajar dan paling lama sesuai ketentuan hukum yang berlaku.`,
          'Kalau Anda mencatat data pelanggan (misalnya nama), Anda yang bertanggung jawab atas dasar pemrosesannya terhadap pelanggan tersebut.',
        ],
      },
      {
        h: '8. Anak-anak',
        p: ['Hermes POS ditujukan untuk pelaku usaha. Akun pemilik harus dibuat oleh orang dewasa yang berwenang mewakili bisnisnya.'],
      },
      {
        h: '9. Perubahan kebijakan',
        p: ['Kami dapat mengubah kebijakan ini. Perubahan penting diberitahukan lewat backoffice atau email sebelum berlaku.'],
      },
      { h: '10. Kontak', p: [`Pertanyaan atau permintaan tentang data pribadi: ${contact}.`] },
    ],
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Effective 18 October 2026',
    intro:
      'This policy explains what data Hermes POS collects, why, where it is kept, and your rights over it, in line with Indonesian Law No. 27 of 2022 on Personal Data Protection.',
    sections: [
      {
        h: '1. Data we collect',
        p: [
          'Owner account: full name, username, email, WhatsApp number (optional), and password. The password is stored as a hash by the authentication service; we cannot read it.',
          'Business and outlets: business name, type, city, time zone, outlet name, address, and phone, logo, and receipt text.',
          'Cashiers: cashier name and 6-digit PIN. The PIN is stored as a hash and is never sent to devices.',
          'Operations: products and prices, bills and their items, item notes, discounts, vouchers, voids and refunds with their reasons, shifts, the cash drawer, and expenses. Customer names and table numbers are recorded only when the cashier enters them.',
          'Subscription payments: sender name, bank, date, amount transferred, and the note you enter when confirming.',
          'Device: a random ID made by the app at install and a terminal code per outlet, to tie a shift to the phone that opened it and to number bills. We do not collect location, contacts, gallery photos, or other personal data on the phone.',
        ],
      },
      {
        h: '2. How we use it',
        p: [
          'To run the service: sign-in, recording sales, computing cash, building reports, sending notifications in the backoffice and the app, and checking subscription payments.',
          'To keep it secure: limiting wrong sign-in and PIN attempts and keeping businesses apart.',
          'To contact you about your account and subscription. We do not use your data for advertising and do not sell it.',
        ],
      },
      {
        h: '3. Cookies and browser storage',
        p: [
          'The backoffice uses HttpOnly cookies to keep you signed in. The website and the backoffice store your language choice in a cookie and in browser storage. We use no advertising cookies and no third-party analytics.',
        ],
      },
      {
        h: '4. Where data is kept and who processes it',
        p: [
          'Data is kept in Supabase (database, authentication, and file storage such as outlet logos), which acts as our data processor. The website and the backoffice run on a web hosting provider, and account emails (verification and password reset) are sent through an email service. These processors handle data only to run the service.',
          'Their servers may be outside Indonesia. We choose providers that apply appropriate data protection.',
          'The cashier app keeps a copy of the catalog, shifts, and the offline sales queue on the phone so it works when the internet is down. The copy is removed when the account signs out on that phone, except queue entries not yet sent.',
          'When a cashier taps Kirim ke WA, the shift report opens in WhatsApp on that phone and the cashier sends it; we do not read WhatsApp messages.',
        ],
      },
      {
        h: '5. Security',
        p: [
          'Connections use HTTPS. Each business can read only its own data, and every change is checked on the server. The cashier app keeps its session in the device’s secure storage. No system is free of risk; keep your password and PINs safe and tell us if you suspect your account is misused.',
        ],
      },
      {
        h: '6. How long we keep data',
        p: [
          'Account and business data is kept while the account exists, including after a subscription ends, so you can continue at any time. Read notifications are deleted after 90 days. Technical keys that prevent duplicate transactions are deleted after 90 days.',
          'If you ask us to delete your account, we delete the account and business data, except what the law requires us to keep, such as subscription payment records.',
        ],
      },
      {
        h: '7. Your rights',
        p: [
          `You may ask to access, correct, or delete your personal data, withdraw consent, and get a copy of it. Most of it you can change yourself in Settings. For anything else, contact us by ${contactEn}; we respond within a reasonable time and no later than the law requires.`,
          'If you record customer data (such as a name), you are responsible for the basis on which you process it towards that customer.',
        ],
      },
      {
        h: '8. Children',
        p: ['Hermes POS is meant for businesses. An owner account must be created by an adult authorised to act for the business.'],
      },
      {
        h: '9. Changes to this policy',
        p: ['We may change this policy. Important changes are announced in the backoffice or by email before they apply.'],
      },
      { h: '10. Contact', p: [`Questions or requests about personal data: ${contactEn}.`] },
    ],
  },
};
