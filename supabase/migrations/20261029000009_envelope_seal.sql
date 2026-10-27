-- The seal goes where the sender put it, pressed with the die they chose.
--
-- letters.envelope gains two keys, written by the app (envelopeJson in src/lib/draft.ts):
--   * seal: the placement, v1 (puddle x/y as fractions of the envelope back, sizes in mm,
--     optional stretch and drops, stamp {x, y, rMm, rot, depth} or null);
--   * die:  the seal die's id ('monogram', 'heart', 'lily', ...).
-- Both are optional: letters posted before this have neither and keep today's centred seal.
-- The client's parseSeal is the real guard (it clamps or drops what it cannot draw); the
-- server only keeps the shape sane and the row small. post_letter and record_posting merge
-- the envelope as before (the client's keys, then the server's postmark on top).
--
-- Additive and safe on live data: every existing row has no seal and a small envelope.
-- The checks are added NOT VALID (no long lock), then validated, which scans the rows once
-- and fails the migration, changing nothing, if any row did not pass.

alter table public.letters
  add constraint letters_envelope_seal_object
    check (jsonb_typeof(envelope -> 'seal') is null or jsonb_typeof(envelope -> 'seal') = 'object') not valid,
  add constraint letters_envelope_die_string
    check (jsonb_typeof(envelope -> 'die') is null or jsonb_typeof(envelope -> 'die') = 'string') not valid,
  -- A full envelope (paper, liner, wax, die, initials, seal with two drops, postmark) is
  -- well under 1 KB; 4 KB leaves room and keeps it inline in the row.
  add constraint letters_envelope_small
    check (pg_column_size(envelope) < 4096) not valid;

alter table public.letters validate constraint letters_envelope_seal_object;
alter table public.letters validate constraint letters_envelope_die_string;
alter table public.letters validate constraint letters_envelope_small;

comment on column public.letters.envelope is
  'The sealed envelope, visible before the contents. From the app (envelopeJson): paper, liner, wax, waxType, '
  'die, initials, seed, format (DL/C5/C6), seal (placement v1: x, y, rMm, stretch?, drops?, stamp | null). '
  'From the server: postmark {city, date}. seal and die may be absent on older letters.';
