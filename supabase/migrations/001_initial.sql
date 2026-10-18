-- KASBOX POS / Supabase PostgreSQL
-- Cashier terminal scope. Product/catalog writes belong to the Owner/Manager application.
create extension if not exists pgcrypto;
create sequence if not exists public.kasbox_transaction_seq;



create type public.shift_status as enum ('open','closed');
create type public.order_status as enum ('draft','held','completed','cancelled','split');
create type public.payment_method as enum ('cash','qris','online_food','card');
create type public.product_station as enum ('kitchen','bar');
create type public.payment_status as enum ('paid','pending','failed');

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  cashier_id uuid not null default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id),
  cashier_name text not null,
  outlet_name text not null,
  terminal_name text not null default 'POS 1',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index cashier_sessions_active_user on public.cashier_sessions(auth_user_id) where is_active;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(outlet_id,name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  hpp numeric(14,2) not null default 0 check(hpp >= 0),
  selling_price numeric(14,2) not null check(selling_price >= 0),
  stock numeric(14,3) not null default 0 check(stock >= 0),
  station public.product_station not null default 'kitchen',
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_outlet_active on public.products(outlet_id,is_active);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(14,2) not null check(opening_cash >= 0),
  closed_at timestamptz,
  closing_cash numeric(14,2),
  expected_cash numeric(14,2),
  variance numeric(14,2),
  status public.shift_status not null default 'open'
);
create unique index one_open_shift_per_cashier on public.shifts(cashier_id) where status='open';
create index shifts_outlet_opened on public.shifts(outlet_id,opened_at desc);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id),
  cashier_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  number text not null unique,
  customer_name text not null default '',
  customer_phone text not null default '',
  table_number text not null default '',
  status public.order_status not null default 'draft',
  subtotal numeric(14,2) not null default 0,
  total_hpp numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  payment_method public.payment_method,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  parent_transaction_id uuid references public.transactions(id)
);
create index transactions_shift_created on public.transactions(shift_id,created_at desc);
create index transactions_outlet_created on public.transactions(outlet_id,created_at desc);

create table public.transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check(quantity > 0),
  hpp_unit numeric(14,2) not null check(hpp_unit >= 0),
  selling_price_unit numeric(14,2) not null check(selling_price_unit >= 0),
  subtotal numeric(14,2) generated always as (quantity * selling_price_unit) stored
);
create index transaction_items_transaction on public.transaction_items(transaction_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  method public.payment_method not null,
  amount_received numeric(14,2) not null check(amount_received >= 0),
  change_amount numeric(14,2) not null default 0 check(change_amount >= 0),
  external_reference text,
  status public.payment_status not null default 'paid',
  paid_at timestamptz not null default now()
);

create table public.checkout_idempotency (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  cashier_id uuid not null,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(cashier_id,idempotency_key)
);

create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  held_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();

create or replace function public.next_transaction_number() returns text language plpgsql as $$
begin
  return '#KBX-' || to_char(now(),'YYYYMMDD') || '-' || lpad(nextval('public.kasbox_transaction_seq')::text,5,'0');
end $$;

create or replace function public.assert_cashier(p_cashier_id uuid,p_outlet_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.cashier_sessions where auth_user_id=auth.uid() and cashier_id=p_cashier_id and outlet_id=p_outlet_id and is_active) then raise exception 'Sesi kasir tidak valid'; end if;
end $$;

create or replace function public.open_shift(p_cashier_id uuid,p_outlet_id uuid,p_opening_cash numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);
  if p_opening_cash < 0 then raise exception 'Modal kas tidak valid'; end if;
  if exists(select 1 from shifts where cashier_id=p_cashier_id and status='open') then raise exception 'Masih ada shift aktif untuk kasir ini'; end if;
  insert into shifts(cashier_id,outlet_id,opening_cash) values(p_cashier_id,p_outlet_id,p_opening_cash) returning id into sid;
  return sid;
end $$;

