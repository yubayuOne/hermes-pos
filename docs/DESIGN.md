# DESIGN.md · HERMES POS

Spesifikasi desain lengkap untuk **Landing Page**, **Backoffice**, dan **aplikasi POS Android** HERMES POS, beserta komponen bersama, halaman pendukung, dan laporan ekspor.

| | |
|---|---|
| Produk | POS langganan untuk kafe dan restoran kecil di Indonesia |
| Target rilis | 17 Okt 2026 |
| Versi dokumen | 2.1 · 12 Okt 2026 (tambah bagian I, aplikasi POS) |
| Sumber kebenaran | papan `.dc.html` di artifact Design "HERMES POS Landing Page & Backoffice" |
| Bahasa antarmuka | Indonesia (utama), English |

Kalau dokumen ini bertentangan dengan kode, dokumen ini yang benar dan kodenya yang diperbaiki. Kalau keputusan desain berubah, ubah dokumen ini dulu.

---

## Daftar isi

- **A. Fondasi**
  1. Arah dan prinsip
  2. Warna
  3. Tipografi
  4. Ruang, grid, dan bentuk
  5. Gerak
  6. Ikon dan ilustrasi
  7. Aksesibilitas
  8. Bahasa dan penulisan
- **B. Komponen**
- **C. Landing Page**
- **D. Backoffice**
- **E. Halaman pendukung**: Masuk, Daftar, Data awal, Checkout, 404, 500
- **F. Laporan ekspor (PDF dan DOCX)**
- **G. Alur dan papan**
- **H. Catatan serah terima**: placeholder, data contoh, hal terbuka, checklist QA
- **I. Aplikasi POS (Android)**: aturan kasir, kerangka, komponen, layar per layar, status, perubahan dari aplikasi lama, token NativeWind

---

# A. Fondasi

## 1. Arah dan prinsip

**Karakter:** brutalisme yang tenang. Garis tegas, sudut kecil, dan bayangan keras tanpa blur, tetapi ruangnya lega dan warnanya kalem. Tidak ada gradien dekoratif, glassmorphism, atau ikon berkilau.

**Motif identitas:** struk kasir. Kertas putih tulang, garis putus-putus, tepi bawah sobek, dan angka mono rata kanan. Motif ini muncul di hero landing, mockup fitur, pratinjau struk di Pengaturan, laporan harian, faktur Checkout, dan halaman galat.

**Dial antislop:**

| Permukaan | ENERGY | RHYTHM | MOTION | Alasan |
|---|---|---|---|---|
| Landing | 2 | 3 | 1 | Perlu menarik perhatian, komposisinya bergantian per jam kerja |
| Backoffice | 1 | 2 | 1 | Alat kerja harian, harus tenang dan bisa dipindai cepat |
| Laporan ekspor | 1 | 1 | 0 | Dokumen formal untuk dicetak |

**Empat prinsip** dan cara menerapkannya:

| Prinsip | Aturan |
|---|---|
| Simplicity | Satu tugas per layar. Satu tombol utama per layar. Informasi pendukung masuk catatan kecil, bukan kartu baru. |
| Consistency | Semua nilai lewat token. Satu tinggi tombol, satu radius, satu gaya spidol, satu pola penanda langkah. |
| Visual hierarchy | Satu titik fokus per layar: angka utama atau judul. Oranye hanya di satu tempat penting. |
| Feedback | Setiap aksi punya respons yang terlihat: hover, fokus, proses, sukses, galat, dan batalkan untuk aksi yang bisa dibalik. |

## 2. Warna

Semua warna dipakai lewat variabel CSS yang didefinisikan di `:root` setiap papan. Jangan menulis kode hex langsung di komponen.

| Token | Hex | Peran |
|---|---|---|
| `--paper` | #EEF0EA | latar halaman, sidebar |
| `--slip` | #FBFBF8 | kartu, struk, isian, dialog |
| `--ink` | #101412 | teks utama, garis, bayangan keras |
| `--mute` | #555A50 | teks sekunder, label |
| `--line` | #CBD0C3 | garis tipis di landing dan di dalam kartu |
| `--pine` | #0E3B2F | warna solid kedua: terpilih, aktif, batang grafik, tombol simpan, bidang gelap |
| `--pine-hover` | #17503F | hover pine |
| `--pine-soft` | #DDEBE2 | tint sukses dan terpilih, toast sukses |
| `--pine-line` | #3F6A5C | garis di atas bidang pine |
| `--pine-text` | #C9D6CF | teks redup di atas bidang pine |
| `--fire` | #FF6A13 | aksen tunggal: tombol utama, angka puncak, spidol, cincin fokus, kotak navigasi aktif |
| `--fire-hover` | #FF8440 | hover fire |
| `--fire-soft` | #FFE6D3 | tint peringatan: tag "data contoh", banner langganan, toast galat |
| `--tint` | #E3E6DC | hover permukaan, panel samping |
| `--tint-2` | #E1E4DA | track progres, isian nonaktif, pemisah baris di daftar |
| `--tint-3` | #F1F3EB | hover baris tabel |
| `--rule` | #D9DDD0 | pemisah baris tabel |
| `--off` | #D8DBD0 | sakelar mati |
| `--disabled-line` | #C3C8BA | garis elemen nonaktif, titik notifikasi sudah dibaca |
| `--error` | #8A2A0C | teks galat |
| `--error-line` | #B3320A | garis isian galat |
| `--error-soft` | #FFF3EA | latar isian galat |

**Aturan pemakaian**
- **Oranye maksimal satu blok penuh per layar**, biasanya tombol utama. Selebihnya hanya penanda kecil: kotak navigasi aktif, satu batang puncak di grafik, spidol pada satu frasa atau angka.
- Teks di atas oranye selalu `--ink`, tidak pernah putih.
- Backoffice tidak memakai blok hitam besar. Bidang gelap memakai `--pine`.
- Status tidak boleh disampaikan lewat warna saja. Selalu ada label teks seperti "Aktif", "Habis", atau "Lunas".
- Warna status: sukses dan terpilih memakai pine dan pine-soft, peringatan memakai fire-soft, galat memakai error.

**Kontras yang sudah diuji (WCAG)**

| Teks | Latar | Rasio | Hasil |
|---|---|---|---|
| mute | paper | 6,17 | AA |
| mute | slip | 6,83 | AA |
| mute | fire-soft | 5,91 | AA |
| mute | tint | 5,61 | AA |
| ink | fire | 6,48 | AA |
| paper | pine | 10,85 | AAA |
| pine-text | pine | 8,31 | AAA |
| error | error-soft | 7,97 | AAA |

## 3. Tipografi

| Peran | Font | Bobot | Aturan |
|---|---|---|---|
| Display | Bricolage Grotesque | 800 | judul halaman, judul kartu, angka besar. `letter-spacing:-0.035em`, `line-height:.98`, `text-wrap:balance` |
| Teks | Instrument Sans | 400 sampai 700 | isi, label, tombol |
| Data | IBM Plex Mono | 400 sampai 600 | angka, kode, label kecil, isi struk. Selalu `font-variant-numeric:tabular-nums` |

Ketiganya dimuat dari Google Fonts dengan fallback `system-ui, sans-serif` dan `ui-monospace, monospace`.

**Skala ukuran**

| Token ukuran | Landing | Backoffice | Dipakai untuk |
|---|---|---|---|
| Isi | 18px / 1.6 | 16px / 1.5 | paragraf |
| Kecil | 15 sampai 16px | 14 sampai 15px | teks pendukung |
| Label mono | 13px | 13 sampai 14px | label, tag, meta |
| Judul kartu | 28 sampai 36px | 24px | h2 dan h3 di kartu |
| Judul halaman | clamp(36px, 4.4vw, 64px) | clamp(38px, 4.4vw, 60px) | h1 dan h2 utama |
| Hero | clamp(46px, 6.8vw, 104px) | | judul landing |
| Angka utama | | clamp(46px, 6.2vw, 92px) | penjualan Ringkasan, total Pengeluaran |

Teks paling kecil adalah 13px. Huruf besar hanya dipakai di judul kolom tabel (mono 13px, `letter-spacing:.04em`) dan kepala struk.

## 4. Ruang, grid, dan bentuk

- **Skala spasi:** kelipatan 4 (4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 72, 96, 120).
- **Radius:** 4px untuk semua komponen. Tidak ada bentuk pil.
- **Garis:** 1.5px `--ink` untuk komponen. 1px `--line` atau `--rule` untuk pemisah. 1px putus-putus `--ink` untuk pemisah di dalam struk.
- **Bayangan:** hanya bayangan keras offset, tanpa blur.
  - 3px saat hover di tombol (tombol naik 2px).
  - 4px untuk panel notifikasi dan kartu masuk di ponsel.
  - 6px untuk dialog, laci menu, dan kartu masuk di desktop.
- **Struk sobek:** `.torn::after`, dua gradien 135° dan 225° berukuran 16px di tepi bawah.

**Lebar dan gutter**

| | Landing | Backoffice |
|---|---|---|
| Kontainer | `.wrap` maks 1200px | sidebar 264px + konten fleksibel |
| Gutter desktop | 32px | padding konten 30px 40px 72px |
| Gutter ≤ 980px | 32px | sidebar 232px, padding 24px 20px |
| Gutter ≤ 760px | 20px (≤ 620px) | 22px 16px |

**Grid yang dipakai**

| Kelas | Kolom | Dipakai di |
|---|---|---|
| `.g12` | 7fr / 5fr, gap 20px | Ringkasan, Pengeluaran, Profil, Bisnis dan struk, Langganan |
| `.g2` | 1fr / 1fr, gap 20px | isian berpasangan, keputusan dan rencana |
| `.g3` | auto-fit min 300px | Per outlet, Per kasir, Produk terlaris |
| `.hero` | 7fr / 5fr, gap 64px | hero landing |
| `.log` | 150px + 1fr (isi 5fr / 6fr) | bagian Satu hari kerja |
| `.bo` | 5fr / 6fr, gap 72px | bagian Backoffice di landing |

## 5. Gerak

Easing standar: `cubic-bezier(.2,.8,.2,1)`. Gerak hanya untuk menunjukkan sebab dan akibat atau urutan baca.

| Nama | Durasi | Dipakai untuk |
|---|---|---|
| hover, tekan | 0.12 sampai 0.2s | tombol, baris, menu |
| `rise` | 0.45 sampai 0.5s, jeda 0.05 sampai 0.07s per item | kartu dan baris tabel masuk |
| `pop` | 0.2 sampai 0.35s | dialog, panel notifikasi, kartu masuk |
| `grow` / `growx` | 0.7 sampai 0.8s | batang grafik, batang daftar |
| `sweep` | 0.9s, jeda 0.25s | spidol oranye |
| `feed` | 1.6s | struk keluar dari printer di hero landing |
| `shim` | 1.3s berulang | skeleton memuat |
| laci menu | 0.26s | sidebar ponsel |

`prefers-reduced-motion: reduce` mematikan semua animasi dan transisi. Spidol langsung tampil penuh.

## 6. Ikon dan ilustrasi

- **Tidak memakai pustaka ikon.** Hanya ada empat ikon SVG buatan sendiri: lonceng notifikasi, silang tutup, tiga garis hamburger, dan pensil 16px. Semuanya memakai garis 2px `--ink`. Pensil ditaruh setelah nama yang membuka dialog ubah (bill di Transaksi, produk, kode voucher), supaya jelas nama itu bisa diklik.
- **Ilustrasi adalah antarmuka produk itu sendiri:** struk, tiket dapur, antrean offline, buku kas, laporan harian, dan mockup Backoffice. Tidak ada gambar stok, maskot, atau ilustrasi orang.
- **Logo:** wordmark "hermes pos" huruf kecil dengan Bricolage 800. Belum ada simbol. Logo bisnis pengguna hanya muncul di struk dan laporan, sebagai placeholder `[LOGO]` sampai diunggah.

## 7. Aksesibilitas

- **Kontras:** minimal AA untuk semua teks (tabel di bagian 2).
- **Fokus:** garis luar 3px `--fire` dengan offset 2px di semua elemen interaktif, dan tidak pernah dihapus.
- **Target sentuh:** minimal 44×44px. Tombol biasa 48px.
- **Dialog dan laci:**
  - Fokus masuk ke elemen pertama.
  - Tab tidak bisa keluar dari dialog.
  - Esc menutup atau kembali ke dialog sebelumnya.
  - Saat ditutup, fokus kembali ke pemicunya.
- **Label:**
  - Setiap isian punya label yang terlihat.
  - Tombol yang hanya berisi ikon punya `aria-label`.
  - Sakelar memakai `role="switch"` dan `aria-checked`.
  - Pilihan bergaya chip memakai `aria-pressed`.
- **Galat:** muncul di bawah kolomnya dengan `role="alert"`, kolomnya diberi `aria-invalid`, dan galat hilang begitu isiannya diubah.
- **Status dan landmark:**
  - Pemberitahuan toast, banner, dan skeleton memakai `role="status"`.
  - Skeleton punya teks tersembunyi "Memuat data...".
  - Halaman memakai landmark `header`, `nav`, `main`, dan `aside` dengan `aria-label` yang jelas.

## 8. Bahasa dan penulisan

**Suara:** lugas, praktis, seperti pemilik kafe yang menjelaskan ke rekannya. Kalimat pendek. Fakta dulu, lalu manfaatnya.

**Aturan**
- **Tanpa em dash.** Pakai koma, titik, titik dua, atau kurung.
- **Tanpa kata pemasaran kosong**, seperti "revolusioner", "seamless", atau "AI powered".
- **Label tombol menyebut aksinya:** "Catat pengeluaran", "Pilih paket dan bayar", "Simpan struk dan pajak". Jangan "Kirim" atau "Lanjutkan" kalau maknanya bisa lebih jelas.
- **Galat menyebut cara memperbaikinya:** "Isi nama pengirim sesuai nama di rekening."
- **Data yang belum ada ditulis sebagai placeholder dalam kurung siku** (bagian H). Data sampel diberi label "data contoh" atau "contoh".
- **Tidak ada testimoni, statistik pengguna, atau klaim keamanan tanpa sumber.**
- **Fitur yang belum rilis diberi tag "segera hadir"**, misalnya Laporan harian otomatis dan insight.

**Format**

