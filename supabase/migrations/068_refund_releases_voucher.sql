-- A bill refunded in full gives its voucher use back, like a void (067). Refunds of a bill add up to exactly its total
-- and never past it (033), so refunded_total reaches the total once and this runs once per bill. A partial refund keeps
-- the use: the customer still bought something with the voucher. The redemption row stays for offline replays.
create or replace function public.trg_release_voucher_refund()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.vouchers v set used_count = greatest(v.used_count - 1, 0)
  from public.voucher_redemptions r
  where r.transaction_id = new.id and r.voucher_id = v.id;
  return new;
end $$;
revoke all on function public.trg_release_voucher_refund() from public, anon, authenticated;
drop trigger if exists transaction_release_voucher_refund on public.transactions;
create trigger transaction_release_voucher_refund
  after update of refunded_total on public.transactions
  for each row when (new.status = 'completed' and old.refunded_total < old.total and new.refunded_total >= new.total)
  execute function public.trg_release_voucher_refund();
