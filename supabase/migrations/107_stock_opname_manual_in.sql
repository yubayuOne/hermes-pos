-- 107: Stok Masuk of the Stock Opname is typed by the owner (owner's request, 7 Nov 2026), not taken from expenses.
-- Selisih = Stok Akhir - (Stok Awal + Stok Masuk - Stok Keluar). An unsaved day has no Stok Masuk yet.

alter table public.stock_opname_days add column if not exists in_qty numeric(16,3) not null default 0 check (in_qty >= 0);

create or replace function public.owner_list_stock_opname(p_outlet_id uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone public.outlet_tz(p_outlet_id))::date;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_date is null or p_date > v_today then raise exception 'Tanggal tidak boleh di masa depan'; end if;
  return coalesce((
    select jsonb_agg(s.x order by s.name_key)
    from (
      select lower(g.name) as name_key,
        jsonb_build_object(
          'ingredientId', g.id, 'name', g.name, 'category', g.kategori,
          'unit', case public.unit_family(g.pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end,
          'opening', case when p.business_date is not null then p.closing_qty else cur.opening_first end,
          'openingEditable', p.business_date is null,
          'incoming', coalesce(cur.in_qty, 0),
          'out', coalesce(cur.out_qty, 0),
          'closing', cur.closing_qty,
          'difference', case when cur.id is not null and (case when p.business_date is not null then p.closing_qty else cur.opening_first end) is not null
            then cur.closing_qty - ((case when p.business_date is not null then p.closing_qty else cur.opening_first end) + cur.in_qty - cur.out_qty) end,
          'note', cur.note,
          'saved', cur.id is not null
        ) as x
      from public.ingredients g
      left join lateral (
        select d.business_date, d.closing_qty from public.stock_opname_days d
        where d.ingredient_id = g.id and d.business_date < p_date
        order by d.business_date desc limit 1
      ) p on true
      left join public.stock_opname_days cur on cur.ingredient_id = g.id and cur.business_date = p_date
      where g.outlet_id = p_outlet_id and g.dihitung_stok
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.owner_list_stock_opname(uuid, date) from public, anon;
grant execute on function public.owner_list_stock_opname(uuid, date) to authenticated;

create or replace function public.owner_save_stock_opname(p_outlet_id uuid, p_date date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_today date := (now() at time zone public.outlet_tz(p_outlet_id))::date;
  r jsonb;
  g public.ingredients%rowtype;
  cur public.stock_opname_days%rowtype;
  v_in numeric;
  v_out numeric;
  v_closing numeric;
  v_opening numeric;
  v_note text;
  v_has_prior boolean;
  n integer := 0;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_date is null or p_date > v_today then raise exception 'Tanggal tidak boleh di masa depan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menyimpan stock opname'); end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Data stock opname tidak valid'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into g from public.ingredients where id = (r->>'ingredientId')::uuid and outlet_id = p_outlet_id;
    if not found or not g.dihitung_stok then raise exception 'Barang tidak ditemukan'; end if;

    v_closing := nullif(r->>'closing', '')::numeric;
    if v_closing is null or v_closing < 0 or v_closing <> round(v_closing, 3) then
      raise exception 'Stok akhir %: isi angka, tidak boleh negatif, paling banyak 3 desimal', g.name;
    end if;
    v_in := coalesce(nullif(r->>'in', '')::numeric, 0);
    if v_in < 0 or v_in <> round(v_in, 3) then raise exception 'Stok masuk %: isi angka, tidak boleh negatif', g.name; end if;
    v_out := coalesce(nullif(r->>'out', '')::numeric, 0);
    if v_out < 0 or v_out <> round(v_out, 3) then raise exception 'Stok keluar %: isi angka, tidak boleh negatif', g.name; end if;
    v_note := nullif(btrim(coalesce(r->>'note', '')), '');
    if v_note is not null and char_length(v_note) > 200 then raise exception 'Catatan maksimal 200 huruf'; end if;

    select * into cur from public.stock_opname_days where ingredient_id = g.id and business_date = p_date;
    if cur.id is null then
      v_has_prior := exists (select 1 from public.stock_opname_days where ingredient_id = g.id and business_date < p_date);
      v_opening := null;
      if not v_has_prior then
        v_opening := nullif(r->>'opening', '')::numeric;
        if v_opening is null or v_opening < 0 or v_opening <> round(v_opening, 3) then
          raise exception 'Stok awal %: isi angka, tidak boleh negatif', g.name;
        end if;
      end if;
      insert into public.stock_opname_days(business_id, outlet_id, ingredient_id, business_date, opening_first, in_qty, out_qty, closing_qty, note, created_by)
      values (b, p_outlet_id, g.id, p_date, v_opening, v_in, v_out, v_closing, v_note, auth.uid());
    else
      update public.stock_opname_days set in_qty = v_in, out_qty = v_out, closing_qty = v_closing, note = v_note, updated_at = now()
      where id = cur.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.owner_save_stock_opname(uuid, date, jsonb) from public, anon;
grant execute on function public.owner_save_stock_opname(uuid, date, jsonb) to authenticated;
