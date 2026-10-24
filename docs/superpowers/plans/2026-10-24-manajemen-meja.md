# Manajemen Meja Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pemilik mengelola daftar meja; kasir memilih meja untuk bill makan di tempat dan bisa memindahkannya.

**Architecture:** Migrasi 091 menambah tabel `tables` dan kolom `table_id` pada transaksi. Status terisi diturunkan dari bill ditahan. BackOffice mendapat halaman Meja; kasir mendapat kotak pilih meja dan aksi pindah meja.

**Spec:** `docs/superpowers/specs/2026-10-24-manajemen-meja-design.md`

## Global Constraints
- Meja wajib untuk makan di tempat; bawa pulang tanpa meja.
- Status terisi tidak disimpan terpisah; diturunkan dari bill ditahan.
- Tutup shift dengan meja terbuka hanya memberi peringatan.
- Migrasi 091 mengikuti pola 088: RLS aktif, `revoke all`, fungsi `security definer` dengan `search_path`, grant ke authenticated saja.
- Teks Indonesia; setiap teks baru ada baris Inggris.

## Tasks

### Task 1: SQL (091)
- [ ] Tes gagal dulu (`supabase/tests/test_091.sql`): buat meja, nonaktifkan ditolak bila ada bill ditahan, makan di tempat tanpa meja ditolak, bawa pulang diterima, pindah meja, isolasi bisnis.
- [ ] Migrasi `091_tables.sql`: tabel, kolom `table_id`, fungsi `owner_save_table`, `owner_list_tables` (dengan status terisi dan jam mulai), `owner_move_held_bill`.
- [ ] Jalankan `/tmp/claude-1000/runsql.sh`; tanpa FAIL/ERROR. Commit.

### Task 2: POS (kasir)
- [ ] Tes gagal dulu untuk logika pilih meja (fungsi murni: wajib untuk makan di tempat, bawa pulang kosong).
- [ ] Kotak pilih meja saat membuka bill makan di tempat, memakai pola kotak besar yang sama dengan pemilih kategori.
- [ ] Aksi "Pindah meja" di menu bill.
- [ ] Peringatan meja terbuka di lembar tutup shift.
- [ ] Gerbang: `npx tsc --noEmit`, `npm run test:js`, `npm run i18n:check`. Commit.

### Task 3: BackOffice
- [ ] Tes gagal dulu (skema meja: nomor wajib, unik per outlet).
- [ ] Halaman Meja: daftar, tambah, ubah, nonaktifkan dengan pesan saat masih terisi.
- [ ] Gerbang: `npm test`, `npm run typecheck`, `npm run build` dari apps/web. Commit.

### Task 4: Dokumen dan verifikasi
- [ ] README (migrasi 091), PRD (baris F17), dan verifikasi gerbang penuh.
- [ ] Tinjauan akhir seluruh cabang sebelum push. Tidak ada rilis tanpa izin Anda.
