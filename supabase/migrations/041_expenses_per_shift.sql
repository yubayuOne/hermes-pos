-- 041: pengeluaran jadi satu catatan per shift (permintaan pemilik, 15 Okt 2026).
-- * Tiap kali kasir mencatat, barangnya ditambahkan ke catatan shift itu. Sumber uang (kas laci atau bukan) dicatat
--   per barang, karena satu shift bisa punya keduanya. Kunci idempotensi juga per kiriman, disimpan di barangnya.
-- * Buku kas: satu baris 'out' per catatan shift, jumlahnya total barang dari laci. Diubah hanya saat kasir menambah
--   barang, selagi shift buka dan terkunci.
-- * Pemilik mengecek sekali per shift, hanya setelah shift ditutup. Koreksi pemilik tidak pernah mengubah buku kas.
-- * Data 040 digabung per shift ke catatan paling awal. Status sama: tetap. Status campur, atau sudah dicek padahal
--   shift masih buka: kembali 'pending' supaya pemilik mengecek ulang semuanya.

alter table public.expense_items add column if not exists paid_from text;
alter table public.expense_items add column if not exists entry_key text;
update public.expense_items i set paid_from = e.paid_from, entry_key = e.idempotency_key
from public.expenses e where e.id = i.expense_id and i.paid_from is null;
alter table public.expense_items alter column paid_from set not null;
alter table public.expense_items drop constraint if exists expense_items_paid_from;
alter table public.expense_items add constraint expense_items_paid_from check (paid_from in ('drawer', 'other'));

-- ---------------------------------------------------------------- gabung data 040
-- Tanpa temp table: beberapa runner mengirim tiap statement lewat koneksi berbeda. Tiap langkah satu statement
-- (atomik) dan aman diulang. "m" = tiap catatan dan catatan paling awal di shift-nya (keeper).

-- Buku kas: satu baris per keeper berisi jumlah semua baris grupnya. Baris yang disimpan adalah milik keeper bila ada,
-- jadi pindah source_id tidak bentrok dengan indeks unik; sisanya dihapus di statement yang sama.
with m as (
  select e.id, first_value(e.id) over (partition by e.shift_id order by e.created_at, e.id) as keeper from public.expenses e
), g as (
  select l.id, m.keeper, sum(l.amount) over (partition by m.keeper) as total,
    row_number() over (partition by m.keeper order by (l.source_id = m.keeper) desc, l.created_at, l.id) as rn
  from public.cash_ledger l join m on l.source_type = 'expense' and l.source_id = m.id
), gone as (
  delete from public.cash_ledger l using g where l.id = g.id and g.rn > 1
)
update public.cash_ledger l set amount = g.total, source_id = g.keeper from g where l.id = g.id and g.rn = 1;

with m as (
  select e.id, e.created_at, first_value(e.id) over (partition by e.shift_id order by e.created_at, e.id) as keeper from public.expenses e
)
update public.expense_items i set expense_id = x.keeper, position = x.pos
from (
  select i2.id, m.keeper, (row_number() over (partition by m.keeper order by m.created_at, m.id, i2.position) - 1)::smallint as pos
  from public.expense_items i2 join m on m.id = i2.expense_id
) x
where x.id = i.id;

-- Barangnya sudah pindah ke keeper, jadi menghapus catatan lain tidak ikut menghapus barang.
with m as (
  select e.id, first_value(e.id) over (partition by e.shift_id order by e.created_at, e.id) as keeper from public.expenses e
), s as (
  select m.keeper, count(distinct e.status) as statuses, sum(e.total) as total, max(e.reviewed_at) as reviewed_at,
    string_agg(distinct e.reject_reason, '; ') as reasons
  from m join public.expenses e on e.id = m.id
  group by m.keeper having count(*) > 1
), gone as (
  delete from public.expenses e using m where e.id = m.id and m.id <> m.keeper
)
update public.expenses k set
  total = s.total,
  status = case when s.statuses = 1 then k.status else 'pending' end,
  reviewed_at = case when s.statuses = 1 then s.reviewed_at end,
  reviewed_by = case when s.statuses = 1 then k.reviewed_by end,
  reject_reason = case when s.statuses = 1 and k.status = 'rejected' then left(s.reasons, 200) end
from s
where k.id = s.keeper;

update public.expenses e set status = 'pending', reviewed_at = null, reviewed_by = null, reject_reason = null
from public.shifts s where s.id = e.shift_id and s.status = 'open' and e.status <> 'pending';

alter table public.expenses drop column if exists paid_from, drop column if exists idempotency_key;
drop index if exists public.expenses_shift;
alter table public.expenses drop constraint if exists expenses_one_per_shift;
alter table public.expenses add constraint expenses_one_per_shift unique (shift_id);

