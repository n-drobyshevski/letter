> Research snapshot from 2026-10-26 (multi-agent web research). Where it differs from [`docs/plan.md`](../plan.md), the plan wins — notably, the app is an Expo **universal** app so the laptop runs the web build.

## Review of the letter-app plan: corrections, gaps, simplifications and realism wins

### Corrections

1. **[CORRECTION] Expo does publish official agent skills.** The plan says this "was not confirmed". It exists at [github.com/expo/skills](https://github.com/expo/skills), marked "Official AI agent skills from the Expo team". It includes `expo-animation`, `expo-native-ui`, `expo-router`, `expo-dev-client`, `eas-update`, `eas-app-stores` and `expo-upgrade`. Install with `claude plugin install expo@claude-plugins-official` or `npx skills@latest add expo/skills --skill '*'`. Make it the first skill in section 6, ahead of `frontend-design`.

2. **[CORRECTION] The libsodium repo link points to the wrong owner.** `react-native-libsodium` is maintained by **serenity-kit**; the plan links `getify/`. Version 1.7.0 needs New Architecture, iOS 15.1+ and Android minSdk 24. `crypto_pwhash` (Argon2id) on **web** only works after `loadSumoVersion()`. That matters because your Playwright/Expo-web QA path will crash at the passphrase screen without it ([socket.dev 1.7.0](https://socket.dev/npm/package/react-native-libsodium/overview/1.7.0)).

3. **[CORRECTION] The SDK 58 notification claim is unverified and probably backwards.** The plan says "SDK 58 shows notifications while the app is open by default". I found no SDK 58 changelog entry saying so. Historically the default is *not* to show them in the foreground. Use the current keys `shouldShowBanner` / `shouldShowList`, not the deprecated `shouldShowAlert` ([v58 notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)). The conclusion to set the handler explicitly is still right.

4. **[CORRECTION] Theatre.js licensing.** Only `@theatre/studio` (the editor) is AGPL-3.0. `@theatre/core`, the part you ship, is Apache-2.0. "Skip" is still correct, but the reason is that it's stale and web-only, not AGPL.

5. **[CORRECTION] GSAP.** It has been 100% free, including SplitText, MorphSVG and commercial use, since 30 Apr 2025 under Webflow's licence ([Webflow](https://webflow.com/blog/gsap-becomes-free)). The only reason to skip it is that it doesn't run in React Native. Don't let anyone cite licensing as the reason.

6. **[CORRECTION] Expo SDK 58 / RN 0.88 is right.**
   - Docs: RN 0.88, React 19.2.3, Node 22.13+.
   - Strict TypeScript API is now the default, so deep `react-native/Libraries/*` imports break ([upgrade blog](https://expo.dev/blog/how-to-upgrade-to-sdk-58)).
   - Gesture Handler 3 is **stable** (3.1.x, needs RN ≥ 0.82). Callbacks are renamed: `onStart` → `onActivate`, `onEnd` → `onDeactivate`, and `success` → `event.canceled` ([guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/)).
   - Rive: both Events **and** state-machine Inputs are deprecated in favour of Data Binding, and the New Runtime doesn't support them ([Rive](https://rive.app/docs/runtimes/react-native/rive-events.md)).

7. **[CORRECTION] TestFlight internal testing needs your girlfriend on your developer team.** She must be added as an App Store Connect user (the Marketing role is enough). Internal builds skip beta review ([Apple](https://apple.co/1kxr08D)).
   - Alternative: EAS ad-hoc internal distribution (`eas device:create`, `"distribution": "internal"`). The profile lasts a year instead of 90 days, but it requires Developer Mode on her phone, and new memberships can take 24–72 h before a device registers ([EAS](https://docs.expo.dev/build/internal-distribution/)). TestFlight is less friction for a non-developer.
   - Push needs the paid $99 programme either way; free personal teams have no APNs.

8. **[CORRECTION] Playing sound through the silent switch is the wrong default.** A playback audio session with `playsInSilentMode` also **ducks or stops her Spotify** unless you set mix-with-others. Use the ambient category (respects the mute switch, mixes with other audio), and offer "sound even on silent" as a setting.

9. **[CORRECTION] Font loading.** Skia's `useFonts` loads TTFs into its own font manager. `expo-font` is only needed if the same fonts are also used in RN `<Text>`/`TextInput`, which the plan does need (see the text-entry gap below). Bundle once and reference from both.

10. **[CORRECTION] Font notes.**
    - Playpen Sans does include Cyrillic in current versions; older metadata says Latin-only ([Fontsource](https://fontsource.org/fonts/playpen-sans/about)).
    - Calligraphr's Cyrillic is **not** a built-in template. It needs a custom template with hand-added Cyrillic cells. Budget about 66 extra glyphs (а–я, А–Я, ё/Ё), plus 2–3 variants each for realism.

11. **[CORRECTION] Read receipts leak through the schema.** `letters.opened_at` and `status='opened'` live in the table both partners can read, which contradicts "read receipts off unless opt-in". Move `opened_at` to a recipient-only table, or write it only when both have opted in.

12. **[CORRECTION] A stored `status` will disagree with RLS.** RLS unlocks content at `deliver_at <= now()`, but the cron flips `status` up to a minute later, so the client sees "in transit" for a letter it can already read.
    - Derive status from timestamps in a view (`case when now() >= deliver_at then 'delivered' …`).
    - Keep cron only for push dispatch, idempotent via a `pushed_at` column.

### Missing pieces

- **[MISSING] Text entry: the biggest gap in the plan.** It never says how Cyrillic typing works on a Skia canvas. Skia has no caret, selection, IME, autocorrect or dictation. Pragmatic design:
  - Write in a transparent, multiline RN `TextInput` with the same font and line-height, laid over the paper image and snapped to the ruling/grid. This gets you native keyboard, autocorrect and dictation.
  - On blur or "read over", crossfade to the jittered Skia render.
  - Prototype this in week 1; it is a bigger risk than the fold.

- **[MISSING] Page size and pagination.** Decide on a hard sheet limit: 1–2 sheets, both sides, and a "you've run out of paper" message. Real letters are bounded, and the limit drives fold thickness and envelope bulge. Skia Paragraph has no Russian hyphenation; that's fine for handwriting, but say so.

- **[MISSING] Render determinism and letters that never change.**
  - Re-rendering from `seed` on the recipient's phone breaks whenever fonts, Skia version or layout code change.
  - Store a `render_v`, keep old renderers, *and* upload the baked page image (encrypted) as the canonical copy, with vectors as secondary.
  - Snapshot at a fixed DPR (for example 2048 px wide), not the device's.

- **[MISSING] Attachments in Storage need delivery gating too.** Add a Storage RLS policy that joins `letters.deliver_at`, or serve attachments only through a signed-URL RPC that checks it. Otherwise photos are fetchable before delivery.

- **[MISSING] Encrypted draft autosave** (local SQLite or MMKV) and an offline posting queue. A lost half-written love letter is the worst bug this app can have.

- **[MISSING] Android haptics and distribution, if she's on Android.**
  - Use `Haptics.performAndroidHapticsAsync` (`AndroidHaptics.Confirm`, `Drag_Start`, `Clock_Tick`…). It's closer to iOS feel and needs no VIBRATE permission ([v58 haptics](https://docs.expo.dev/versions/v58.0.0/sdk/haptics/)).
  - Ship with an EAS APK or Play internal testing.
  - Ask her phone model before anything else.

- **[MISSING] A home-screen widget and Live Activity.** `expo-widgets` is stable from SDK 56 ([Expo blog](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo.md)).
  - A mailbox widget whose flag goes up is the most "physical" signal you can get outside the app.
  - A Live Activity / Dynamic Island "letter in transit · arrives tomorrow at the 10:00 round" makes waiting part of the ritual. Updates are throttled, which is fine because the estimate is fixed.

- **[MISSING] A custom notification sound.** A mail-slot clack or flag creak, via the `expo-notifications` config plugin `sounds` (iOS: under 30 s, `.caf`/`.wav`).

- **[MISSING] A Liquid Glass policy (iOS 26/27).** Keep system chrome out of the stationery scenes. Use full-bleed custom UI and hide the tab bar during ceremonies; mixing glass and paper ruins the illusion.

### Simplifications

- **[SIMPLIFY] Drop invite-code pairing.** Seed two `profiles` rows and one `couple_id` by SQL, and sign in with Apple or a magic link.
- **[SIMPLIFY] Tiers.** Ship one delivery tier, distance-based with post rounds. Express, slow boat, capsule and tracking-hub events go to v1 or later. Pre-generated `tracking_events` with RLS is over-built for two people.
- **[SIMPLIFY] Drop the asset-licence worry.** A private app for two people is non-commercial, unpublished use.
  - Freesound CC-BY-NC and ElevenLabs free-tier output are fine to use privately.
  - Don't spend time on commercial-terms checks unless it goes on the App Store.
- **[SIMPLIFY] Tooling.**
  - Cut Maestro, the Blender MCP, DeepBump and the `visual-qa` contact-sheet skill from MVP. Two humans on two real phones are the QA.
  - Keep only the `paper-realism` and `postal-rules` skills.
  - Playwright against a CanvasKit web export also renders slightly differently from Ganesh/Metal, so screenshot diffs will be noisy.
- **[SIMPLIFY] E2E is optional, not mandatory, for MVP.** It adds a way to lose letters permanently (a lost passphrase) to a romance app. Option: Supabase at-rest encryption plus RLS for MVP, with a `schema_v` column so letters can be encrypted later. If you keep E2E, the in-app restore test is mandatory.
- **[SIMPLIFY] Supabase plan.** Free tier plus a pg_cron job still risks pausing and has no backups, so Pro at $25 is defensible. Alternatively use Convex's free tier with `scheduler.runAt`, which removes the cron-polling design entirely.
- **[SIMPLIFY] Push plumbing.** Use a Supabase Database Webhook to call the Edge Function, instead of hand-rolled `pg_net` triggers.

### Realism boosts (ranked by perceived impact per hour of work)

1. **[REALISM-BOOST] Her real handwriting beats any shader.**
   - Pull a **handwritten signature and P.S.** (perfect-freehand, finger) into the MVP, even if the body is typed.
   - Phones have no finger pressure (no 3D Touch since the iPhone 11), so derive pressure from velocity. RNGH `stylusData` only helps with an iPad Pencil.
2. **[REALISM-BOOST] Lighting and shadow, not texture.**
   - A soft contact shadow under the sheet plus ambient occlusion along creases.
   - The folded-over panel casts a shadow that grows with angle.
   - 0.3–0.5 mm paper thickness shown at the edges when folded.
   - One global light shared with the desk.
3. **[REALISM-BOOST] Imperfection, seeded per letter.**
   - Thirds fold 1–3 mm off and 0.5–1° skewed.
   - Cut edges aren't perfectly straight.
   - After unfolding, the sheet doesn't lie flat: residual crease lift casts a small shadow.
   - The letter sits slightly crooked in the envelope.
4. **[REALISM-BOOST] Physical envelope cues.**
   - The envelope bulges and shades by fold count and sheet count.
   - Show-through of the folded letter's outline, and of ink, when the envelope is tilted toward light (reuse the DeviceMotion uniform).
5. **[REALISM-BOOST] Continuous haptic texture.** One-shot taps feel digital. A custom Expo module wrapping `CHHapticAdvancedPatternPlayer`, with intensity and sharpness tracking drag velocity, makes tearing and sliding feel like friction. On Android, use `VibrationEffect.Composition` low-tick primitives. Promote it from "delight" to v1.
6. **[REALISM-BOOST] Cyrillic-native script fonts first.**
   - Bad Script and Marck Script were designed as Russian cursive. Russian prints т as m, and д and з have descenders.
   - Caveat and Great Vibes have Cyrillic, but the shapes are Latin-first.
   - Grid paper should use the real school-notebook palette: grey-blue 5 mm grid and a **red/pink margin line**, not a pale blue one.
7. **[REALISM-BOOST] The wait is part of the realism.**
   - Postmark with the real city and date.
   - Arrival snapped to the 10:00/16:00 rounds.
   - The mailbox flag rises via Realtime and the widget.
   - The in-transit envelope visible but untouchable.
   - These cost little and sell the illusion more than particles do.
8. **[REALISM-BOOST] Record your own foley in one evening:** paper, envelope, wax, pen and mailbox, 3–5 takes each. Owned, in-character sound beats stock libraries for this app.