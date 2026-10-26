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

## Tracking (`src/letter/tracking/itinerary.ts`, migrations 004–005, `post-letter`)
- **One generator, two places.** `itinerary.ts` is self-contained and copied verbatim to `supabase/functions/_shared/` (`npm run sync:shared`; `tests/shared.test.ts` fails if they differ). The server generates; the app's lab only previews.
- **Route FR→BY** (inferred, Oct 2026): Lille box → PIC Lille-Lesquin → Roissy (dispatch Tue/Fri 20:00) → by road through BE/DE/PL, unscanned → border Kukuryki–Козловичи (3 % closed ≈ a week) → MINSK PI 2 (ул. Вокзальная 22, 09–18 daily; 4 % customs) → ОПС 220030 → delivery round 10:00/16:00 Mon–Sat. All of it is data at the top of the file; re-route there. Open questions in `docs/research/tracking-*.md`.
- **Calibration is a product choice:** `scale` 1.0 ("romantic") gives p05 ≈ 13 d, p50 ≈ 17 d, p95 ≈ 25 d; real reports are longer (≈ 1.6).
- **The promise:** at posting the day window `[lo, hi]` (recipient's zone) always contains `deliver_at`, which is exactly the EMI scan. Never later than shown.
- **Tiers:** `postal` = the itinerary decides `deliver_at` (`record_posting`, service role). `express`/`standard` keep `compute_deliver_at` and replay the same journey compressed into it (`record_tracking`); express shows only EMA → EMD → EMI.
- **RLS:** a scan is visible when `visible and at <= now()`; the recipient only after `collected_at`; silent waypoints (WPT/XBX) never. Retrieval deletes the journey. `reveal_tracking()` stamps `revealed_at` each minute for Realtime.
- **Copy:** official lines in the language of the post office that scanned (FR legs French, BY legs Russian); couple notes in the viewer's language; silence is explained, never framed as loss. A registered number (S10, valid check digit) heads the slip.

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
