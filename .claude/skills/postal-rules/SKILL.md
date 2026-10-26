---
name: postal-rules
description: Delivery-time algorithm, database invariants, RLS rules and push copy for the letter service (Supabase). Use when touching supabase/migrations, supabase/functions, delivery tiers, mailbox status or notifications.
---

# Postal rules

## Invariants (tests: `tests/sql.test.ts`, `tests/dispatch.test.ts`)
1. **The server decides `deliver_at`.** Clients write only through `post_letter`, `retrieve_letter`, `open_letter` (security definer, `search_path = ''`). No insert/update policies on `letters`.
2. **Nothing for the recipient while the letter is still in the postbox** (before `collect_at`, the sender's grace window). Then the sealed envelope is visible ("в пути"), and the contents only after `deliver_at` — `letters` vs `letter_contents`, gated by `can_read_contents()`. Storage objects under `<letter_id>/…` use the same gate.
3. **Never lose a letter, never delay it beyond the estimate shown.** No random loss, no hidden extra delay. Jitter is bounded (±15 %) and applied before rounding, at posting time.
4. **Status is derived** (`letter_status` view: posted → in_transit → delivered, or retrieved), **but every transition is also written** so Realtime fires: `collect_posted()` stamps `collected_at`, `dispatch_deliveries()` stamps `pushed_at` (both pg_cron, every minute, idempotent).
5. **Read receipts are private** (`letter_receipts`, with `opened_by`: slit / seal / replay); the sender sees them only if *both* opted in. `open_letter(id, opened_by)` is idempotent — queue it offline and retry.
6. Every change to a migration needs a PGlite test; Supabase-only pieces are stubbed in `tests/dispatch.test.ts`.

## Delivery tiers (`compute_deliver_at`)
- Post rounds: **10:00 and 16:00 in the recipient's time zone, no Sunday rounds** (`next_post_round`, DST-safe by doing wall-clock math in Postgres).
- `express`: next round ≥ 2 h after posting.
- `standard`: `clamp(km / 40, 12, 72) h × (1 ± 0.15)`, then next round (distance unknown → 24 h).
- `scheduled`: 10:00 local on the chosen date; must be ≥ 2 h away.
- Grace window: `collect_at = min(posted + 1 h, deliver_at)`; the sender may retrieve until then.
- v1 additions: "open when…" (delivered sealed, opened on the recipient's cue), +1 year capsule, slow boat.

## Several letters
Oldest unopened first. After reading one, return to the open mailbox (skip the door). The box shows how many wait (RU: all peek holes pale; FR: up to three corners, then a chalked «+N») and the hint says so («В ящике писем: 3» / «3 lettres t’attendent»).

## Postmark
Server-stamped at posting: sender's city + local date (`envelope.postmark`). The client renders it procedurally from these values only, in the sender's country style (RU calendar stamp «… ПОЧТА», FR «… FRANCE»).

## Push
- `dispatch_deliveries()` every minute → Edge Function `deliver` → Expo Push. On failure the function clears `pushed_at` so the next tick retries.
- Copy is vague and localized (ru/fr): "В ящике письмо — Загляни в почтовый ящик: там что-то белеет." / "Tu as du courrier — Quelque chose dépasse de ta boîte aux lettres." Never include letter text.
- **No mailbox flag.** On US boxes a raised flag means *outgoing* mail, and RU/FR boxes have none. The cue is the envelope itself: pale through the peek holes (RU подъезд box) or a corner poking out of the slot (FR).
- Times in copy say whose clock they are: «Можно забрать до 14:37» is the sender's time; delivery rounds are the recipient's.
- Web (laptop) gets no push; the mailbox updates through Realtime on `letters`.
