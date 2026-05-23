
revoke execute on function public.try_reserve_stock(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.confirm_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.release_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.expire_stale_reservations() from public, anon, authenticated;
