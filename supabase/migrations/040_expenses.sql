-- 040: pengeluaran yang dicatat kasir, dicek pemilik di backoffice sebelum dihitung.
-- * Kasir mencatat satu atau beberapa barang: nama, kategori (operasional atau belanja), jumlah + satuan, harga total.
-- * Status awal 'pending'. Pemilik bisa mengubah barangnya lalu menyetujui ('approved') atau menolak ('rejected').
--   Hanya yang disetujui dihitung sebagai pengeluaran di backoffice.
-- * Dibayar dari kas laci: langsung menulis cash_ledger 'out' di shift kasir, karena uangnya memang sudah keluar
--   dari laci. Kalau pemilik mengubah jumlahnya selagi shift masih buka, kas seharusnya ikut menyesuaikan. Setelah
--   shift ditutup, buku kas tidak diubah lagi (selisih shift sudah tersimpan). Ditolak tidak mengembalikan kas: uangnya
--   tetap sudah keluar dari laci.
-- * Tabel hanya dibaca dan ditulis lewat RPC.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  outlet_id uuid not null references public.outlets(id),
  shift_id uuid not null references public.shifts(id),
  cashier_id uuid not null,
  paid_from text not null check (paid_from in ('drawer', 'other')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  total numeric(14,2) not null check (total > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  reject_reason text check (reject_reason is null or char_length(reject_reason) between 3 and 200),
  unique (cashier_id, idempotency_key)
);
create index if not exists expenses_business_status_created on public.expenses(business_id, status, created_at desc);
create index if not exists expenses_shift on public.expenses(shift_id);

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  position smallint not null,
  name text not null check (char_length(name) between 1 and 60),
  category text not null check (category in ('operasional', 'belanja')),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 100000),
  unit text not null check (unit in ('kg', 'gr', 'L', 'ml', 'pcs', 'pack', 'dus', 'botol', 'sachet', 'ikat', 'karung', 'lusin')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 100000000 and amount = round(amount))
);
create index if not exists expense_items_expense on public.expense_items(expense_id, position);

alter table public.expenses enable row level security;
alter table public.expense_items enable row level security;
revoke all on public.expenses from anon, authenticated;
revoke all on public.expense_items from anon, authenticated;

-- ---------------------------------------------------------------- validasi barang (dipakai kasir dan pemilik)
-- p_items: [{ "name", "category", "quantity", "unit", "amount" }]. Mengembalikan barang yang sudah dirapikan, urut.
create or replace function public.expense_items_checked(p_items jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  x jsonb;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_qty numeric;
  v_amount numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu barang.';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(x->>'name', ''));
    if v_name = '' then raise exception 'Tulis nama barang atau biaya.'; end if;
    if char_length(v_name) > 60 then raise exception 'Nama barang maksimal 60 huruf.'; end if;
    if coalesce(x->>'category', '') not in ('operasional', 'belanja') then raise exception 'Pilih kategori: operasional atau belanja.'; end if;
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
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'category', x->>'category', 'quantity', v_qty,
      'unit', x->>'unit', 'amount', v_amount));
  end loop;
  return v_out;
end $$;
revoke all on function public.expense_items_checked(jsonb) from public, anon, authenticated;

create or replace function public.expense_json(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'createdAt', e.created_at, 'outletId', e.outlet_id, 'outletName', o.name, 'shiftId', e.shift_id,
    'cashierName', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = e.cashier_id limit 1),
    'paidFrom', e.paid_from, 'status', e.status, 'total', e.total, 'reviewedAt', e.reviewed_at, 'rejectReason', e.reject_reason,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category, 'quantity', i.quantity,
        'unit', i.unit, 'amount', i.amount) order by i.position)
      from public.expense_items i where i.expense_id = e.id
    ), '[]'::jsonb))
  from public.expenses e join public.outlets o on o.id = e.outlet_id
  where e.id = p_expense_id