| | Indonesia | English |
|---|---|---|
| Rupiah | Rp4.280.000 | Rp4.280.000 (sama, karena angka dihitung dengan format ini) |
| Tanggal | Min, 11 Okt 2026 | Sun, 11 Oct 2026 |
| Jam | 13.05 | 13.05 |
| Desimal | 63,9% | 63.9% (di laporan) |
| Rentang | 5 sampai 11 Okt 2026 | 5 to 11 Oct 2026 |

**Dua bahasa (ID | EN)**
- **Tombol:** tombol **ID | EN** ada di header setiap papan. Pilihan disimpan di `localStorage` dengan kunci `hermes-pos-lang`, dan setiap papan juga punya prop Pratinjau `lang`.
- **Kamus:** teks markup disimpan di kamus `I18N_TX` per papan, terjemahannya di `I18N_EN`. Kalimat yang dirangkai JavaScript diterjemahkan lewat `I18N_RULES`.
- **Data pengguna tidak diterjemahkan**, misalnya teks bawah struk dan nama produk yang diketik pemilik.
- **Teks diubah lewat kamus**, jangan langsung di markup, supaya versi ID dan EN tetap sejajar.

---

# B. Komponen

### Tombol `.btn`

Tinggi 48px, padding 0 20 sampai 24px, garis 1.5px ink, radius 4px, font 600.

| Varian | Dipakai untuk | Default | Hover | Tekan | Nonaktif |
|---|---|---|---|---|---|
| `btn-fire` | satu aksi utama per layar | fire, teks ink | fire-hover, naik 2px, bayangan 3px | kembali rata | tint-2, teks mute, garis disabled-line |
| `btn-ink` | simpan, aksi solid kedua | pine, teks paper | pine-hover, naik 2px | kembali rata | sama |
| `btn` | aksi sekunder | slip, garis ink | tint-2, naik 2px | kembali rata | sama |
| `btn-ghost` | aksi tersier, tautan | transparan, garis bawah 2px | tint | | |
| `btn-sm` (landing) | header, tabel harga | tinggi 44px, font 15px | | | |

Saat proses berjalan, labelnya berubah, misalnya "Mengirim...", "Menyusun laporan...", atau "Mencoba lagi...". Tombol dinonaktifkan sampai selesai supaya tidak terkirim dua kali.

### Chip dan tab `.chipb` / `.chip`

- Tinggi 44px, padding 0 14 sampai 16px, gaya `.btn`.
- Terpilih: latar pine, teks paper, tetap pine saat hover, `aria-pressed="true"`.
- Dipakai untuk periode, kategori, jenis usaha, sumber dana, format ekspor, bahasa, dan tab Pengaturan.

### Isian `.in`

- Tinggi 46 sampai 48px, garis 1.5px ink, radius 4px, latar slip, font 500.
- Label `.fld` di atasnya: 14px, 600, gap 6px. Bagian "(opsional)" ditulis sebaris dengan label, 400, warna mute.
- Teks bantuan: 13px mute di bawah isian.
- Galat (`.in-err`): garis error-line, latar error-soft, pesan `.ferr` 14px 600 warna error.
- Nonaktif: latar tint-2, teks mute.
- Unggah berkas: tombol `.btn` dengan input tersembunyi. Fokusnya terlihat lewat `:focus-within`.

### Sakelar `.sw`

- Ukuran 56×32, radius 4px, garis 1.5px ink. Kenop 22×22 berwarna slip.
- Mati memakai `--off`, nyala memakai `--pine`. Kenop bergeser 0.2s.
- Nonaktif: opacity .55, kursor not-allowed.
- Mematikan kasir, produk, atau voucher memunculkan toast dengan tombol **Batalkan**.

### Tag `.tag`

- Mono 13px, garis 1.5px, radius 4px, padding 1px 8px, tidak turun baris.
- Varian latar: slip (netral), fire-soft (data contoh, segera hadir, peringatan), pine-soft (aktif, lunas, terhubung).

### Kartu `.slipc`

- Latar slip, garis 1.5px ink, radius 4px, padding 24px 26px (18 sampai 20px di ponsel).
- Judul kartu: display 24px.
- Kartu dalam satu baris memakai `align-items:start` supaya tidak ada ruang kosong yang meregang.

### Struk `.slip` / `.torn`

- Font mono 13 sampai 14px. Baris `.row` berisi label kiri dan angka kanan, dipisah garis putus-putus.
- Baris total memakai blok oranye selebar kartu: `margin:0 -padding`.
- Tepi bawah sobek memakai `.torn::after`.

### Tabel `.tbl`

- Judul kolom: mono 13px huruf besar, warna mute, garis bawah 1.5px ink.
- Sel: padding 14px 10px, pemisah `--rule`.
- Angka: `.num` mono rata kanan.
- Hover baris: tint-3. Baris masuk dengan `rise` berjeda.
- **Di ≤ 760px dengan `.tbl-card`:** judul kolom disembunyikan. Setiap baris jadi kartu, dan setiap sel menampilkan labelnya dari `data-l` di kiri.
- Tabel lebar dibungkus `overflow-x:auto`.

### Grafik batang

- Batang pine. Satu batang puncak atau hari ini oranye. Nilai mono 13px di atas setiap batang.
- Label sumbu di bawah, mono 13px mute.
- Garis bantu horizontal tint-2 setiap 44px. Batang tumbuh dengan `grow`.
- Selalu ada kalimat keterangan, misalnya "dalam juta rupiah. Batang oranye adalah hari ini."

### Daftar batang `.lr` + `.lbar`

- Baris berisi nama dan angka kanan, sub-teks 13px mute, dan batang 6px.
- Batang pine untuk biaya operasional dan nilai utama. Batang mute untuk pembelian persediaan.

### Toast

- Melayang di bawah layar (18 Okt 2026): di ponsel di tengah dengan jarak 16px dari tepi, mulai `sm` di pojok kanan bawah. Tidak menggeser isi halaman; `role="status"`, di atas dialog (z 80).
- Lebar maksimal 360px, teks 14px tebal, bayangan keras 3px. Sukses memakai pine-soft, galat memakai fire-soft. Garis 1.5px ink, radius 4px. Hilang sendiri setelah 6 detik (9 detik kalau ada Batalkan), paling banyak 3 sekaligus.
- Selalu ada tombol tutup (ikon silang 36px, berlabel "Tutup"). Aksi yang bisa dibalik juga punya tautan **Batalkan**, yang mengembalikan data ke kondisi sebelumnya.

### Banner langganan

| Status | Tampil di | Gaya | Tombol |
|---|---|---|---|
| aktif, trial | Ringkasan saja | ramping: fire-soft, padding 12px, judul 16px bold | `btn` "Lihat paket" |
| berakhir | semua halaman | besar: slip, garis kiri 12px fire, judul display 24px | `btn-fire` "Perpanjang paket" |

### Dialog `.dlg`

- Maks 480px, latar slip, garis 1.5px, bayangan 6px. Tinggi maks layar dikurangi 120px, isinya menggulir.
- Latar belakang ink 60%. Judul display 34px. Tombol di kanan bawah: Batal, lalu aksi utama `btn-fire`.
- Dialog bertingkat (misalnya kategori baru dari dialog produk) kembali ke dialog asal saat Batal atau Esc.
- Galat dialog: kotak fire-soft di atas tombol, `role="alert"`.

### Panel notifikasi `.bell-p`

- Lebar 380px, menempel ke tepi kanan area konten di bawah header, tidak pernah melewati area konten.
- Isinya daftar notifikasi: titik oranye untuk yang belum dibaca, abu untuk yang sudah, teks, dan waktu. Ada aksi "Tandai sudah dibaca".
- Lencana jumlah: kotak fire 13px di pojok tombol lonceng.

### Skeleton

- Blok `.sk` dengan gradien tint-2 ke tint-3 yang berkilau 1.3s.
- Bentuknya meniru kartu yang akan muncul: judul, angka besar, tiga angka kecil, dan batang grafik.

### Penanda langkah

| Keadaan | Kotak angka |
|---|---|
| sekarang | fire, teks ink |
| selesai | pine, teks paper, ✓ |
| belum | slip, garis ink |

Dipakai vertikal dengan sub-judul di Data awal, dan horizontal di Checkout. Di ponsel, Checkout hanya menampilkan angka.

### Spidol `.hl`

- Gradien fire dari 62% sampai 90% tinggi baris, disapu dari kiri dalam 0.9s, dengan `box-decoration-break:clone` untuk teks yang turun baris.
- Satu per layar, untuk satu frasa atau satu angka utama.

### Kosong

- Kartu dengan judul display 40px dan satu kalimat langkah berikutnya. Kalau ada aksi yang jelas, diberi satu tombol.

---

# C. Landing Page

Papan: `Main.dc.html`, 1360 × 8000 di kanvas. Isi 18px, kontainer 1200px.

## C1. Struktur

| # | Bagian | id | Tujuan |
|---|---|---|---|
| 1 | Header | `atas` | navigasi ke bagian, Masuk, Coba gratis, ID/EN |
| 2 | Hero | | janji utama: kasir tetap jalan saat offline |
| 3 | Fakta singkat | | tiga fakta teknis tanpa klaim |
| 4 | Satu hari kerja | `log` | cara kerja dari buka sampai tutup |
| 5 | Backoffice | `backoffice` | apa yang dilihat pemilik dari rumah |
| 6 | Harga | `harga` | paket dan aturan outlet tambahan |
| 7 | Tanya jawab | `faq` | keberatan nyata pemilik kafe |
| 8 | Ajakan akhir dan kontak | `kontak` | daftar trial, kontak, rekening pembayaran |
| 9 | Footer | | wordmark, tahun, tautan syarat |

## C2. Header

- Satu baris berisi wordmark (26px, kembali ke atas), lima tautan, lalu tombol bahasa, **Masuk** (`btn-ghost btn-sm`), dan **Coba gratis 3 hari** (`btn-ink btn-sm`). Garis bawah 1.5px ink.
- Tautan: Satu hari kerja → `#log`, Backoffice → `#backoffice`, Harga paket → `#harga`, Tanya jawab → `#faq`, Kontak → `#kontak`. Hover menampilkan garis bawah 2px.
- **≤ 620px:**
  - Baris pertama berisi wordmark, tombol bahasa, dan Masuk.
  - Tombol Coba gratis disembunyikan, karena tombol yang sama ada tepat di hero.
  - Tautan jadi satu baris yang bisa digeser horizontal, tanpa turun baris.

## C3. Hero

- **Kiri (7fr):**
  - Judul "Kasir yang **tidak ikut mati** saat internet mati." Ukuran clamp(46px, 6.8vw, 104px), spidol di frasa tengah.
  - Paragraf 21px warna mute, maksimal 28em.
  - Dua tombol: **Coba gratis 3 hari** (`btn-fire`) dan **Lihat harga** (`btn-ghost`, ke `#harga`).
- **Kanan (5fr):**
  - Struk sementara "TUNDA-7F3A2C" di atas blok oranye yang bergeser 28px. Struknya keluar dengan animasi `feed`.
  - Isi struk: dua item, catatan "tanpa es", total, tunai, kembali, dan catatan "Nomor resmi terbit setelah sinkron. Contoh tampilan."
- **≤ 980px:** satu kolom, struk di bawah teks. **≤ 620px:** tombol selebar layar.

## C4. Fakta singkat

- Tiga kolom dengan garis atas: "Android, HP dan tablet", "Printer Bluetooth 58 mm dan 80 mm", "Rilis pertama menerima tunai".
- ≤ 980px: satu kolom.

## C5. Satu hari kerja (`log`)

- Judul: "Satu hari kerja, dari buka sampai tutup." Ada catatan bahwa jam dan angka adalah ilustrasi.
- Tujuh baris `article.log`. Setiap baris berisi kolom jam (mono 28px dengan statistik kecil), teks (judul display 36px dan paragraf), dan satu mockup.
- Posisi teks dan mockup bergantian kiri dan kanan (`.alt`). Inilah RHYTHM 3 di landing.

| Jam | Judul | Mockup |
|---|---|---|
| 07:00 | Buka shift dengan kas awal. | form buka shift: kasir, PIN, kas awal, tombol pine |
| 09:30 | Jam ramai, satu tangan memegang nampan. | bill dengan catatan dan diskon item, tombol Tahan, Pisah bill, Bayar tunai |
| 12:15 | Sinyal hilang. Jualan jalan terus. | antrean offline: kepala pine "OFFLINE · 3 menunggu", tiga nomor TUNDA |
| 12:16 | Satu pesanan, tiga kertas. | struk pelanggan, tiket dapur, tiket bar |
| 22:00 | Tutup shift. Server yang menghitung. | buku kas: kas awal, tunai, void, kas seharusnya, hitungan kasir, selisih Rp0 (blok oranye) |
| 22:01 | Laporan harian tersusun sendiri. (tag segera hadir) | struk laporan harian |
| 22:02 | Dari angka itu, empat catatan untuk besok. (tag segera hadir) | daftar insight, masing-masing dengan sumbernya |

- ≤ 980px: kolom jam pindah ke atas, isi jadi satu kolom. Tiket di baris 12:16 jadi dua kolom.

## C6. Backoffice (`backoffice`)

- Bidang pine selebar layar, padding 112px.
- **Kiri:** judul paper "Setelah tutup, pemilik membaca angkanya dari rumah." Di bawahnya lima poin bergaris `--pine-line`: Laporan, Laporan harian otomatis dan insight (segera hadir), Menu dan kasir, Lonceng pengingat, Data usaha Anda saja.
- **Kanan:** mockup `.win` yang sama dengan Backoffice asli.
  - Menu: Ringkasan aktif dengan kotak oranye, lalu Laporan, Outlet, Kasir, Produk, Voucher.
  - Kartu langganan "Bulanan · 7 hari lagi" dan Pengaturan.
  - Angka Rp4.280.000, batang pine dengan hari ini oranye, dan daftar per kasir.
- **≤ 980px:** satu kolom. Menu mockup jadi deretan horizontal, kartu langganan disembunyikan.

## C7. Harga (`harga`)

- Judul: "Satu harga per bisnis, bukan per perangkat." Subjudul: semua paket berbayar berisi 1 outlet, 3 kasir, dan 100 produk per outlet.
- Tabel `.plan` dengan enam kolom: Paket, Durasi, Harga, Setara per bulan, Hemat dari bulanan, dan tombol.

