-- Barang (docs/superpowers/specs/2026-11-07-barang-design.md, plan 2026-11-07-barang-plan.md).
--
-- The ingredients table is the barang table (renamed in the screens only). Changes:
-- * A barang's price is per base unit (g, ml, pcs) with pack_qty 1, so it is the average the stock runs on. Existing
--   rows are converted once; their HPP does not change (recipe_cost divides the same way).
-- * dihitung_stok: only a counted barang has stock, an average price, a count, and a place in a recipe.
-- * Stock comes in through an expense item (expense_items.ingredient_id + stock_qty), not through purchases. The
--   purchase functions (088, 089) are no longer granted; their tables stay as history.
-- * Expense categories are a list the owner keeps per business (expense_categories). Existing businesses start with the
--   two categories the old app used, so an old phone that still sends them keeps working.
-- * Cancelling an expense item that moved stock moves it back, if nothing moved that barang afterwards.

-- ================================================================ units and prices
alter table public.ingredients alter column price type numeric(18,6);
alter table public.ingredients add column if not exists dihitung_stok boolean not null default true;

update public.ingredients
set price = round(price / (pack_qty * public.unit_factor(pack_unit)), 6),
    pack_qty = 1,
    pack_unit = case public.unit_family(pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end
where pack_qty <> 1 or pack_unit not in ('g', 'ml', 'pcs');

alter table public.ingredient_moves drop constraint if exists ingredient_moves_kind_check;
alter table public.ingredient_moves add constraint ingredient_moves_kind_check
  check (kind in ('purchase', 'purchase_cancel', 'sale', 'opening', 'count', 'expense', 'expense_cancel'));

-- Only a counted barang moves stock (any kind of move, from every path).
create or replace function public.trg_move_needs_counted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ingredients where id = new.ingredient_id and dihitung_stok) then
    raise exception 'Barang ini tidak dihitung stoknya';
  end if;
  return new;
end $$;
revoke all on function public.trg_move_needs_counted() from public, anon, authenticated;
drop trigger if exists ingredient_moves_counted on public.ingredient_moves;
create trigger ingredient_moves_counted before insert on public.ingredient_moves for each row execute function public.trg_move_needs_counted();

-- A recipe uses counted barang only.
create or replace function public.trg_recipe_line_counted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ingredients where id = new.ingredient_id and dihitung_stok) then
    raise exception 'Barang ini tidak dihitung stoknya, tidak bisa dipakai di resep';
  end if;
  return new;
end $$;
revoke all on function public.trg_recipe_line_counted() from public, anon, authenticated;
drop trigger if exists recipe_lines_counted on public.recipe_lines;
create trigger recipe_lines_counted before insert or update of ingredient_id on public.recipe_lines
for each row execute function public.trg_recipe_line_counted();

