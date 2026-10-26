-- Where a letter probably is right now, for the "somewhere here?" pencil circle on the map.
-- Clients only see the scans so far (RLS), but the estimate also needs the silent
-- waypoints and the next scan, so the server interpolates and returns a single number:
-- the position along the route, 0..1. Same audience as the scans themselves.

create function public.tracking_estimate(p_letter_id uuid)
returns real
language plpgsql stable security definer
set search_path = ''
as $$
declare
  prev public.tracking_events;
  nxt public.tracking_events;
begin
  if not exists (
    select 1 from public.letters l
     where l.id = p_letter_id and l.retrieved_at is null
       and (l.sender_id = auth.uid() or (l.recipient_id = auth.uid() and l.collected_at is not null))
  ) then
    return null;
  end if;
  select * into prev from public.tracking_events
   where letter_id = p_letter_id and at <= now() order by at desc, seq desc limit 1;
  select * into nxt from public.tracking_events
   where letter_id = p_letter_id and at > now() order by at, seq limit 1;
  if prev.letter_id is null then
    return case when nxt.letter_id is null then null else 0 end;
  end if;
  if nxt.letter_id is null then
    return prev.route_t;
  end if;
  return prev.route_t + (nxt.route_t - prev.route_t)
    * extract(epoch from now() - prev.at) / greatest(extract(epoch from nxt.at - prev.at), 1);
end
$$;

revoke all on function public.tracking_estimate from public, anon;
grant execute on function public.tracking_estimate to authenticated;
