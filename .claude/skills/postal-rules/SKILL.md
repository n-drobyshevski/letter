---
name: postal-rules
description: Delivery-time algorithm, database invariants, RLS rules and push copy for the letter service (Supabase). Use when touching supabase/migrations, supabase/functions, delivery tiers, mailbox status or notifications.
---

# Postal rules

## Invariants (tests: `tests/sql.test.ts`, `tests/dispatch.test.ts`)
1. **The server decides `deliver_at`.** Clients write only through `post_letter`, `retrieve_letter`, `open_letter` (security definer, `search_path = ''`). No insert/update policies on `letters`.
2. **Envelope visible at once, contents only after `deliver_at`** — `letters` vs `letter_contents`, gated by `can_read_contents()`. Storage objects under `<letter_id>/…` use the same gate.
3. **Never lose a letter, never delay it beyond the estimate shown.** No random loss, no hidden extra delay. Jitter is bounded (±15 %) and applied before rounding, at posting time.
4. **Status is derived** (`letter_status` view: posted → in_transit → delivered, or retrieved). Cron only dispatches pushes, idempotently via `pushed_at`.
5. **Read receipts are private** (`letter_receipts`); the sender sees them only if *both* opted in.
6. Every change to a migration needs a PGlite test; Supabase-only pieces are stubbed in `tests/dispatch.test.ts`.

## Delivery tiers (`compute_deliver_at`)
- Post rounds: **10:00 and 16:00 in the recipient's time zone, no Sunday rounds** (`next_post_round`, DST-safe by doing wall-clock math in Postgres).
- `express`: next round ≥ 2 h after posting.
- `standard`: `clamp(km / 40, 12, 72) h × (1 ± 0.15)`, then next round (distance unknown → 24 h).
- `scheduled`: 10:00 local on the chosen date; must be ≥ 2 h away.
- Grace window: `collect_at = min(posted + 1 h, deliver_at)`; the sender may retrieve until then.
- v1 additions: "open when…" (delivered sealed, opened on the recipient's cue), +1 year capsule, slow boat.

## Postmark
Server-stamped at posting: sender's city + local date (`envelope.postmark`). The client renders it procedurally from these values only.

## Push
- `dispatch_deliveries()` every minute → Edge Function `deliver` → Expo Push. On failure the function clears `pushed_at` so the next tick retries.
- Copy is vague and localized (ru/fr): "Почта пришла — Флажок на почтовом ящике поднят." / "Du courrier pour toi — Le drapeau de la boîte aux lettres est levé." Never include letter text.
- Web (laptop) gets no push; the mailbox updates through Realtime on `letters`.
