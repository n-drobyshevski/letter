---
name: letter-choreography
description: How to build the letter "ceremonies" (fold, insert, seal, stamp, post, receive, slit, unfold) as gesture-driven Reanimated/Skia animations with sound and haptics. Use when adding or changing any animated moment in the app.
---

# Letter choreography

## Pattern
- One ceremony = one `SharedValue` `t ∈ [0, 1]` plus pure worklet functions `t → state` (angles, offsets, opacities). Reference: `src/letter/FoldableLetter.tsx`.
- The finger writes `t` directly (`usePanGesture` → `t.set(...)`); on release settle with `withSpring(target, { velocity })` so a flick carries through. Never a fixed-duration tween for something the hand started.
- With React Compiler on, use `.get()/.set()` on shared values in JS-thread code and gesture callbacks.
- Sub-phases are ranges of `t` with an ease (`t/0.5`, `(t-0.5)/0.5`), so scrubbing backwards always works.
- Expose a `fixedT` prop (and `?t=` lab param) so `npm run qa:visual` can freeze any frame.

- Multi-stage ceremonies (`EnvelopeCeremony`): one progress value per stage plus a `stage` shared value. **Lock each gesture to the stage it began in** (`gestureStage`); otherwise a drag that completes stage N keeps driving stage N+1.
- On web, a tap without movement never activates a pan: `onActivate`/`onDeactivate` don't fire, only `onBegin`/`onFinalize`. Handle taps in `onFinalize`.
- Hold-to-do (pouring wax): start a `withTiming` in `onBegin`, `cancelAnimation` in `onFinalize`, and keep what was done.

## Physics cues
- Nothing moves at constant velocity. Falls ease in; landings settle with a damped spring (damping ~18–22, stiffness ~140–160).
- Hinged panels: rigid planes, `perspective ~1100`, max angle < 180° (`0.985π`) — paper never lies perfectly flat. Swap front/back face at 90° (clip, not opacity).
- Moving paper casts shadow on what lies beneath; the contact shadow shrinks to what still touches the desk.

## Sound & haptics
- Haptics vocabulary in `src/lib/haptics.ts` (`crease`, `tick`, `press`, `posted`). Fire from `useAnimatedReaction` threshold crossings via `scheduleOnRN`, only on forward crossings.
- Sounds: one-shots at the same thresholds; continuous rustle/tear gain follows gesture velocity. 3–5 variants per sound, picked by seed. Ambient audio session (respect the mute switch, don't stop the user's music); "sound on silent" is a setting.

## Pacing
- First opening of a letter: full gesture-driven ceremony, 5–8 s. **Re-reading skips straight to the unfolded sheet.**
- `useReducedMotion()` → short timing crossfades instead of sequences.
- Keep system chrome out of ceremonies (full-bleed `Desk`, no tab bar).

## Ceremony map (MVP)
| Moment | Gesture | Feedback |
|---|---|---|
| Fold (tri-fold) | drag up | `crease` per panel |
| Insert into envelope | drag down + page curl | rustle |
| Close flap | tap | soft thud |
| Wax seal | hold to pour (puddle size = hold time), release to press | `tick` while pouring, `press` on impact |
| Stamp / postmark | tap | `press` |
| Postbox | flick | `posted` |
| Slit envelope | drag along the flap | `tick` every ~24 px |
| Unfold | drag down | `crease` |