| Paket | Durasi | Harga | Per bulan | Hemat | Tombol |
|---|---|---|---|---|---|
| Trial | 3 hari | Gratis | - | - | Daftar (`btn-fire`) |
| Bulanan | 1 bulan | Rp149.000 | Rp149.000 | - | Pesan |
| 6 bulan | 6 bulan | Rp699.000 | Rp116.500 | Rp195.000 | Pesan |
| Tahunan | 12 bulan | Rp1.399.000 | Rp116.583 | Rp389.000 | Pesan |

- Tidak ada paket yang disorot sebagai "paling populer".
- Di bawah tabel ada dua kolom:
  - Outlet tambahan Rp99.000 per bulan, proporsional, dengan contoh perhitungan 3 outlet.
  - Cara bayar: transfer bank, perpanjangan menambah sisa waktu, dan data tidak dihapus saat paket berakhir.
- **≤ 980px:** judul kolom disembunyikan. Setiap paket jadi kartu dua kolom dengan label kecil, tombolnya selebar kartu.

## C8. Tanya jawab (`faq`)

- **Kiri:** judul "Yang biasa ditanyakan pemilik kafe."
- **Kanan:** tujuh `details`. Ringkasannya 20px dengan tanda + yang berputar 45° saat terbuka. Item pertama terbuka.
  1. Apa yang terjadi saat langganan berakhir?
  2. Bagaimana kalau internet mati di tengah jam ramai?
  3. Printer apa saja yang bisa dipakai?
  4. Apa batasan selama trial 3 hari?
  5. Bisa bayar pelanggan dengan QRIS atau e-wallet? (jawaban jujur: bisa lewat QRIS milik outlet, termasuk dari e-wallet. Kasir mengonfirmasi setelah melihat pembayaran berhasil; belum terhubung otomatis ke bank)
  6. Apakah setiap kasir perlu akun sendiri?
  7. Apakah laporan harian dan insight sudah ada? (jawaban jujur: belum di rilis pertama)

## C9. Ajakan akhir, kontak, dan footer

- **Ajakan akhir:**
  - Judul "Coba tiga hari di kafe Anda." Ukuran clamp(48px, 7.4vw, 112px).
  - Tombol **Coba gratis 3 hari** dan **Saya sudah punya akun**.
  - Di kanan ada struk "PESANAN ANDA": Trial, 3 hari, 1 outlet, 2 kasir, 40 produk, Total Rp0.
- **Kontak:** tiga kolom berisi WhatsApp, Email, dan Rekening pembayaran paket. Semuanya masih placeholder.
- **Footer:** wordmark, © 2026, dan `[TAUTAN SYARAT LAYANAN DAN KEBIJAKAN PRIVASI]`.

## C10. Tautan di prototipe

| Tombol | Tujuan |
|---|---|
| Masuk, Saya sudah punya akun | `Auth.dc.html` |
| Coba gratis, Daftar, Pesan | `Register.dc.html` (form daftar) |
| Tautan header | anchor bagian di halaman yang sama |

Di produksi, Masuk dan Daftar diarahkan ke URL aplikasi. Ini perlu dikonfirmasi (bagian H).

---

# D. Backoffice

Papan: `Backoffice.dc.html`. Prop Pratinjau:
- `status`: aktif, trial, atau expired.
- `data`: contoh, kosong, atau memuat.
- `view`: ringkasan, laporan, outlet, kasir, produk, pengeluaran, voucher, langganan, profil, atau pengaturan.
- `lang`: id atau en.

Papan turunan: `BackofficeExpired.dc.html` (status berakhir) dan `BackofficePhone.dc.html` (390px).

## D1. Kerangka

**Desktop (> 980px)**
- `.app` setinggi layar. Sidebar 264px dan konten menggulir sendiri-sendiri, jadi sidebar tidak ikut tergulir. Grid ini memakai satu baris `minmax(0, 1fr)` dan kolom konten `position: relative`; tanpa keduanya, isi yang panjang (termasuk keterangan grafik `sr-only`) membuat seluruh jendela ikut menggulir.
- **Sidebar, dari atas ke bawah:**
  1. Wordmark 32px dan meta "backoffice · [NAMA BISNIS]"
  2. Navigasi
  3. Ruang kosong fleksibel
  4. Garis, lalu tombol Pengaturan
- **Navigasi (`.nav-b`, tinggi 44px):** Ringkasan, Outlet (2), Kasir (4), Produk (74), Pengeluaran, Voucher (2). Angka produk dan voucher dihitung per bisnis oleh server (`owner_shell_counts`). Laporan tidak punya menu sendiri: dibuka dari tombol Laporan di Ringkasan.
  - Item aktif: kartu slip bergaris, kotak oranye 10px di kiri, `aria-current="page"`.
  - Hover: latar tint, bergeser 3px.
- **Sisa waktu langganan** tampil di Pengaturan, tab Langganan, bukan di sidebar.
- **Pengaturan** punya lima tab, satu topik per tab: Profil, Bisnis, Struk, Notifikasi, Langganan (`?tab=profile|business|receipt|notifications|subscription`). Data milik satu outlet (nama, alamat, telepon, logo, teks struk) diubah di halaman Outlet; kode persetujuan void ada di halaman Kasir.

**Tablet (761 sampai 980px):** sidebar tetap di kiri dengan lebar 232px.

**Ponsel (≤ 760px)**
- Bilah atas setinggi 60px berisi hamburger 44px di kiri dan lonceng 44px di kanan, tanpa logo dan nama (18 Okt 2026; logo tetap ada di laci). Sisa langganan ada di Pengaturan, Langganan. Di ponsel lonceng tidak diulang di header halaman.
- Sidebar jadi laci dari kiri: lebar min(300px, 86vw), bayangan 6px, latar redup pine 45%, dan tombol ✕.
- Laci tertutup lewat ✕, ketuk latar, Esc, atau memilih menu. Fokus terkunci di dalam laci, lalu kembali ke hamburger.

**Header konten (`.hd`)**
- Tanggal mono (disembunyikan di ponsel), judul halaman, tag "data contoh", dan catatan pratinjau (disembunyikan di ponsel).
- Di kanan: tombol ID/EN, filter outlet (di Ringkasan, Pengeluaran, dan Produk), dan lonceng.
- Garis bawah 1.5px ink.

## D2. Status langganan

| | aktif | trial | berakhir |
|---|---|---|---|
| Sisa waktu | Pengaturan, Langganan | Pengaturan, Langganan | Pengaturan, Langganan |
| Batas per outlet | 3 kasir, 100 produk | 2 kasir, 40 produk | 3 kasir, 100 produk |
| Banner | tidak ada | tidak ada | besar, di semua halaman |
| Notifikasi | pengingat 30, 21, 14, dan 7 hari, lalu setiap hari sejak sisa 3 hari (070) | setiap hari (trial 3 hari) | langganan berakhir |
| Yang terkunci | | | penjualan baru, shift baru, tambah outlet, kasir, produk, dan pengeluaran, ubah pengaturan |
| Tetap terbuka | semua | semua | laporan, riwayat, lihat data, bayar |

- Tombol yang terkunci tetap tampil tetapi nonaktif, dengan label "Terkunci: langganan berakhir".
- Data tidak pernah dihapus.

## D3. Status layar

| Status | Wujud |
|---|---|
| Isi | data contoh berlabel "data contoh" |
| Kosong (`data=kosong`) | kartu kosong per halaman dengan langkah berikutnya, misalnya "Belum ada penjualan." dengan tombol Buat produk dan Buat kasir |
| Memuat (`data=memuat`, atau 650ms setelah ganti periode atau outlet) | skeleton di area konten, header tetap |
| Galat aksi | pesan di dalam dialog atau di bawah kolom, atau toast fire-soft |
| Galat server | halaman `ServerError.dc.html` |
| Terkunci | lihat D2 |

## D4. Ringkasan

1. **Banner langganan** versi ramping.
2. **Periode (`PeriodFilter`, sama di Ringkasan, Transaksi, Pengeluaran, dan Produk):** satu dropdown berlabel Periode (220px, selebar layar di ponsel) berisi Hari ini (bawaan), Bulan ini (tanggal 1 sampai hari ini), Bulan lalu (sebulan penuh), dan Pilih tanggal; setelah tanggal dipilih, pilihan itu menampilkan rentangnya dan tombol kecil **Ubah tanggal** muncul di sebelahnya. Pilih tanggal membuka dua isian, Dari dan Sampai, dengan aturan: keduanya wajib, akhir tidak setelah hari ini, akhir tidak sebelum mulai, dan rentang maksimal 366 hari. Server memeriksa ulang tanggal dan rentangnya. Di sebelah dropdown: "Grafik selalu 7 hari terakhir dan jam hari ini." dan tombol **Laporan**, yang membuka Laporan untuk periode dan outlet yang sama.
3. **Baris 7/5, tinggi kedua kartu sama:**
   - **Kiri, Total omset:** label "Total omset, bersih setelah refund · periode · outlet", angka utama dengan spidol, lalu satu kalimat perbandingan mute: "Naik/Turun Rp… dari hari sebelumnya" untuk periode satu hari, atau "dari {n} hari sebelumnya" untuk periode lebih panjang, beserta angka pembandingnya. Di bawah garis, delapan angka dua kolom: Omset tunai, Omset QRIS, Jumlah bill, Rata-rata per bill, Item terjual, Diskon diberikan, Void, Refund.
   - **Kanan, Omset setelah pengeluaran:** angka pine, catatan "Semua pengeluaran dikurangkan, dari kas laci maupun dari luar laci.", lalu Pengeluaran, Dari kas laci, Dari luar laci, Laba kotor (nominal saja, tanpa persen), dan Selisih kas terakhir.
   - Angka di dalam kedua kartu memakai komponen `Stat`: label mono 14px mute, nilai mono 20px medium, nominal panjang pindah baris dan tidak pernah dipotong. Komponen yang sama dipakai di Pengeluaran, Outlet, dan tab Langganan.
4. **Baris 7/5, tinggi sama:** grafik Penjualan per hari (7 batang, hari ini oranye) dan Penjualan per jam (12 batang, jam tersibuk oranye). Hari dan jam mengikuti zona waktu bisnis.
5. **Baris dua kolom:** Produk terlaris (6 teratas, berperingkat) di kiri; di kanan dua kartu bertumpuk dengan tinggi dibagi rata: **Cara bayar** (Tunai dan QRIS) dan **Pengeluaran per kategori** (Operasional dan Belanja).
6. **Baris dua kolom:** Per outlet (hanya kalau filter Semua outlet) dan Per kasir. Kalau satu outlet dipilih, Per kasir selebar baris.
7. Kartu daftar tanpa data menaruh kalimat kosongnya di tengah kartu, supaya kartu yang diregangkan tidak terlihat belum selesai.

Semua isi Ringkasan datang dari satu panggilan `owner_dashboard` (migrasi 062).

## D5. Laporan

**Yang sudah dibangun.** Halaman `/reports` menampilkan laporan sebagai enam lembar A4 (bagian F), dari satu panggilan `owner_report_page` (migrasi 063). Halaman ini tidak punya menu: dibuka dari tombol Laporan di Ringkasan dengan periode dan outlet yang sama, dan "Kembali ke Ringkasan" kembali ke periode yang sama. Tanpa periode, laporan memakai Hari ini. Tombol **Cetak / simpan PDF** (`btn-ink`) mencetak lembar yang sama lewat browser. Teks terkecil di lembar laporan 12px.

**Rancangan berikut (belum dibangun):**

1. **Kotak ekspor:** "Ekspor laporan untuk manajer atau akuntan" dengan tombol **Lihat contoh hasil** (ke `Laporan.dc.html`) dan **Ekspor laporan** (`btn-ink`).
2. **Tag segera hadir** dan catatan pratinjau.
3. **Struk Laporan harian** (kiri) dan kartu **Empat catatan untuk besok** (kanan, setiap insight dengan sumbernya).
4. **Kartu Keputusan dan rencana** (tag "ikut dalam ekspor"):
   - Daftar keputusan dengan isian Tambah.
   - Daftar rencana tindakan berisi tindakan, penanggung jawab, dan tenggat.
   - Chip usulan dari insight, yang menambahkan rencana dalam sekali klik.
   - Galat "Tulis keputusannya dulu." dan "Isi tindakannya dulu."

**Dialog Ekspor laporan**

| Isian | Pilihan |
|---|---|
| Format | chip PDF ("Siap dicetak dan dikirim. Tata letak terkunci.") atau DOCX ("Bisa diedit di Word atau Google Docs sebelum dikirim.") |
| Periode | 7 hari terakhir, Bulan berjalan, Bulan lalu |
| Outlet | Semua outlet, Outlet Utama, Outlet Cabang 2 |
| Bagian | kotak centang: Ringkasan eksekutif, Laba rugi sederhana, Kas dan shift, Pengeluaran, Penjualan dan produk, Insight, Keputusan dan rencana |
| Bahasa | Indonesia atau English |
| Nama berkas | otomatis, misalnya `Laporan-KopiPojok-2026-10-05_11-SemuaOutlet.pdf` atau `Report-...-AllOutlets.docx` |

- Tombol **Buat laporan** berubah jadi "Menyusun laporan..." selama sekitar 1 detik, lalu dialog tertutup dan muncul toast "Laporan siap: [nama berkas]".
- Galat: "Pilih minimal satu bagian laporan."

## D6. Outlet

- Catatan: satu bisnis, satu tanggal berakhir, outlet tambahan Rp99.000 per bulan. Tombol **Tambah outlet** (`btn-fire`).
- Kartu per outlet: garis kiri pine untuk outlet "termasuk paket" dan fire untuk "tambahan". Isinya nama display, alamat placeholder, Kasir aktif x/3, dan Produk aktif x/100.
- **Dialog Tambah outlet** bersifat informasi: penambahan diaktifkan setelah pembayaran, hubungi WhatsApp. Tombolnya "Mengerti".

## D7. Kasir

- Catatan: kasir tidak punya email, masuk dengan nama dan PIN 6 digit, terkunci 5 menit setelah lima kali salah. Tombol **Tambah kasir**.
- Tabel berisi Kasir (nama display), Outlet, Status (sakelar dan label), dan PIN ("Ubah PIN").
- Menonaktifkan kasir memunculkan toast dengan Batalkan. Mengaktifkan kembali dibatasi jumlah kasir aktif per outlet.
- **Dialog Tambah kasir:** nama, outlet, dan PIN 6 digit.
  - Galat: "Nama kasir wajib diisi.", "PIN harus 6 digit angka.", dan batas kasir tercapai.
