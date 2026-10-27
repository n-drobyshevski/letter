# Letter: письма для двоих

Private Expo app for two people: write a letter on realistic paper, fold, seal, post it, wait,
receive, slit and unfold it. Realism of paper and motion is the product. Plan: `docs/plan.md`.

@AGENTS.md

## Stack
Expo SDK 58 universal app (iOS, Android, web for the laptop) · Expo Router (`src/app`) ·
@shopify/react-native-skia (paper/ink shaders, baked pictures; CanvasKit on web) ·
Reanimated 4 + Gesture Handler 3 hooks · perfect-freehand · Supabase (RLS, cron, Edge Functions).

## Layout
- `src/letter/`: rendering + choreography (`shaders.ts`, `handwriting.ts`, `renderLetter.ts`, `FoldableLetter.tsx`, `strokes.ts`, `WritingDesk.tsx`: the sheet you write on); `src/components/MailboxView.tsx`: the mailbox scene (shared by `/lab/mailbox` and the journey)
- The wax seal: `seal.ts` (pure: `SealPlacement` stored as `letters.envelope.seal`, `defaultSeal` for old letters, `parseSeal`, px conversion, the JS twin of `WAX_SKSL` v2: `coverSD`, `sealBounds`, `sealHold`), `sealDies.ts` (the 8 dies as SVG paths, ru/fr names), `dieImage.ts` (die textures, cached), `WaxSeal.tsx` (the shader; `placement` plain or shared), `EnvelopeCeremony.tsx` (pour anywhere, die tray `DieTray.tsx`, place/turn the die; `command` buttons), `sealCopy.ts` + `SealButtons.tsx` (hints and buttons, ru/fr)
- Several sheets, both sides: `stack.ts` (faces, seeds, limits; pure), `paperLayout.ts` (writing area, paper uniforms; pure), `showThrough.ts` (the other side's ghost), `DeskStack.tsx` (desk: turn over by the edges or buttons, more sheets; `grip.ts`: how the hand shapes the turn; on the laptop the sheets lie loose on the desk: Shift + drag moves one, a click brings it to the top, Ctrl/⌘ + drag turns it, `deskMove.ts`, `useDeskKeys`), `ReadingStack.tsx` (reader); `useSheetFaces`/`useStackPictures` in `LetterSheet.tsx`; `?sheets=&face=&turn=` in the labs
- `src/theme/stationery.ts`: papers, inks, fonts, the desk light
- `src/app/index.tsx`: home (mailbox, desk, letters on their way); `/write`, `/seal`, `/post`, `/mailbox` re-export their lab screens, which also run offline; `/fold` folds the draft (`src/letter/fold.ts`: tri/half/quarter, stored as `body.fold`); `/seal` seals it (`draft.envelope`: look, die, seed and placement, sent as-is by `/post`)
- `src/app/lab/*`: isolated spikes (jitter, typing, fold, envelope, post, mailbox) and `journey` (all of them chained offline, write → mailbox; `?step=`), index at `/lab`; `?seed=&t=&paper=` params make frames reproducible
- `src/letter/tracking/`: itinerary generator (self-contained, copied to `supabase/functions/_shared`), copy, projection, server rows → itinerary; `TrackingMap.tsx`, `TrackingTimeline.tsx`, `TrackingView.tsx`
- `src/lib/`: `supabase.ts` (null without `.env.local`: labs run offline), `mail.ts` (session, couple, post/retrieve, tracking, mailbox, open_letter), `draft.ts` (desk → postbox); `src/letter/mailboxFromServer.ts`: RLS rows → mailbox letters (pure, tested); `src/app/track/[id].tsx`: a real letter's journey
- `supabase/migrations`: schema, delivery algorithm, RLS, dispatch, tracking, letter body check (v1/v2), envelope seal checks; `supabase/functions/deliver`: Expo push; `post-letter`: posting + itinerary
- `tests/`: node:test via tsx (layout, shader compile, font coverage, SQL in PGlite, the wax shader against its JS twin)

## Skills to load
- Drawing paper/ink/envelopes/stamps, or reviewing screenshots → `paper-realism`
- Any animated moment → `letter-choreography`
- Anything in `supabase/` or delivery/notifications → `postal-rules`

## Commands
```bash
npm test               # layout, shaders (CanvasKit), fonts, SQL + RLS (PGlite)
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
npm run export:web && npm run qa:visual   # screenshots → qa-screens/ (phone + laptop)
```
Before calling UI work done, run the visual QA and look at the screenshots.

## Gotchas
- Skia web: entry is `index.web.tsx` (`LoadSkiaWeb`); `public/canvaskit.wasm` is copied on postinstall.
- `<Picture>` ignores group opacity; use clips or `layer={<Paint opacity/>}`. Canvas `style` must be flat on web.
- SkPath is immutable: build with `Skia.PathBuilder.Make()` … `.detach()`.
- React Compiler is on: use `.get()/.set()` for shared values outside worklet reads.
- Typefaces for `Skia.Font(...)`: load with `useTypeface` (see `useTypefaces`). `font.getTypeface()` is a borrowed pointer on web and `Skia.Font` throws on it.
- `perspective` only works in the same `transform` list as the rotation (each Group flattens to 2D).
- A Reanimated derived value or animated reaction only subscribes to shared values read directly in its own closure, not inside helper worklets it calls: read them inline.
- Reanimated animations jump to their end under Reduce Motion (`ReduceMotion.System` is the default): pass `reduceMotion: ReduceMotion.Never` to animations used as clocks (hold timers, the wax pour).
- `WaxSeal` with a shared `placement`: pass `dieR`, or the die texture is sized for a 20 pt die.
- On web, React Native Web's `AccessibilityInfo.isScreenReaderEnabled()` always resolves true; `useMotionPrefs` ignores it there.
- After editing `src/letter/tracking/itinerary.ts`, run `npm run sync:shared` (a test enforces it). Keep that file import-free.
- UI copy is Russian/French; code and comments in English.
