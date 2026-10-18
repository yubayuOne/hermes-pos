-- KASBOX 018
-- 1) Menu Sementara: item sekali pakai yang dibuat kasir dari layar Kasir.
-- 2) Hapus Bill: membatalkan Bill Ditahan.
-- 3) Hapus fitur Kas Masuk / Kas Keluar manual (RPC create_cash_movement).
--
-- Catatan: tabel cash_ledger dan get_shift_cash_summary TIDAK dihapus karena
-- expected cash shift tetap dihitung dari ledger (penjualan tunai + modal awal).

-- ---------------------------------------------------------------------------
-- 1) Menu Sementara
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists is_temporary boolean not null default false;

create index if not exists products_outlet_temporary
  on public.products(outlet_id, is_temporary);

create or replace function public.create_temporary_product(
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_name text,
  p_price numeric,
  p_station public.product_station default 'kitchen'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nama menu sementara wajib diisi';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Harga menu sementara harus lebih dari nol';
  end if;

  -- Stok besar agar validasi stok checkout tidak menghalangi; menu sementara
  -- tidak tampil di katalog maupun di pengaturan produk (is_temporary).
  insert into public.products(
    outlet_id, category_id, name, hpp, selling_price, stock, station, is_active, is_temporary
  ) values (
    p_outlet_id, null, trim(p_name), 0, p_price, 999999, p_station, true, true
  )
  returning id into pid;

  return pid;
end;
$$;

revoke execute on function public.create_temporary_product(uuid, uuid, text, numeric, public.product_station) from public, anon;
grant execute on function public.create_temporary_product(uuid, uuid, text, numeric, public.product_station) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Hapus Bill (Bill Ditahan)
-- ---------------------------------------------------------------------------
-- Bill ditahan tidak mengurangi stok, jadi tidak ada stok yang perlu dikembalikan.
-- Bill dibatalkan (status 'cancelled'), bukan dihapus fisik, supaya bagian split
-- yang sudah dibayar (anak transaksi) tetap punya induk dan laporan tetap utuh.
create or replace function public.delete_held_bill(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.transactions%rowtype;
  s public.shifts%rowtype;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;

  perform public.assert_cashier(t.cashier_id, t.outlet_id);

  if t.status <> 'held' then
    raise exception 'Hanya Bill Ditahan yang dapat dihapus';
  end if;

  select * into s from public.shifts where id = t.shift_id;
  if not found or s.status <> 'open' then
    raise exception 'Shift bill ini sudah tidak aktif';
  end if;

  update public.transactions set status = 'cancelled' where id = t.id;
  delete from public.held_bills where transaction_id = t.id;

  return jsonb_build_object('transactionId', t.id, 'number', t.number);
end;
$$;

revoke execute on function public.delete_held_bill(uuid) from public, anon;
grant execute on function public.delete_held_bill(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Hapus Kas Masuk / Kas Keluar manual
-- ---------------------------------------------------------------------------
drop function if exists public.create_cash_movement(uuid, uuid, uuid, public.cash_ledger_direction, numeric, text);
