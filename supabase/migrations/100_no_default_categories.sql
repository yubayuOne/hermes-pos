-- 100: no default expense categories (owner's decision, 7 Nov 2026). The owner makes the list; an expense item may have
-- no category. The two default names that 099 added are removed; items that already carry a name keep it.

drop trigger if exists businesses_default_categories on public.businesses;
drop function if exists public.trg_business_default_categories();
delete from public.expense_categories where lower(btrim(name)) in ('operasional', 'belanja');

alter table public.expense_items alter column category drop not null;
alter table public.expense_items drop constraint if exists expense_items_category_check;
alter table public.expense_items add constraint expense_items_category_check
  check (category is null or char_length(btrim(category)) between 1 and 40);

-- Same as 099; a blank category is allowed, a given one must be on the owner's active list.
drop function if exists public.expense_items_checked(jsonb, text, uuid);
create or replace function public.expense_items_checked(p_items jsonb, p_paid_from text, p_outlet_id uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  x jsonb;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_cat text;
  v_qty numeric;
  v_amount numeric;
  v_paid text;
  v_ing uuid;
  v_stock numeric;
  v_counted boolean;
  v_business uuid := (select o.business_id from public.outlets o where o.id = p_outlet_id);
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu barang.';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Maksimal 200 barang dalam satu shift.'; end if;
  if (select count(e ->> 'ingredientId') <> count(distinct lower(e ->> 'ingredientId')) from jsonb_array_elements(p_items) e) then
    raise exception 'Satu barang hanya boleh sekali per pengeluaran.';
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(x->>'name', ''));
    if v_name = '' then raise exception 'Tulis nama barang atau biaya.'; end if;
    if char_length(v_name) > 60 then raise exception 'Nama barang maksimal 60 huruf.'; end if;
    v_cat := null;
    if btrim(coalesce(x->>'category', '')) <> '' then
      select c.name into v_cat from public.expense_categories c
      where c.business_id = v_business and c.active and lower(btrim(c.name)) = lower(btrim(x->>'category'));
      if v_cat is null then raise exception 'Kategori tidak tersedia. Atur kategori di halaman Pengeluaran.'; end if;
    end if;
    if coalesce(x->>'unit', '') not in ('kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin') then
      raise exception 'Pilih satuan yang tersedia.';
    end if;
    if coalesce(x->>'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$' then raise exception 'Jumlah harus angka, maksimal 3 angka di belakang koma.'; end if;
    v_qty := (x->>'quantity')::numeric;
    if v_qty <= 0 or v_qty > 100000 then raise exception 'Jumlah harus lebih dari 0.'; end if;
    if coalesce(x->>'amount', '') !~ '^[0-9]+$' then raise exception 'Harga total harus angka rupiah tanpa koma.'; end if;
    v_amount := (x->>'amount')::numeric;
    if v_amount <= 0 then raise exception 'Harga total harus lebih dari Rp0.'; end if;
    if v_amount > 100000000 then raise exception 'Harga total maksimal Rp100.000.000 per barang.'; end if;
    v_paid := coalesce(p_paid_from, x->>'paidFrom', '');
    if v_paid not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;

    v_ing := null; v_stock := null;
    if coalesce(x->>'ingredientId', '') <> '' then
      if x->>'ingredientId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Data barang tidak valid'; end if;
      select g.dihitung_stok into v_counted from public.ingredients g where g.id = (x->>'ingredientId')::uuid and g.outlet_id = p_outlet_id;
      if not found then raise exception 'Barang tidak ditemukan di outlet ini'; end if;
      v_ing := (x->>'ingredientId')::uuid;
    end if;
    if coalesce(x->>'stockQty', '') <> '' then
      if v_ing is null then raise exception 'Jumlah masuk stok hanya untuk barang'; end if;
      if not v_counted then raise exception 'Barang ini tidak dihitung stoknya'; end if;
      if not (x->>'stockQty' ~ '^[0-9]{1,6}(\.[0-9]{1,3})?$') then
        raise exception 'Jumlah masuk stok harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000';
      end if;
      v_stock := (x->>'stockQty')::numeric;
      if v_stock <= 0 then raise exception 'Jumlah masuk stok harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000'; end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'category', v_cat, 'quantity', v_qty,
      'unit', x->>'unit', 'amount', v_amount, 'paidFrom', v_paid, 'ingredientId', v_ing, 'stockQty', v_stock));
  end loop;
  return v_out;
end $$;
revoke all on function public.expense_items_checked(jsonb, text, uuid) from public, anon, authenticated;