-- ================================================================ expense categories (owner's list)
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists expense_categories_business_name on public.expense_categories(business_id, lower(btrim(name)));
alter table public.expense_categories enable row level security;
revoke all on public.expense_categories from public, anon, authenticated;

-- The two categories the old app used, for every business that exists now and every business created later (the owner
-- can rename or switch them off).
insert into public.expense_categories(business_id, name)
select b.id, c.name from public.businesses b cross join (values ('operasional'), ('belanja')) c(name)
on conflict do nothing;

create or replace function public.trg_business_default_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.expense_categories(business_id, name) values (new.id, 'operasional'), (new.id, 'belanja')
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.trg_business_default_categories() from public, anon, authenticated;
drop trigger if exists businesses_default_categories on public.businesses;
create trigger businesses_default_categories after insert on public.businesses for each row execute function public.trg_business_default_categories();

-- ================================================================ expense items linked to barang
alter table public.expense_items drop constraint if exists expense_items_category_check;
alter table public.expense_items add constraint expense_items_category_check check (char_length(btrim(category)) between 1 and 40);
alter table public.expense_items add column if not exists ingredient_id uuid references public.ingredients(id) on delete restrict;
-- Set = the stock came in (the item moved stock). Null with an ingredient = waiting for the owner's amount.
alter table public.expense_items add column if not exists stock_qty numeric(16,3) check (stock_qty > 0 and stock_qty <= 1000000);
-- What the stock was before this item, so a cancel puts it back exactly.
alter table public.expense_items add column if not exists stock_price_before numeric(18,6);
alter table public.expense_items add column if not exists stock_started_before boolean;
create index if not exists expense_items_ingredient on public.expense_items(ingredient_id);

-- Moves the stock of the item's barang: the average of the stock and this item's total (not a price typed per unit).
create or replace function public._099_stock_in(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.expense_items%rowtype;
  g public.ingredients%rowtype;
  v_price numeric;
begin
  select * into i from public.expense_items where id = p_item_id;
  select * into g from public.ingredients where id = i.ingredient_id for update;
  if not g.dihitung_stok then raise exception 'Barang ini tidak dihitung stoknya'; end if;
  v_price := case when g.stock_started and g.stock > 0
                  then (g.stock * g.price + i.amount) / (g.stock + i.stock_qty)
                  else i.amount / i.stock_qty end;
  update public.expense_items set stock_price_before = g.price, stock_started_before = g.stock_started where id = i.id;
  update public.ingredients set stock = stock + i.stock_qty, price = round(v_price, 6), stock_started = true, updated_at = now() where id = g.id;
  insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, doc_id, created_by)
  values (g.id, g.outlet_id, 'expense', i.stock_qty, i.id, auth.uid());
  perform public.recompute_hpp_for(array[g.id]);
end $$;
revoke all on function public._099_stock_in(uuid) from public, anon, authenticated;

-- Takes the item's stock back. Refused when the barang moved after it: cancel the later move first.
create or replace function public._099_stock_out(p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.expense_items%rowtype;
  m public.ingredient_moves%rowtype;
begin
  select * into i from public.expense_items where id = p_item_id;
  if i.stock_qty is null then return; end if;
  perform 1 from public.ingredients where id = i.ingredient_id for update;
  select * into m from public.ingredient_moves where doc_id = i.id and kind = 'expense' order by at desc limit 1;
  if exists (select 1 from public.ingredient_moves where ingredient_id = i.ingredient_id and id <> m.id and at >= m.at) then
    raise exception 'Sudah ada pergerakan stok setelahnya; batalkan yang terbaru dulu.';
  end if;
  update public.ingredients set stock = stock - i.stock_qty, price = i.stock_price_before,
    stock_started = i.stock_started_before, updated_at = now()
  where id = i.ingredient_id;
  insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, doc_id, created_by)
  select i.ingredient_id, g.outlet_id, 'expense_cancel', -i.stock_qty, i.id, auth.uid()
  from public.ingredients g where g.id = i.ingredient_id;
  update public.expense_items set stock_qty = null, stock_price_before = null, stock_started_before = null where id = i.id;
  perform public.recompute_hpp_for(array[i.ingredient_id]);
end $$;
revoke all on function public._099_stock_out(uuid) from public, anon, authenticated;

-- An item with an amount for the stock comes in at once, on every insert path.
create or replace function public.trg_expense_item_stock_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stock_qty is not null then perform public._099_stock_in(new.id); end if;
  return null;
end $$;
revoke all on function public.trg_expense_item_stock_in() from public, anon, authenticated;
drop trigger if exists expense_items_stock_in on public.expense_items;
create trigger expense_items_stock_in after insert on public.expense_items for each row
when (new.stock_qty is not null) execute function public.trg_expense_item_stock_in();

-- p_items: name, category, quantity, unit, amount, paidFrom, optional ingredientId and stockQty.
drop function if exists public.expense_items_checked(jsonb, text);
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
    select c.name into v_cat from public.expense_categories c
    where c.business_id = v_business and c.active and lower(btrim(c.name)) = lower(btrim(coalesce(x->>'category', '')));
    if v_cat is null then raise exception 'Pilih kategori yang tersedia. Atur kategori di halaman Pengeluaran.'; end if;
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

-- Cashier (043 + the barang fields). Same idempotency and cash rules as before.
create or replace function public.record_expense(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_paid_from text,
  p_items jsonb,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.expenses%rowtype;
  b uuid := public.business_of_outlet(p_outlet_id);
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_items jsonb;
  v_total numeric;
  v_count int := 0;
begin
  -- Mengunci shift: tutup shift, koreksi pemilik, dan kiriman lain di shift ini menunggu sampai selesai.
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);
  if v_key = '' then raise exception 'Kunci idempotensi wajib diisi'; end if;

  select * into e from public.expenses where shift_id = p_shift_id;
  -- Kirim ulang (tombol ditekan dua kali, antrean offline): kembalikan catatan yang sama.
  if e.id is not null and v_key = any(e.entry_keys) then
    return jsonb_build_object('ok', true, 'replayed', true) || public.expense_json(e.id);
  end if;

  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from, p_outlet_id);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select sum((x->>'amount')::numeric) into v_total from jsonb_array_elements(v_items) x;

  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
    values (b, p_outlet_id, p_shift_id, p_cashier_id, v_total, array[v_key])
    returning * into e;
  else
    select count(*) into v_count from public.expense_items where expense_id = e.id;
    if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
    update public.expenses set total = total + v_total, entry_keys = entry_keys || v_key where id = e.id;
  end if;

  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from, ingredient_id, stock_qty)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from, (x.v->>'ingredientId')::uuid, (x.v->>'stockQty')::numeric
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);

  if p_paid_from = 'drawer' then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'out', v_total, 'Pengeluaran', 'expense', e.id)
    on conflict (source_type, source_id) where source_id is not null do update set amount = public.cash_ledger.amount + excluded.amount;
  end if;

  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (b, 'expense', jsonb_build_object('amount', v_total, 'count', jsonb_array_length(v_items), 'paid_from', p_paid_from,
    'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = p_cashier_id limit 1)), 'expense:' || e.id || ':' || v_key)
  on conflict (business_id, dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'replayed', false) || public.expense_json(e.id);
end $$;
revoke all on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) to authenticated;

-- Owner (087 + the barang fields): both sources.
create or replace function public.owner_add_expense_items(p_shift_id uuid, p_paid_from text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s public.shifts%rowtype;
  e public.expenses%rowtype;
  v_items jsonb;
  v_count int := 0;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found or not public.is_owner_of_outlet(s.outlet_id) then raise exception 'Shift tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from, s.outlet_id);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select * into s from public.shifts where id = p_shift_id for update;

  select * into e from public.expenses where shift_id = s.id;
  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
    values (b, s.outlet_id, s.id, s.cashier_id, 0, '{}')
    returning * into e;
  end if;
  select count(*) into v_count from public.expense_items where expense_id = e.id;
  if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from, ingredient_id, stock_qty)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from, (x.v->>'ingredientId')::uuid, (x.v->>'stockQty')::numeric
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_add_expense_items(uuid, text, jsonb) from public, anon;
grant execute on function public.owner_add_expense_items(uuid, text, jsonb) to authenticated;

-- The owner sets (or changes, or clears) the amount that came into stock for an item of the expense.
create or replace function public.owner_set_expense_stock(p_item_id uuid, p_qty numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  i public.expense_items%rowtype;
  e public.expenses%rowtype;
begin
  select * into i from public.expense_items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  select * into e from public.expenses where id = i.expense_id and business_id = b;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengisi stok'); end if;
  if i.ingredient_id is null then raise exception 'Barang ini tidak terhubung ke barang stok'; end if;
  if p_qty is not null and not (p_qty > 0 and p_qty <= 1000000 and p_qty = round(p_qty, 3)) then
    raise exception 'Jumlah masuk stok harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000';
  end if;
  perform public._099_stock_out(i.id);
  update public.expense_items set stock_qty = p_qty where id = i.id;
  if p_qty is not null then perform public._099_stock_in(i.id); end if;
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_set_expense_stock(uuid, numeric) from public, anon;
grant execute on function public.owner_set_expense_stock(uuid, numeric) to authenticated;

-- Cancel (073 + putting the stock back first).
create or replace function public.owner_cancel_expense_item(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  i public.expense_items%rowtype;
  e public.expenses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  select * into i from public.expense_items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  select * into e from public.expenses where id = i.expense_id and business_id = b;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('membatalkan pengeluaran'); end if;
  perform 1 from public.shifts where id = e.shift_id for update;
  select * into i from public.expense_items where id = p_item_id for update;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;

  perform public._099_stock_out(i.id);
  insert into public.expense_item_cancellations(id, expense_id, position, name, category, quantity, unit, amount, paid_from, reason, cancelled_by)
  values (i.id, i.expense_id, i.position, i.name, i.category, i.quantity, i.unit, i.amount, i.paid_from, v_reason, auth.uid());
  delete from public.expense_items where id = i.id;
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_cancel_expense_item(uuid, text) from public, anon;
grant execute on function public.owner_cancel_expense_item(uuid, text) to authenticated;

-- Same as 073, plus each item's barang and stock amount.
create or replace function public.expense_json(p_expense_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'createdAt', e.created_at, 'outletId', e.outlet_id, 'outletName', o.name, 'shiftId', e.shift_id,
    'businessDate', s.business_date, 'shiftNumber', s.shift_number, 'shiftOpen', s.status = 'open',
    'cashierName', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = e.cashier_id limit 1),
    'total', e.total,
    'drawerTotal', (select coalesce(sum(i.amount), 0) from public.expense_items i where i.expense_id = e.id and i.paid_from = 'drawer'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category, 'quantity', i.quantity,
        'unit', i.unit, 'amount', i.amount, 'paidFrom', i.paid_from, 'ingredientId', i.ingredient_id,
        'ingredientName', g.name, 'ingredientUnit', case when g.id is null then null when public.unit_family(g.pack_unit) = 'mass' then 'g' when public.unit_family(g.pack_unit) = 'volume' then 'ml' else 'pcs' end,
        'ingredientCounted', g.dihitung_stok, 'stockQty', i.stock_qty) order by i.position)
      from public.expense_items i left join public.ingredients g on g.id = i.ingredient_id where i.expense_id = e.id
    ), '[]'::jsonb),
    'cancelled', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'quantity', c.quantity,
        'unit', c.unit, 'amount', c.amount, 'paidFrom', c.paid_from, 'reason', c.reason, 'cancelledAt', c.cancelled_at) order by c.position)
      from public.expense_item_cancellations c where c.expense_id = e.id
    ), '[]'::jsonb))
  from public.expenses e join public.outlets o on o.id = e.outlet_id join public.shifts s on s.id = e.shift_id
  where e.id = p_expense_id
