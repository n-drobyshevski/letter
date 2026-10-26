> Research snapshot from 2026-10-26 (multi-agent web research). Where it differs from [`docs/plan.md`](../plan.md), the plan wins — notably, the app is an Expo **universal** app so the laptop runs the web build.

# Letter Simulator: Build Plan (synthesis of the 5 research reports, as of 2026-10-26)

## 0. Contradictions between the reports, and how I resolved them

| # | Conflict | Decision |
|---|---|---|
| 1 | **Stack** recommends Expo/React Native. **Paper** and **animation** assume a web stack (three.js/R3F, GSAP, Motion 14, Capacitor). | **Go native-first with Expo.** On iOS Safari there is no Vibration API, and the `<input switch>` haptics hack is reportedly broken in iOS 26.5 ([tester](https://rapidtoolset.com/en/tool/ios-haptics-tester)). Web push also only works for Home-Screen installs, and some subscriptions get lost ([magicbell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)). Haptics and the "mail's here" push are core to the ritual, so web is out. Every web-only technique (MeshPhysicalMaterial, GSAP timelines, SVG filters) is converted to its Skia/Reanimated equivalent below. |
| 2 | Version numbers disagree: Skia 2.6.2 vs 2.14.0, Reanimated 4.6.0 vs 4.7.1. | Install with **`npx expo install`**, which picks the versions compatible with SDK 58. The newest npm release can be ahead of what the SDK supports. |
| 3 | Skia draws in 2D, but the animation report's tri-fold is a 3D vertex shader. | A tri-fold is three **rigid panels on hinges**. Draw them as Skia groups with a `Matrix4` perspective plus `rotateX`. Fake the curved crease with a lighting gradient in the shader. **Week-1 spike:** if it doesn't look convincing, render the fold moment alone with `expo-gl` and `@react-three/fiber/native`, reusing the GLSL `bend()` function from the animation report. |
| 4 | The stack report's single-table RLS (`deliver_at <= now()`) hides the *whole* letter. The product report needs the recipient to see the sealed envelope while it is in transit. | **Split the table.** `letters` holds metadata the recipient can always see. `letter_contents` holds the ciphertext and is RLS-gated on `deliver_at`. |
| 5 | When to add end-to-end encryption: stack says from day one, product says v2. | **In the MVP.** It's only two people, and adding it later means migrating every stored letter. The real cost is the passphrase-backup screen. |
| 6 | The paper report draws text one grapheme at a time with `fillText` to keep Caveat's contextual alternates. But shaping each grapheme on its own **drops** `calt` anyway. | Shape **one word at a time** (Skia Paragraph runs HarfBuzz, so `calt` survives inside the word). Jitter each word (rotation, drift, opacity), and add only a baseline wobble inside the word. |
| 7 | GSAP as the master choreographer; Rapier for the mailbox drop. | On native, use **one Reanimated `progress` SharedValue per ceremony**. A gesture writes to it directly; on release it finishes with `withSpring({velocity})` or `withDecay`. Rapier is replaced by a hand-written drag/lift integration inside `useFrameCallback`. |
| 8 | Playwright visual QA assumes the DOM. | Run Playwright against the **Expo web export** (Skia on CanvasKit) to screenshot fixed points in each timeline. Use **Maestro** (my addition) for flows on a real device. |

## 1. Recommended tech stack

| Layer | Choice | Why | Runner-up |
|---|---|---|---|
| App | **Expo SDK 58** (RN 0.88, New Architecture only, [changelog](https://expo.dev/changelog/sdk-58)), Expo Router, TypeScript | Push, haptics and 120 Hz work on the UI thread; OTA updates via EAS Update | PWA + Capacitor + R3F 9.8 |
| Rendering | **@shopify/react-native-skia 2.x**: SkSL `RuntimeEffect`, `FractalNoise`, `Picture`, `makeImageSnapshot`. Stay on Ganesh; Graphite is experimental ([Shopify](https://shopify.engineering/webgpu-skia-web-graphics)) | Paper, ink, wax and page-curl shaders driven by SharedValues with no React re-renders | expo-gl + R3F native (fold moment only) |
| Motion | **Reanimated 4.x** + `react-native-worklets` | Animation runs on the UI thread; timelines can be written as worklets | Rive RN runtime for 2D charm pieces |
| Gestures | **Gesture Handler 3** hooks (`usePanGesture`), with SharedValues in the config ([upgrade guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/)) | Tear, slit, unfold and stroke capture | none |
| Ink strokes | **perfect-freehand 1.2.3**, with RNGH `stylusData` pressure (my addition; verify) | Vector strokes that can be replayed | Calligraphr custom font |
| Audio | **react-native-audio-api** (Software Mansion's Web Audio API for RN; my addition, verify the version) for gesture-coupled sound; `expo-audio` for one-shots | The animation report's Web Audio design (granular tear, rustle that follows drag velocity) ports across directly | expo-audio only |
| Haptics | **expo-haptics** | The full Taptic set | Custom Core Haptics (AHAP) module |
| Tilt light | `expo-sensors` DeviceMotion | Ink glints when the phone tilts | Light fixed in place |
| Backend | **Supabase** (Postgres + RLS, Auth with Apple/magic link, Storage, Realtime, Edge Functions, Cron). **Pro, $25/mo** | RLS enforces delivery time on the server ([cron](https://supabase.com/docs/guides/functions/schedule-functions)) | **Convex** `scheduler.runAt` ([docs](https://docs.convex.dev/scheduling)) |
| Push | Expo Push via `expo-notifications` ([docs](https://docs.expo.dev/push-notifications/sending-notifications)) | One call covers APNs and FCM v1 | Direct APNs |
| E2E | **react-native-libsodium 1.7** + `expo-secure-store` ([repo](https://github.com/getify/react-native-libsodium)) | Cheap for two people | Trust the server |
| Distribution | EAS Build/Submit → TestFlight internal testing ($99/yr Apple Developer Program; builds expire after 90 days) ([pricing](https://expo.dev/pricing.md)) | No review needed for internal testers | Ad-hoc install by device UDID |
| Export | Skia snapshot → `expo-print` PDF | Letters outlive the app | none |

## 2. Realism techniques

**Paper.** Every letter is a stack of layers baked into images, following the paper report's architecture and ported to SkSL:
1. Albedo: an own scan or ambientCG CC0 `Paper001`–`006`, or `Cardboard` for kraft.
2. Procedural fibre and mottling seeded per letter. Port `@paper-design/shaders-react` PaperTexture ([docs](https://shaders.paper.design/paper-texture)) to SkSL. That library is pre-1.0 and web-only, so treat it as the parameter reference: `fiber`, `folds`, `wrinkles`, `drops`, `seed`.
3. Ink layer, multiply-blended.
4. A normal-ish shading term: grain plus creases at y = 1/3 and 2/3, using the paper report's GLSL snippet. `uCreaseStrength` animates from 1 to about 0.35 and never reaches 0.
5. A roughness proxy: paper is matte (~0.9), ink is glossier (~0.55). Use it to drive a specular highlight from the DeviceMotion tilt, clamped to ±25° and low-pass filtered.

Bake the letter once at seal time (`makeImageSnapshot`) and cache it.

Paper types: lined; **Russian school grid paper (5 mm, pale blue, with a margin)**; kraft; parchment; laid (fine laid lines with ±2% brightness modulation); airmail onionskin, which shows the back side's ink mirrored at 8–12%. Never use pure white or pure black. Aging (yellowing, coffee ring) grows with `ageDays`, and is optional.

**Typed handwriting (Cyrillic).** Use only fonts that include Cyrillic:
- **Caveat** (variable, 3 contextual alternates per glyph), **Bad Script**, **Great Vibes**
- Also: Marck Script, Neucha, Pangolin, Comforter, Playpen Sans, Shantell Sans (BNCE/INFM axes)
- **Not:** Homemade Apple, Reenie Beanie, La Belle Aurore, Nothing You Could Do (all Latin-only)

Test every font with «Съешь же ещё этих мягких французских булок, да выпей чаю».

Jitter is seeded with `mulberry32(letter.seed)`, so both phones render the letter identically. Apply it per word (see 0.6): baseline drift, ±1° rotation, ink-load opacity 0.82–1, a re-dip darkening every 40–80 characters, and ±3 px margin wobble. Ink colours: blue-black `#1f2b4d`, iron-gall (browns with age), violet. Add feathering with a small noise-displacement plus blur pass in SkSL; it is stronger on kraft and parchment.

**Real handwriting.** Use perfect-freehand with `simulatePressure:false` when there is stylus pressure. For a broad nib, pass `max(.18, |sin(dir−0.70)|) × pressure` as the pressure value. Fresh ink starts glossy and dark and dries to matte over about 2 s, and overlapping strokes multiply-blend. Store strokes as `[x, y, p, t]` vectors so the writing can be replayed on opening. ML handwriting synthesis for Cyrillic is still research-grade ([arXiv 2605.27487](https://arxiv.org/pdf/2605.27487)), so skip it.

**Envelope.** Front, back, flap and liner are Skia paths. When the flap's rotateX crosses 90°, swap its z-order. The gum strip goes from wet to dry with a roughness lerp. Addressing is in the sender's font: pet name plus city, with the return address on the flap.

**Wax seal.**
1. Hold to pour: a noise-displaced blob spreads while the finger is down.
2. Release: the stamp descends; on impact, a 2 px shake, a thud and a Heavy haptic.
3. The monogram comes from a heightmap of the initials drawn with Canvas, which the shader turns into a normal map. Add a clearcoat-like highlight (~0.35 roughness).
4. The noise is seeded per letter, so every seal is unique.
5. Breaking the seal gives a crack, a few crumbs and a haptic. Don't overdo particles ([Greenvelope](https://card.greenvelope.com/resources/animated-envelope-invitations)).

**Stamps and postmark.**
- Stamps: Recraft V4 SVG art with procedural perforations.
- Postmark: a circular date stamp drawn per letter with the **real sender city and local date**, plus wavy cancellation lines. Rotate ±8°, multiply by an ink-coverage noise mask, and allow partial strikes.
- Extras (polaroid, washi tape, pressed flower, lipstick kiss) are alpha PNGs, multiply-blended and masked by the paper grain.

## 3. Animation architecture, sound and haptics

Every ceremony is a pure worklet `(t: 0..1) => state` driven by one SharedValue. Gestures write `t`; on release it settles with a velocity-aware spring.

| Moment | Technique | How it's driven |
|---|---|---|
| Tri-fold / unfold | Skia Matrix4 panels; crease light uniform; residual 3–6° crease memory; overshoot (bounce ~0.15) | Unfold: drag each panel edge. Fold: drag. |
| Insert / slide out | Translate plus SkSL page curl (`u_originPos`/`u_currPos`, from Expo's Callie app, [blog](https://expo.dev/blog/making-ai-feel-human-in-a-mobile-app-with-expo-reanimated-and-skia)) | Drag |
| Flap close / gum | Spring rotateX with the z-swap at 90° | Tap |
| Wax seal | Shader blob plus stamp drop | Hold (hold time sets depth) |
| Stamp / postmark | Squash plus scale pulse | Tap |
| Postbox drop | Hand-written drag/lift flutter in `useFrameCallback` | Flick |
| Tear / slit | Simplex-noise tear line, alpha mask with a fibrous edge | Drag along the flap |
| Mailbox flag, transit badge | Skia (Rive optional; it uses Data Binding, Events are deprecated) | State |

- Opening the letter is **gesture-driven** and takes 5–8 s the first time. **Re-reading skips straight to the unfolded letter**, because Paperless Post cut its 9-second animation after complaints ([InVision](https://invisionapp.com/inside-design/paperless-post)).
- Honour Reduce Motion (`AccessibilityInfo` / Reanimated `useReducedMotion`) by replacing sequences with crossfades.
- Skip Theatre.js (stale, AGPL), Lottie and GSAP on native.

**Sound.**
- One-shot clips fire from progress thresholds.
- The paper-rustle loop's gain and playback rate follow drag velocity.
- The tear sound is granular-scrubbed by tear progress.
- Pen scratch follows stroke speed.
- Each sound has 3–5 variants chosen at random.
- Use the playback audio session so sound still plays when the ringer switch is on silent.

**Haptics (expo-haptics).**
- `selectionAsync` on each fold crease.
- Light impact every ~24 px of tear.
- Heavy impact on the stamp and the wax press.
- `notificationAsync(Success)` on the postbox drop.
- A Core Haptics (AHAP) seal crack belongs in the delight tier.

## 4. Backend and delivery mechanics

```sql
profiles(id→auth.users, couple_id, display_name, pet_name, city, city_lat, city_lon, tz, public_key, key_backup_enc)
devices(id, user_id, expo_push_token, platform)
letters(id, couple_id, sender_id, recipient_id,
  status enum('draft','posted','in_transit','delivered','opened'),
  tier enum('standard','express','slow','capsule','open_when'),
  posted_at, collect_at, deliver_at, delivered_at, opened_at, open_when_label,
  envelope jsonb,   -- paper/env colour, stamp_id, seal{colour,initials,seed}, postmark{city,date}
  seed int)
letter_contents(letter_id pk, ciphertext, nonce, key_for_recipient, key_for_sender, schema_v)
attachments(id, letter_id, storage_path, kind, nonce)   -- encrypted blobs in Storage
tracking_events(letter_id, at, label)                   -- pre-generated hub postmarks; RLS: at <= now()
stamps / user_stamps
```

**Access rules.**
- `letters` is readable by both members of the couple.
- `letter_contents` is readable when `auth.uid() = sender_id`, or when the user is the recipient and the parent letter has `deliver_at <= now()`.
- All writes go through `security definer` RPCs (`post_letter`, `retrieve_letter`). Clients cannot set `deliver_at`.

**Computing `deliver_at` on the server** (`post_letter`):
1. `hours = clamp(haversine_km / ~40, 12, 72) × (1 ± 0.15 random)`.
2. **Round up to the next post round** in the recipient's timezone: 10:00 or 16:00, with optional no-Sunday delivery. Do the arithmetic with `at time zone` so daylight-saving changes are handled.
3. Tiers:
   - Express: next round after +2 h.
   - Slow boat: about 7 days.
   - Capsule: a chosen date, or +1 year.
   - Open-when: delivered to a separate sealed stack.
4. Grace window: the letter stays `posted` until `collect_at` (about 1–2 h), during which the sender can retrieve it.

**Never lose or randomly delay a letter.** The arrival estimate shown must be honest (Carrier Pidge's 0.2% loss is a lesson in what not to do, [TechSpot](https://techspot.com/news/113501-carrier-pidge-app-delivers-texts-110-mph-unless.html)).

**Delivery job and push.**
- Supabase Cron runs `deliver_due()` every minute; 30 s is possible ([pg_cron](https://supabase.com/docs/guides/database/extensions/pgcron)). It moves `posted→in_transit` and `in_transit→delivered`.
- The status change fires Realtime (the mailbox flag goes up) and calls the `push` Edge Function through `pg_net`. That function calls Expo Push, checks receipts and retries.
- Notification copy stays vague ("Mail's here. The flag is up."), which also suits E2E. Group with `threadIdentifier`.
- SDK 58 shows notifications while the app is open by default, so set the notification handler explicitly.
- Free Supabase projects pause after about 7 idle days; use Pro.

**E2E encryption.**
- One `crypto_secretbox` key per letter.
- That key is wrapped with `crypto_box_easy` for both partners. Don't use a sealed box, because it can't prove who sent the letter.
- Private keys live in the Keychain via SecureStore.
- An Argon2id (`crypto_pwhash`) passphrase backup is stored on the server.

## 5. Feature roadmap

**Week-1 spikes:**
- The Skia tri-fold vs. the R3F fold.
- Per-word jitter with Caveat in Cyrillic.
- An end-to-end push test on the girlfriend's real phone.

**MVP (about 4 weeks):**
- Invite-code pairing and city selection.
- A writing desk with one great paper (grid or cotton), 2–3 ink colours and Caveat or Bad Script.
- E2E encryption.
- Seal ceremony: fold, envelope, one stamp, wax seal, postbox drop.
- Server-side `deliver_at` (Standard and Express tiers, post rounds).
- The sealed in-transit envelope with its arrival estimate.
- Mailbox flag, push notification, Realtime updates.
- Gesture-driven opening with skip-on-reread and a Reduce Motion fallback.
- Procedural postmark.
- A chronological shoebox archive.
- Sound and haptics.

**v1:**
- Finger or stylus handwriting with replay.
- "Open when…" stack, scheduled and anniversary letters, the +1-year capsule.
- Tracking timeline with hub postmarks.
- More paper types, envelope liners, a stamp album with city and seasonal unlocks.
- Photo, tape and flower enclosures.
- Reply on the back of the letter, and a P.S. strip.
- Grace-window retrieve.
- Ribbon-tied monthly bundles.
- PDF export.

**Delight:**
- Photo-to-stamp maker.
- "Letters crossed in the mail".
- Voice-note cassette.
- Paper wear and aging.
- Route map.
- Desk lighting that follows the time of day.
- "On this day".
- AHAP haptics.
- Real print-and-mail (Lob).

**Deliberately excluded:** typing indicators, streaks, sticker clutter, lost mail. Read receipts are off unless you both opt in.

## 6. AI design tooling and Claude Code skills

```bash
/plugin install frontend-design@claude-plugins-official          # pick a design direction before coding
/plugin marketplace add anthropics/skills
/plugin install example-skills@anthropic-agent-skills            # skill-creator, algorithmic-art, canvas-design, webapp-testing
npx skills add supabase/agent-skills                             # RLS/security
npx skills add https://github.com/MiniMax-AI/skills --skill shader-dev   # GLSL, then port to SkSL
claude mcp add context7 -- npx -y @upstash/context7-mcp          # current Expo/Skia/Reanimated docs (already attached in this session)
claude mcp add --transport http figma https://mcp.figma.com/mcp  # stationery system, create_shader, weave_run_model
claude mcp add blender uvx blender-mcp                           # optional: bake wax/envelope normal maps
```

- Software Mansion's [gesture-handler-3-migration](https://smithery.ai/skills/software-mansion/gesture-handler-3-migration) skill.
- The Splice MCP for SFX, which is already in this session.
- Skip GSAP skills, Motion AI Kit and the R3F skill pack unless you build a web companion.
- An official Expo skills package was not confirmed by the research.

**Custom project skills** (scaffold with `/skill-creator` into `.claude/skills/<name>/SKILL.md`):
1. **`paper-realism`.** Warm-white tokens; grain multiplied at 4–8%; one light direction for the whole app; ink multiplied with bleed and pressure; crease memory; Cyrillic-only font list; banned and approved examples. Trigger: "any component rendering paper, envelope, ink, stamp, seal".
2. **`letter-choreography`.** Each ceremony as a `(t)=>state` worklet, with durations, easings (falls use ease-in, settling uses a damped spring), SFX and haptic cue points, the z-swap at 90°, the "never constant velocity" rule, and the Reduce Motion fallback.
3. **`postal-rules`.** The `deliver_at` algorithm, the RLS invariants, "never lose a letter", and the push copy.
4. **`visual-qa`** (`allowed-tools: Bash(npx playwright *)`). Run the Expo web export, seek each timeline to 0, .25, .5, .75 and 1, take `toHaveScreenshot` with seeds fixed, build a contact sheet, and critique it against the paper-realism rubric. A Playwright test script costs about 4× fewer tokens than the MCP ([morphllm](https://www.morphllm.com/playwright-mcp)).

## 7. Asset pipeline

- **Textures.**
  - Best: your own 1200 dpi scans of your stationery, plus raking-light shots for normal maps.
  - CC0: ambientCG Paper and Cardboard sets, and Poly Haven for the desk and wood ([license](https://polyhaven.com/license)).
  - Textures.com is paid and forbids raw redistribution, so only ship baked composites.
  - AI route: Imagen 4 Ultra, GPT Image 2 or FLUX.2 (via Figma `weave_run_model`) → offset-and-inpaint the seam → check as a 3×3 tile → DeepBump ([GPL-3 tool](https://github.com/HugoTini/DeepBump)) for normal and height maps.
  - Ship 2048 px WebP.
- **Stamps and seals.** Recraft V4 SVG. Perforations and halftone added procedurally.
- **Fonts.** Google Fonts under SIL OFL (embedding allowed): Caveat, Bad Script, Great Vibes, Marck Script, Shantell Sans. Bundle the TTFs with `expo-font` and load them with Skia `useFonts`. Calligraphr can make fonts from your own handwriting, but its Cyrillic template support is unverified.
- **SFX.**
  - Best: record your own foley (paper, envelope, wax, pen).
  - Freesound **CC0 only**: avoid NC and Sampling+ clips; CC-BY needs credit.
  - Splice: royalty-free, and you keep downloads ([FAQ](https://intercom.help/splice-b7a2d5b83f2e/en/articles/8652642)); downloads need Sounds+.
  - ElevenLabs SFX: 0.1–30 s clips, about 40 credits/s ([docs](https://elevenlabs.io/docs/product/sound-effects/overview)); check the plan's commercial terms.
  - Encode as AAC `.m4a`, 3–5 variants per sound.

## 8. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Skia 2.5D folds look fake | Week-1 spike; fall back to expo-gl/R3F for the fold only |
| The ceremony gets tedious | Gesture-driven, skippable on re-read, Reduce Motion fallback |
| Jitter breaks `calt` alternates | Shape per word (0.6) |
| Losing the encryption key loses the letters | Mandatory passphrase backup at onboarding; test restore |
| Supabase pause, push lost | Pro plan; check push receipts and retry; Realtime fallback while the app is open |
| TestFlight builds expire after 90 days | Monthly EAS build; EAS Update in between |
| Version churn on pre-1.0 libraries | `npx expo install`, lockfile, pinned exact versions |
| Mid-range Android performance | Cache the baked letter image; animate only uniforms; limit shader cost; test on her actual phone |
| App dies, letters vanish (Letterbird) | PDF/image export from v1 |
| Timezone and DST bugs in post rounds | Do all the date arithmetic in Postgres with IANA zone names; unit-test it |

## 9. Questions to ask before building

1. Which phones do you each use (iPhone or Android, model)? Is the $99/yr Apple Developer Program fee acceptable?
2. Typed in a handwriting font, finger or stylus handwriting, or both? Does either of you have an Apple Pencil?
3. How far apart are you? Should delivery time be distance-based, a fixed overnight delay, or chosen by the sender? What is the longest wait you'd enjoy?
4. Do you want true E2E encryption, which means no server-side search or AI over letters and a passphrase you must keep?
5. Read receipts as a broken-seal icon, or none at all, like real mail?
6. Are you willing to scan your own stationery and record foley? Is there a budget for paid tools (Splice Sounds+, ElevenLabs, Recraft)?
7. What language for the UI: Russian, English, or both? Is a web or desktop version ever needed?
8. Should letters age visibly in the archive? Limit to one letter in the post at a time?
