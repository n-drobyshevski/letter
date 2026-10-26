# «Letter»: realistic letter-sending simulator for two

## Context
The repo `n-drobyshevski/letter` is empty (no commits). We're building a private app for two people (the two of us). One writes a letter on realistic paper, folds it, puts it in an envelope, stamps it, seals it with wax and drops it in a postbox. The letter "travels" for a time the sender chooses. The other receives it in a mailbox, slits the envelope and unfolds the letter. The goal is maximum realism in rendering and animation.

**Your answers:**
- Devices: phones **and laptop**.
- Writing: **typed in a handwriting style + drawn by finger/stylus**.
- Delivery: **sender chooses** the speed.
- Languages: **Russian + French** (fonts need Cyrillic + French accents).

**How the plan was made:** a 7-agent research workflow (stack, paper, animation, product, AI tooling, then synthesis and a critic), using web search. Full reports: [`docs/research/synthesis.md`](research/synthesis.md) and [`docs/research/critique.md`](research/critique.md).

## 1. Tech stack (recommended)
| Layer | Choice | Why |
|---|---|---|
| App | **Expo SDK 58 universal app** (iOS + Android + **web for the laptop**), Expo Router, TypeScript | Real haptics + reliable push on phones (iOS Safari has no Vibration API, and PWA push is flaky). The same codebase exports to web for the laptop. |
| Rendering | **@shopify/react-native-skia 2.x** (SkSL RuntimeEffect shaders; CanvasKit on web) | Paper, ink, wax, page curl and crease lighting, driven by animation values with no React re-renders |
| Motion | **Reanimated 4** + react-native-worklets; **Gesture Handler 3** | Each ceremony = one `progress` value that the finger drives; on release it settles with a velocity spring |
| Handwriting | **perfect-freehand** (pressure derived from velocity; stylus pressure on iPad/laptop pen) | Vector strokes stored as `[x, y, p, t]`, so they can be replayed on opening |
| Typing | Transparent RN `TextInput` over the paper (native keyboard, autocorrect, dictation, RU/FR), crossfading to the jittered Skia render | Skia has no caret or IME. This is the #1 risk; prototype it in week 1 |
| Sound / haptics | `expo-audio` (+ `react-native-audio-api` for drag-coupled rustle/tear), `expo-haptics` (Android: `performAndroidHapticsAsync`) | Ambient audio session (respects the mute switch, doesn't stop Spotify) |
| Backend | **Supabase** (Auth via magic link / Apple, Postgres + RLS, Storage, Realtime, Cron, Edge Functions); Pro plan ($25/mo) because free projects pause | The server enforces delivery time; a letter can't be peeked early |
| Push | `expo-notifications` → Expo Push (APNs/FCM). Laptop: Realtime while the tab is open, plus an optional email "mail's here" | |
| Distribution | EAS Build → TestFlight internal (needs the Apple Developer Program, $99/yr; add her to App Store Connect) or an Android APK; web on Vercel | |

**Runner-up:** a pure web PWA (Next.js + R3F + GSAP, which is free since 2025). It's simpler for the laptop, but has weaker phone haptics and push.

## 2. Realism techniques
- **Paper:** layered shader:
  1. albedo (your own scan or ambientCG CC0 textures)
  2. seeded fibre/mottle noise (parameters ported from `@paper-design/shaders` PaperTexture)
  3. ink, multiply-blended
  4. crease lighting at 1/3 and 2/3 that never fully disappears
  5. matte paper vs. glossier ink, with a highlight that follows device tilt (`expo-sensors`)

  Bake the letter once at seal time (`makeImageSnapshot` at a fixed 2048 px). The baked image is the canonical copy.
- **Paper types:**
  - **MVP:** Russian school-notebook grid (5 mm grey-blue grid, red margin) and cotton writing paper.
  - **Later:** kraft, laid, airmail onionskin ("PAR AVION / АВИА"). Never pure white or pure black.
- **Fonts (Cyrillic + French, SIL OFL):**
  - Primary: **Bad Script** and **Marck Script** (native Russian cursive).
  - Also: Caveat, Neucha, Shantell Sans, Playpen Sans.
  - Avoid: Homemade Apple, Reenie Beanie, La Belle Aurore (Latin only).
  - Test pangrams: «Съешь же ещё этих мягких французских булок» and «Voix ambiguë d'un cœur qui au zéphyr préfère les jattes de kiwis».
- **Anti-"font look":** per-word jitter seeded with `mulberry32(letter.seed)` (shaped per word, so contextual alternates survive):
  - baseline drift
  - ±1° rotation
  - ink-load opacity 0.82–1
  - re-dip darkening every 40–80 characters
  - margin wobble
  - feathering/bleed shader

  Ink colours: blue-black `#1f2b4d`, iron-gall, violet.
- **Hand-drawn:** signature + P.S. + doodles in the MVP (full-page handwriting in v1). Ink is glossy while wet and dries to matte in about 2 s, and the strokes replay on opening.
- **Imperfection:**
  - the fold is 1–3 mm off-third and slightly skewed
  - the unfolded sheet doesn't lie flat (crease lift casts a shadow)
  - the letter sits crooked in the envelope
  - the envelope bulges with the sheet count
- **Envelope / seal / stamp:**
  - Envelope: Skia paths; the flap swaps z-order when it passes 90°.
  - Wax seal: hold to pour, the stamp drops with a thud and a heavy haptic, monogram from an initials heightmap, seeded so each seal is unique, cracks on opening.
  - Stamps: Recraft SVG art with procedural perforations.
  - Postmark: procedural, with the **real city and date**, ±8° rotation, partial ink strike.
- **Lighting:** soft contact shadows, ambient occlusion in the creases, paper thickness at the edges, one global light for the desk.

## 3. Animation choreography
Every ceremony is a pure worklet `(t: 0..1) => state`. Gesture-driven:
- Fold: drag the panels.
- Insert: drag + page curl (shader from Expo's Callie app).
- Flap: tap.
- Seal: hold.
- Postbox: flick.
- Opening: drag along the flap to tear or slit.
- Unfold: drag the panels.

Rules:
- The first opening takes 5–8 s; **re-reading skips** the ceremony.
- Reduce Motion replaces the sequences with crossfades.
- Sound cues fire at progress thresholds; the rustle's gain follows drag velocity.
- Haptics: selection tick on each crease, a light tick every ~24 px of tear, heavy on wax and stamp, success on the postbox drop.
- **Fallback** if Skia's 2.5D fold looks fake: render just the fold moment with expo-gl + R3F using a GLSL bend shader.

## 4. Backend and delivery (sender chooses)
```
profiles(id, couple_id, display_name, pet_name, city, lat, lon, tz, locale)
devices(user_id, expo_push_token, platform)
letters(id, couple_id, sender_id, recipient_id, tier, posted_at, collect_at, deliver_at,
        pushed_at, envelope jsonb /*paper, ink, stamp, seal{colour,initials,seed}, postmark{city,date}*/,
        seed, render_v)
letter_contents(letter_id, body jsonb, page_image_path)   -- RLS: sender, or recipient when deliver_at <= now()
letter_receipts(letter_id, opened_at)                      -- recipient-only unless read receipts opted in
attachments(letter_id, storage_path, kind)                 -- Storage gated through a signed-URL RPC that checks deliver_at
```
- The couple is seeded with SQL (no pairing UI).
- Status is **derived** from timestamps in a view; the cron only dispatches push (idempotent via `pushed_at`).
- Writes go only through the `post_letter` / `retrieve_letter` RPCs. The server computes `deliver_at`; clients can't set it.
- **Tiers (MVP):**
  - **Express:** next post round after +2 h.
  - **Standard:** next-day round; distance-aware, 12–72 h.
  - **On a date:** the sender picks the day.

  Arrivals snap to post rounds at 10:00 / 16:00 in the recipient's timezone (computed in Postgres with IANA zones).
- **v1 tiers:** "Open when…" stack, 1-year capsule, slow boat.
- Grace window: the sender can retrieve a letter for about 1 h.
- Never lose or randomly delay a letter, and always show an honest arrival estimate.
- When a letter is due:
  1. A Supabase Cron job runs every minute and finds it.
  2. A Database Webhook calls an Edge Function, which sends the Expo push ("Mail's here: the flag is up").
  3. Realtime raises the mailbox flag.
- Encrypted local draft autosave + offline posting queue.
- **E2E encryption:** not in the MVP (risk of permanently losing letters with a forgotten passphrase). Keep a `schema_v` column so it can be added later with libsodium.

## 5. Roadmap
- **Week 1 spikes:**
  - TextInput-over-Skia typing in RU/FR
  - Skia tri-fold vs. R3F fold
  - per-word jitter with Bad Script
  - push on both real phones + the laptop web build
- **MVP (~4 weeks):**
  - magic-link login
  - writing desk: 2 papers, 3 inks, 2 fonts
  - drawn signature / P.S. / doodles
  - the full sealing ceremony
  - the three delivery tiers
  - in-transit sealed envelope with arrival estimate
  - mailbox flag, push and Realtime
  - gesture-driven opening with skip-on-reread
  - procedural postmark
  - shoebox archive
  - sound + haptics
  - RU/FR UI (i18n)
- **v1:**
  - full-page handwriting with replay
  - "Open when…" letters, capsules, anniversaries
  - more papers and envelope liners
  - stamp album with city unlocks
  - photo, washi-tape and pressed-flower enclosures
  - reply on the back
  - PDF export
  - continuous haptics (Core Haptics module)
  - home-screen mailbox widget + Live Activity "arrives tomorrow at 10:00" (`expo-widgets`)
  - custom notification sound (mail-slot clack)
- **Delight:**
  - paper aging in the archive
  - desk light that follows the time of day
  - letters crossed in the mail
  - voice-note cassette
  - photo-to-stamp
  - real print-and-mail

## 6. AI design tooling / Claude Code skills
**Install** (project-level):
```bash
claude plugin install expo@claude-plugins-official        # official expo/skills: expo-animation, expo-router, eas-*, expo-upgrade
/plugin install frontend-design@claude-plugins-official   # design-direction discipline before coding
/plugin marketplace add anthropics/skills                  # skill-creator, algorithmic-art, canvas-design, webapp-testing
npx skills add supabase/agent-skills                      # RLS/security guidance
npx skills add https://github.com/MiniMax-AI/skills --skill shader-dev   # GLSL know-how → port to SkSL
```
**MCPs already in this session:**
- **Context7:** current Expo, Skia and Reanimated docs.
- **Supabase:** migrations, RLS, cron.
- **Vercel:** web deploy.
- **Figma:** stationery design and `weave_run_model` image generation for textures and stamps.
- **Splice:** SFX.
- **Mobbin:** UI references.
- **Three.js viewer:** quick fold-shader previews.
- **Playwright** (pre-installed): screenshots of the web build.

**Custom skills to write** in `.claude/skills/`:
1. `paper-realism`: tokens (warm white, ink colours), grain at 4–8% multiply, the single light direction, the RU/FR font allowlist, imperfection rules, banned/approved examples.
2. `letter-choreography`: the `(t)=>state` worklet pattern, easings (falls use ease-in, settling uses a damped spring), SFX and haptic cue points, the Reduce Motion fallback, skip-on-reread.
3. `postal-rules`: the `deliver_at` algorithm, RLS invariants, "never lose a letter", push copy.

**Asset generation:**
- Textures: Imagen / GPT-Image / FLUX via Figma `weave_run_model`, then made seamless with offset + inpaint.
- Stamps: Recraft SVG.
- Best results come from **your own scans** of real stationery and **your own foley recorded in one evening**: paper, envelope, wax, pen, mailbox, 3–5 takes each.
- Extra SFX: ElevenLabs SFX, Freesound CC0, Splice.
- Licensing is relaxed for a private two-person app.

## 7. Execution steps (after approval)
1. Scaffold on branch `ccr-5cdc9a81-00a6wl`: `npx create-expo-app@latest` (SDK 58, TS, Router).
2. Add with `npx expo install`: skia, reanimated, gesture-handler, haptics, audio, sensors, notifications, `@supabase/supabase-js`, `perfect-freehand`. Add the fonts under `assets/fonts`.
3. Add `CLAUDE.md` (project conventions) + the 3 custom skills + `docs/plan.md` (this plan + research).
4. Supabase migration: tables, RLS, the `post_letter` RPC with the delivery algorithm, the cron job + push Edge Function (via the Supabase MCP, once you pick or create a project).
5. Week-1 spikes as isolated screens under `app/(lab)/`: `typing.tsx`, `fold.tsx`, `jitter.tsx`.
6. Commit + push to `origin ccr-5cdc9a81-00a6wl`.

## 8. Verification
- `npx tsc --noEmit`, `npx expo lint`.
- `npx expo export -p web` + a Playwright script that screenshots each lab screen at t = 0/.5/1 with fixed seeds. Review the images for realism against the `paper-realism` rubric.
- SQL tests for `deliver_at`: tiers, post-round snapping, DST, RLS (the recipient can't read content before `deliver_at`).
- Manual: an Expo Go / dev build on both phones; post an Express letter → push arrives → opening ceremony → re-read skips the ceremony.

## 9. Key risks
| Risk | Mitigation |
|---|---|
| Typing over the canvas feels wrong | Week-1 spike |
| 2.5D fold looks fake | R3F fallback for the fold only |
| Ceremony gets tedious | Skip on re-read, gesture speed controls pacing |
| Re-render drift across versions | `render_v` + the baked page image is canonical |
| Push lost | Retry on push receipts + Realtime |
| TestFlight builds expire every 90 days | Monthly EAS build + EAS Update in between |
| Skia web bundle (~3 MB CanvasKit) | Load lazily on the laptop |