$$;
revoke all on function public.expense_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- kasir
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
begin
  -- Mengunci shift, jadi tutup shift tidak bisa menyela di antara catatan dan buku kasnya.
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);
  if v_key = '' then raise exception 'Kunci idempotensi wajib diisi'; end if;

  -- Kirim ulang (tombol ditekan dua kali, koneksi putus): kembalikan catatan yang sama.
  select * into e from public.expenses where cashier_id = p_cashier_id and idempotency_key = v_key;
  if found then return jsonb_build_object('ok', true, 'replayed', true) || public.expense_json(e.id); end if;

  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items);
  select sum((x->>'amount')::numeric) into v_total from jsonb_array_elements(v_items) x;

  insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, paid_from, total, idempotency_key)
  values (b, p_outlet_id, p_shift_id, p_cashier_id, p_paid_from, v_total, v_key)
  returning * into e;

  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount)
  select e.id, (x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit', (x.v->>'amount')::numeric
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);

  if p_paid_from = 'drawer' then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'out', v_total, 'Pengeluaran', 'expense', e.id);
  end if;

  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (b, 'expense', jsonb_build_object('amount', v_total, 'count', jsonb_array_length(v_items), 'paid_from', p_paid_from,
    'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = p_cashier_id limit 1)), 'expense:' || e.id)
  on conflict (business_id, dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'replayed', false) || public.expense_json(e.id);
end $$;
revoke all on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) to authenticated;

create or replace function public.list_shift_expenses(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s public.shifts%rowtype;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id, s.outlet_id);
  return coalesce((
    select jsonb_agg(public.expense_json(e.id) order by e.created_at desc, e.id)
    from public.expenses e where e.shift_id = p_shift_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_shift_expenses(uuid) from public, anon;
grant execute on function public.list_shift_expenses(uuid) to authenticated;

-- ---------------------------------------------------------------- pemilik
-- Daftar per status (200 terbaru), jumlah yang menunggu, dan total yang disetujui per kategori pada rentang yang sama.
create or replace function public.owner_list_expenses(
  p_status text,
  p_outlet_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
begin
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Status pengeluaran tidak valid'; end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(public.expense_json(x.id) order by x.created_at desc, x.id)
      from (
        select e.id, e.created_at from public.expenses e
        where e.business_id = b and e.status = p_status
          and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        order by e.created_at desc, e.id limit 200
      ) x
    ), '[]'::jsonb),
    'pendingCount', (select count(*) from public.expenses e
      where e.business_id = b and e.status = 'pending' and (p_outlet_id is null or e.outlet_id = p_outlet_id)),
    'approved', (
      select jsonb_build_object(
        'total', coalesce(sum(i.amount), 0),
        'operasional', coalesce(sum(i.amount) filter (where i.category = 'operasional'), 0),
        'belanja', coalesce(sum(i.amount) filter (where i.category = 'belanja'), 0))
      from public.expenses e join public.expense_items i on i.expense_id = e.id
      where e.business_id = b and e.status = 'approved'
        and (p_outlet_id is null or e.outlet_id = p_outlet_id)
        and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to))
  );
end $$;
revoke all on function public.owner_list_expenses(text, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_list_expenses(text, uuid, timestamptz, timestamptz) to authenticated;

-- p_action 'approve' (p_items opsional: barang hasil koreksi pemilik) atau 'reject' (p_reason wajib).
create or replace function public.owner_review_expense(
  p_expense_id uuid,
  p_action text,
  p_items jsonb default null,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  e public.expenses%rowtype;
  v_items jsonb;
  v_total numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_shift_status public.shift_status;
begin
  select * into e from public.expenses where id = p_expense_id and business_id = b for update;
  if not found then raise exception 'Pengeluaran tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengecek pengeluaran'); end if;
  if e.status <> 'pending' then
    raise exception 'Pengeluaran ini sudah dicek.' using errcode = 'P0001', hint = 'already_reviewed';
  end if;

  if p_action = 'reject' then
    if char_length(v_reason) < 3 then raise exception 'Tulis alasan penolakan minimal 3 huruf.'; end if;
    if char_length(v_reason) > 200 then raise exception 'Alasan penolakan maksimal 200 huruf.'; end if;
    update public.expenses set status = 'rejected', reject_reason = v_reason, reviewed_at = now(), reviewed_by = auth.uid()
    where id = e.id;
    return public.expense_json(e.id);
  end if;
  if p_action is distinct from 'approve' then raise exception 'Aksi tidak valid'; end if;

  if p_items is not null then
    v_items := public.expense_items_checked(p_items);
    select sum((x->>'amount')::numeric) into v_total from jsonb_array_elements(v_items) x;
    delete from public.expense_items where expense_id = e.id;
    insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount)
    select e.id, (x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit', (x.v->>'amount')::numeric
    from jsonb_array_elements(v_items) with ordinality as x(v, ord);
    update public.expenses set total = v_total where id = e.id;

    -- Kas laci ikut koreksi hanya selagi shift masih buka. Shift dikunci dulu supaya tidak bentrok dengan tutup shift.
    if e.paid_from = 'drawer' and v_total <> e.total then
      select s.status into v_shift_status from public.shifts s where s.id = e.shift_id for update;
      if v_shift_status = 'open' then
        update public.cash_ledger set amount = v_total where source_type = 'expense' and source_id = e.id;
      end if;
    end if;
  end if;

  update public.expenses set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid() where id = e.id;
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_review_expense(uuid, text, jsonb, text) from public, anon;
grant execute on function public.owner_review_expense(uuid, text, jsonb, text) to authenticated;
