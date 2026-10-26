-- RLS helpers are for signed-in members only (Supabase advisor 0028): nothing to
-- learn from them anonymously, but nothing anonymous should reach them either.
revoke execute on function public.can_read_contents(uuid) from public, anon;
revoke execute on function public.my_couple_id() from public, anon;
grant execute on function public.can_read_contents(uuid), public.my_couple_id() to authenticated;
