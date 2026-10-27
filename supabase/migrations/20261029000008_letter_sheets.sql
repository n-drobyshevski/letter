-- Letters of several sheets, written on both sides (body schema_v 2).
--
-- schema_v 1: { text, strokes, sheet_width, font, ink, paper, fold, seed }: one face.
-- schema_v 2: the same top level (sheet 1's recto, so an older reader still shows
-- page 1) plus "schema_v": 2 and "sheets": [ { verso? }, { recto, verso? }, … ],
-- at most 4 sheets; sheets[0] holds only sheet 1's verso.
--
-- The body is checked where it is stored, so every way of posting (post_letter,
-- record_posting) is covered. Existing rows are not re-checked (not valid).

create function public.check_face(p_face jsonb, p_where text)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_face is null then
    return;
  end if;
  if jsonb_typeof(p_face) <> 'object' then
    raise exception 'letter %: not a page', p_where;
  end if;
  if p_face ? 'text' and jsonb_typeof(p_face->'text') <> 'string' then
    raise exception 'letter %: text must be a string', p_where;
  end if;
  if p_face ? 'strokes' and jsonb_typeof(p_face->'strokes') <> 'array' then
    raise exception 'letter %: strokes must be a list', p_where;
  end if;
end
$$;

create function public.check_body(p_body jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  n int;
  i int;
begin
  if jsonb_typeof(p_body) <> 'object' then
    raise exception 'letter body must be an object';
  end if;
  if octet_length(p_body::text) > 2000000 then
    raise exception 'letter too large';
  end if;
  perform public.check_face(p_body, 'sheet 1');
  if not p_body ? 'sheets' then
    return true;
  end if;
  if jsonb_typeof(p_body->'sheets') <> 'array' then
    raise exception 'letter sheets must be a list';
  end if;
  n := jsonb_array_length(p_body->'sheets');
  if n < 1 or n > 4 then
    raise exception 'a letter has 1 to 4 sheets';
  end if;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(p_body->'sheets'->i) <> 'object' then
      raise exception 'letter sheet %: not a sheet', i + 1;
    end if;
    if i > 0 and not (p_body->'sheets'->i) ? 'recto' then
      raise exception 'letter sheet %: no front', i + 1;
    end if;
    perform public.check_face(p_body->'sheets'->i->'recto', format('sheet %s front', i + 1));
    perform public.check_face(p_body->'sheets'->i->'verso', format('sheet %s back', i + 1));
  end loop;
  return true;
end
$$;

alter table public.letter_contents add constraint body_ok check (public.check_body(body)) not valid;

comment on column public.letter_contents.body is
  'schema_v 1 { text, strokes, sheet_width, font, ink, paper, fold, seed }; schema_v 2 adds sheets[] (see 20261029000008)';

-- Only the posting functions (security definer, as the owner) store bodies.
revoke all on function public.check_face(jsonb, text), public.check_body(jsonb) from public, anon, authenticated;