$$;

-- ================================================================ barang
-- The list: as 088, plus whether the barang is counted.
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
      'lastCountedAt', (select max(m.at) from public.ingredient_moves m where m.ingredient_id = i.id and m.kind in ('opening', 'count'))
    ) order by lower(i.name))
    from public.ingredients i where i.outlet_id = p_outlet_id), '[]'::jsonb);
end $$;

-- Name, base unit (fixed once the barang has any record), and whether it is counted (fixed the same way).
-- p_id null creates; the price is never typed: it comes from the expenses.
create or replace function public.owner_save_barang(p_outlet_id uuid, p_id uuid, p_name text, p_unit text, p_counted boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  cur public.ingredients%rowtype;
  v_has_record boolean;
  iid uuid;
begin
  perform public.assert_outlet_owner(p_outlet_id);
  if v_name = '' then raise exception 'Nama barang wajib diisi'; end if;
  if char_length(v_name) > 60 then raise exception 'Nama barang maksimal 60 karakter'; end if;
  if p_unit not in ('g', 'ml', 'pcs') then raise exception 'Satuan dasar harus g, ml, atau pcs'; end if;
  if p_counted is null then raise exception 'Pilih apakah barang ini dihitung stoknya'; end if;

  if p_id is null then
    insert into public.ingredients(outlet_id, name, price, pack_qty, pack_unit, dihitung_stok)
    values (p_outlet_id, v_name, 0, 1, p_unit, p_counted)
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

  update public.ingredients set name = v_name, pack_unit = p_unit, dihitung_stok = p_counted, updated_at = now() where id = p_id;
  if p_unit <> cur.pack_unit or p_counted <> cur.dihitung_stok then perform public.recompute_hpp_for(array[p_id]); end if;
  return p_id;
exception when unique_violation then
  raise exception 'Nama barang sudah dipakai';
end $$;

-- ================================================================ expense categories (owner)
create or replace function public.owner_list_expense_categories()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active) order by lower(c.name))
                   from public.expense_categories c where c.business_id = b), '[]'::jsonb);
