/**
 * The sidebar's menus, shared by the sidebar and the Pengaturan tab that hides some of them (108). Keep NAV_KEYS in step
 * with owner_update_sidebar. Pengaturan is not listed: it is always shown.
 */
export const NAV_KEYS = [
  '/',
  '/transactions',
  '/closing',
  '/expenses',
  '/stock',
  '/customers',
  '/products',
  '/ingredients',
  '/resep',
  '/tables',
  '/vouchers',
  '/outlets',
  '/cashiers',
] as const;
export type NavTo = (typeof NAV_KEYS)[number];

/** Grouped by how often the owner opens them: the daily pages first, then records, then the store's setup. */
export const NAV_GROUPS: { label: string; items: { to: NavTo; label: string }[] }[] = [
  {
    label: 'Setiap hari',
    items: [
      { to: '/', label: 'Ringkasan' },
      { to: '/transactions', label: 'Transaksi' },
      { to: '/closing', label: 'Shift' },
    ],
  },
  {
    label: 'Catatan',
    items: [
      { to: '/expenses', label: 'Kas' },
      { to: '/stock', label: 'Stock Opname' },
      { to: '/customers', label: 'Pelanggan' },
    ],
  },
  {
    label: 'Atur toko',
    items: [
      { to: '/products', label: 'Produk' },
      { to: '/ingredients', label: 'Barang' },
      { to: '/resep', label: 'Resep' },
      { to: '/tables', label: 'Meja' },
      { to: '/vouchers', label: 'Voucher' },
      { to: '/outlets', label: 'Outlet' },
      { to: '/cashiers', label: 'Kasir' },
    ],
  },
];

/** A group with more items than this folds into a dropdown in the sidebar. */
export const NAV_FOLD_OVER = 3;
