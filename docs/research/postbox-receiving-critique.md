> Critic review of postbox-receiving-spec.md (2026-10-27).

# "Письма" spec review: posting and receiving

I checked the spec's claims with web searches, Context7 (`/wcandillon/react-native-skia`) and the official docs. The tags below mean: [CORRECTION] fix before building, [MISSING] the spec does not cover it, [SIMPLIFY] cut it for the first build, [REALISM-BOOST] high realism for little work.

## Facts I confirmed

- **Lebedev box.** It is 380×550×250 mm with a **171×6 mm** slot, powder-coated sheet metal, and a steel emblem set into a recess. The collection time is **written by hand on a replaceable template sticker** on the side ([artlebedev.ru](https://www.artlebedev.ru/russianpost/mailbox/)).
- **Box colours.** There are three: **blue for mail across Russia, red for mail within the city, yellow for first-class express**. Using yellow for our express tier therefore matches the real code ([snob.ru](https://snob.ru/selected/entry/93316/)).
- **La Poste yellow** is officially **#FFCB05**, RGB 255/203/5 ([brand center](https://www.lebrandcenter.lapostegroupe.com/brand/document/pdf/logotype-rvb-sans-signature-1)).
- **Flag.** On US boxes the flag means the mail is *outgoing*, and Russian boxes have no flag. Dropping the flag wording is right ([mailboxesandsigns](https://www.mailboxesandsigns.com/blog/2020/posts/5-myths-about-carrier-signal-flags-in-mailboxes/), [ria.ru](https://ria.ru/20120708/692575206.html)).
- **Reanimated.** `useReducedMotion` reads the setting once, at app start. `AccessibilityInfo` `reduceMotionChanged` gives live updates ([Reanimated](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion)).
- **expo-audio SDK 58** has `preload(source, options)`, documented for module scope, plus `clearPreloadedSource` ([docs](https://docs.expo.dev/versions/v58.0.0/sdk/audio.md)).
- **expo-haptics** has `performAndroidHapticsAsync`, `Segment_Tick` and `Clock_Tick` ([docs](https://docs.expo.dev/versions/v58.0.0/sdk/haptics/)).
- **Skia on web.** `MakeSum` and `MakeCompose` are missing on React Native Web (also `MakeFromText` and `ShaderFilter`) ([RN Skia web docs](https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/getting-started/web.mdx)).

## [CORRECTION]

1. **The gesture code ignores cancellation.** In RNGH 3, `onDeactivate` only fires if the gesture activated, and the old `success` argument is gone. You now check `event.canceled` ([upgrade guide](https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrade-to-3/), [callbacks](https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/callbacks-events)).
   - As written, a pan interrupted by the system (an incoming call, a scroll taking over) **posts the letter**.
   - Fix: `if (e.canceled) → spring back`. Also handle `onFinalize` with `canceled`, so a progress value left part-way always settles.
2. **The drop curve jumps at release.** `withTiming(…, Easing.in(quad))` starts from zero speed, but the finger releases at up to about 900 pt/s, so the envelope visibly stops and then speeds up again.
   - Option 1: use a closed-form fall, `p(t) = p0 + v0·t + ½·g·t²`, with g about 6 progress/s², clamped at 1 and checked for each frame with `useFrameCallback`. This also stays deterministic under `fixedT`.
   - Option 2: use `withSpring(1, {velocity, overshootClamping:true, stiffness:900, damping:60})`.
3. **The path calls are partly the old API.** `Skia.Path.Make().addRect(...)` is the mutable form. The immutable API uses `Skia.Path.Rect(rect)` and `PathBuilder…build()` ([migration](https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/shapes/path-migration.md)).
   - The repo uses `.detach()`, which works, so pick one style and keep it.
   - `MakeFromOp` is **not in the migration guide's list of static operations**. Verify it in the 2.14 typings.
   - Better: drop the boolean operation entirely. Draw the second half with `<Group clip={pathA} invertClip>` (a documented `Group` prop).
4. **Opacity does not fade a `<Picture>`.** The docs say Picture, SVG and Paragraph are not affected by a Group's paint properties ([group.md](https://github.com/wcandillon/react-native-skia/blob/main/apps/docs/docs/group.md)).
   - The Reduce Motion crossfades will therefore do nothing on raw pictures.
   - Fix: use `layer={<Paint opacity={o}/>}`, or draw the baked `usePictureAsTexture` result as `<Image>`. The bake table already says to do this, but the code snippet uses `<Picture>`.
5. **The door's perspective is in the wrong place.** `[{translateX:hx},{perspective:800},{rotateY},…]` puts the vanishing point at the hinge and the door's top edge (y=0). The door will skew as if seen from above. Put `perspective` in a parent Group whose origin is the cell centre or the eye point, then apply the hinge translate and rotate inside it.
6. **Reduce Motion skips spring and timing animations already.** Animations default to `ReduceMotion.System`, so with the setting on, `withSpring` and `withTiming` return the end value immediately ([a11y guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility)).
   - Every settle in the ceremony already jumps to the end. Direct `ins.set(clamp…)` from the finger still moves, though.
   - It is undocumented whether the completion callback still fires with `finished=true`. Test it, because `onPosted` depends on it.
7. **French mailbox numbers are partly wrong.**
   - The nameplate minimum is **100×22 mm**, not 100×25 ([Écully form](https://ecully.fr/fileadmin/user_upload/Formulaire_740_raccordement_immeuble_collectif.pdf)).
   - The slot is 235 mm wide, 24–28 mm high, when the box is 260 mm wide.
   - The 260×260×340 mm minimum interior is confirmed ([laposte.fr pro](https://www.laposte.fr/professionnel/guide-achat/comment-choisir-boite-aux-lettres-collective-professionnelle)).
8. **The French plate wording.** Current La Poste street boxes show an **"heure limite de dépôt"**. Mail posted after it is postmarked the next day ([AN question](https://www.assemblee-nationale.fr/dyn/13/questions/QANR5L13QE2504)). Use "Heure limite de dépôt : 14 h 37". "Levée" is an older term.
   - I found **no source for an orange day "chapeau"** on French boxes. Remove it and the invented #E8731C.
9. **Two dead or unsupported citations.**
   - The InVision Paperless Post link now redirects to miro.com, so the "criticised 9 s" claim has no support. Remove the citation.
   - The letterseals source covers flexible wax versus brittle wax. It does not support "slit is the primary method" (see Realism-boost 3).
10. **Haptics: `fibre` on Android.** Use `Segment_Frequent_Tick`, which is documented as very soft for rapid repeats, instead of `Segment_Tick`. Some devices may then not vibrate at all, which is acceptable for fibre ticks.
11. **expo-audio settings.** `mixWithOthers` is a value of `interruptionMode`, and it is already the default. `playsInSilentMode` defaults to **true**. Setting it to false is a reasonable choice, but it means the iPhone silent switch mutes every ceremony sound, so make that a conscious decision.

## [MISSING]

- **Derived status never produces database events.** If `posted → in_transit → delivered` is computed from time, nothing is written at `collect_at` or at the delivery round. Realtime then never fires, and RLS cannot "reveal" a row by itself.
  - Add a pg_cron job (or the existing `deliver` function) that writes `status` / `visible_at` at those moments.
  - Make the RLS policy for the recipient `recipient_id = auth.uid() AND collect_at <= now()`, plus that written column, so Realtime events reach them.
- **Time zones in the copy.** "Можно забрать до 14:37" is in the sender's time, while the delivery rounds are in the recipient's time. State which zone each string uses. RU–FR is UTC+3 versus UTC+1/+2.
- **Left-handed slit.** The slit must start near the top-left corner. Accept the top-right corner too, mirrored.
- **Offline open.** `open_letter` must be idempotent and queued locally, so the replay-skip still works if the call fails.
- **Platform limits of the a11y actions.** `magicTap` and `escape` exist only on iOS VoiceOver. On Android, use custom `accessibilityActions` labels.
- **Tap versus pan in one gesture.** Instead of separate Pressables everywhere, consider `useTapGesture` racing the pan. The web behaviour of that is unverified, so keep the Pressable fallback.

## [SIMPLIFY] (first build)

- **Crumbs.** Atlas plus `useRSXformBuffer` for 2–5 crumbs is overkill. The docs also warn that Graphite (v3) draws an atlas one sprite at a time. Use five `<Group transform>` elements with derived values.
- **Postbox sticker.** Drop the 7-segment "ГРАФИК ДОСТАВКИ" table on the postbox, because a delivery schedule on a postbox is conceptually muddled. Keep the baked "ПОЧТА", the handwritten "Выемка 14:37", and the ETA line in the UI.
- **Skins.** Build RU only (blue, plus yellow for express) for both the postbox and the mailbox. FR follows.
- **One opening method: the slit.** It keeps the seal, and the wax shader is reused unchanged. Break-the-seal comes later. When it does, start with the cheaper **pop-off** version: the seal lifts whole with the flap and leaves a residue ring and torn fibres on the body, with no crack polyline or shards.
- **Door.** Merge the key turn into a single tap that unlocks and auto-opens the door to 20°, then pan. Skip the separate key animation.
- **Take out.** Use a simple vertical pan with lerp of `rotateX` and scale. Skip the 64-sample path.
- **Pull out.** Skip the snag and the recoil at first. Pulling out is the insert in reverse with the pocket clip.
- **Insert.** Skip the squash at contact (3% `scaleY`). It is invisible at 1.6 pt/mm.
- **Sound.** Defer all of it. Haptics only.

## [REALISM-BOOST]

1. **The seal snags in the slot.** Envelope, letter and wax together are about 5 mm, against a 6 mm slot ([artlebedev](https://www.artlebedev.ru/russianpost/mailbox/)). When the seal's position along the insert axis reaches the slot lip, cut the follow factor to 0.4 for about 12 pt and fire `tick`. This is one `interpolate` call, and it is *the* moment users will feel.
2. **Darken the envelope as it enters the slot.** Apply a 30–40 pt multiply gradient (#000 at 0 → 0.6) across the slot line, in envelope-local space, inside the clip. A bare clip looks like a mask; light falloff looks like a hole.
3. **Transit wear, seeded by letter id and baked.** Real brittle sealing wax often cracks or detaches in sorting machines ([letterseals](https://www.letterseals.com/blogs/waxing-about-wax/best-sealing-wax-for-mailing-letters-that-wont-crack)). Bake into the envelope picture:
   - a 0.3 pt hairline crack in the seal,
   - a slightly rounded, dog-eared corner,
   - a 4% grime vignette,
   - the machine-cancellation wavy lines next to the postmark.

   This costs nothing per frame and sells "it travelled".
4. **Contact shadows.** Add a pre-blurred 6–10 pt shadow under the envelope on the mailbox floor, and an ambient-occlusion line where the envelope touches the slot lip.
5. **Interior light.** Keep the mailbox interior light uniform `mix(.12,.65,sin a)` from the spec, and add a cool #0B0B0D tint at the back wall.
6. **Two sounds only, recorded on a phone:** `postbox_thud` and `slot_flap_clack`. They give the most perceived physicality per asset.

## Recommended FIRST-BUILD SCOPE

**Build now:**
- `steelBox.ts`: RU blue and yellow, baked to a texture, with "ПОЧТА", the handwritten "Выемка", slot AO, and the slot darkening gradient.
- **PostingCeremony.**
  - Stages: orient, insert, then the seal snag.
  - Commit rule: `ins ≥ 0.55`, or velocity commit. Add the `canceled` guard.
  - Drop: closed-form fall with velocity, flap spring, `posted` haptic.
  - Grace line plus [Забрать письмо]; Retrieve runs 1 → 0.
- **MailboxScene.** RU bank cell, envelope corner in the peek holes, and door on a single tap then pan, with the perspective fix.
- **ReceivingCeremony.**
  - Take out (simple), then flip.
  - Slit (corner start on either side, `tearY` edge, liner in the gap).
  - Pull out (reverse insert), then unfold with `FoldableLetter initialT={1}`.
  - Call `open_letter`.
- Transit-wear bake (seeded).
- Re-read skips straight to the reading view. Reduce Motion gives stills with `layer` opacity crossfades and stage buttons. Web gets Pressable fallbacks.
- Supabase:
  - written `visible_at`/`status` via cron,
  - RLS hiding rows before `collect_at`,
  - `opened_by`,
  - new push copy.
- Lab screens with `fixedT` and the QA frames for RU only.

**Later:**
- the FR skins (with verified FR values);
- break-the-seal (pop-off first, then crack and shards);
- crumbs;
- the snag and recoil on pull-out;
- the key animation;
- the delivery-schedule plate;
- sound (expo-audio one-shots, then react-native-audio-api for the slit loop);
- the multiple-letter stack and "+N" tag;
- the "Открыть заново" replay.