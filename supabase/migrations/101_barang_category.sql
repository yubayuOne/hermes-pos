-- 101: the category belongs to the barang, not to the expense (owner's decision, 7 Nov 2026). An expense of a barang
-- takes its category and its unit from the barang; only an expense without a barang ("Barang lain") types them.
-- Drawer or outlet money keeps its names: 'drawer' is "Kas Laci", 'other' is "Kas Outlet".

alter table public.ingredients add column if not exists kategori text
  check (kategori is null or char_length(btrim(kategori)) between 1 and 40);

-- The barang's own unit (g, ml, pcs) is a unit an expense item can carry.
alter table public.expense_items drop constraint if exists expense_items_unit_check;
alter table public.expense_items add constraint expense_items_unit_check
  check (unit in ('g', 'kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin'));

-- The category is optional and must be on the owner's active list when given.
drop function if exists public.owner_save_barang(uuid, uuid, text, text, boolean);
create or replace function public.owner_save_barang(p_outlet_id uuid, p_id uuid, p_name text, p_unit text, p_counted boolean, p_category text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  cur public.ingredients%rowtype;
  v_has_record boolean;
  v_business uuid := (select o.business_id from public.outlets o where o.id = p_outlet_id);
  iid uuid;
begin
  perform public.assert_outlet_owner(p_outlet_id);
  if v_name = '' then raise exception 'Nama barang wajib diisi'; end if;
  if char_length(v_name) > 60 then raise exception 'Nama barang maksimal 60 karakter'; end if;
  if p_unit not in ('g', 'ml', 'pcs') then raise exception 'Satuan dasar harus g, ml, atau pcs'; end if;
  if p_counted is null then raise exception 'Pilih apakah barang ini dihitung stoknya'; end if;
  if v_cat is not null and not exists (select 1 from public.expense_categories c
                                       where c.business_id = v_business and c.active and lower(btrim(c.name)) = lower(v_cat)) then
    raise exception 'Kategori tidak tersedia. Atur kategori di halaman Barang.';
  end if;
  if v_cat is not null then
    select c.name into v_cat from public.expense_categories c where c.business_id = v_business and lower(btrim(c.name)) = lower(v_cat);
  end if;

  if p_id is null then
    insert into public.ingredients(outlet_id, name, price, pack_qty, pack_unit, dihitung_stok, kategori)
    values (p_outlet_id, v_name, 0, 1, p_unit, p_counted, v_cat)
    returning id into iid;
    return iid;
  end if;

  select * into cur from public.ingredients where id = p_id and outlet_id = p_outlet_id for update;
  if not found then raise exception 'Barang tidak ditemukan'; end if;
  v_has_record := cur.stock_started or exists (select 1 from public.ingredient_moves where ingredient_id = p_id)
    or exists (select 1 from public.expense_items where ingredient_id = p_id);
  if (p_unit <> cur.pack_unit or p_counted <> cur.dihitung_stok) and v_has_record then
    raise exception 'Satuan dan penanda stok tidak bisa diubah setelah barang punya catatan stok.';
  end if;
  if p_unit <> cur.pack_unit and cur.price > 0 then
    raise exception 'Satuan tidak bisa diubah karena barang sudah punya harga. Buat barang baru.';
  end if;
  if not p_counted and exists (select 1 from public.recipe_lines where ingredient_id = p_id) then
    raise exception 'Barang ini dipakai di resep. Hapus dari resep dulu.';
  end if;

  update public.ingredients set name = v_name, pack_unit = p_unit, dihitung_stok = p_counted, kategori = v_cat, updated_at = now() where id = p_id;
  if p_unit <> cur.pack_unit or p_counted <> cur.dihitung_stok then perform public.recompute_hpp_for(array[p_id]); end if;
  return p_id;
exception when unique_violation then
  raise exception 'Nama barang sudah dipakai';
end $$;
revoke all on function public.owner_save_barang(uuid, uuid, text, text, boolean, text) from public, anon;
grant execute on function public.owner_save_barang(uuid, uuid, text, text, boolean, text) to authenticated;

-- The list carries the category too.
create or replace function public.owner_list_ingredients(p_outlet_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_catalog_access(p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'price', i.price, 'packQty', i.pack_qty, 'packUnit', i.pack_unit,
      'unitCost', i.price / (i.pack_qty * public.unit_factor(i.pack_unit)),
      'baseUnit', case public.unit_family(i.pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end,
      'usedBy', (select count(*) from public.recipe_lines r where r.ingredient_id = i.id),
      'stock', i.stock, 'stockStarted', i.stock_started, 'packLabel', i.pack_label, 'dihitungStok', i.dihitung_stok,
      'kategori', i.kategori,
      'lastCountedAt', (select max(m.at) from public.ingredient_moves m where m.ingredient_id = i.id and m.kind in ('opening', 'count'))
    ) order by lower(i.name))
    from public.ingredients i where i.outlet_id = p_outlet_id), '[]'::jsonb);
end $$;

-- A barang's category and unit are the expense's when a barang is chosen; the name too, when left blank.
-- Without a barang ("Barang lain") the name, category, and unit are typed as before.
drop function if exists public.expense_items_checked(jsonb, text, uuid);
create or replace function public.expense_items_checked(p_items jsonb, p_paid_from text, p_outlet_id uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  x jsonb;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_cat text;
  v_unit text;
  v_qty numeric;
  v_amount numeric;
  v_paid text;
  v_ing uuid;
  v_stock numeric;
  g public.ingredients%rowtype;
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
    v_ing := null; v_stock := null; g := null;
    if coalesce(x->>'ingredientId', '') <> '' then
      if x->>'ingredientId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Data barang tidak valid'; end if;
      select * into g from public.ingredients where id = (x->>'ingredientId')::uuid and outlet_id = p_outlet_id;
      if not found then raise exception 'Barang tidak ditemukan di outlet ini'; end if;
      v_ing := g.id;
    end if;

    v_name := btrim(coalesce(x->>'name', ''));
    if v_ing is not null then
      v_name := coalesce(nullif(v_name, ''), g.name);
      v_cat := g.kategori;
      v_unit := case public.unit_family(g.pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end;
    else
      if v_name = '' then raise exception 'Tulis nama barang atau biaya.'; end if;
      v_cat := null;
      if btrim(coalesce(x->>'category', '')) <> '' then
        select c.name into v_cat from public.expense_categories c
        where c.business_id = v_business and c.active and lower(btrim(c.name)) = lower(btrim(x->>'category'));
        if v_cat is null then raise exception 'Kategori tidak tersedia. Atur kategori di halaman Barang.'; end if;
      end if;
      v_unit := x->>'unit';
    end if;
    if char_length(v_name) > 60 then raise exception 'Nama barang maksimal 60 huruf.'; end if;
    if coalesce(v_unit, '') not in ('g', 'kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin') then
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
    if v_paid not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau kas outlet.'; end if;

    if v_ing is not null and coalesce(x->>'stockQty', '') <> '' then
      if not g.dihitung_stok then raise exception 'Barang ini tidak dihitung stoknya'; end if;
      if not (x->>'stockQty' ~ '^[0-9]{1,6}(\.[0-9]{1,3})?$') then
        raise exception 'Jumlah masuk stok harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000';
      end if;
      v_stock := (x->>'stockQty')::numeric;
      if v_stock <= 0 then raise exception 'Jumlah masuk stok harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000'; end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'category', v_cat, 'quantity', v_qty,
      'unit', v_unit, 'amount', v_amount, 'paidFrom', v_paid, 'ingredientId', v_ing, 'stockQty', v_stock));
  end loop;
  return v_out;
end $$;
revoke all on function public.expense_items_checked(jsonb, text, uuid) from public, anon, authenticated;

-- A cancelled item keeps the category it had, which may now be none.
alter table public.expense_item_cancellations alter column category drop not null;

-- The cashier app shows a barang with its category and unit (the expense takes them from the barang).
create or replace function public.pos_expense_options(p_outlet_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cashier uuid;
  v_business uuid;
begin
  select cs.cashier_id into v_cashier from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active limit 1;
  if v_cashier is null then raise exception 'Outlet tidak ditemukan'; end if;
  select o.business_id into v_business from public.outlets o where o.id = p_outlet_id;
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(c.name order by lower(c.name)) from public.expense_categories c
                            where c.business_id = v_business and c.active), '[]'::jsonb),
    'barang', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'unit',
                              case public.unit_family(g.pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end,
                              'category', g.kategori, 'counted', g.dihitung_stok)
                              order by lower(g.name))
                        from public.ingredients g where g.outlet_id = p_outlet_id), '[]'::jsonb));
end $$;