-- ---------------------------------------------------------------- validasi barang
-- p_paid_from diisi (kasir): semua barang dari sumber itu. Null (pemilik): tiap barang wajib membawa "paidFrom".
-- Maksimal 200 barang, karena pemilik mengirim seluruh barang satu shift saat mengoreksi.
drop function if exists public.expense_items_checked(jsonb);
create or replace function public.expense_items_checked(p_items jsonb, p_paid_from text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  x jsonb;
  v_out jsonb := '[]'::jsonb;
  v_name text;
  v_qty numeric;
  v_amount numeric;
  v_paid text;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Isi minimal satu barang.';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Maksimal 200 barang dalam satu shift.'; end if;
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
    v_paid := coalesce(p_paid_from, x->>'paidFrom', '');
    if v_paid not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'category', x->>'category', 'quantity', v_qty,
      'unit', x->>'unit', 'amount', v_amount, 'paidFrom', v_paid));
  end loop;
  return v_out;
end $$;
revoke all on function public.expense_items_checked(jsonb, text) from public, anon, authenticated;

create or replace function public.expense_json(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'createdAt', e.created_at, 'outletId', e.outlet_id, 'outletName', o.name, 'shiftId', e.shift_id,
    'businessDate', s.business_date, 'shiftNumber', s.shift_number, 'shiftOpen', s.status = 'open',
    'cashierName', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = e.cashier_id limit 1),
    'status', e.status, 'total', e.total, 'reviewedAt', e.reviewed_at, 'rejectReason', e.reject_reason,
    'drawerTotal', (select coalesce(sum(i.amount), 0) from public.expense_items i where i.expense_id = e.id and i.paid_from = 'drawer'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category, 'quantity', i.quantity,
        'unit', i.unit, 'amount', i.amount, 'paidFrom', i.paid_from) order by i.position)
      from public.expense_items i where i.expense_id = e.id
    ), '[]'::jsonb))
  from public.expenses e join public.outlets o on o.id = e.outlet_id join public.shifts s on s.id = e.shift_id
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
  v_count int := 0;
begin
  -- Mengunci shift: tutup shift dan kiriman lain di shift ini menunggu sampai catatan dan buku kasnya selesai.
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);
  if v_key = '' then raise exception 'Kunci idempotensi wajib diisi'; end if;

  select * into e from public.expenses where shift_id = p_shift_id;
  -- Kirim ulang (tombol ditekan dua kali, koneksi putus): barangnya sudah ada, kembalikan catatan yang sama.
  if e.id is not null and exists (select 1 from public.expense_items where expense_id = e.id and entry_key = v_key) then
    return jsonb_build_object('ok', true, 'replayed', true) || public.expense_json(e.id);
  end if;

  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select sum((x->>'amount')::numeric) into v_total from jsonb_array_elements(v_items) x;

  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total)
    values (b, p_outlet_id, p_shift_id, p_cashier_id, v_total)
    returning * into e;
  else
    select count(*) into v_count from public.expense_items where expense_id = e.id;
    if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
    update public.expenses set total = total + v_total where id = e.id;
  end if;

  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from, entry_key)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from, v_key
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

-- ---------------------------------------------------------------- pemilik
-- Satu baris per shift, urut tanggal bisnis terbaru (200 shift). Rentang waktu tetap memakai waktu catatan dibuat.
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
      select jsonb_agg(public.expense_json(x.id) order by x.business_date desc, x.created_at desc, x.id)
      from (
        select e.id, e.created_at, s.business_date from public.expenses e join public.shifts s on s.id = e.shift_id
        where e.business_id = b and e.status = p_status
          and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        order by s.business_date desc, e.created_at desc, e.id limit 200
      ) x
    ), '[]'::jsonb),
    -- Total per tanggal bisnis untuk status dan rentang yang sama: { "2026-10-15": 221000 }.
    'dayTotals', coalesce((
      select jsonb_object_agg(x.d, x.t) from (
        select s.business_date::text as d, sum(e.total) as t from public.expenses e join public.shifts s on s.id = e.shift_id
        where e.business_id = b and e.status = p_status
          and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        group by s.business_date
      ) x
    ), '{}'::jsonb),
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

-- p_action 'approve' (p_items opsional: seluruh barang shift hasil koreksi, tiap barang dengan "paidFrom") atau
-- 'reject' (p_reason wajib). Hanya setelah shift ditutup.
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
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into e from public.expenses where id = p_expense_id and business_id = b for update;
  if not found then raise exception 'Pengeluaran tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengecek pengeluaran'); end if;
  if e.status <> 'pending' then
    raise exception 'Pengeluaran ini sudah dicek.' using errcode = 'P0001', hint = 'already_reviewed';
  end if;
  -- Dikunci supaya kasir tidak menambah barang di antara cek ini.
  if (select s.status from public.shifts s where s.id = e.shift_id for update) = 'open' then
    raise exception 'Shift masih buka. Pengeluaran bisa dicek setelah shift ditutup.' using errcode = 'P0001', hint = 'shift_open';
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
    v_items := public.expense_items_checked(p_items, null);
    delete from public.expense_items where expense_id = e.id;
    insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
    select e.id, (x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
      (x.v->>'amount')::numeric, x.v->>'paidFrom'
    from jsonb_array_elements(v_items) with ordinality as x(v, ord);
    update public.expenses set total = (select sum((x->>'amount')::numeric) from jsonb_array_elements(v_items) x) where id = e.id;
  end if;

  update public.expenses set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid() where id = e.id;
  return public.expense_json(e.id);
end $$;