- **Dialog Ubah PIN:** PIN baru. Ada catatan bahwa PIN disimpan sebagai hash dan berlaku langsung.

## D8. Produk

- Filter outlet di header. Di bawah header, paling atas: filter periode (sama dengan Ringkasan) dengan keterangan "Kolom Terjual: {periode}, dari bill selesai." Kalau jumlah terjual gagal dimuat, muncul kalimat galat dan kolomnya berisi "-", tetapi daftar produk tetap tampil.
- Lalu pencarian, pemakaian "6 / 100 produk aktif", dan tombol **Tambah produk**.
- Kategori dipilih lewat dropdown (Semua kategori dan kategori yang ada), karena satu outlet bisa punya banyak kategori. Toolbar satu baris (`FilterBar`): kotak cari, tombol **Filter**, dan **Tambah produk**. Dialog Filter berisi Outlet, Periode (untuk kolom Terjual), dan Kategori; tiap perubahan langsung berlaku, ada **Atur ulang** dan **Selesai**. Tombol Filter memberi angka jumlah filter yang tidak bawaan. Di bawah toolbar satu baris teks abu: outlet · Terjual {periode} · kategori · {n} / {maks} produk aktif. Kategori baru dibuat dari dialog produk ("Kategori belum ada? Buat baru").
- Tabel berisi Produk (foto kecil, nama, dan kategori), Harga, HPP, Stok ("tanpa stok" atau angka), Terjual (jumlah pada periode terpilih, dari `owner_product_sales`, migrasi 061), dan Aktif (sakelar).
  - **Foto kecil** 64 × 48 (rasio 4:3) di kiri nama, menampilkan versi yang tampil di kasir. Mengetuknya langsung membuka pemilih berkas untuk mengganti foto, jadi produk lama bisa diberi foto tanpa membuka dialog. Produk tanpa foto menampilkan kotak putus-putus "+ foto".
  - Setelah foto diganti, muncul toast "Foto Kopi susu diperbarui. Kasir melihatnya setelah katalog dimuat ulang." dengan **Batalkan**.
- **Dialog Tambah produk:**
  - Nama, foto menu (opsional), kategori (dengan tautan "Kategori belum ada? Buat baru"), harga jual, dan HPP.
  - **Foto menu: unggah, selesai.** Pemilik tidak memotong atau memperbesar, dan foto tidak diedit. Sebelum unggah: kotak kosong 160 × 120 bergaris putus-putus dan tombol Unggah foto. Sesudah unggah: satu pratinjau berupa kartu kasir sungguhan (foto, nama, dan harga dari isian), lalu Ganti foto dan Hapus foto, dengan keterangan "Begini tampilannya di kasir. Foto dipotong 4:3 dan diberi bingkai, warnanya tidak diubah."
  - **Pemrosesan otomatis saat disimpan, hanya ukuran:** potong 4:3 dengan titik fokus yang dicari otomatis (`sharp` strategi `attention`), lalu simpan dua ukuran WebP (640 × 480 untuk tablet, 320 × 240 untuk ponsel). Warna, kecerahan, dan latar foto **tidak diubah**: foto pemilik tampil apa adanya. Keseragaman katalog datang dari bingkai kartu, bukan dari mengedit foto. Kalau hasilnya tidak disukai, pemilik cukup mengganti fotonya. Foto tidak pernah dicetak di struk.
  - Galat foto di bawah kolomnya: "Pilih berkas JPG, PNG, atau WebP.", "Ukuran foto maksimal 2 MB.", "Foto gagal dibaca. Coba berkas lain." Galat foto tidak menghalangi produk disimpan tanpa foto.
  - Stok: chip Lacak stok atau Tanpa stok, dengan stok awal kalau dilacak.
  - Galat: "Nama produk wajib diisi.", "Harga jual harus lebih dari Rp0.", dan batas produk tercapai.
- **Dialog Kategori baru:** maksimal 20 huruf, kategori dipakai di semua outlet.

## D9. Pengeluaran

**Yang sudah dibangun** (migrasi 040 sampai 045; tanpa persetujuan sejak 043):

- Filter outlet di header. Catatan pembuka: kasir mencatat di aplikasi, semua catatan satu shift jadi satu daftar dan langsung dihitung, pemilik bisa mengubahnya kapan saja dan kas shift itu ikut dihitung ulang.
- Filter periode (sama dengan Ringkasan).
- Kartu **Total pengeluaran · {periode}**: angka utama, lalu Operasional dan Belanja (`Stat`).
- Daftar per tanggal bisnis (judul display 22px dan total hari itu dari database), lalu satu kartu per shift: nomor shift, outlet, kasir, total, jumlah dari kas laci, dan barang dengan kategori dan sumbernya. Tombol **Ubah** per kartu. Di bawah daftar: "{total} catatan shift di periode ini" dan paginasi (50 per halaman).
- Tidak ada tombol Ubah (sejak 071). Sejak 073 setiap barang punya tombol **Batalkan** (dialog dengan alasan wajib); barang yang dibatalkan tetap tampil dicoret dengan alasannya, dan kas shift dihitung ulang. Tombol **Tambah barang** per kartu mencatat barang yang terlewat (sumber dana dipilih). Nominal yang salah = batalkan lalu catat ulang. Kartu total menyebut "Termasuk koreksi pengeluaran lama: Rp…" kalau ada koreksi 071 di periode itu.

**Rancangan awal (belum dibangun):** kategori pengeluaran buatan pemilik dan pencatatan dari backoffice:

- Tombol **Kelola kategori** dan **Catat pengeluaran** (`btn-fire`).
- Chip filter kategori.
- Tabel berisi Tanggal, Kategori (nama dan jenis), Keterangan (dan outlet, "nota terlampir"), Dibayar dari, Jumlah, dan Hapus.
  - Menghapus memunculkan toast dengan Batalkan.
  - Di ponsel tabel jadi kartu.
- **Dialog Catat pengeluaran:**
  - Tanggal (maksimal hari ini), jumlah, kategori (persediaan diberi akhiran " · persediaan"), keterangan, dan outlet.
  - Sumber dana memakai chip:
    - **Kas laci outlet:** mengurangi kas seharusnya di shift yang sedang buka.
    - **Rekening bisnis.**
    - **Uang pribadi pemilik:** dicatat sebagai setoran pemilik.
  - Foto nota opsional.
  - Galat: "Pilih kategori pengeluaran.", "Tulis keterangan singkat, misalnya barang yang dibeli.", "Jumlah harus lebih dari Rp0.", dan "Tanggal tidak boleh setelah hari ini (11 Okt 2026)."
- **Dialog Kategori pengeluaran baru:** nama (maksimal 24 huruf), dan jenis dengan penjelasan masing-masing:
  - **Biaya operasional:** mengurangi laba.
  - **Pembelian persediaan:** hanya masuk arus kas.
- **Dialog Kelola kategori:** daftar kategori dengan jenis dan status "dipakai". Kategori yang dipakai tidak bisa dihapus. Ada tombol Tambah kategori.
- **Kategori bawaan:**
  - Persediaan: Bahan baku, Kemasan.
  - Operasional: Gaji, Sewa, Listrik dan air, Gas, Perawatan, Lainnya.

## D10. Voucher

- Catatan cara kerja voucher. Tombol **Buat voucher**.
- Tabel berisi:
  - Kode (bingkai putus-putus mono dengan "Salin")
  - Potongan (nilai dan cakupan)
  - Syarat (minimal belanja)
  - Terpakai (x / kuota atau tanpa batas)
  - Berlaku sampai
  - Status (Aktif, Kedaluwarsa, Habis, Nonaktif)
  - Aktif (sakelar)
- **Dialog Buat kode voucher:**
  - Kode 4 sampai 12 huruf atau angka (tombol "Buat acak").
  - Berlaku untuk: Seluruh bill atau Produk tertentu. Produk tertentu membuka pemilih produk berisi pencarian, filter kategori, "x dari y produk dipilih", Pilih semua hasil, Kosongkan, daftar centang dengan tinggi maksimal 200px, dan chip pilihan.
  - Jenis potongan (Persen atau Nominal), nilai, minimal belanja, kuota, dan tanggal berakhir.
  - Galat: kode, minimal satu produk, persen 1 sampai 100, nominal minimal Rp1.000, tanggal berakhir, dan kode yang sudah dipakai.

## D11. Pengaturan

Tiga tab chip di bawah header: **Profil**, **Bisnis dan struk**, **Langganan**.

**Profil (7/5)**
- **Kiri:** avatar inisial (kotak pine 84px), nama, dan "pemilik · @username". Isian nama lengkap, username (huruf kecil, dipakai untuk masuk), email, dan WhatsApp (opsional). Tombol **Simpan profil** (`btn-ink`).
- **Kanan:**
  - **Ganti kata sandi:** saat ini, baru (minimal 6 karakter, bebas angka atau huruf), dan ulangi.
  - **Akun Google:** tag terhubung atau belum, dengan tombol hubungkan atau putuskan.
  - **Sesi:** "Keluar dari akun" membuka konfirmasi sebaris "Keluar dari Backoffice di perangkat ini?" dengan tombol "Ya, keluar" ke halaman Masuk dan Batal.

**Bisnis dan struk (7/5)**
- **Kiri:**
  - **Bisnis:** nama, jenis usaha (chip), kota, dan zona waktu (WIB, WITA, WIT). Tombol **Simpan data bisnis**.
  - **Struk dan pajak:**
    - Logo di struk: kotak pratinjau 120×72 hitam putih, tombol Unggah atau Ganti logo dan Hapus logo, hanya PNG atau JPG maksimal 1 MB.
    - Teks di atas struk dan teks di bawah struk.
    - **Tampil di struk:** sakelar untuk logo, teks atas, alamat outlet, telepon outlet, nama kasir, catatan item, rincian pajak dan layanan, dan teks bawah. Nomor bill, waktu, item, dan total selalu tercetak.
    - Lebar kertas mengikuti printer, jadi tidak ada pilihan lebar.
    - Pajak dan biaya layanan (%, 0 sampai 100), dan sakelar "harga sudah termasuk pajak". Tombol **Simpan struk dan pajak**.
- **Kanan (menempel saat digulir):**
  - Pratinjau struk yang berubah langsung mengikuti setiap pengaturan.
  - **Notifikasi:** sakelar pengingat langganan, selisih kas shift, stok menipis, dan laporan harian (segera hadir, nonaktif).
  - **Data:** tombol Ekspor data (CSV).

**Langganan (7/5)**
- **Kiri:**
  - Kartu paket: garis kiri 12px pine untuk aktif, fire untuk trial atau berakhir. Isinya angka hari 140px, Berlaku sampai, dan Sisa waktu.
  - Kartu Pemakaian: outlet, kasir per outlet, dan produk per outlet.
- **Kanan:** struk "Perpanjang atau ganti paket" berisi daftar harga, kalimat cara bayar, dan tombol **Pilih paket dan bayar**. Tombol membuka `Checkout.dc.html`, atau `CheckoutExpired.dc.html` saat berakhir.

## D12. Responsif Backoffice

| Lebar | Perubahan |
|---|---|
| ≤ 1100px | grid 7/5 dan 1/1 jadi satu kolom, pratinjau struk tidak lagi menempel |
| ≤ 980px | sidebar 232px |
| ≤ 760px | bilah atas dan laci, header ringkas, tabel jadi kartu ringkas (`.tbl-card`, 19 Okt 2026): kolom pertama jadi kepala kartu selebar kartu (nama dan teks sekunder, garis bawah tipis), kolom lain dua per baris dengan label mono 12px di atas nilai 15px; padding 12/14px, jarak antarkartu 10px. Tombol utama halaman selebar layar. Halaman Kasir dan Voucher tanpa paragraf pembuka. |

## D13. Transaksi

**Yang sudah dibangun** (`/transactions`, migrasi 066 dan 067). Menu di sidebar tepat di bawah Ringkasan. Dua chip tab: **Bill** dan **Produk terjual** (`?tab=products`), lalu toolbar satu baris (`FilterBar`, sama dengan Produk): kotak cari dan tombol **Filter**, dengan ringkasan filter aktif di bawahnya.

- **Bill:** cari nomor, nama, atau meja (dikirim saat Enter atau saat kotak ditinggalkan). Dialog Filter: Outlet (boleh semua), Periode, Status bill (Selesai bawaan, Dibatalkan, Semua). Ringkasan: outlet · periode · status · {n} bill. Tabel Bill (nomor sebagai tombol, nama, meja, outlet bila semua outlet, tag `dibatalkan`, `refund`, atau `refund sebagian`, dan `diubah nx`), Waktu, Kasir, Bayar, Total. 50 per halaman dari server.
- **Dialog Bill {nomor}** (560px): item dengan harga satuan, catatan, diskon, dan "Direfund n"; Diskon, Total, Bayar, Refund dan Bersih; daftar refund; **Riwayat perubahan** (pembatalan, koreksi, dan ubahan lama dari sebelum 071). Dua tombol untuk bill selesai yang belum direfund dan tanpa voucher: **Koreksi bill** dan **Batalkan bill**; langganan berakhir menguncinya. Tag di daftar: `dikoreksi, diganti {nomor}` dan `pengganti {nomor}`.
- **Batalkan bill** membuka dialog dengan alasan wajib; mengembalikan stok dan tidak bisa diurungkan. Bill dari hari sebelumnya menampilkan catatan bergaris fire: laporan hari itu dan selisih kas shift-nya ikut berubah. Untuk shift yang sudah ditutup, kas seharusnya dan selisih dihitung ulang; hitungan uang kasir tetap.
- **Koreksi bill** (073): jumlah per item, hapus item, tambah produk, Dibayar dengan, nama, meja, dan alasan wajib. Bill lama dibatalkan dan bill pengganti dibuat di hari dan shift yang sama, saling tertaut; harga lama tetap, produk baru memakai harga katalog. Toast: "Bill {lama} diganti {baru}, total {nominal}."
- Hari yang sudah dikunci (D14) menolak pembatalan dan koreksi; koreksinya lewat refund di hari yang masih buka.
- **Produk terjual:** satu outlet (produk milik outlet). Semua produk, termasuk yang 0 terjual dan yang nonaktif, dengan Terjual dan Penjualan (setelah diskon item, refund belum dikurangi). Cari nama produk langsung saat mengetik. Dialog Filter: Outlet, Periode, Urutkan (Terlaris bawaan, Penjualan terbesar, Nama A-Z). Ringkasan: outlet · periode · urutan · {n} produk. 20 per halaman.

