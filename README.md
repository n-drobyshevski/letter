# Письма · Letter

A private app for two people that simulates sending and receiving real letters. You write on paper that looks and behaves like paper, fold it, seal it and post it. The letter then travels for as long as the sender chose. The other person finds it in the mailbox, slits the envelope and unfolds the letter.

- **Plan & roadmap:** [`docs/plan.md`](docs/plan.md)
- **Research** (stack, realism, animation, product, AI tooling): [`docs/research/`](docs/research)

## Status: week-1 spikes

| Lab | Route | What it proves |
|---|---|---|
| Почерк | `/lab/jitter` | Typed RU/FR text rendered as handwriting: seeded per-word jitter, ink load and re-dips, feathering, notebook-grid and cotton paper shaders |
| Письмо | `/lab/typing` | Writing straight onto the sheet with the native keyboard (RU/FR, autocorrect, dictation), crossfading into inked handwriting; a finger/stylus pen for signatures and doodles |
| Сложить | `/lab/fold` | Gesture-driven tri-fold: hinged panels in perspective, seeded off-third creases, face swap with ink show-through, moving shadows, crease haptics |
| Конверт | `/lab/envelope` | Slide the folded letter into the envelope, close the flap in perspective, hold to pour sealing wax (brittle sealing wax or modern flexible wax), release to press a brass seal that leaves your monogram in relief |
| Отправить | `/lab/post` | Post the sealed envelope into a Почта wall box (turns to go in short edge first) or a French street box (long edge first); it catches on the seal, darkens into the slot; take it back until the collection time ; with a backend and a signed-in account it really posts the letter you wrote at the desk, through `post-letter` (sign in with an e-mailed code, pick the tier, «Как настоящая» only France → Belarus) |
| — | `/track/<id>` | The journey of a real letter: the scans the server has revealed so far, live over Realtime; the map's pencil guess comes from the server's estimate |
| Где письмо? | `/lab/track` | Tracking a registered letter Lille → Minsk on an old-atlas paper map: real hubs (Lesquin, Roissy, MINSK PI 2), realistic delays and silences, official scan lines in French/Russian with handwritten notes, a promise window that always holds; fake clock, three tiers, both viewers |
| Получить | `/lab/mailbox` | Your подъезд mailbox in Moscow (envelopes show through the peek holes) or your boîte aux lettres in Paris (corners poke out of the slot); several letters wait in order; open the door, take the envelope out, read the address side (stamp, postmark, wear), flip it, then either slit the fold with a paper knife or break the wax seal (it strains, snaps along the flap edge, chips fly), pull the letter out, unfold; re-reading skips the ceremony |

Backend (`supabase/`):
- schema, RLS and the server-side delivery algorithm
- delivery tiers: express, standard (distance-based) and scheduled
- 10:00/16:00 post rounds in the recipient's time zone
- a grace window to take a letter back
- recipients see nothing until the letter is collected; collection and delivery are written so Realtime fires
- private read receipts
- per-minute dispatch to an Expo push Edge Function
- delivery tracking: a «Как настоящая почта» tier whose realistic itinerary decides the delivery time, scans revealed by the clock, a `post-letter` Edge Function sharing the app's generator

## Run it

```bash
npm install                 # also copies canvaskit.wasm into public/ for the web build
npx expo start              # press w for the laptop (web), or scan with a dev build
```

The labs need no backend. Skia, Reanimated and haptics need a **development build** on phones (`npx expo run:ios` / `eas build --profile development`), not Expo Go.

### Backend (when ready)

1. Create a Supabase project and copy `.env.example` → `.env.local`.
2. Apply the migrations: `supabase db push`, or use the Supabase MCP.
3. Store the `project_url` and `service_role_key` secrets in Vault (see the header of `supabase/migrations/20261026000002_delivery_push.sql`).
4. Deploy the functions: `supabase functions deploy deliver` and `supabase functions deploy post-letter`. The app posts through `post-letter`.
5. Create both accounts in the dashboard (Authentication → Users → Add user; sign-in never creates accounts), then run `supabase/seed.sql` with your e-mails, cities and time zones. Tracking is routed for a sender in `Europe/Paris` writing to `Europe/Minsk`.
6. Sign-in is a 6-digit code by e-mail (no deep links): add `{{ .Token }}` to the Magic Link e-mail template (Authentication → Email Templates).
7. Write at the desk (`/lab/typing`), then «Отнести на почту →». The posting screen sends exactly what you wrote.

## Checks

```bash
npm test                                  # handwriting layout, SkSL compile, RU/FR glyph coverage, SQL + RLS (PGlite)
npm run typecheck && npm run lint
npm run export:web && npm run qa:visual   # phone + laptop screenshots in qa-screens/
npm run build:map                         # re-bake assets/map/europe.json (Natural Earth)
npm run sync:shared                       # copy the itinerary generator to supabase/functions/_shared
```

## Working on it with Claude Code

Project skills live in `.claude/skills/`:
- `paper-realism`
- `letter-choreography`
- `postal-rules`

The official Expo plugin is enabled in `.claude/settings.json`.

Recommended additions:

```bash
/plugin install frontend-design@claude-plugins-official
/plugin marketplace add anthropics/skills
npx skills add supabase/agent-skills
```