create or replace function public.close_shift(p_shift_id uuid,p_physical_cash numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s shifts%rowtype; cash_sales numeric; expected numeric; variance numeric;
begin
  select * into s from public.shifts where id=p_shift_id for update;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);
  if p_physical_cash < 0 then raise exception 'Kas fisik tidak valid'; end if;
  if s.status <> 'open' then raise exception 'Shift sudah ditutup'; end if;
  select coalesce(sum(p.amount_received-p.change_amount),0) into cash_sales
    from payments p join transactions t on t.id=p.transaction_id
    where t.shift_id=s.id and t.status='completed' and p.method='cash' and p.status='paid';
  expected := s.opening_cash + cash_sales;
  variance := p_physical_cash - expected;
  update shifts set closed_at=now(),closing_cash=p_physical_cash,expected_cash=expected,variance=variance,status='closed' where id=s.id;
  return jsonb_build_object('expected_cash',expected,'variance',variance);
end $$;

create or replace function public.save_held_bill(p_shift_id uuid,p_cashier_id uuid,p_outlet_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  tid uuid;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  v_total numeric := 0;
  v_thpp numeric := 0;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  if not exists(
    select 1
    from shifts
    where id=p_shift_id
      and cashier_id=p_cashier_id
      and status='open'
  ) then
    raise exception 'Shift aktif tidak ditemukan';
  end if;

  insert into transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'held'
  )
  returning id into tid;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;

    if qty <= 0 then
      raise exception 'Kuantitas tidak valid';
    end if;

    select p.hpp,p.selling_price
      into phpp,pprice
      from products p
      where p.id=pid
        and p.outlet_id=p_outlet_id
        and p.is_active
      for share;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;

    insert into transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit
    )
    values(tid,pid,qty,phpp,pprice);

    v_total := v_total + (qty * pprice);
    v_thpp := v_thpp + (qty * phpp);
  end loop;

  if v_total <= 0 then
    raise exception 'Bill kosong';
  end if;

  update transactions t
  set subtotal=v_total,
      total=v_total,
      total_hpp=v_thpp
  where t.id=tid;

  insert into held_bills(transaction_id) values(tid);

  return tid;
end $$;

create or replace function public.complete_checkout(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_payload jsonb,
  p_payment_method public.payment_method,
  p_amount_received numeric,
  p_external_reference text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tid uuid;
  existing_tid uuid;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  stock numeric;
  v_total numeric := 0;
  v_thpp numeric := 0;
  v_change numeric := 0;
  tnumber text;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  select ci.transaction_id
    into existing_tid
    from checkout_idempotency ci
    where ci.cashier_id=p_cashier_id
      and ci.idempotency_key=p_idempotency_key;

  if existing_tid is not null then
    select t.number,t.total
      into tnumber,v_total
      from transactions t
      where t.id=existing_tid;

    select p.change_amount
      into v_change
      from payments p
      where p.transaction_id=existing_tid;

    return jsonb_build_object(
      'transactionId',existing_tid,
      'transactionNumber',tnumber,
      'total',v_total,
      'change',v_change
    );
  end if;

  if not exists(
    select 1
    from shifts s
    where s.id=p_shift_id
      and s.cashier_id=p_cashier_id
      and s.outlet_id=p_outlet_id
      and s.status='open'
  ) then
    raise exception 'Shift aktif tidak ditemukan';
  end if;

  insert into transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'draft'
  )
  returning id,number into tid,tnumber;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;

    if qty <= 0 then
      raise exception 'Kuantitas tidak valid';
    end if;

    select p.hpp,p.selling_price,p.stock
      into phpp,pprice,stock
      from products p
      where p.id=pid
        and p.outlet_id=p_outlet_id
        and p.is_active
      for update;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;

    if stock < qty then
      raise exception 'Stok produk tidak mencukupi';
    end if;

    insert into transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit
    )
    values(tid,pid,qty,phpp,pprice);

    v_total := v_total + (qty * pprice);
    v_thpp := v_thpp + (qty * phpp);

    update products p
    set stock=p.stock-qty
    where p.id=pid;
  end loop;

  if v_total <= 0 then
    raise exception 'Bill kosong';
  end if;

  if p_payment_method='cash' then
    if p_amount_received < v_total then
      raise exception 'Uang diterima kurang';
    end if;

    v_change := p_amount_received-v_total;
  else
    p_amount_received := v_total;
    v_change := 0;
  end if;

  update transactions t
  set subtotal=v_total,
      total=v_total,
      total_hpp=v_thpp,
      status='completed',
      payment_method=p_payment_method,
      completed_at=now()
  where t.id=tid;

  insert into payments(
    transaction_id,method,amount_received,change_amount,
    external_reference,status
  )
  values(
    tid,p_payment_method,p_amount_received,v_change,
    p_external_reference,'paid'
  );

  insert into checkout_idempotency(
    idempotency_key,cashier_id,transaction_id
  )
  values(p_idempotency_key,p_cashier_id,tid);

  return jsonb_build_object(
    'transactionId',tid,
    'transactionNumber',tnumber,
    'total',v_total,
    'change',v_change
  );