## D14. Shift

**Yang sudah dibangun** (`/closing?outlet=&date=`, migrasi 073, 075, dan 078). Menu "Shift" di sidebar di bawah Transaksi. Tidak ada tutup hari dan tidak ada kunci hari (078): kasir menutup shift di aplikasi, pemilik tidak punya langkah harian. Rincian pembukuan: [`ACCOUNTING.md`](ACCOUNTING.md).

- Isian Outlet (satu outlet) dan Tanggal (maksimal hari ini).
- **Pemeriksaan:** satu kotak pine-soft "Semua angka hari ini cocok…" atau kotak fire-soft berisi setiap aturan yang gagal dalam kalimat biasa (P1 sampai P5, P7).
- **Satu kartu per shift:** Shift n · kasir, jam buka sampai tutup, jumlah bill, omzet. Dua kolom: **Kas laci** (Kas awal, Penjualan tunai, Refund tunai, Uang masuk, Uang keluar, Kas seharusnya, Kas dihitung kasir, lalu Cocok / Kurang / Lebih) dan **QRIS** (Penjualan QRIS, Refund QRIS, QRIS seharusnya masuk, QRIS di aplikasi merchant, lalu Cocok / Kurang / Lebih). Catatan uang laci di bawahnya. Tombol kecil **Uang masuk** (uang laci kurang) dan **Uang keluar** (uang laci lebih), selalu ada.
- **Koreksi dan pembatalan:** void, koreksi bill, refund, pengeluaran dibatalkan, penyesuaian dan hitung stok hari itu, dengan nominal, alasan, dan jam.

## D15. Stok

**Yang sudah dibangun** (`/stock`, migrasi 074). Menu di sidebar di bawah Produk.

- Dua tab: **Stok sekarang** dan **Riwayat**, isian Outlet. Tombol **Stok masuk**, **Penyesuaian**, **Hitung stok**.
- Dialog dokumen: beberapa produk sekaligus; stok masuk lebih dari 0; penyesuaian bertanda dengan alasan wajib; hitung stok mengisi jumlah fisik dan menampilkan selisihnya. Stok tidak boleh minus.
- Form produk hanya menampilkan "Stok sekarang {n}." dengan tautan ke Stok; angka stok hanya diisi sebagai "Stok awal" saat pelacakan dimulai.

---

# E. Halaman pendukung

## E1. Masuk dan Daftar (`Auth.dc.html`, `Register.dc.html`)

- **Dua panel.**
  - **Kiri (paper):** wordmark dan tombol bahasa, judul "Kasir yang **tidak ikut mati** saat internet mati.", struk tertunda, dan tiga tag.
  - **Kanan (tint):** kartu slip dengan bayangan 6px.
  - Di ponsel panel kiri hanya menampilkan wordmark, jadi form langsung terlihat.
- **Tampilan:** masuk, daftar, lupa, terkirim, reset, dan berhasil.
- **Masuk:** email atau username, kata sandi (tombol Lihat), "Ingat saya", Lupa kata sandi, Masuk, "atau", dan Lanjut dengan Google (monogram G, bukan logo resmi).
- **Daftar:**
  - Nama bisnis, username (3 sampai 20 karakter), email, dan kata sandi.
  - Kata sandi punya meter kekuatan (Lemah, Cukup, Baik, Kuat) dan dua syarat yang tercentang hijau pine: "Minimal 6 karakter" (boleh angka saja atau huruf saja) dan "Berbeda dari email Anda".
  - Persetujuan syarat wajib, baik untuk daftar biasa maupun lewat Google.
- **Berhasil:** setelah masuk menuju Backoffice, setelah daftar menuju Data awal.
- Galat ditampilkan per kolom dan hilang saat isiannya diubah.

## E2. Data awal (`Onboarding.dc.html`)

- Rail kiri 320px berisi lima langkah (Bisnis, Outlet, Kasir, Produk, Selesai) dan progres "Langkah x dari 5". Kartu form di kanan dibuat rata tengah, maksimal 720px.
- Batas trial: 2 kasir dan 40 produk. Langkah Kasir dan Produk boleh dilewati.
- Langkah Selesai berisi ringkasan, tiga langkah berikutnya, dan tombol **Buka Backoffice**.
- Di ponsel, daftar langkah disembunyikan dan hanya progres yang tampil.

## E3. Berlangganan dan pembayaran (`Checkout.dc.html`, `CheckoutExpired.dc.html`)

- Header berisi wordmark, ID/EN, tab Berlangganan dan Riwayat tagihan, dan Ke backoffice.
- Penanda langkah: Paket, Transfer, Konfirmasi, Verifikasi.
- **Langkah:**
  1. **Paket:** tiga kartu paket. Yang terpilih memakai pine-soft dengan garis kiri pine. Ada kartu "Yang termasuk".
  2. **Transfer:** jumlah besar dengan tombol "Salin jumlah", data rekening (placeholder), instruksi, dan kotak "Belum ada pembayaran otomatis".
  3. **Konfirmasi:** nama pengirim, bank asal, tanggal (maksimal hari ini), jumlah (diberi peringatan kalau berbeda dari tagihan), bukti, dan catatan.
  4. **Verifikasi:** garis waktu lima tahap, dengan tombol simulasi yang jelas berlabel "Hanya di pratinjau desain".
  5. **Aktif:** tanggal berakhir baru dan tombol Kembali ke backoffice.
- **Riwayat:** tabel faktur (nomor faktur bisa diklik), dan faktur ditampilkan di struk kanan.
- **Struk kanan:** faktur, tanggal, paket, harga, outlet tambahan (perkiraan), total (blok oranye), setara per bulan, dan berlaku sampai.
- **Aturan masa aktif:** saat aktif atau trial, sisa waktu ditambahkan. Saat berakhir, dihitung dari hari aktivasi.

## E4. Galat (`Errors.dc.html` 404, `ServerError.dc.html` 500)

- Angka besar dengan spidol, judul, penjelasan, dan dua tombol.
- **404:** tautan cepat ke Masuk, Daftar trial, dan Bayar langganan.
- **500:** kotak "Aplikasi kasir tetap bisa dipakai", tombol Muat ulang (dengan status mencoba), dan kontak bantuan.
- Kanan: struk "STRUK TIDAK DITEMUKAN" untuk 404 atau "LAPORAN GALAT" berisi kode referensi untuk 500.

---

# F. Laporan ekspor (PDF dan DOCX)

Papan `Laporan.dc.html`, berisi enam halaman A4 tegak. Contoh berkasnya ada di `project/contoh/`.

**Tata letak halaman**
- 794 × 1123 px di layar, `@page A4` dengan margin 0, satu `article.page` per halaman.
- **Header:** nama bisnis dan meta mono (nomor laporan, periode), dengan garis bawah 2px ink. Halaman pertama juga memuat kotak `[LOGO]`, cakupan outlet, tanggal dibuat, dan mata uang.
- **Footer:** nama bisnis, judul laporan, periode, dan "Halaman x dari 6". Halaman terakhir ditambah "Rahasia, untuk internal".
- **Judul bagian:** kotak nomor pine bergaris dan judul display 19px. Teks pengantar 12.5px warna mute.

**Isi**

| Halaman | Bagian |
|---|---|
| 1 | Judul "Laporan Kinerja Mingguan", 4 angka utama (penjualan bersih, laba kotor, laba operasional, jumlah bill) beserta perbandingannya, 1 Ringkasan eksekutif, 2 Penjualan bersih per hari (grafik), kotak "Perlu keputusan minggu ini" |
| 2 | 3 Laba rugi sederhana (minggu ini, minggu lalu, selisih, %), 4 Rekonsiliasi kas laci |
| 3 | 5 Pengeluaran per kategori, 6 Arus kas, 7 Pengeluaran terbesar |
| 4 | 8 Penjualan per hari, 9 Per outlet, 10 Per kasir, 11 Kinerja produk |
| 5 | 12 Void dan potongan harga, 13 Insight (dengan sumber), 14 Keputusan |
| 6 | 15 Rencana tindakan (penanggung jawab, tenggat, ukuran berhasil, status), 16 Catatan dan definisi, pengesahan (disusun, diperiksa, disetujui) |

**Aturan tabel akuntan**
- Angka mono rata kanan, pengurang ditulis dalam kurung.
- Subtotal berlatar #F4F5F0 dengan garis atas dan bawah. Total bergaris ganda di bawah.
- Selisih positif menambah laba, negatif mengurangi laba. Margin di bawah ambang ditandai warna error.
- PPN dicatat terpisah sebagai utang pajak, bukan pendapatan.

**Aturan isi**
- Insight dibuat dari data dan selalu menyebut sumbernya.
- Keputusan dan rencana ditulis pemilik atau manajer. Sistem hanya mengusulkan.
- Semua angka di contoh saling cocok antarbagian.

**Versi DOCX**
- Struktur sama, dengan font Calibri dan Consolas karena font brand belum tentu terpasang di komputer pembaca.
- Header dan footer Word dengan nomor halaman otomatis, tabel dengan lebar kolom tetap.

---

# G. Alur dan papan

| Papan | Ukuran kanvas | Isi |
|---|---|---|
| `Main.dc.html` | 1360 × 8000 | Landing Page |
| `Backoffice.dc.html` | 1360 × 2200 | Backoffice interaktif |
| `BackofficeExpired.dc.html` | 1360 × 1300 | Backoffice saat langganan berakhir |
| `BackofficePhone.dc.html` | 390 × 844 | Backoffice di ponsel |
| `Auth.dc.html` | 1360 × 1100 | Masuk, lupa, reset |
| `Register.dc.html` | 1360 × 1100 | Daftar trial |
| `Onboarding.dc.html` | 1360 × 1000 | Data awal |
| `Checkout.dc.html` | 1360 × 1100 | Berlangganan dan pembayaran |
| `CheckoutExpired.dc.html` | 1360 × 1100 | Pembayaran saat berakhir |
| `Errors.dc.html` | 1360 × 820 | 404 |
| `ServerError.dc.html` | 1360 × 820 | 500 |
| `Laporan.dc.html` | 900 × 7000 | Contoh laporan ekspor |
| `POS.dc.html` | 390 × 844 | Aplikasi POS interaktif, semua alur dalam satu papan (prop `layar`, `status`, `jaringan`) |
| `Pos*.dc.html` (20 papan) | 390 × 844 | Layar POS ponsel per langkah: Masuk sampai Terkunci |
| `PosTab*.dc.html` (5 papan) | 1280 × 800 | POS tablet landscape: masuk, jual, bayar, bill, shift |
| `PosLand*.dc.html` (2 papan) | 844 × 390 | POS ponsel landscape: jual, bayar |
| `PosFoto.dc.html` | 390 × 844 | POS ponsel: jual dengan katalog Foto (pilihan, bukan bawaan) |
| `PosMenuMemuat.dc.html` | 390 × 844 | POS ponsel: menu sedang dimuat (skeleton arsiran) |
| `PosMenuGagal.dc.html` | 390 × 844 | POS ponsel: menu gagal dimuat, tombol Coba lagi |
| `FotoMenu.dc.html` | 1360 × 3320 | Perbandingan cara menampilkan foto menu dari pemilik. Keputusan: foto asli dengan bingkai seragam (A) |

**Alur utama**
1. Landing → Daftar trial → Data awal → Backoffice.
2. Backoffice → Pengaturan, tab Langganan → Checkout → kembali ke Backoffice.
3. Backoffice → Laporan → Ekspor laporan, dan Lihat contoh hasil → papan Laporan.
4. Landing → Masuk → Backoffice → Pengaturan → Keluar → Masuk.
5. 404 dan 500 → beranda, Masuk, Daftar, Bayar langganan.
6. POS: Masuk akun pemilik → Pilih kasir → PIN → Jual → Bill → Bayar → Konfirmasi → Berhasil → Bill baru.
7. POS: Tahan bill → tab Bill, Ditahan → Panggil bill → Pisah bill → Bayar per bagian.
8. POS: Shift → Tutup shift → Hasil (selisih) → Buka shift berikutnya.

Semua tautan antarpapan memakai `<a href="Nama.dc.html">`, jadi bisa diklik di mode Play.

---

# H. Catatan serah terima

## H1. Placeholder yang harus diisi sebelum rilis

| Placeholder | Muncul di |
|---|---|
| `[NAMA BISNIS]` | header Backoffice, Checkout, laporan |
| `[LOGO]` | laporan, sampai pemilik mengunggah logo |
| `[NOMOR WHATSAPP]` | kontak landing, 500, Checkout, dialog outlet |
| `[ALAMAT EMAIL]` | kontak landing, 500 |
| `[NAMA BANK]`, `[NOMOR REKENING]`, `[ATAS NAMA]` | Checkout, rekening di landing |
| `[TAUTAN SYARAT LAYANAN DAN KEBIJAKAN PRIVASI]` | footer landing, form Daftar |
| `[JAM OPERASIONAL VERIFIKASI]` | Checkout, langkah verifikasi |
| `[Alamat outlet]`, `[Telepon outlet]`, `[Nama kasir]`, `[Nama manajer]` | contoh struk, outlet, laporan |

## H2. Data contoh

Semua angka, nama kasir (Sari, Budi, Wulan, Dedi, Rini), produk, voucher, pengeluaran, faktur, dan laporan adalah contoh untuk pratinjau, dan selalu diberi label "data contoh". Tanggal acuan di semua papan adalah Min, 11 Okt 2026.

## H3. Fitur yang ditambahkan selama desain

Bandingkan daftar ini dengan PRD sebelum dibangun: voucher (per bill dan per item), kategori produk, pilihan lacak stok, Pengeluaran, ekspor laporan PDF dan DOCX, keputusan dan rencana, logo dan isi struk, mode ID dan EN, serta Checkout dengan riwayat tagihan. Laporan harian otomatis dan insight sudah berlabel "segera hadir".

