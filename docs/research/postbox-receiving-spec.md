> Research snapshot from 2026-10-27 (multi-agent web research → build spec → critic). The first build follows the critic's scope; see README for what shipped.

# Build spec for "Письма": posting and receiving

Checked in the repo: Skia 2.14.0 (`Skia.PathBuilder.Make()…detach()` is already used in `src/letter/envelope.ts`), RNGH ~3.3, Reanimated 4.7.1, expo-audio ~58. expo-haptics in this install exports `performAndroidHapticsAsync`, `AndroidHaptics.Segment_Tick`/`Clock_Tick` and `ImpactFeedbackStyle.Rigid`. The current push copy ("Флажок на почтовом ящике поднят") is in `supabase/functions/deliver/index.ts:7` and `.claude/skills/postal-rules/SKILL.md:29`.

## 1. Scene and objects

**Postbox: the RU 2015 Lebedev wall box, built first.** It is 380×550×250 mm with a 171×6 mm slot, made of powder-coated sheet steel with a recessed steel emblem, and the side sticker is filled in by hand ([artlebedev.ru](https://www.artlebedev.ru/russianpost/mailbox/), [snob.ru](https://snob.ru/selected/entry/93316/)).
- **Framing.** Use a close-up at 1.6 pt/mm. The slot is then 274 pt wide and the box front overflows a 390 pt screen. The visor sits about 22% from the top.
- **Envelope orientation.** A DL envelope is 220×110 mm, which is about 352×176 pt at this scale. It is wider than the slot, so **the envelope goes in short edge first, in portrait**. This is real physics and needs no widened slot. The sealed envelope with its wax, about 4 mm thick, clears the 6 mm slot.
- **Colours.**
  - Blue: front #2766C5, side #1A499F, deep shade #153774.
  - Express tier uses the yellow skin, #FFC315. Standard and scheduled use blue.
  - Slot lip #F6974A.
  - Wear: primer chips #8A8D90, rust #7A3B1C.
  - Slot interior: gradient #0B0B0D → #1C1C20.
  - These are sampled from renders, so treat them as approximate.
- **Signage.** "ПОЧТА" plus an original emblem. Do not use "Почта России" or its logo (branding rule).
- **Side sticker (the plate).** Resolving the conflict between the reports: our 10:00/16:00 times are *delivery* rounds, not box collections, so labelling them "выемка" would be dishonest.
  - The baked part keeps the real sticker layout and reads **"ГРАФИК ДОСТАВКИ"**. Пн–Сб rows show "1 10:00 · 2 16:00" in dotted 7-segment boxes, Вс is left blank, and a footnote says "по времени получателя".
  - A live top row, **"Выемка"**, shows the letter's `collect_at` (for example 14:37). It is drawn in marker ink with our handwriting renderer, because real stickers are filled in by hand.
  - The footer is baked small text: "Перенос согласовать по телефону…".
- **FR skin (second).**
  - Body #FFCB05 ([La Poste brand](https://www.lebrandcenter.lapostegroupe.com/brand/document/pdf/logotype-rvb-sans-signature-1)).
  - Orange day "chapeau" ([CHP PDF](https://comitehistoire.laposte.fr/wp-content/uploads/2024/04/CHP-Dossier-Documentaire-La-boite-aux-lettres.pdf)). #E8731C is my invention, so verify it.
  - "LETTRES" over the slot.
  - Plate reads "DISTRIBUTION — Du lundi au samedi : 10 h · 16 h — Pas de distribution le dimanche", plus a handwritten "Levée : 14 h 37".
- **Skin rule.** The postbox follows the sender's locale and the mailbox follows the recipient's.

**Mailbox: the RU подъезд bank, built first.**
- **Layout.** A 2×4 block, 390 mm wide, cells 200 mm deep ([productcenter](https://productcenter.ru/products/72953/pochtovyi-iashchik-sierii-praktik)).
- **Door.** About 190×125 mm, side-hinged. The size is my estimate.
- **Cell colours.** RAL 7035 #CBD0CC or RAL 1001 #C2B078.
- **Hardware.** 20 mm cylinder lock ([vc.ru](https://vc.ru/id638900/206508-vybiraem-pochtovyi-yashik-dlya-podezda)), a slot, and a row of six peek holes of about 8 mm. The holes are undocumented but culturally right.
- **Interior.** #2A2622 with corner AO gradients from rgba(0,0,0,.55) over 20 pt.
- **FR batterie.**
  - Cells 26×26×34 cm with a 235×24 mm slot ([laposte.fr](https://www.laposte.fr/guide-achat/quelle-boite-aux-lettres-choisir)).
  - 100×25 mm nameplate with names in capitals at least 4 mm high.
  - Anthracite #383E42.
- **"Mail is here" cue.** Drop the flag: on US boxes it means *outgoing* mail ([mailboxesandsigns](https://www.mailboxesandsigns.com/blog/2020/posts/5-myths-about-carrier-signal-flags-in-mailboxes/)).
  - RU: a pale envelope corner shows through the holes.
  - FR: a corner pokes 6–10 pt out of the slot.
  - With several letters, draw up to 3 corners offset by 3 pt and 2°. A fourth shows as a "+N" chalk tag.

**Bake vs animate.**

| Bake (SkPicture → `usePictureAsTexture`) | Animate |
|---|---|
| Box body: orange-peel fbm, edge wear, grime under the visor, slot AO 6 px, static plate text, neighbour flyers, mailbox interior, pre-blurred shadows | Inner slot flap (rotateX), door (rotateY), interior light uniform `L=mix(.12,.65,sin a)`, handwritten collect_at, envelope matrices and clips, wax shader (only live shader, about 90 pt), crumbs |

## 2. Posting ceremony

There is one progress value `ins`. The fixedT map is: 0–0.15 orient, 0.15–0.85 insert, 0.85–1 drop and flap settle.

| Stage | Driver | Visual | Haptic / sound |
|---|---|---|---|
| Enter | auto, 250 ms crossfade | Sealed envelope (back, seal visible) under the box | — |
| Orient 0–0.15 | finger drags up | Envelope rotates 90° to portrait, scales to slot scale, tilts `rotateX` 0 → −1.15 | — |
| Insert 0.15–0.85 | finger, TRAVEL = 352 pt | Clip in envelope-local space. The flap rotates `min(k·9,1)·1.2` rad. At contact (k<0.08) the envelope squashes `scaleY 1−0.03·sin πk` | `tick` at contact; `slot_paper_slide` |
| Release | `onDeactivate` | **Commit** if `ins ≥ 0.55` or (`velocityY ≤ −900 pt/s` and `ins ≥ 0.15`). Otherwise `withSpring(0,{velocity,damping:16,stiffness:320})`, as if the flap pushed it back | — |
| Drop | `withTiming(1,{duration:90+260(1−p), easing:Easing.in(quad)})` | Flap springs `withSpring(0,{stiffness:500,damping:11})` | `clack` on overshoot, then `postbox_thud` + `posted` |
| Grace | after drop | Plate line and a text button, at least 44 pt | — |

The commit rule follows the techniques report. The UX report suggested 0.6; 0.55 plus a velocity commit is better.

**Grace window.**
- No modal: the commit threshold is the confirmation ([LogRocket](https://blog.logrocket.com/ux-design/ux-reversible-actions-framework/)).
- Until `collect_at` show "Можно забрать до 14:37" with the [Забрать письмо] button. Show clock time, never seconds.
- **Retrieve** runs `ins` from 1 to 0 over 600 ms with `Easing.out(cubic)` and plays `slot_paper_slide` reversed. The seal stays intact.
- After `collect_at` (local timer plus Realtime), the line becomes "Письмо забрали. Оно в пути" and the button is removed.
- **Recipient sees nothing while the letter is `posted`.** This needs an RLS check in postal-rules.

## 3. Receiving ceremony

The fixedT map is: 0–0.1 door, 0.1–0.25 take out, 0.25–0.32 flip, 0.32–0.5 open, 0.5–0.7 pull, 0.7–1 unfold.

1. **Door.**
   - Tap the lock: the key turns 90° over 200 ms auto, with `clack` and `mailbox_key`.
   - Then pan horizontally: `[{translateX:hx},{perspective:800},{rotateY:-a},{translateX:-hx}]`, with `a` up to 105°. Swap to the inside face at π/2 (the clip technique from the tri-fold).
   - Commit at `a > 0.4` or `vx > 600 pt/s`. Haptic `door`, sound `mailbox_door_creak`.
2. **Take out.**
   - Inside, the envelope lies on the floor at `rotateX 0.95`, rotated 8°, front face up.
   - Pan along a 64-sample path. The envelope lifts (`rotateX` → 0, scale → 1.15) and is clipped by the door opening while t < 0.4.
   - Commit at t > 0.5 or v > 700 pt/s. Sound `envelope_pickup`, haptic `crease`.
3. **Front, then flip.** The front shows stamp, postmark and address. Tap or swipe to flip over 500 ms with `withSpring` and `overshootClamping`.
4. **Open.** The primary method is a **paper-knife slit along the top fold**. The flap stays glued and the seal survives as a keepsake ([opening report](https://www.letterseals.com/blogs/waxing-about-wax/best-sealing-wax-for-mailing-letters-that-wont-crack)). Tear is not offered: it reads as careless.
   - **Slit.** The pan must start within 48 pt of the top-left corner.
     - Progress 0–0.08: the brass knife tip dips 8 pt (`press`).
     - The slit front then follows `x/W`, rubber-banding with resistance 0.55.
     - `fibre` ticks fire at seeded stick-slip intervals of 18–30 pt, never closer than 45 ms.
     - At 0.92 it auto-finishes with `withSpring({velocity})`.
     - Edge: `tearY = y0 + 0.3·fbm(x/40) + 0.15·n(x/1.5)` pt, a 0.5 pt dark cut line, and the liner visible in the gap. No fringe.
   - **Wax present: break-the-seal sub-step.** Both gestures stay live. The hint offers the seal first, because that is the sender's craft.
     - Pan up from inside the seal radius plus 12 pt.
     - 0–14 pt is strain only: the seal darkens 4% and a hairline crack fades in.
     - At 14 pt it snaps: `crack`, `seal_snap`, then `wax_crumbs`. The crack follows the flap edge (seeded polyline plus 1–2 branches). The flap half lifts with the flap, which reverses the existing close stage and rotates up to 0.985π. The body half stays.
     - 2–5 crumbs of 1.3–4 pt fly with g = 2000 pt/s².
     - Fibre-tear patches cover 30–60% of the gum line, with gum #e3d6b0 at 25% alpha.
5. **Pull out.** Reverse of the existing insert stage, clipped by the pocket path.
   - Follow factor by progress: 0.35 (0–0.08), then 0.85 (to 0.3), then a 120 ms snag (1.5 pt sideways, 0.8°, `tick`), then 1.0.
   - The envelope recoils 8% on a spring (damping 20, stiffness 150).
   - The slit lip casts a 12 pt shadow from 30% to 0.
   - Auto-complete at t > 0.82 or v > 800 pt/s.
   - The envelope slides to the bottom-left at scale 0.92.
   - Sound `letter_pull_rustle`.
6. **Unfold.** `FoldableLetter` with a new `initialT={1}`; dragging down decreases t. There is one `crease` per panel and `uCrease` stays at 0.35.
7. **Read.**
   - Call `open_letter`, which sets `opened_at` and `opened_by:'slit'|'seal'`.
   - Damage is seeded from a hash of the letter id, so both phones match.
   - The play-by-itself time budget is 2.5 s or less, versus Paperless Post's criticised 9 s ([InVision](https://invisionapp.com/inside-design/paperless-post)).

**Re-read.** If `opened_at` is set, mount the reading view directly. The archive thumbnail is the envelope at `fixedT={1}`. "Открыть заново" is an optional replay, as in Punchbowl ([help](https://help.punchbowl.com/article/396-why-didnt-i-see-the-envelope-animation)).

**Multiple letters.** Oldest unopened comes first. After reading, return to the open mailbox with the remaining envelopes and skip the door stage.

**Reduce Motion, screen reader and web.**
- Subscribe to `AccessibilityInfo` `reduceMotionChanged` and `screenReaderChanged`. `useReducedMotion` is read once at startup only ([Reanimated](https://docs.swmansion.com/react-native-reanimated/docs/device/useReducedMotion)).
- Each stage becomes stills at fixedT 0 and 1, joined by 200 ms opacity crossfades with `ReduceMotion.Never` on opacity only.
- Stage buttons: Опустить / Открыть ящик / Вскрыть / Достать / Развернуть.
- Sound and one haptic stay.
- Add `accessibilityActions` (`activate`, `magicTap`, `escape`).
- On web, add a separate `Pressable` for each tap, because a tap without movement does not reach the pan gesture.

## 4. Techniques (current API generation)

```ts
// Split one baked picture into two moving parts (slit, seal shards)
const top = Skia.PathBuilder.Make().moveTo(0, -20);
for (let i = 0; i < pts.length; i += 2) top.lineTo(pts[i], pts[i + 1]);
const pathA = top.lineTo(W, -20).close().detach();
const pathB = Skia.Path.MakeFromOp(Skia.Path.Make().addRect(rect(0,0,W,H)), pathA, PathOp.Difference)!;
// <Group clip={pathA}><Picture picture={env}/></Group>
// <Group clip={pathB} transform={flapT}><Picture picture={env}/></Group>
```

```ts
const pan = usePanGesture({
  enabled: fixedT === undefined,
  onBegin: () => { gStage.set(stage.get()); },
  onUpdate: (e) => { if (gStage.get() !== 0) return;
    ins.set(clamp01(start.get() - e.translationY / TRAVEL)); },
  onDeactivate: (e) => { const p = ins.get();
    if (p >= 0.55 || (e.velocityY <= -900 && p >= 0.15))
      ins.set(withTiming(1, { duration: 90 + 260 * (1 - p), easing: Easing.in(Easing.quad) },
        (d) => { if (d) scheduleOnRN(onPosted); }));
    else ins.set(withSpring(0, { velocity: -e.velocityY / TRAVEL, damping: 16, stiffness: 320 })); },
});
```

- **Occlusion.** Put `<Group clip={rect(0, ins*TRAVEL, W, H)}>` *inside* the perspective `Group matrix`. Draw order: slot interior → flap → face picture (slot cut out with evenOdd) → envelope.
- **Crumbs.** `Atlas` plus `useRSXformBuffer` with closed-form motion `p0 + v0·t + 1000·t²`, one bounce at restitution 0.3. It is deterministic under fixedT.
- **Web limits.** No nested path effects on web (`MakeSum`/`MakeCompose` are missing). Use at most 3–4 live AA clips per frame (rule of thumb).
- **Unverified.** Building paths with `PathBuilder` inside a worklet each frame is not checked. Fallback: precompute polylines in JS and capture them as plain number arrays.

## 5. Copy (informal ты/tu; needs a native-speaker check)

| Key | RU | FR |
|---|---|---|
| post.hint | Опусти письмо в ящик | Glisse la lettre dans la boîte |
| plate.collect | Выемка 14:37 | Levée : 14 h 37 |
| plate.rounds | Доставка 10:00 и 16:00, кроме воскресенья | Distribution 10 h et 16 h, sauf le dimanche |
| post.eta / express | Придёт завтра около 10:00 / Придёт сегодня к 16:00 | Arrivée demain vers 10 h / Arrivée aujourd'hui vers 16 h |
| post.grace | Письмо в ящике. Можно забрать до 14:37 | La lettre est dans la boîte. Tu peux la reprendre jusqu'à 14 h 37 |
| post.retrieve | Забрать письмо | Reprendre la lettre |
| post.retrieved | Письмо снова у тебя | La lettre est revenue |
| post.collected | Письмо забрали. Оно в пути | La lettre est partie. Elle est en route |
| push.title | В ящике письмо | Tu as du courrier |
| push.body | Загляни в почтовый ящик: там что-то белеет | Quelque chose dépasse de ta boîte aux lettres |
| mbox.transit | Тебе идёт письмо | Une lettre est en route pour toi |
| mbox.n | В ящике писем: 3 | 3 lettres t'attendent |
| mbox.empty | Пока пусто | Rien pour l'instant |
| mbox.open | Открой ящик | Ouvre la boîte |
| open.slit | Проведи ножом вдоль сгиба | Fais glisser le coupe-papier le long du pli |
| open.seal | Потяни вверх, чтобы сломать печать | Tire vers le haut pour briser le cachet de cire |
| pull / unfold | Достань письмо / Разверни | Sors la lettre / Déplie-la |
| archive | Шкатулка / Убрать в шкатулку | Boîte à souvenirs / Ranger |
| replay | Открыть заново | Rouvrir l'enveloppe |

The push stays vague, as the current design intends. That also avoids declining the sender's name into the Russian genitive.

## 6. File plan

- **`src/letter/`**
  - `steelBox.ts`: parametric body, powder-coat SkSL and skins.
  - `PostboxScene.tsx`
  - `PostingCeremony.tsx`
  - `MailboxScene.tsx`
  - `ReceivingCeremony.tsx`
  - `tear.ts`: `tearY`, `slitEdge`, `crackPolyline`, `mulberry32`.
  - `WaxShards.tsx`: clip-split plus Atlas crumbs.
  - `sounds.ts`
  - `useMotionPrefs.ts`
- **`src/app/lab/`**: `post.tsx`, `mailbox.tsx`, `open.tsx`, each with a fixedT slider.
- **`stationery.ts`**: add `POSTBOX` (RU blue/yellow, FR), `MAILBOX` (RAL 7035, 1001, 7016) and `KNIFE` (brass #B08D57, an estimate).
- **`haptics.ts`**: add these to `feel`:
  - `clack`: iOS Rigid, Android `Clock_Tick`.
  - `fibre`: iOS `selectionAsync`, Android `Segment_Tick`.
  - `crack`: Rigid.
  - `door`: Medium.
- **`FoldableLetter`**: add `initialT` and `onSettled`.
- **Supabase**: `opened_by` column; postmark gets `index` and `sortingCentre`; replace the flag copy in `deliver/index.ts`; hide `posted` rows from the recipient.
- **Skills**:
  - postal-rules: new copy and visibility rule.
  - letter-choreography: posting and receiving tables.
  - paper-realism: box colours and the slit edge.
- **QA frames** for posting, receiving and a crumb-mid frame:

| Posting | Receiving | Crumbs |
|---|---|---|
| 0, 0.1, 0.3, 0.6, 0.86, 1 | 0.05, 0.2, 0.3, 0.4 (slit and seal variants), 0.6 (snag), 0.85, 1 | Seal at +80 ms |

  Also capture both skins and Reduce Motion stills.

## 7. Sounds (deferred until we have assets)

- **Libraries.** expo-audio one-shots first: `Audio.preload` at module scope, `playsInSilentMode:false`, `mixWithOthers`. react-native-audio-api later for the gesture-coupled slit: dev build only ([docs](https://docs.swmansion.com/react-native-audio-api/docs/fundamentals/getting-started)), with 40 ms grains whose offset is `tearT·duration` ([source node](https://docs.swmansion.com/react-native-audio-api/docs/sources/audio-buffer-source-node)). Only one library may own the audio session.
- **Files**, all `assets/sfx/*.m4a`:
  - `slot_paper_slide`: envelope sliding into the slot.
  - `slot_flap_clack`: the flap snapping back.
  - `postbox_thud`: the letter landing inside.
  - `mailbox_key`: key turning in the lock.
  - `mailbox_door_creak`: door opening.
  - `envelope_pickup`: lifting the envelope.
  - `opener_slit_loop`: continuous rasp, 3–5 variants, gain `clamp(v/1200)`, rate 0.9–1.15.
  - `seal_snap`: 30–60 ms.
  - `wax_crumbs`: crumbs landing.
  - `letter_pull_rustle`: pulling the letter out.
  - `unfold_crease_1..3`: one per unfolded panel.
- **Sourcing.** Record on a phone in a quiet room, with a contact mic for paper ([A Sound Effect](https://www.asoundeffect.com/?p=474)), or use CC0 Freesound clips after a licence check. On web, call `ctx.resume()` in `onBegin`.

Additional sources: [OSM RU](https://wiki.openstreetmap.org/wiki/RU:Tag:amenity%3Dpost_box), [Reanimated a11y](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility), [audio-api plugin](https://docs.swmansion.com/react-native-audio-api/docs/other/audio-api-plugin), [comnews](https://www.comnews.ru/content/95856/2015-06-03/pochta-rossii-menyaet-cvet-i-formu).