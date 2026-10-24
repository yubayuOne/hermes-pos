-- Table management (docs/superpowers/specs/2026-10-24-manajemen-meja-design.md).
--
-- The owner keeps a list of tables per outlet. A table is occupied while a held bill has its name in table_number.
-- Nothing is stored about occupancy, so it cannot go out of step. The bill keeps the table name it was given (text, as
-- before this migration), so receipts, reports, and old bills read the same.
--
-- Rules: a held bill needs a table (a trigger, so every path is covered); a table with a held bill cannot be renamed,
-- deactivated, or moved away from until it is paid or cancelled; moving a bill needs an active, free table.

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 20),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists tables_outlet_name on public.tables(outlet_id, lower(btrim(name)));
alter table public.tables enable row level security;
revoke all on public.tables from public, anon, authenticated;

-- Held bills of an outlet that carry this table's name.
create or replace function public.table_held(p_outlet_id uuid, p_name text)
returns table (bills bigint, since timestamptz, total numeric)
language sql stable security definer set search_path = public as $$
  select count(*), min(t.created_at), coalesce(sum(t.total), 0)
  from public.transactions t
  where t.outlet_id = p_outlet_id and t.status = 'held' and btrim(t.table_number) = btrim(p_name)
$$;
revoke all on function public.table_held(uuid, text) from public, anon, authenticated;

-- The list for the owner and the cashier: each table with whether it is occupied, since when, and what is on it.
create or replace function public.list_tables(p_outlet_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_catalog_access(p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'isActive', x.is_active,
      'occupied', h.bills > 0, 'since', h.since, 'heldTotal', h.total) order by lower(x.name))
    from public.tables x
    cross join lateral public.table_held(p_outlet_id, x.name) h
    where x.outlet_id = p_outlet_id), '[]'::jsonb);
end $$;
revoke all on function public.list_tables(uuid) from public, anon;
grant execute on function public.list_tables(uuid) to authenticated;

create or replace function public.owner_save_table(p_outlet_id uuid, p_id uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.assert_outlet_owner(p_outlet_id);
  v_name text := btrim(coalesce(p_name, ''));
  cur public.tables%rowtype;
  tid uuid;
begin
  if not public.subscription_active(b) then perform public.raise_expired('mengubah meja'); end if;
  if v_name = '' then raise exception 'Nama meja wajib diisi'; end if;
  if char_length(v_name) > 20 then raise exception 'Nama meja maksimal 20 karakter'; end if;
  if p_id is null then
    insert into public.tables(outlet_id, name) values (p_outlet_id, v_name) returning id into tid;
    return tid;
  end if;
  select * into cur from public.tables where id = p_id and outlet_id = p_outlet_id for update;
  if not found then raise exception 'Meja tidak ditemukan'; end if;
  if lower(cur.name) <> lower(v_name) and (select bills from public.table_held(p_outlet_id, cur.name)) > 0 then
    raise exception 'Meja masih terisi. Ganti nama setelah bill-nya selesai.';
  end if;
  update public.tables set name = v_name where id = p_id;
  return p_id;
exception when unique_violation then
  raise exception 'Nama meja sudah dipakai';
end $$;
revoke all on function public.owner_save_table(uuid, uuid, text) from public, anon;
grant execute on function public.owner_save_table(uuid, uuid, text) to authenticated;

create or replace function public.owner_set_table_active(p_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare cur public.tables%rowtype;
begin
  select * into cur from public.tables where id = p_id;
  if not found then raise exception 'Meja tidak ditemukan'; end if;
  perform public.assert_outlet_owner(cur.outlet_id);
  if not p_active and (select bills from public.table_held(cur.outlet_id, cur.name)) > 0 then
    raise exception 'Meja masih terisi. Selesaikan bill-nya dulu.';
  end if;
  update public.tables set is_active = p_active where id = p_id;
end $$;
revoke all on function public.owner_set_table_active(uuid, boolean) from public, anon;
grant execute on function public.owner_set_table_active(uuid, boolean) to authenticated;

-- Moves a held bill to another free table (or clears it). Online only; the cashier's own outlet.
create or replace function public.move_held_bill(p_transaction_id uuid, p_table_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  tr public.transactions%rowtype;
  v_name text := btrim(coalesce(p_table_name, ''));
  tb public.tables%rowtype;
begin
  select * into tr from public.transactions where id = p_transaction_id for update;
  if not found or tr.status <> 'held' then raise exception 'Bill yang ditahan tidak ditemukan'; end if;
  perform public.assert_catalog_access(tr.outlet_id);
  if v_name = '' then raise exception 'Pilih meja tujuan'; end if;
  select * into tb from public.tables where outlet_id = tr.outlet_id and lower(name) = lower(v_name);
  if not found or not tb.is_active then raise exception 'Meja tidak ditemukan'; end if;
  if coalesce(btrim(tr.table_number), '') <> tb.name and (select bills from public.table_held(tr.outlet_id, tb.name)) > 0 then
    raise exception 'Meja % sudah terisi.', tb.name;
  end if;
  update public.transactions set table_number = tb.name where id = p_transaction_id;
end $$;
revoke all on function public.move_held_bill(uuid, text) from public, anon;
grant execute on function public.move_held_bill(uuid, text) to authenticated;

-- A held bill that eats in needs a table. Bills that are paid at once (take-away) never sit held.
-- Runs on every write of a held bill (update_held_bill edits the table without touching status). Bills held
-- before this migration keep their old table text; they are only checked when the table is changed.
create or replace function public.trg_held_needs_table()
returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.table_number is not distinct from old.table_number then return new; end if;
  if coalesce(btrim(new.table_number), '') = '' then
    raise exception 'Bill yang ditahan wajib punya meja. Pilih meja dulu.';
  end if;
  return new;
end $$;
revoke all on function public.trg_held_needs_table() from public, anon, authenticated;
drop trigger if exists held_needs_table on public.transactions;
create trigger held_needs_table
  before insert or update on public.transactions
  for each row when (new.status = 'held')
  execute function public.trg_held_needs_table();
