-- Bill numbers are unique per outlet, not across the whole database (prompt 4).
-- A phone's terminal code is per outlet, so the first phone of every outlet is A1, and its counter starts at 1 each day.
-- Two outlets selling on the same day made the same number, and the second bill was refused (the global unique on
-- transactions.number, 001). Nothing looks a bill up by its number alone: the searches match several bills and stay
-- inside the outlet, so the number only needs to be unique inside its outlet.
alter table public.transactions drop constraint if exists transactions_number_key;
create unique index if not exists transactions_outlet_number on public.transactions(outlet_id, number);
