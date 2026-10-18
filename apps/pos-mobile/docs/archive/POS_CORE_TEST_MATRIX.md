# HERMES POS Core — Test Matrix v1

Tujuan: memvalidasi invariant bisnis POS sebelum menambah fitur baru.

## A. Shift

| Test | Expected |
|---|---|
| Open shift normal | 1 row `shifts.status=open` |
| Open shift dua kali cepat | Tepat 1 shift open; request kedua ditolak |
| Tutup shift normal | Row berubah `closed`, `closed_at`, `closing_cash`, `expected_cash`, `variance` terisi |
| Tutup shift dua kali | Request kedua ditolak tanpa mengubah hasil pertama |
| Tutup shift dengan Bill Ditahan | Ditolak; shift tetap open |
| Open setelah close | Shift baru dapat dibuat |
| Close dan checkout bersamaan | Salah satu serialized; tidak ada transaksi completed pada shift closed |
| Device restart | State shift mengikuti database |

## B. Checkout

| Test | Expected |
|---|---|
| Cash normal | Tepat 1 transaction + 1 payment; stok berkurang tepat sekali |
| QRIS normal | Tepat 1 transaction + 1 payment; `amount_received = total` |
| Double tap | Tepat 1 transaction |
| Timeout setelah server commit lalu retry | Retry mengembalikan transaksi lama; tidak membuat transaksi kedua |
| Uang cash kurang | Tidak ada transaction/payment/stock mutation |
| Stok kurang | Tidak ada transaction/payment/stock mutation |
| Produk inactive | Checkout ditolak |
| Shift closed | Checkout ditolak |
| Empty cart | Checkout ditolak |
| ID idempotency kosong | Ditolak |

## C. Held Bill

| Test | Expected |
|---|---|
| Hold normal | Transaction `held` + row `held_bills` |
| Hold dengan item kosong | Ditolak; tidak ada orphan transaction |
| Recall | Bill tetap memakai item dan harga yang tersimpan |
| Harga produk berubah setelah Hold | Pembayaran memakai harga saat Hold, bukan harga baru |
| Stok berubah setelah Hold | Pembayaran memakai stok terkini; jika kurang, ditolak tanpa menyelesaikan bill |
| Close shift saat held | Ditolak |

## D. Split Bill

| Test | Expected |
|---|---|
| Split sebagian | Child completed, parent tetap held |
| Split seluruh item | Parent tidak lagi aktif sebagai held |
| Bayar item melebihi parent | Ditolak |
| Harga berubah setelah parent Hold | Child memakai harga parent |
| Dua split bersamaan | Tidak boleh mengalokasikan item melebihi parent |
| Retry child checkout | Tidak membuat child kedua |

## E. Failure / Recovery

| Test | Expected |
|---|---|
| Network timeout sebelum response | UI mempertahankan idempotency key untuk retry |
| Network timeout setelah commit | Retry mengembalikan transaksi lama |
| Supabase error saat dashboard refresh | UI tidak mengganti data valid menjadi "kosong" |
| App restart setelah checkout | Database tetap authoritative |
| App restart setelah hold | Held bill tetap tersedia |
| App restart setelah close shift | Tidak muncul kembali sebagai open |

## F. Accounting Invariants

1. Setiap completed transaction memiliki tepat satu payment.
2. Setiap payment mengacu ke tepat satu transaction.
3. Checkout hanya dapat terjadi pada shift `open`.
4. Close shift hanya dapat terjadi pada shift `open`.
5. Shift tidak boleh ditutup ketika masih ada transaction `held`.
6. Stock tidak boleh menjadi negatif.
7. Retry checkout dengan idempotency key yang sama tidak boleh menghasilkan transaksi kedua.
8. Harga pada transaction item adalah snapshot harga saat transaksi/hold dibuat.
9. Seluruh operasi uang dan stok harus atomic dalam satu RPC.
10. UI state tidak boleh menjadi bukti bahwa operasi database berhasil.

## Phase 7 — Cash Ledger

- Open shift with Rp200.000 → ledger contains one opening entry.
- Cash sale Rp50.000 → ledger contains one payment entry for Rp50.000 net.
- Cash sale Rp50.000 paid with Rp100.000 → ledger is Rp50.000, not Rp100.000.
- Cash out Rp20.000 with reason → expected cash decreases Rp20.000.
- Cash in Rp30.000 with reason → expected cash increases Rp30.000.
- Attempt manual movement with zero/negative amount → rejected.
- Attempt manual movement without reason → rejected.
- Attempt manual movement after close → rejected.
- Close with physical cash equal to ledger balance → variance Rp0.
- Close with different physical cash → exact variance persisted.
- Cashier cannot directly insert/update/delete ledger rows through client access.
- Retry/duplicate payment cannot create duplicate ledger entry.