## H4. Hal terbuka

1. **Rumus outlet tambahan** saat checkout. Sekarang Rp99.000 × jumlah bulan paket, ditandai perkiraan. PRD hanya menyebut "proporsional dengan sisa masa aktif".
2. **URL produksi** untuk Masuk dan Daftar. Prototipe memakai tautan antarpapan.
3. **Galat memuat data di Backoffice** belum punya layar khusus di dalam halaman. Sekarang memakai halaman 500 dan toast.
4. **Font di DOCX**, apakah perlu disematkan.
5. **Logo HERMES POS**: belum ada simbol, baru wordmark.
6. **Ukuran kertas laporan** A4 atau Letter, dan apakah perlu periode bulanan.

## H5. Checklist QA sebelum rilis

- [ ] Tidak ada kode hex langsung di komponen. Semua lewat token.
- [ ] Tidak ada em dash di teks.
- [ ] Semua tombol 48px, chip 44px, radius 4px.
- [ ] Oranye maksimal satu blok penuh per layar.
- [ ] Setiap halaman data punya status isi, kosong, memuat, galat, dan terkunci.
- [ ] Fokus terlihat di semua elemen. Dialog dan laci bisa ditutup dengan Esc dan mengunci Tab.
- [ ] Tidak ada gulir horizontal di 390, 768, 1024, dan 1360px.
- [ ] Mode ID dan EN lengkap, tidak ada teks antarmuka yang tertinggal.
- [ ] Teks terkecil 13px, kontras lolos AA.
- [ ] Placeholder di H1 sudah diganti data asli.
- [ ] `prefers-reduced-motion` mematikan animasi.

---

# I. Aplikasi POS (Android)

Papan: `POS.dc.html` (interaktif, semua alur) dan 27 papan turunan per layar. Kode aplikasi: React Native, Expo, NativeWind. Bagian ini menggantikan `docs/UI_UX_SYSTEM.md` versi lama (tema krem, cokelat kopi, terakota).

## I1. Prinsip khusus kasir

Pengguna utama adalah Sari: kasir yang bekerja cepat di jam ramai, satu tangan memegang nampan, dan benci salah ketuk. Turunannya:

1. **Satu bill tunai 3 item selesai di bawah 30 detik:** ketuk produk → Lihat bill → Bayar → Pas → Bayar → Catat pembayaran.
2. **Aksi utama selalu di kanan bawah,** dalam jangkauan jempol. Tombol kedua di kiri.
3. **Uang tidak boleh salah.** Setiap pembayaran melewati satu konfirmasi berisi total, tunai, dan kembalian. Tombol dikunci selama proses supaya tidak terkirim dua kali.
4. **Status jaringan selalu terlihat** saat offline atau saat ada antrean. Saat online dan antrean kosong, tidak ada indikator, supaya tidak ramai.
5. **Gagal tidak boleh diam.** Galat server tidak boleh tampil sebagai daftar kosong. Printer yang gagal tidak membatalkan pembayaran.

## I2. Penyesuaian dari sistem web

| Hal | Web (bagian A) | POS |
|---|---|---|
| Teks isi | 16 sampai 18px | 15px, label 13px, teks terkecil 12px (hanya nilai grafik) |
| Tinggi tombol | 48px | 44 (`btn-sm`), 48 (bawaan), 54 (`btn-lg`, untuk Bayar, Tahan, Tutup shift). PRD X3 menyebut 40 untuk tombol kecil; dinaikkan ke 44 supaya memenuhi target sentuh 44px (PRD X7) tanpa `hitSlop` |
| Target sentuh | 44px | 44px minimal; stepper dan tombol ikon 44 × 44 |
| Hover | naik 2px, bayangan 3px | tidak ada. Saat ditekan: turun 1px, latar `--tint` |
| Bayangan keras | tombol, panel | dialog konfirmasi dan lembar di tablet (6px), toast (4px). Tombol tanpa bayangan |
| Jarak bawah | | navigasi dan footer lembar memberi 20px + 16px di atas gesture bar (PRD X4) |
| Bilah status | | 28px, mono 13px, ikut warna `--paper` |
| Tombol bahaya | | `btn-danger` (teks dan garis `--error`) untuk Hapus, Void, Keluar akun. `btn-danger-solid` (latar `--error`, teks `--slip`) hanya untuk konfirmasi akhir |
| Oranye | satu blok per layar | sama. Blok kembalian di layar berhasil memakai pine, karena tombol Bill baru sudah oranye |

## I3. Kerangka dan navigasi

**Ponsel portrait (< 700px)**
- Dari atas: bilah status, header halaman, isi (menggulir), dock bill (hanya di Jual dan saat bill berisi), navigasi bawah.
- **Header:** logo outlet (kotak 44px, 32px di ponsel landscape, `contain` supaya logo lebar atau tinggi tidak gepeng; tidak tampil kalau outlet belum punya logo), judul halaman (Bricolage 30px), sub mono "Sari · Shift 3 · Outlet Utama", chip offline atau antrean (kalau ada), lonceng 44px dengan lencana jumlah belum dibaca. Urutan sub dimulai dari nama kasir, supaya yang terpotong di layar sempit adalah nama outlet, bukan kasir.
- **Navigasi bawah, 4 tab:** Jual, Bill, Shift, Lainnya. Ikon garis 2px buatan sendiri. Tab aktif berteks ink dengan bilah oranye 4px di tepi atas. Tab Bill punya lencana jumlah bill ditahan.

**Tablet landscape (≥ 900px) dan ponsel landscape (≥ 700px dengan tinggi ≤ 520px)**
- Rail kiri 108px (ponsel landscape 86px) berisi wordmark dan 4 tab. Tab aktif berupa kartu slip bergaris dengan kotak oranye 10px, sama dengan sidebar Backoffice.
- **Jual:** katalog di tengah (4 kolom di tablet, 2 di ponsel landscape) dan panel bill tetap di kanan, lebar 404px (ponsel landscape 340px).
- **Bill:** daftar di kiri, rincian di kanan. Kalau belum ada yang dipilih, panel kanan menampilkan "Pilih bill di kiri."
- **Shift dan Lainnya:** dua kolom.
- Lembar bawah berubah jadi dialog di tengah layar (maks 560px). Layar penuh (Bayar, Berhasil) jadi dialog besar (maks 940 × 720) dengan latar redup.
- **Ponsel landscape:** keypad pindah ke samping nominal (Bayar, Buka shift, Tutup shift, PIN), dan teks bantuan banner disembunyikan.

Grid katalog: 2 kolom di bawah 600px, 3 kolom di 600 sampai 899px, 4 kolom di tablet. Memutar layar tidak menghapus bill atau isian (state ada di store, bukan di layar).

## I4. Komponen POS

| Komponen | Spesifikasi |
|---|---|
| Kartu produk, mode Foto (bawaan) | Slip, garis 1.5px. **Bingkai seragam:** foto diberi jarak kertas 7px (5px di ponsel landscape) dan garis ink 1.5px sendiri, tinggi 88px di ponsel, 104px di tablet, 58px di ponsel landscape, dipotong `cover`. Foto tampil asli tanpa edit warna. Bingkai dan kertas inilah yang menyatukan foto dari pemilik yang beragam; lihat papan `FotoMenu.dc.html`. Lalu nama 15px 600 (maks 2 baris, 1 baris di landscape) dan harga mono 15px tanpa "Rp" dengan tag stok di kanan. Menu tanpa foto: blok `--tint` dengan inisial Bricolage 30px warna mute (maks 2 huruf), supaya baris grid tetap rata. Habis: foto hitam putih 50% dengan arsiran diagonal, kartu nonaktif. Jumlah di bill: kotak oranye 32px di pojok kanan atas foto. |
| Kartu produk, mode Ringkas | Tinggi min 112px (100px di ponsel landscape, supaya nama dua baris tidak membuat tinggi baris grid berbeda), nama 15px 600 maks 2 baris, harga mono 15px, tag stok. Tanpa foto. Tag stok: tidak tampil untuk produk tanpa lacak stok, "stok 23" netral, fire-soft kalau sisa ≤ 5, "habis" dengan arsiran diagonal dan nonaktif. Ketuk sekali menambah 1. |
| Kartu menu sementara | Garis putus-putus, transparan, di akhir grid (kategori Semua atau Lainnya, tanpa pencarian). |
| Dock bill (ponsel) | Tinggi 66px, pine, garis ink. Kiri: kotak oranye berisi jumlah item. Tengah: "Bill · Meja 4" (pine-text 13px) dan total mono 21px. Kanan: "Lihat bill" dan chevron. |
| Baris bill | Nama 15px 600, "2 × Rp22.000" mono 13px, total baris kanan. Catatan dengan garis kiri oranye 3px. Diskon mono pine. Aksi: stepper 44px (− di jumlah 1 menghapus baris, dengan toast Batalkan), Catatan, Diskon (pine-soft kalau terisi), hapus. Pemisah putus-putus. |
| Footer bill | Diskon bill, Voucher, Pisah bill (hanya untuk bill ditahan yang dipanggil). Lalu Subtotal, Diskon item, Diskon bill, Voucher (hanya yang ada nilainya). Total Bricolage 32px. Tombol Tahan (Simpan untuk bill ditahan yang dipanggil) dan **Bayar** (oranye), keduanya 54px dan sama lebar. Bayar tidak memuat nominal karena total ada tepat di atasnya; pembaca layar tetap membacakan "Bayar Rp…". Ponsel landscape: Voucher dan Total (Bricolage 24px, mengecil otomatis) berbagi satu baris, tombol 48px. Footer menepi selama kasir mengetik di kolom bill (catatan item, meja, nama) supaya kolomnya tidak tertutup; mengetik di pencarian menu tidak menyembunyikannya. |
| Keypad angka | Grid 3 × 4: 1 sampai 9, 000, 0, hapus. Tombol 54px (44px di landscape), mono 22px. Dipakai untuk uang diterima, kas awal, hitungan laci, dan PIN (tanpa 000). Isian uang tidak membuka keyboard sistem (`showSoftInputOnFocus={false}`). |
| Kotak nominal | Tinggi 64px, slip, garis ink dengan garis dalam oranye 1.5px (menandakan sedang diisi). Label mono kiri, nilai mono 28px kanan. |
| Kotak kembalian | Pine-soft "Kembalian", error-soft "Kurang", tint-3 "-" saat belum diisi. |
| Nominal cepat | 4 chip: Pas, lalu pembulatan 10rb, 50rb, 100rb di atas total. |
| Lembar (sheet) | Dari bawah, maks 92% tinggi layar, pegangan 44 × 5px, header (judul Bricolage 27px, sub 14px, tutup 44px), isi menggulir, footer tetap. |
| Dialog konfirmasi | Di tengah layar, bayangan 6px, judul berupa pertanyaan, dua tombol. |
| Chip jaringan | Di header. Fire-soft "Offline · 3", error-soft "Ditolak 1". Di ponsel portrait hanya ikon dan angka (44px), supaya sub judul outlet dan kasir tidak terpotong; label lengkap tetap ada di `accessibilityLabel`. Ketuk membuka antrean. |
| Toast | Ponsel: di atas navigasi. Tablet: kanan atas. Pine-soft untuk sukses, fire-soft untuk gagal. Aksi opsional (Batalkan, Coba lagi, Buka shift). Hilang setelah 3.6 detik, atau 6 detik kalau ada aksi. |
| Struk di layar | Mono 14px, baris kiri kanan, pemisah putus-putus, tepi bawah sobek. Total memakai blok oranye, kecuali di layar Berhasil. Logo outlet 72px (`contain`) di tengah atas, kalau ada. |
| Angka besar | Nominal yang bisa panjang (total tagihan, kembalian, omset, rata-rata) selalu satu baris, rata kanan di ruang yang tersisa, dan mengecil otomatis (`adjustsFontSizeToFit`). Tag di samping label boleh turun ke baris berikutnya (`flex-wrap`). |
| Tag di baris daftar | Baris bill dua lapis: nomor dan nominal di atas, keterangan dan tag di bawah, keduanya rata kiri dan kanan. Tag tidak memakai `self-start` di baris ini. |

## I5. Layar per layar

**1. Masuk akun pemilik.** Wordmark dan tag "kasir", judul "Masuk dengan akun pemilik.", Email atau username, kata sandi dengan tombol Lihat, Masuk (oranye, 54px). Galat: "Isi email atau username, dan kata sandi.", "Format email atau username belum benar.", "Email/username atau kata sandi salah.", "Masuk perlu internet." Sepuluh kata sandi salah untuk satu username mengunci masuk lewat username 15 menit ("Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit."); masuk lewat email tetap bisa. Tablet: panel brand di kiri dengan struk TUNDA.

**2. Pilih kasir.** Logo outlet 88px di tengah atas (dari kasir pertama di daftar, karena belum ada sesi; tidak tampil kalau tidak ada logo), lalu "Siapa yang jaga kasir?", daftar kasir 76px (avatar kotak pine berisi inisial, nama, outlet). Tag "PIN belum dibuat" (fire-soft) atau "terkunci 4 menit" (error-soft) di bawah nama. Saat offline, banner menjelaskan bahwa daftar diambil dari simpanan perangkat. Bawah: Keluar akun.

**3. PIN.** Lembar dengan 6 kotak 56px (terisi: kotak ink 16px), pesan status, keypad. PIN diperiksa otomatis begitu digit keenam masuk. Galat: "PIN salah. Sisa percobaan: 3.", "Terlalu banyak salah. Coba lagi dalam 5 menit.", "PIN tidak bisa diperiksa. Periksa koneksi internet."

**4. Jual.** Urutan banner, paling banyak satu dari kelompok jaringan dan satu dari kelompok shift:
1. Pembayaran belum terkonfirmasi (error-soft, Hapus data atau Lanjutkan).
2. Antrean offline (fire-soft, Tinjau atau Sinkronkan) atau antrean ditolak (error-soft).
3. Pengingat langganan ≤ 7 hari atau trial (fire-soft, bisa ditutup). Di ponsel hanya satu baris judul dan tombol tutup; rinciannya ada di Lainnya. Disembunyikan saat banner 1 atau 2 tampil.
4. Shift belum dibuka (slip, tombol Buka shift). Kartu produk ikut terkunci.

