# Письма · Letter

A private app for two people that simulates sending and receiving real letters. You write on paper that looks and behaves like paper, fold it, seal it and post it. The letter then travels for as long as the sender chose. The other person finds it in the mailbox, slits the envelope and unfolds the letter.

- **Plan & roadmap:** [`docs/plan.md`](docs/plan.md)
- **Research** (stack, realism, animation, product, AI tooling): [`docs/research/`](docs/research)

## The app

| Screen | Route | What it is |
|---|---|---|
| Home | `/` | Your mailbox (a red flag when something is waiting), the letter on your desk, letters on their way in both directions, the ones you have read. Signed out: the sign-in card. No backend: the lab index |
| Write | `/write` | The writing desk (same screen as `/lab/typing`): the sheet on a walnut (FR) or oak (RU) desk; pull a drawer up, tap it or tug it, to take paper (notebook, Seyès, cotton, airmail), a pen (the hand) and a bottle (the ink) while the letter is blank, and the envelope `/seal` starts from |
| Fold | `/fold` | Fold what you wrote; the gesture picks the fold: drag up from below = in three (DL), pull the top edge down = in half (A5), then swipe left = in four (A6). Saved with the letter, in an envelope that fits the fold (DL, C5, C6); she unfolds it the same way |
| Seal | `/seal` | Slide your folded letter into its envelope and seal it (same screen as `/lab/envelope`): pour the wax wherever you hold, pick one of eight dies, press it where you tap. The seal travels with the letter exactly as you made it; folding again or editing the letter unseals it |
| Post | `/post` | The postbox (same as `/lab/post`) |
| Mailbox | `/mailbox` | Your mailbox (same as `/lab/mailbox`) |
| Track | `/track/<id>` | A letter's journey |

## Status: week-1 spikes (`/lab`)

| Lab | Route | What it proves |
|---|---|---|
| Почерк | `/lab/jitter` | Typed RU/FR text rendered as handwriting: seeded per-word jitter, ink load and re-dips, feathering, notebook-grid, Seyès, cotton and airmail paper shaders |
| Письмо | `/lab/typing` | Writing straight onto the sheet with the native keyboard (RU/FR, autocorrect, dictation), crossfading into inked handwriting; a finger/stylus pen for signatures and doodles; the desk's three drawers (paper, pens and inks, envelopes) under it; `?drawer=paper|pens|envelopes&dt=` freezes one open, `?item=` lifts an item, `?country=fr`, `?kb=1`, `?rm=1`, `?debug=1` |
| Стол | `/lab/desk` | The writing desk's realism board: the desk top over the closed band, the three drawers fully out side by side, every item (paper stacks, pens, bottles, envelopes) at the drawers' scale and at the desk's; `?country=ru|fr`, `?paper=&ink=&font=` for what is in use, `?item=` lifts one |
| Сложить | `/lab/fold` | Gesture-driven folds, chosen by the gesture: tri-fold (up), half (top edge down), quarter (then left); hinged panels in perspective, seeded off-centre creases, face swap with ink show-through, moving shadows, crease haptics; `?fold=half|quarter&t=` freezes frames |
| Конверт | `/lab/envelope` | Slide the folded letter into the envelope, close the flap in perspective, then seal it anywhere: hold where the seal should go and the wax (brittle sealing wax or modern flexible wax) pours right there, growing while you hold, steered as you move; pick a die (your monogram, heart, swallow, bee, rose, lily, cornflower, moon); tap where to press it or drag the stamp there, turn it (two fingers, the wheel, `[` `]`, ↺ ↻); a die off the wax bounces back, one half off leaves a cut-off imprint, pressed late a shallow one; a seal across the flap edge holds it, one on the flap or the body is decoration; every step has a button (they lead with Reduce Motion or a screen reader); `?t=&sx=&sy=&kx=&ky=&rot=&depth=&die=&hold=` freeze any seal |
| Отправить | `/lab/post` | Post the sealed envelope into a Почта wall box (turns to go in short edge first) or a French street box (long edge first); it catches on the seal, darkens into the slot; take it back until the collection time ; with a backend and a signed-in account it really posts the letter you wrote at the desk, through `post-letter` (sign in with an e-mailed code, pick the tier, «Как настоящая» only France → Belarus) |
| — | `/track/<id>` | The journey of a real letter: the scans the server has revealed so far, live over Realtime; the map's pencil guess comes from the server's estimate |
| Где письмо? | `/lab/track` | Tracking a registered letter Lille → Minsk on an old-atlas paper map: real hubs (Lesquin, Roissy, MINSK PI 2), realistic delays and silences, official scan lines in French/Russian with handwritten notes, a promise window that always holds; fake clock, three tiers, both viewers |
| Получить | `/lab/mailbox` | Your подъезд mailbox in Moscow (envelopes show through the peek holes) or your boîte aux lettres in Paris (corners poke out of the slot); several letters wait in order; open the door, take the envelope out, read the address side (stamp, postmark, wear), flip it, then either slit the fold with a paper knife or break the wax seal wherever the sender put it (it strains, snaps along the flap edge it crosses, chips fly; a decorative seal off the edge stays whole and only the knife opens it), pull the letter out, unfold; re-reading skips the ceremony; signed in, it is your real mailbox: the letters delivered to you, opened for real (a private receipt records slit or seal), pen signatures included, and a shoebox of read letters that reopens without the ceremony |
| Путь письма | `/lab/journey` | The whole journey offline, end to end: write on the sheet (keyboard or pen), paper, pen, ink and envelope from the desk's drawers → fold by gesture → into an envelope sized to the fold (DL/C5/C6), wax and die wherever you put them → postbox in Lille or Moscow → skip the weeks → it waits in her mailbox in Minsk (or yours in Lille): open, slit or break the seal, unfold, read; `?step=write|fold|envelope|post|receive` jumps in with a sample letter, `?fold=` presets the fold, `?t=&die=` freeze the envelope step |

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

### Deploy

Backend: Supabase project `letter` (eu-central-1). Web: Vercel, built from this repo with `vercel.json`.

1. Create a Supabase project and copy `.env.example` → `.env.local`.
2. Apply the migrations in filename order: `supabase db push`, or `apply_migration` via the Supabase MCP.
3. Vault secrets (SQL): `project_url`, plus a random `deliver_secret` (see the header of `supabase/migrations/20261026000002_delivery_push.sql`). The deliver function checks the token itself, so no key is copied by hand.
4. Deploy the functions: `supabase functions deploy post-letter` and `supabase functions deploy deliver --no-verify-jwt`. The app posts through `post-letter`.
5. Create both accounts in the dashboard (Authentication → Users → Add user; sign-in never creates accounts), then run `supabase/seed.sql` with your e-mails, cities and time zones. Tracking is routed for a sender in `Europe/Paris` writing to `Europe/Minsk`.
6. Sign-in is a 6-digit code by e-mail (no deep links): add `{{ .Token }}` to the Magic Link e-mail template (Authentication → Email Templates).
7. Vercel project from this repo: env `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `vercel.json` builds the web export, serves it as a single-page app, and runs `api/keepalive` daily so a free Supabase project never pauses mid-journey.
8. Write at the desk (`/lab/typing`), then «Отнести на почту →». The posting screen sends exactly what you wrote.

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
