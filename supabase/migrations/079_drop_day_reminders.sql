-- 078 stopped the "day not closed" reminder; the ones already sent point to a page that is gone.
delete from public.notifications where kind = 'day_not_closed';
