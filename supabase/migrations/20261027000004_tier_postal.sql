-- "Как настоящая почта / Comme la vraie poste": delivery decided by a realistic
-- itinerary (supabase/functions/post-letter). Alone in its migration: a new enum
-- value can't be used in the transaction that adds it.
alter type public.delivery_tier add value if not exists 'postal';
