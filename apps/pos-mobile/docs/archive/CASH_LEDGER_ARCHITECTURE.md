# HERMES POS Cash Ledger Architecture

## Tujuan

Cash drawer adalah hasil penjumlahan ledger, bukan hasil rekonstruksi dari UI.

`Expected Cash = SUM(cash in) - SUM(cash out)`

## Entry yang sah

- `shift_opening` — modal awal saat shift dibuka.
- `payment` — otomatis dibuat dari payment cash yang berstatus `paid`.
- `manual` — kas masuk/keluar yang dibuat lewat RPC dan wajib memiliki alasan.

## Invariants

1. Kasir tidak pernah INSERT/UPDATE/DELETE langsung ke ledger.
2. Checkout cash dan pencatatan kas manual harus berada dalam shift yang masih `open`.
3. Close shift mengunci row shift sebelum menghitung expected cash.
4. Checkout juga mengunci row shift sebelum menulis payment, sehingga checkout dan close shift tidak dapat masuk bersamaan.
5. Setiap payment cash memiliki paling banyak satu ledger entry melalui `source_type=payment` + `source_id=payment.id`.
6. Ledger tidak mengandalkan harga produk saat ini; payment sudah membawa nilai transaksi final.
7. Riwayat kas tidak boleh diubah untuk memperbaiki kesalahan. Koreksi dibuat sebagai movement baru dengan alasan yang jelas.

## Rekonsiliasi

Saat close shift:

- `physical_cash` = uang fisik yang dihitung kasir.
- `expected_cash` = total cash ledger masuk dikurangi total cash ledger keluar.
- `variance` = `physical_cash - expected_cash`.

Jika variance bukan nol, data tetap disimpan. Selisih tidak boleh disembunyikan atau dipaksa menjadi nol.
