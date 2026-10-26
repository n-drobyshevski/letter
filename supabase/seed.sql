-- One couple, two people. Run once after both of you have signed in (magic link),
-- replacing the e-mails, cities and coordinates. There is deliberately no pairing UI.
with c as (insert into public.couples default values returning id)
insert into public.profiles (id, couple_id, display_name, pet_name, city, lat, lon, tz, locale)
select u.id, c.id, v.display_name, v.pet_name, v.city, v.lat, v.lon, v.tz, v.locale
from c,
  (values
    ('me@example.com',  'Н.', 'зайка', 'Paris',  48.8566, 2.3522,  'Europe/Paris',  'ru'),
    ('her@example.com', 'М.', 'mon cœur', 'Lyon', 45.7640, 4.8357, 'Europe/Paris', 'fr')
  ) as v(email, display_name, pet_name, city, lat, lon, tz, locale)
join auth.users u on u.email = v.email;
