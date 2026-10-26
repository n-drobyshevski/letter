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

Backend (`supabase/`):
- schema, RLS and the server-side delivery algorithm
- delivery tiers: express, standard (distance-based) and scheduled
- 10:00/16:00 post rounds in the recipient's time zone
- a grace window to take a letter back
- private read receipts
- per-minute dispatch to an Expo push Edge Function

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
4. Deploy the push function: `supabase functions deploy deliver`.
5. You both sign in once with a magic link. Then run `supabase/seed.sql` with your e-mails and cities.

## Checks

```bash
npm test                                  # handwriting layout, SkSL compile, RU/FR glyph coverage, SQL + RLS (PGlite)
npm run typecheck && npm run lint
npm run export:web && npm run qa:visual   # phone + laptop screenshots in qa-screens/
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