Lalu satu baris berisi pencarian dan tombol **Kategori** (140px) yang membuka daftar kategori dalam lembar pilihan, sama di portrait dan landscape, lalu grid produk. **Bawaan: Ringkas.** Foto dari pemilik bermacam-macam dan bisa menyaingi UI, jadi Foto jadi pilihan yang dinyalakan kasir di Lainnya. Mode Foto hanya berlaku kalau minimal satu produk di outlet punya foto; kalau tidak ada sama sekali, tetap Ringkas. Ponsel portrait mode Foto memuat sekitar 4 kartu di atas lipatan, mode Ringkas sekitar 6.

**5. Bill.** Ponsel: lembar 92%. Tablet: panel kanan tetap. Isinya pelanggan (opsional) dan meja, baris bill, footer. Kosongkan bill memunculkan toast dengan Batalkan. Tag "dipanggil · #HPOS-…" muncul untuk bill ditahan yang dipanggil, dan Tahan berganti label jadi Simpan.

**6. Bayar.** Layar penuh. Isinya total tagihan (Bricolage 40px, satu baris, mengecil otomatis), lalu chip metode **Tunai** dan **QRIS**. **Tunai:** uang diterima, kembalian atau kurang, nominal cepat, keypad, dan tombol "Bayar Rp…" yang nonaktif dengan label "Masukkan uang diterima" atau "Kurang Rp…" sampai uangnya cukup. **QRIS:** keypad dan nominal cepat hilang, diganti kotak fire-soft "Nominal QRIS: Rp…" dan "Pastikan pembayaran QRIS berhasil diterima sebelum mencatat transaksi.", lalu tombol "Konfirmasi QRIS Rp…". Pelanggan memindai QRIS milik outlet di luar aplikasi. Ganti metode mengosongkan uang diterima. Tablet menampilkan ringkasan struk di kiri. Pembayaran pisah bill memakai layar yang sama, dengan meta "Meja 9 · bagian 2".

**7. Konfirmasi.** Dialog "Catat pembayaran ini?" dengan total, metode, uang diterima atau nominal QRIS, dan kembalian (tunai saja), lalu Periksa lagi atau Catat pembayaran. Catatannya berubah saat offline: pembayaran disimpan di perangkat dengan nomor sementara.

**8. Berhasil.** Tag lunas (pine-soft), "Pembayaran tercatat.", nomor bill, blok pine berisi "Kembalian" (tunai) atau "Pembayaran QRIS" dengan total (QRIS), angka Bricolage 44px satu baris rata kanan, Cetak struk pelanggan, Tiket dapur dan Tiket bar, pratinjau struk, lalu Bill baru (oranye). **Versi offline:** tag "belum terkirim · offline", judul "Tersimpan di perangkat.", nomor `TUNDA-XXXXXX`, dan pengingat untuk tidak menutup shift sebelum antrean kosong.

**9. Bill (riwayat shift).** Pencarian (nomor, meja, nama), lalu **chip shift** yang bisa digeser: "Shift ini" dan shift outlet yang ditutup dalam 24 jam terakhir, dari kasir mana pun, maks 10 ("S2 · Budi · 08.00–15.00"). Baris chip hanya tampil kalau ada shift lama. Saat shift lama dipilih, teks mute di bawahnya: "Shift sudah ditutup. Bill bisa dilihat, dicetak ulang, dan direfund dalam 24 jam. Refund masuk ke shift ini." Lalu tab Selesai, Ditahan, dan Void dengan jumlah, lalu baris 72px dua lapis (nomor mono dan total di atas; "12.58 · Meja 7 · 3 item" dan tag status di bawah, rata kanan). Tag status: lunas (pine-soft), refund sebagian (fire-soft), refund (error-soft), ditahan, void. Daftar dimuat per halaman dengan catatan "Menampilkan 6 dari 42 bill." Kalau shift belum buka, layar kosong menjelaskan bahwa riwayat lama ada di backoffice. Lencana bill ditahan di tab selalu milik shift yang sedang buka.

**10. Rincian bill.** Struk (waktu, meja, pelanggan, kasir pemilik shift, item, catatan, diskon, total, tunai, kembalian). Bill yang pernah direfund menambah "Direfund n" di bawah item, lalu "Refund −Rp…" (error) dan "Bersih" (tebal) di bawah pembayaran. Aksinya tergantung status:

| Status | Aksi |
|---|---|
| Selesai | Cetak ulang struk, dapur, atau bar. Footer: Void bill (`btn-danger`) dan Refund item (oranye) selama bill kurang dari 24 jam dan masih punya item tersisa; setelah itu tombol kanan kembali jadi Cetak ulang struk (pine) |
| Selesai, sudah direfund | Void bill nonaktif (void setelah refund memotong kas dua kali; server juga menolak) |
| Selesai, shift lama | Void bill tidak tampil (server menolak void di shift tertutup). Refund dan cetak ulang tetap ada |
| Ditahan | Hapus, atau Panggil bill (oranye). Kalau bill di layar masih berisi, muncul konfirmasi "Ganti bill di layar?" |
| Void | Kotak alasan "disetujui pemilik" dan tombol Tutup |

**11. Void.** Penjelasan dampaknya, alasan (min 3 huruf), dan kode persetujuan pemilik 6 digit, lalu Void bill ini (`btn-danger-solid`). Galat: alasan, format kode, kode salah, dan "Void perlu internet." Bentuk kode masih menunggu keputusan (PRD 20, pertanyaan 4).

**11a. Refund item.** Lembar tinggi. Sub: nomor bill, total, metode bayar. Penjelasan "Pilih item yang dikembalikan. Refund masuk ke shift ini dan tidak bisa dibatalkan." Lalu kartu per item yang masih tersisa: nama, "sisa n dari m" mono, stepper 0 sampai sisa. Kalau jumlahnya lebih dari 0 dan produknya dilacak stok, muncul chip **Kembalikan ke stok** (bawaan mati, karena makanan yang sudah dimasak tidak kembali ke stok). Lalu chip **Tunai** (bawaan) atau **QRIS/transfer**, tidak harus sama dengan cara bayar bill. Kotak tint-3 "Perkiraan refund" dengan nominal mono rata kanan; nilai final dihitung server. Lalu alasan (min 3 huruf) dan kode persetujuan pemilik 6 digit (sama dengan void). Footer: Kembali dan "Refund Rp…" (`btn-danger-solid`, nonaktif sampai ada item). Galat: pilih item, alasan, format kode, kode salah (sisa percobaan), terkunci 5 menit, lewat 24 jam, jumlah melebihi sisa, dan "Refund perlu internet." Setelah berhasil: toast sukses ("{nomor} · Rp… keluar dari kas laci." atau "kembalikan Rp… lewat QRIS atau transfer.") dengan aksi **Cetak struk**, lalu rincian bill dimuat ulang.

**Struk refund (cetak).** Header outlet, judul STRUK REFUND, nomor bill asli, waktu refund, kasir yang melakukan refund, item dan jumlah yang direfund (tanpa nilai per item), TOTAL REFUND dari server rata kanan, "Dikembalikan Tunai" atau "QRIS/transfer", dan alasan. Dicetak ke printer Cetak ulang, atau printer Struk kalau tidak ada. Printer gagal tidak membatalkan refund.

**12. Pisah bill.** Dua kartu ringkas (Sisa bill, Bagian N), nama di bagian ini, lalu baris dengan stepper porsi (0 sampai sisa). Tombol "Bayar bagian ini · Rp…". Setelah dibayar, layar kembali ke pisah bill dengan sisa porsinya. Bagian terakhir menutup bill ditahan. Perlu internet.

**13. Shift berjalan.** Kartu penjualan shift (Bricolage 52px, omset bersih setelah refund; tag "buka sejak" turun ke baris bawah kalau tidak muat; lalu Bill, Rata-rata, Void; lalu "Refund (n) −Rp…" error kalau ada refund di shift ini), Cetak laporan dan Tutup shift. Kotak "Shift belum bisa ditutup" mendaftar alasan beserta tombolnya: bill ditahan (Lihat), antrean offline (Tinjau), dan tidak ada internet. Lalu penjualan per jam (jam tersibuk oranye), kas laci (kas awal, tunai masuk, refund tunai keluar, kas seharusnya), menu terlaris, dan shift hari ini. Laporan shift cetak menambah baris Refund (n). Refund untuk bill shift lama ikut terhitung di shift tempat refund dilakukan.

**14. Buka shift.** Saat tidak ada shift: kartu "Buka shift untuk mulai jualan." Lembar Buka shift berisi kas awal, chip Rp0/100rb/200rb/300rb, dan keypad, dengan catatan "Hitung uang di laci lalu masukkan sebagai kas awal. Tanggal bisnis dikunci saat shift dibuka." Tanggal bisnis mengikuti zona waktu bisnis (WIB, WITA, atau WIT). Nonaktif saat langganan berakhir. Bisa offline: pembukaan masuk antrean.

**14a. Catat pengeluaran.** Dari tab Shift selama shift buka. Satu kartu per barang: nama, kategori (Operasional atau Belanja), jumlah, satuan, harga total, dan sumber uang (kas laci atau bukan). Satuan dipilih lewat tombol yang membuka lembar pilihan (kg, gr, L, ml, pcs, pack, dus, botol, sachet, ikat, karung, lusin), bukan deretan chip. Masuk antrean saat offline seperti penjualan.

**15. Tutup shift dan hasil.** Kas seharusnya dari server, uang di laci dengan keypad, lalu Tutup shift. Hasil: "Kas sesuai." (pine-soft) atau "Kas kurang Rp15.000." (error-soft) dengan struk kas seharusnya, hitungan kasir, selisih, penjualan, dan jumlah bill. Lalu Cetak laporan dan Selesai.

**16. Lainnya.** Kartu kasir, kartu langganan (hanya baca), Perangkat (Printer, Tampilan katalog Foto atau Ringkas, Bahasa ID/EN), Katalog (mengarah ke backoffice), Tentang, lalu Keluar akun dan Ganti kasir. Ganti kasir dengan bill berisi dan Keluar akun dengan antrean berisi memunculkan konfirmasi berperingatan (PRD E6).

**17. Printer.** Tambah printer (cari perangkat Bluetooth yang sudah di-pair), lalu kartu per printer: nama, merek · lebar · ESC/POS · Bluetooth, tag terhubung/galat/belum diuji, galat terakhir, peran (Struk pelanggan, Dapur, Bar, Cetak ulang, Laporan), lebar kertas 58 atau 80 mm, Hapus dan Cetak uji. Hasil cetak uji tampil di kartu. Isi struk diatur di backoffice.

**18. Antrean offline.** Entri berisi nomor, waktu, jumlah, ringkasan item, dan tag menunggu atau ditolak, beserta alasan penolakan. Aksinya Hapus (dengan peringatan bahwa penjualan tidak akan masuk laporan) dan Coba lagi. Bawah: Sinkronkan.

**19. Lonceng.** Notifikasi langganan dan refund ("Refund Rp… pada #HPOS-… oleh Sari. Alasan: …") dirender dari jenis dan parameternya, dengan titik oranye untuk yang belum dibaca. Ada aksi Tandai sudah dibaca.

**20. Terkunci.** Muncul di tab Jual saat langganan berakhir: "Penjualan baru dikunci.", struk langganan, tiga langkah memperpanjang, kontak, Lihat riwayat bill, dan Periksa status langganan. Bill tetap bisa dibuka, void dinonaktifkan, dan shift baru tidak bisa dibuka.

## I6. Matriks status

| | online | offline | ada entri ditolak | pembayaran belum terkonfirmasi |
|---|---|---|---|---|
| Header | tanpa chip | chip "Offline · n" | chip "Ditolak n" | tanpa chip |
| Jual | normal | banner antrean, bayar masuk TUNDA | banner error-soft | banner Lanjutkan atau Hapus data |
| Voucher | dicek server | ditolak dengan penjelasan | | |
| Void, refund, buka shift, tutup shift, pisah bill | bisa | nonaktif dengan alasan | | |
| Masuk, PIN | bisa | daftar kasir dari simpanan, PIN gagal diperiksa | | |

| | aktif | trial | berakhir |
|---|---|---|---|
| Banner Jual | ≤ 7 hari sebelum berakhir | selalu, dengan batas trial | layar Terkunci |
| Lainnya | Bulanan · 7 hari lagi | Trial · 2 hari lagi | Bulanan · berakhir |
| Penjualan, shift baru, void, refund | bisa | bisa | dikunci |

## I7. Perubahan dari aplikasi lama

| Aplikasi lama | Desain baru | Alasan |
|---|---|---|
| Tema krem, cokelat kopi, terakota, radius 12 sampai 20px | Paper, pine, oranye, radius 4px, garis ink 1.5px | Satu sistem dengan landing dan backoffice |
| 5 tab: Dashboard, Kasir, Pesanan, Shift, Setting | 4 tab: Jual, Bill, Shift, Lainnya | Dashboard per periode adalah laporan pemilik (sudah di backoffice). Ringkasan untuk kasir pindah ke Shift (PRD B2) |
| Tombol Menu Sementara dan Transaksi Baru di atas katalog | Kartu menu sementara di grid. Transaksi Baru dihapus, diganti Tahan | Satu baris lebih untuk produk; Tahan sudah melakukan hal yang sama |
| Foto di kartu produk, ikon kopi kalau tidak ada foto | Foto 4:3 tetap ada (mode Foto). Menu tanpa foto memakai inisial, bukan ikon kopi yang sama untuk semua. Mode Ringkas tanpa foto bisa dipilih per perangkat | Foto membantu kasir baru mengenali menu; inisial membedakan menu tanpa foto; Ringkas untuk HP lama dan menu panjang |
| Pilihan bayar Tunai dan QRIS | Tunai dan QRIS, QRIS dikonfirmasi kasir tanpa keypad | PRD C11: QRIS umum di kafe; konfirmasi otomatis butuh payment gateway (di luar rilis pertama) |
| Isian uang dengan keyboard sistem | Keypad besar di layar dan nominal cepat | Satu tangan, tanpa keyboard menutupi total |
| Pisah bill memunculkan peringatan kalau bukan bill ditahan | Tombol Pisah bill hanya muncul untuk bill ditahan yang dipanggil | Tombol yang tidak bisa dipakai tidak perlu tampil |
| Void cukup dengan alasan | Alasan dan kode persetujuan pemilik | PRD C8 |
| Komplain sebagian diselesaikan dengan void lalu input ulang | Refund per item dengan kode persetujuan, termasuk bill shift lama dalam 24 jam | PRD C12 |
| Belum ada voucher, lonceng, layar terkunci, bahasa | Ada | PRD C5, G2, G3, X1 |
| Teks tambahan cetak di layar Printer | Dipindah ke backoffice (Bisnis dan struk) | Satu tempat untuk isi struk |
| Kategori dan Produk dikelola di POS | Baris di Lainnya mengarah ke backoffice | PRD F, menu disembunyikan setelah backoffice teruji (P1) |
| Portrait saja di beberapa layar | Ponsel portrait, ponsel landscape, tablet landscape | PRD X2 |