exception
  when unique_violation then
    select ci.transaction_id
      into existing_tid
      from checkout_idempotency ci
      where ci.cashier_id=p_cashier_id
        and ci.idempotency_key=p_idempotency_key;

    if existing_tid is not null then
      select t.number,t.total
        into tnumber,v_total
        from transactions t
        where t.id=existing_tid;

      select p.change_amount
        into v_change
        from payments p
        where p.transaction_id=existing_tid;

      return jsonb_build_object(
        'transactionId',existing_tid,
        'transactionNumber',tnumber,
        'total',v_total,
        'change',v_change
      );
    end if;

    raise;
end $$;

create or replace function public.recall_held_bill(p_transaction_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status <> 'held' then raise exception 'Bill tidak berstatus ditahan'; end if;
  update transactions set status='draft' where id=t.id;
  delete from held_bills where transaction_id=t.id;
  return jsonb_build_object('transactionId',t.id,'number',t.number,'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number);
end $$;

alter table public.outlets enable row level security;
alter table public.cashier_sessions enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.shifts enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_items enable row level security;
alter table public.payments enable row level security;
alter table public.held_bills enable row level security;

create policy "cashier session self read" on cashier_sessions for select using(auth_user_id=auth.uid() and is_active);
create policy "catalog read" on products for select using(exists(select 1 from cashier_sessions cs where cs.auth_user_id=auth.uid() and cs.outlet_id=products.outlet_id and cs.is_active));
create policy "category read" on categories for select using(exists(select 1 from cashier_sessions cs where cs.auth_user_id=auth.uid() and cs.outlet_id=categories.outlet_id and cs.is_active));
create policy "shift own read" on shifts for select using(exists(select 1 from cashier_sessions cs where cs.auth_user_id=auth.uid() and cs.cashier_id=shifts.cashier_id and cs.outlet_id=shifts.outlet_id and cs.is_active));
create policy "transaction own read" on transactions for select using(exists(select 1 from cashier_sessions cs where cs.auth_user_id=auth.uid() and cs.cashier_id=transactions.cashier_id and cs.outlet_id=transactions.outlet_id and cs.is_active));
create policy "transaction item own read" on transaction_items for select using(exists(select 1 from transactions t join cashier_sessions cs on cs.cashier_id=t.cashier_id and cs.outlet_id=t.outlet_id where t.id=transaction_items.transaction_id and cs.auth_user_id=auth.uid() and cs.is_active));
create policy "payment own read" on payments for select using(exists(select 1 from transactions t join cashier_sessions cs on cs.cashier_id=t.cashier_id and cs.outlet_id=t.outlet_id where t.id=payments.transaction_id and cs.auth_user_id=auth.uid() and cs.is_active));
create policy "held own read" on held_bills for select using(exists(select 1 from transactions t join cashier_sessions cs on cs.cashier_id=t.cashier_id and cs.outlet_id=t.outlet_id where t.id=held_bills.transaction_id and cs.auth_user_id=auth.uid() and cs.is_active));

revoke insert,update,delete on products from anon,authenticated;
revoke insert,update,delete on categories from anon,authenticated;
revoke insert,update,delete on transactions from anon,authenticated;
revoke insert,update,delete on transaction_items from anon,authenticated;
revoke insert,update,delete on payments from anon,authenticated;
revoke insert,update,delete on shifts from anon,authenticated;
revoke insert,update,delete on held_bills from anon,authenticated;
revoke all on checkout_idempotency from anon,authenticated;

grant execute on function public.open_shift(uuid,uuid,numeric) to authenticated;
grant execute on function public.close_shift(uuid,numeric) to authenticated;
grant execute on function public.save_held_bill(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text) to authenticated;
grant execute on function public.recall_held_bill(uuid) to authenticated;
