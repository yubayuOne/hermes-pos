# HERMES POS Split Bill — Iterative Master Bill

## Konsep

Split Bill dimulai dari **Bill Ditahan**. Satu transaksi menjadi **Master Bill** yang tetap menjadi sumber item sampai seluruh porsinya habis.

Setiap customer yang mengambil sebagian item dibuat sebagai **Child Bill** dengan identitas customer sendiri dan pembayaran sendiri.

Produk tidak digandakan. Yang dialokasikan adalah quantity/porsi dari Master Bill.

## Flow

```text
Bill Ditahan
    ↓
Buka Bill
    ↓
Pesanan Saat Ini
    ↓
Split Bill
    ↓
Tampilkan seluruh item yang masih tersisa
    ↓
Kasir pilih item/porsi untuk Customer 1
    ↓
Isi identitas Customer 1
    ↓
Popup Pembayaran
    ↓
Bayar + cetak Child Bill 1
    ↓
Master Bill tetap Ditahan dengan sisa item
    ↓
Split Bill lagi
    ↓
Customer 2
    ↓
Bayar + cetak Child Bill 2
    ↓
... ulangi sampai sisa item = 0
    ↓
Master Bill ditutup secara internal
```

## Database

- Master Bill menggunakan row `transactions` yang awalnya berstatus `held`.
- Direct Recall dari menu Pesanan **tidak mengubah Master Bill menjadi draft**.
- `parent_transaction_id` pada child menunjuk ke Master Bill.
- Child Bill memiliki nomor transaksi dan identitas customer sendiri.
- `complete_checkout` menghitung quantity child yang sudah `completed` terhadap quantity Master.
- Child tidak boleh mengambil quantity melebihi sisa Master.
- Saat seluruh quantity habis, Master Bill ditutup secara internal sebagai `cancelled` dan `held_bills` dihapus. Master tidak dihitung sebagai transaksi penjualan agar tidak menggandakan omzet.

## Stok

Split Bill tidak mengurangi stok.

Stok berkurang hanya ketika Child Bill berhasil dibayar melalui checkout transaction-safe.

## Receipt

Setiap Child Bill menghasilkan receipt sendiri. Item tetap membawa station `kitchen` atau `bar`, sehingga Customer Bill, Kitchen Bill, dan Bar Bill tetap mengikuti struktur receipt HERMES POS.

## Identitas

Customer name yang dimasukkan pada setiap Split Bill menjadi `customer_name` pada Child Transaction. Jika kosong, UI menggunakan `Tanpa Nama`.

Nomor meja diwariskan dari Master Bill.

## Keamanan

- Checkout tetap menggunakan idempotency key.
- Parent/master dikunci saat child checkout.
- Quantity child divalidasi terhadap quantity master.
- Stock dikunci saat child checkout.
- Parent tidak dihitung sebagai completed sale.
