-- Fixes from the review of 089 (docs/superpowers/specs/2026-10-23-tautan-pengeluaran-belanja-design.md).
-- 1. purchase_json shows each line's expenseItemId, so the Belanja tab can mark a purchase that came from an expense
--    and the owner does not record it a second time. Same body as 088 plus that key.
-- 2. owner_link_expense_items locks only items of this outlet. Same body as 089 except the lock.

create or replace function public.purchase_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'boughtOn', p.bought_on, 'total', p.total, 'cancelledAt', p.cancelled_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('ingredientId', l.ingredient_id, 'name', i.name, 'packLabel', i.pack_label, 'packs', l.packs,
        'total', l.total, 'priceBefore', l.price_before, 'priceAfter', l.price_after, 'expenseItemId', l.expense_item_id) order by lower(i.name))
      from public.purchase_lines l join public.ingredients i on i.id = l.ingredient_id where l.purchase_id = p.id), '[]'::jsonb))
  from public.purchases p where p.id = p_id
$$;
revoke all on function public.purchase_json(uuid) from public, anon, authenticated;

-- p_lines: [{"expenseItemId", "ingredientId", "packs"}], belanja items of one business day of this outlet. Returns the
-- new purchase (purchase_json) with "linked": true. Lock order: the items (by id), then owner_save_purchase's.
create or replace function public.owner_link_expense_items(p_outlet_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.assert_outlet_owner(p_outlet_id);
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  ids uuid[];
  v_day date;
  v_days bigint;
  v_res jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu bahan'; end if;
  if jsonb_array_length(p_lines) > 50 then raise exception 'Catatan belanja maksimal 50 bahan'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e where jsonb_typeof(e) <> 'object'
             or coalesce(e ->> 'expenseItemId', '') !~* uuid_re or coalesce(e ->> 'ingredientId', '') !~* uuid_re) then
    raise exception 'Data belanja tidak valid';
  end if;
  if (select count(*) <> count(distinct lower(e ->> 'expenseItemId')) from jsonb_array_elements(p_lines) e) then
    raise exception 'Satu barang hanya boleh sekali per catatan belanja';
  end if;
  ids := array(select (e ->> 'expenseItemId')::uuid from jsonb_array_elements(p_lines) e);

  -- Held until commit: a cancel of the item (073) waits, then its trigger sees the link.
  perform 1 from public.expense_items i join public.expenses e on e.id = i.expense_id
  where i.id = any(ids) and e.outlet_id = p_outlet_id order by i.id for update of i;
  if (select count(*) from public.expense_items i join public.expenses e on e.id = i.expense_id
      where i.id = any(ids) and e.outlet_id = p_outlet_id) <> cardinality(ids) then
    raise exception 'Barang tidak ditemukan atau sudah dibatalkan';
  end if;
  if exists (select 1 from public.expense_items where id = any(ids) and category <> 'belanja') then
    raise exception 'Hanya barang belanja yang bisa masuk stok.';
  end if;
  if exists (select 1 from public.purchase_lines l join public.purchases p on p.id = l.purchase_id
             where l.expense_item_id = any(ids) and p.cancelled_at is null) then
    raise exception 'Barang ini sudah masuk stok. Batalkan belanjanya dulu.';
  end if;
  select min(s.business_date), count(distinct s.business_date) into v_day, v_days
  from public.expense_items i join public.expenses e on e.id = i.expense_id join public.shifts s on s.id = e.shift_id
  where i.id = any(ids);
  if v_days <> 1 then raise exception 'Pilih barang dari satu hari yang sama.'; end if;

  v_res := public.owner_save_purchase(p_outlet_id, v_day, (
    select jsonb_agg(jsonb_build_object('ingredientId', x ->> 'ingredientId', 'packs', x -> 'packs', 'total', i.amount))
    from jsonb_array_elements(p_lines) x join public.expense_items i on i.id = (x ->> 'expenseItemId')::uuid));

  update public.purchase_lines l set expense_item_id = (x ->> 'expenseItemId')::uuid
  from jsonb_array_elements(p_lines) x
  where l.purchase_id = (v_res ->> 'id')::uuid and l.ingredient_id = (x ->> 'ingredientId')::uuid;
  return v_res || jsonb_build_object('linked', true);
end $$;

revoke all on function public.owner_link_expense_items(uuid, jsonb) from public, anon;
grant execute on function public.owner_link_expense_items(uuid, jsonb) to authenticated;
