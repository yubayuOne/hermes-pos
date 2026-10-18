-- Tests for 048 (receipt text per outlet only) on top of 001 to 048.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (no error)', label;
exception when others then
  raise notice '%', (case when sqlerrm ilike '%' || expect || '%' then 'PASS ' else 'FAIL ' end) || label || ' -> ' || sqlerrm;
end $$;

insert into auth.users(id, email) values ('b4800000-0000-0000-0000-000000000001', 'empat@kedai.id'), ('b4800000-0000-0000-0000-000000000002', 'lain@kedai.id');
select set_config('request.jwt.claim.sub', 'b4800000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kedai Empat', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o1', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days', extra_outlets = 1 where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.o2', public.owner_create_outlet('Cabang')::text, false);
select public.owner_update_outlet(current_setting('t.o2')::uuid, 'Cabang', null, null, true, 'Cabang sendiri', null);

-- The backfill of 048 (same statement), for a business that had typed a text before: it fills only the empty outlets.
reset role;
update public.businesses set receipt = receipt || '{"header":"Teks bisnis","footer":"Bisnis bawah"}'::jsonb where id = current_setting('t.b')::uuid;
update public.outlets o
set receipt_header = coalesce(o.receipt_header, nullif(btrim(b.receipt ->> 'header'), '')),
    receipt_footer = coalesce(o.receipt_footer, nullif(btrim(b.receipt ->> 'footer'), ''))
from public.businesses b
where b.id = o.business_id
  and ((o.receipt_header is null and nullif(btrim(b.receipt ->> 'header'), '') is not null)
    or (o.receipt_footer is null and nullif(btrim(b.receipt ->> 'footer'), '') is not null));
select pg_temp.ok('B1 outlet without text takes the business text',
  (select receipt_header = 'Teks bisnis' and receipt_footer = 'Bisnis bawah' from public.outlets where id = current_setting('t.o1')::uuid));
select pg_temp.ok('B2 outlet with its own header keeps it, gets the missing footer',
  (select receipt_header = 'Cabang sendiri' and receipt_footer = 'Bisnis bawah' from public.outlets where id = current_setting('t.o2')::uuid));

set role authenticated;
select public.owner_apply_receipt_text('Sama semua', 'Terima kasih ya');
select pg_temp.ok('A1 apply sets every outlet of the business',
  (select count(*) from public.outlets where business_id = current_setting('t.b')::uuid and receipt_header = 'Sama semua' and receipt_footer = 'Terima kasih ya') = 2);
select public.owner_apply_receipt_text('', '  ');
select pg_temp.ok('A2 empty text clears them all',
  (select count(*) from public.outlets where business_id = current_setting('t.b')::uuid and receipt_header is null and receipt_footer is null) = 2);
select pg_temp.fails('A3 over 120 characters is refused', format('select public.owner_apply_receipt_text(%L, null)', repeat('x', 121)), '120');

select set_config('request.jwt.claim.sub', 'b4800000-0000-0000-0000-000000000002', false);
select pg_temp.fails('A4 an account without a business cannot apply', 'select public.owner_apply_receipt_text(''x'', ''y'')', 'owner');