end $$;

-- Renaming a category does not change items already recorded with the old name; a category is switched off, not deleted.
create or replace function public.owner_save_expense_category(p_id uuid, p_name text, p_active boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_name text := btrim(coalesce(p_name, ''));
  iid uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception 'Nama kategori 1 sampai 40 karakter'; end if;
  if p_active is null then raise exception 'Pilih aktif atau tidak'; end if;
  if p_id is null then
    insert into public.expense_categories(business_id, name, active) values (b, v_name, p_active) returning id into iid;
    return iid;
  end if;
  update public.expense_categories set name = v_name, active = p_active where id = p_id and business_id = b returning id into iid;
  if iid is null then raise exception 'Kategori tidak ditemukan'; end if;
  return iid;
exception when unique_violation then
  raise exception 'Nama kategori sudah dipakai';
end $$;

-- What the cashier app needs to record an expense: the active categories and the barang of the outlet.
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
    'barang', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'unit', g.pack_unit, 'counted', g.dihitung_stok)
                                         order by lower(g.name))
                        from public.ingredients g where g.outlet_id = p_outlet_id), '[]'::jsonb));
end $$;

-- ================================================================ grants: belanja is gone from the owner's screens
revoke all on function public.owner_save_purchase(uuid, date, jsonb) from public, anon, authenticated;
revoke all on function public.owner_cancel_purchase(uuid, text) from public, anon, authenticated;
revoke all on function public.owner_link_expense_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function public.owner_preview_ingredient(uuid, numeric, numeric, text) from public, anon, authenticated;

revoke all on function public.owner_list_ingredients(uuid) from public, anon;
revoke all on function public.owner_save_barang(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.owner_list_expense_categories() from public, anon;
revoke all on function public.owner_save_expense_category(uuid, text, boolean) from public, anon;
revoke all on function public.pos_expense_options(uuid) from public, anon;
grant execute on function public.owner_list_ingredients(uuid) to authenticated;
grant execute on function public.owner_save_barang(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.owner_list_expense_categories() to authenticated;
grant execute on function public.owner_save_expense_category(uuid, text, boolean) to authenticated;
grant execute on function public.pos_expense_options(uuid) to authenticated;
