# PRD Alignment

Dokumen PRD awal masih memiliki beberapa butir yang menyebut CRUD katalog dari aplikasi kasir dan beberapa fitur fase lanjutan. Arsitektur build ini mengikuti arahan produk terbaru: HERMES POS adalah terminal kasir saja. Karena itu master data dan manajemen pengguna tidak diimplementasikan sebagai fitur terminal.

Fitur database-critical yang ditambahkan atas persetujuan pengembangan:

- transaction-safe checkout
- idempotency protection
- printer abstraction
- local cache

Fitur tersebut tidak mengubah source-of-truth atau menjadi dashboard manajemen.