## I8. Implementasi di React Native dan NativeWind

**Token warna.** Nama kunci `kas.*` tetap dipakai supaya `className` yang ada tidak perlu diganti massal. Nilainya yang diganti, ditambah token baru. Dengan tabel ini, `text-kas-muted` dan `bg-kas-surface` langsung ikut gaya baru. Varian tombol, kartu produk, dock, dan navigasi tetap perlu diubah sesuai bagian I4.

```js
// tailwind.config.js
colors: {
  kas: {
    background: '#EEF0EA',        // paper
    surface: '#FBFBF8',           // slip
    subtle: '#E3E6DC',            // tint
    white: '#FBFBF8',
    primary: '#0E3B2F',           // pine (dock, chip terpilih, tombol simpan)
    primaryContainer: '#0E3B2F',
    secondary: '#FF6A13',         // fire (aksi utama, penanda aktif)
    secondaryContainer: '#FFE6D3',// fire-soft
    text: '#101412',              // ink
    muted: '#555A50',
    border: '#101412',            // garis komponen 1.5px
    rule: '#D9DDD0',              // pemisah baris
    success: '#0E3B2F', successBg: '#DDEBE2',
    warning: '#101412', warningBg: '#FFE6D3',
    error: '#8A2A0C', errorBg: '#FFF3EA', errorLine: '#B3320A',
    infoBg: '#F1F3EB',
    tint2: '#E1E4DA', disabledLine: '#C3C8BA', off: '#D8DBD0',
    pineHover: '#17503F', pineText: '#C9D6CF', fireHover: '#FF8440',
  },
},
borderRadius: { 'kas-sm': '4px', 'kas-md': '4px', 'kas-lg': '4px', 'kas-xl': '4px', 'kas-pill': '4px' },
fontFamily: {
  display: ['BricolageGrotesque_800ExtraBold'],
  body: ['InstrumentSans_400Regular'],
  'body-600': ['InstrumentSans_600SemiBold'],
  'body-700': ['InstrumentSans_700Bold'],
  mono: ['IBMPlexMono_500Medium'],
  'mono-600': ['IBMPlexMono_600SemiBold'],
},
```

```ts
// src/theme/index.ts
export const controls = {
  buttonHeight: 48, compactButtonHeight: 40, largeButtonHeight: 54,
  inputHeight: 48, iconButtonSize: 44, navHeight: 62, borderWidth: 1.5,
  cardPadding: 16, gridGap: 10, bottomSafe: 20 + 16,
} as const;
export const typography = { label: 13, body: 15, title: 27, hero: 30, amount: 40, min: 12 } as const;
```

**Catatan implementasi**
- **Font:** pakai `@expo-google-fonts/bricolage-grotesque`, `@expo-google-fonts/instrument-sans`, dan `@expo-google-fonts/ibm-plex-mono` dengan `useFonts` sebelum splash ditutup. Di Android setiap bobot adalah family sendiri, jadi jangan mengandalkan `fontWeight` untuk font kustom. Angka uang selalu `fontVariant: ['tabular-nums']`.
- **Garis 1.5px:** `borderWidth: 1.5` didukung RN. Di layar berdensitas rendah, cek hasilnya tidak kabur.
- **Bayangan keras:** pakai prop gaya `boxShadow: '6px 6px 0 #101412'` (React Native New Architecture), bukan `elevation` atau `shadow-lg` yang selalu buram. Hanya untuk dialog konfirmasi, lembar di tablet, dan toast (`4px 4px 0`).
- **Tepi struk sobek:** pakai `react-native-svg` (path zigzag 12px) di bawah kartu struk.
- **Saat ditekan:** `Pressable` dengan `style={({pressed}) => pressed && { transform: [{ translateY: 1 }], backgroundColor: '#E3E6DC' }}`. Opsional getar ringan (`expo-haptics`) saat produk ditambahkan.
- **Lembar:** komponen `BottomSheet`, `SheetHeader`, dan `ActionFooter` tetap dipakai (PRD X3). Di tablet, render sebagai modal di tengah layar dengan lebar maks 560.
- **Tata letak responsif:** `useWindowDimensions`. Rail dan panel bill aktif saat `width >= 900`, atau saat `width >= 700 && height <= 520`. Kolom grid 2, 3, atau 4.
- **Foto menu:** pakai `expo-image` dengan `cachePolicy="disk"` dan `recyclingKey` per produk, supaya katalog tetap tampil dengan foto saat offline (PRD C1, katalog dari simpanan). Ambil ukuran 320 × 240 di ponsel dan 640 × 480 di tablet, `contentFit="cover"`, `transition={120}`. Kalau foto gagal dimuat, tampilkan blok inisial, jangan kotak kosong. Simpan pilihan Foto atau Ringkas di `@hermes-pos/catalog-view`. Kolom `products.image_url` sudah ada di data model aplikasi lama (`imageUrl`).
- **Bahasa:** semua teks lewat kamus (PRD X1). Kunci teks prototipe ada di `i18n/POS.en.json` pada sumber desain dan bisa dipakai sebagai titik awal.
- **Identitas teknis (diganti 15 Okt 2026, migrasi 038 dan 039):** paket `com.hermespos.pos`, kunci `@hermes-pos/…`, modul `HermesPosBluetoothPrinter`, dan awalan `#HPOS-` untuk bill baru. Bill lama tetap bernomor `#KBX-` (PRD 15).

## I9a. Audit 12 Okt 2026

Diperiksa otomatis di 27 papan POS, lima ukuran layar (390 × 844, 360 × 740, 844 × 390, 1024 × 700, 1280 × 800), bahasa ID dan EN: gulir horizontal, target sentuh di bawah 44px, teks di bawah 12px, kontras di bawah AA, tombol ikon tanpa label, teks terpotong, dan elemen yang mengempis. Setelah perbaikan semuanya nol. Alur interaktif (jual, bayar, tahan, panggil, pisah bill, void, tutup shift) diuji ulang dengan klik otomatis.

| Temuan | Perbaikan |
|---|---|
| Lencana jumlah di tab Bill berteks mute di atas oranye (kontras 2,47) | Teks lencana selalu ink (6,48) |
| Tombol kecil 40px: Lihat, Tinjau, Sinkronkan, Struk, Dapur, Bar, Tiket dapur, Hapus, Coba lagi | `btn-sm` jadi 44px |
| Tab Selesai, Ditahan, Void mengempis jadi garis di tablet yang pendek | Isi kolom daftar tidak boleh menyusut; hanya daftar yang menggulir |
| Ponsel landscape: panel bill tidak menampilkan item sama sekali | Label Pelanggan dan Meja disembunyikan (placeholder jadi labelnya), rincian subtotal disembunyikan, hanya total |
| Ponsel portrait: pengingat langganan memakan 3 baris di atas katalog | Satu baris judul dan tombol tutup |
| Ponsel portrait: chip Offline memotong sub judul header | Chip hanya ikon dan angka |
| Lainnya: baris Bahasa dan Tampilan katalog tidak seragam | Keduanya teks di atas, kontrol di bawah |
| Placeholder meja "-" | "Meja", dan "Nama (opsional)" |

**Kode aplikasi lama yang perlu diganti saat membangun desain ini** (berdasarkan isi zip `coloony-pos`):

| Tempat | Sekarang | Ganti dengan | Alasan |
|---|---|---|---|
| `BottomNav` | ikon dan garis bawah tab beranimasi spring (core `Animated`) | tanpa animasi; status aktif langsung berganti | Pindah tab terjadi ratusan kali sehari; tab adalah setara, bukan hierarki |
| `AnimatedPressable` | core `Animated.spring` untuk skala tekan | Reanimated 4 (sudah ada di `package.json`): transisi CSS `transform: scale(0.97)`, 120ms, `cubicBezier(0.23, 1, 0.32, 1)`. Baris daftar selebar layar tidak diskalakan, cukup latar `--tint` | Berjalan di UI thread, tetap halus saat JS sibuk menyimpan bill |
| `Toast` | masuk dengan spring memantul, keluar dengan `Easing.in`, `elevation: 12` | masuk 200ms ease-out dari `translateY: 8` dan opacity 0, keluar 150ms; `boxShadow` keras 4px | Tidak ada `ease-in` di UI; bayangan sesuai sistem |
| `BottomSheet` | `Modal` React Native dengan `animationType` | `BottomSheet` dari `@expo/ui` (`isPresented`, `onDismiss`, `snapPoints`) untuk Bill, PIN, Catatan, Diskon, Voucher, Buka shift, Tutup shift. Isi lembar tetap gaya HERMES POS | Gestur tarik dan titik henti bawaan platform, tanpa membangun ulang di JS |
| `App.tsx`, `KeyboardSafeView`, `KeyboardAwareScrollView` | `Keyboard.addListener` untuk menyembunyikan navigasi | `react-native-keyboard-controller` (`KeyboardProvider` di root) | Tombol utama lembar (Void, Simpan catatan) tidak boleh tertutup keyboard |
| `CartDock` | `shadow-lg` buram | garis ink 1.5px, tanpa bayangan | Bayangan hanya untuk elevasi yang bermakna |
| `ProductCard` | `Image` React Native | `expo-image` dengan simpanan disk | Foto tetap tampil saat offline |
| Ikon | `@expo/vector-icons` MaterialCommunityIcons | ikon garis 2px sendiri lewat `react-native-svg` | Sama dengan landing dan backoffice |

**Haptic** (`expo-haptics`), satu per aksi dan selalu bersama perubahan visual: `selectionAsync` saat produk ditambahkan dan saat stepper berubah, `notificationAsync(Success)` saat pembayaran tercatat, `notificationAsync(Error)` saat PIN salah atau pembayaran ditolak, `impactAsync(Medium)` saat void dikonfirmasi. Tidak ada haptic saat menggulir atau pindah tab.

**Gerak yang dihapus atau tidak dibuat:** pindah tab, buka dan tutup keyboard, dan baris daftar bill tidak beranimasi. Masuknya baris tidak memakai `entering` pada daftar yang divirtualisasi. Semua gerak menghormati `useReducedMotion()`: hanya opacity yang tersisa.

### Tindak lanjut audit prinsip UI/UX (12 Okt 2026)

Dari penilaian Simplicity, Consistency, Visual Hierarchy, dan Feedback:

| Temuan | Perubahan |
|---|---|
| Foto penuh warna menyaingi tombol dan aksen | Katalog bawaan **Ringkas**. Foto jadi pilihan di Lainnya (Tampilan katalog) |
| Sheet Bill terlalu padat | Pelanggan dan meja dilipat jadi satu baris ringkasan ("Meja 4 · Dimas" atau "Tambah meja atau nama (opsional)") yang membuka dua isian. Di tiap baris item, Catatan dan Diskon dipindah ke tombol **Opsi**; catatan dan diskon yang sudah diisi tetap terlihat di baris. Satu baris Opsi terbuka pada satu waktu |
| Tidak ada keadaan memuat | Skeleton arsiran (tanpa animasi, `role="status"`, `aria-busy`) pada grid katalog: 6 kotak, tinggi mengikuti mode Foto atau Ringkas |
| Tidak ada keadaan gagal | Kotak galat "Menu belum bisa dimuat." dengan tombol **Coba lagi**; bill yang sedang dibuat tidak terganggu. Prop pratinjau `menu`: siap, memuat, gagal |
| Foto gagal dimuat | Blok inisial selalu ada di bawah foto; kalau gambar gagal, gambar disembunyikan dan inisial tetap tampil |
| Sinkron tanpa umpan balik di header | Chip jaringan menampilkan "Mengirim..." selama sinkron berjalan |
| `btn-sm` 44 (desain) vs 40 (PRD X3) | Desain tetap 44 (target sentuh PRD X7). **PRD X3 perlu diubah dari 40 ke 44** |

Untuk React Native: skeleton memakai blok statis (tanpa shimmer, sesuai aturan tanpa gerak berulang); Coba lagi memanggil ulang query katalog; `expo-image` `onError` menyembunyikan gambar dan menampilkan inisial.

## I9. Hal terbuka untuk POS

1. **Bentuk kode persetujuan void:** PIN pemilik, kode sekali pakai, atau kode tetap. Desain memakai isian 6 digit.
2. **Voucher saat offline.** Desain menolak dan meminta internet, supaya antrean tidak berisi voucher yang nanti ditolak server. Perlu dikonfirmasi.
3. **Hitungan kas buta.** Desain sekarang menampilkan kas seharusnya sebelum kasir menghitung. Kalau pemilik ingin hitungan buta, sembunyikan angka itu di lembar Tutup shift dan di kartu Kas laci sampai shift ditutup.
4. **Menu Kategori dan Produk di POS:** disembunyikan sekarang, atau setelah backoffice teruji (P1).
5. **Logo bisnis di struk cetak.** Logo outlet sudah tampil di header, layar pilih kasir, dan struk di layar. Struk cetak belum memuat logo; perlu konversi gambar ke bitmap ESC/POS.
6. **Penyimpanan foto menu:** Supabase Storage dengan bucket per bisnis dan pembuatan dua ukuran di server (Edge Function) atau di peramban sebelum unggah. Batas jumlah foto mengikuti batas produk (100 per outlet), jadi kuota sekitar 100 × 60 KB per outlet.
7. **Foto contoh di prototipe** adalah gambar buatan untuk pratinjau, bukan foto produk asli. Sengaja dibuat beragam (lampu kuning, flash, taplak motif) untuk menguji bingkai.
8. **Cetak ulang struk refund.** Aksi cetak hanya ada di toast setelah refund berhasil. Belum ada cara mencetak ulang struk refund setelah toast hilang.
