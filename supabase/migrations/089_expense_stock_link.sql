-- Expense items linked to stock purchases (docs/superpowers/specs/2026-10-23-tautan-pengeluaran-belanja-design.md).
--
-- A belanja item the cashier paid for is recorded once, as an expense. The owner then puts it into stock: the link makes
-- a purchase through owner_save_purchase (088) with the item's amount as the total, so the cash of the shift stays as
-- it is and only the stock, the average price and the HPP move. The link lives on the purchase line; an item is linked
-- while its purchase is active, and cancelling the purchase releases it. 040 and 073 are not changed.

-- Set null: an item linked only to cancelled purchases may still be cancelled (073 deletes it); active links are
-- refused before that by trg_expense_item_linked.
alter table public.purchase_lines add column if not exists expense_item_id uuid references public.expense_items(id) on delete set null;
create index if not exists purchase_lines_expense_item on public.purchase_lines(expense_item_id);

create or replace function public.trg_expense_item_linked()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.purchase_lines l join public.purchases p on p.id = l.purchase_id
             where l.expense_item_id = old.id and p.cancelled_at is null) then
    raise exception 'Barang ini sudah masuk stok. Batalkan belanjanya dulu.';
  end if;
  return old;
end $$;
revoke all on function public.trg_expense_item_linked() from public, anon, authenticated;
drop trigger if exists trg_expense_item_linked on public.expense_items;
create trigger trg_expense_item_linked before delete on public.expense_items for each row execute function public.trg_expense_item_linked();

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
  perform 1 from public.expense_items where id = any(ids) order by id for update;
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

-- Every purchase line linked to an item of the expense, active or not.
create or replace function public.owner_stock_links_for_expense(p_expense_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  -- An unknown expense gives a null outlet, which assert_outlet_owner refuses like another owner's.
  perform public.assert_outlet_owner((select outlet_id from public.expenses where id = p_expense_id));
  return coalesce((
    select jsonb_agg(jsonb_build_object('expenseItemId', i.id, 'purchaseId', p.id, 'ingredientId', g.id, 'ingredientName', g.name,
      'packs', l.packs, 'active', p.cancelled_at is null) order by i.position, p.created_at)
    from public.expense_items i
    join public.purchase_lines l on l.expense_item_id = i.id
    join public.purchases p on p.id = l.purchase_id
    join public.ingredients g on g.id = l.ingredient_id
    where i.expense_id = p_expense_id), '[]'::jsonb);
end $$;

revoke all on function public.owner_link_expense_items(uuid, jsonb) from public, anon;
revoke all on function public.owner_stock_links_for_expense(uuid) from public, anon;
grant execute on function public.owner_link_expense_items(uuid, jsonb) to authenticated;
grant execute on function public.owner_stock_links_for_expense(uuid) to authenticated;
