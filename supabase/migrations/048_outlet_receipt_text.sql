-- HERMES POS 048: the receipt header and footer text lives per outlet only (outlets.receipt_header / receipt_footer, 047).
--  * The text an owner had already typed for the whole business (businesses.receipt header/footer) is copied into every
--    outlet that has none, so no receipt changes. The business keys stay in the jsonb, unused.
--  * owner_apply_receipt_text sets the same header and footer on every outlet of the business ("pakai untuk semua outlet").

update public.outlets o
set receipt_header = coalesce(o.receipt_header, nullif(btrim(b.receipt ->> 'header'), '')),
    receipt_footer = coalesce(o.receipt_footer, nullif(btrim(b.receipt ->> 'footer'), ''))
from public.businesses b
where b.id = o.business_id
  and ((o.receipt_header is null and nullif(btrim(b.receipt ->> 'header'), '') is not null)
    or (o.receipt_footer is null and nullif(btrim(b.receipt ->> 'footer'), '') is not null));

create or replace function public.owner_apply_receipt_text(p_header text, p_footer text)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if char_length(btrim(coalesce(p_header, ''))) > 120 or char_length(btrim(coalesce(p_footer, ''))) > 120 then
    raise exception 'Teks struk maksimal 120 karakter' using errcode = '22023';
  end if;
  update public.outlets
  set receipt_header = nullif(btrim(coalesce(p_header, '')), ''), receipt_footer = nullif(btrim(coalesce(p_footer, '')), '')
  where business_id = b;
end $$;
revoke all on function public.owner_apply_receipt_text(text, text) from public, anon;
grant execute on function public.owner_apply_receipt_text(text, text) to authenticated;
