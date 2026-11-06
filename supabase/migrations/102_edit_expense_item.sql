-- 102: the owner edits or deletes an expense item (owner's request, 7 Nov 2026). An edit checks the new values the same way
-- the cashier's entry is checked (expense_items_checked), moves the stock back and forth (099), and the shift's cash
-- follows (073). A delete leaves no cancelled line: the item is gone, as the owner asked.

create or replace function public.owner_update_expense_item(
  p_item_id uuid, p_ingredient_id uuid, p_name text, p_category text, p_unit text,
  p_quantity numeric, p_amount numeric, p_stock_qty numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  i public.expense_items%rowtype;
  e public.expenses%rowtype;
  v_items jsonb;
  v_new jsonb;
begin
  select * into i from public.expense_items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dihapus'; end if;
  select * into e from public.expenses where id = i.expense_id and business_id = b;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dihapus'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengubah pengeluaran'); end if;
  perform 1 from public.shifts where id = e.shift_id for update;
  select * into i from public.expense_items where id = p_item_id for update;

  -- The same checks as a new entry, with the outlet and the money source of the expense.
  v_items := public.expense_items_checked(jsonb_build_array(jsonb_build_object(
    'name', coalesce(p_name, ''), 'category', coalesce(p_category, ''), 'unit', coalesce(p_unit, ''),
    'quantity', p_quantity, 'amount', p_amount,
    'ingredientId', p_ingredient_id, 'stockQty', p_stock_qty)), i.paid_from, e.outlet_id);
  v_new := v_items -> 0;

  perform public._099_stock_out(i.id);
  update public.expense_items
  set name = v_new->>'name', category = v_new->>'category', unit = v_new->>'unit',
      quantity = (v_new->>'quantity')::numeric, amount = (v_new->>'amount')::numeric,
      ingredient_id = (v_new->>'ingredientId')::uuid, stock_qty = (v_new->>'stockQty')::numeric
  where id = i.id;
  if (v_new->>'stockQty') is not null then perform public._099_stock_in(i.id); end if;
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_update_expense_item(uuid, uuid, text, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.owner_update_expense_item(uuid, uuid, text, text, text, numeric, numeric, numeric) to authenticated;

create or replace function public.owner_delete_expense_item(p_item_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  i public.expense_items%rowtype;
  e public.expenses%rowtype;
begin
  select * into i from public.expense_items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dihapus'; end if;
  select * into e from public.expenses where id = i.expense_id and business_id = b;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dihapus'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menghapus pengeluaran'); end if;
  perform 1 from public.shifts where id = e.shift_id for update;
  select * into i from public.expense_items where id = p_item_id for update;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dihapus'; end if;

  perform public._099_stock_out(i.id);
  delete from public.expense_items where id = i.id;
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_delete_expense_item(uuid) from public, anon;
grant execute on function public.owner_delete_expense_item(uuid) to authenticated;

-- Moves made in one transaction (a stock move back, then the new one) need their own times, so "after" is well defined.
alter table public.ingredient_moves alter column at set default clock_timestamp();

-- A later move blocks only while it still stands: a reversed entry (expense_cancel) or an entry whose item was deleted
-- does not count, so undoing the later entry frees the earlier one.
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
  if exists (
    select 1 from public.ingredient_moves m2
    where m2.ingredient_id = i.ingredient_id and m2.id <> m.id and m2.at >= m.at and m2.kind <> 'expense_cancel'
      and (m2.kind <> 'expense' or exists (select 1 from public.expense_items x where x.id = m2.doc_id and x.stock_qty is not null))
  ) then
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
