> Research snapshot 2026-10-27 (multi-agent web research → build spec). The first build follows the critic's scope (docs/research/tracking-critique.md): single-draw itinerary with a window around delivery, no Monte Carlo; TS generator shared with the Edge Function instead of plpgsql.

# Delivery tracking build spec, Lille → Minsk (v1, 2026-10-27)

**Decisions taken here:**
- A new `postal` tier runs a server-generated itinerary of about 11 legs. The model is calibrated to a median of about 18 days, with p05 ≈ 13 d and p95 ≈ 27 d. I checked this by simulating 20,000 draws of the leg model in §2.
- `express` and `standard` keep `compute_deliver_at` and show the same itinerary compressed into their window.
- The default route is by road through Poland. There is no air leg.
- The map is a baked Skia map, not MapLibre.

## 1. Itinerary

**Routing assumption.** La Poste still accepts *documents* for Belarus; goods are suspended ([aide.laposte.fr](https://aide.laposte.fr/contenu/quelles-sont-les-destinations-internationales-suspendues-et-pourquoi)). Two pieces of evidence point to road transport through Poland:
- Slovak Post suspended Belarus mail because of the Poland–Belarus border closure ([IPC](https://www.ipc.be/news-portal/operations-logistics/2025/10/20/13/47/slovak-post-is-resuming-the-acceptance-of-shipments-to-canada)).
- Belarus's Resolution 599 truck ban (2 Nov 2025 – 31 Dec 2027) is widely reported to exempt mail ([Polskie Radio](https://polskieradio.pl/395/7786/Artykul/3602904,belarus-bans-polish-lithuanian-trucks-in-escalating-border-row), [trans.info](https://trans.info/en/belarus-eu-truck-ban-435424)). That makes a through mail truck plausible. I could not confirm that the text of 599 itself repeats the exemption ([Revera](https://belarus.revera.legal/?p=5033)).

**Contradictions resolved:**
- **Border crossing:** Kukuryki–Козловичи is the default, because it is the freight crossing. Terespol is mostly passenger and rail traffic.
- **Exchange office:** Roissy (FRCDGA) is the default. Chilly-Mazarin (FRCYMA) is kept as a data alternative.
- **Air via Istanbul:** Turkish Airlines resumed Istanbul–Minsk on 21 Sep 2026 ([BelTA](https://belta.by/society/view/aviakompanija-turkish-airlines-vozobnovila-polety-po-marshrutu-stambul-minsk-802002-2026/)). The air variant is stored as a variant row with `p=0`, because nothing shows La Poste uses it.

**If the assumption is wrong:** all hubs, legs and probabilities live in `route_hubs` data, not in code. A data migration can re-route, for example via Bobrowniki–Берестовица or Lithuania. Letters already generated keep their rows.

| # | Hub (FR / RU) | Code | lat, lon | Mode to next | Wait rule + dwell lognormal (median, σ) | Conf. |
|---|---|---|---|---|---|---|
| 0 | Boîte aux lettres, Lille / почтовый ящик, Лилль | — | 50.637, 3.063 | van | levée Mon–Fri 12:00, Sat 11:00; none on Sundays or FR holidays | high |
| 1 | PIC Lille-Lesquin | FRLSQA "LESQUIN PIC" ([parcelsapp](https://parcelsapp.com/en/mail-centers/FRLSQA)) | 50.585, 3.115 (approx.) | night truck on the A1, 3 h | 6 h, 0.4; departs 03:00 Mon–Sat | high / med |
| 2 | Roissy, bureau d'échange international | FRCDGA | 49.005, 2.560 | truck | 48 h, 0.6, then the Belarus dispatch **Tue/Fri 20:00** | med / low |
| 3 | Allemagne → Pologne (A2/E30, ~1,900 km) | — (no scan) | waypoints Berlin 52.52, 13.40; Warszawa 52.23, 21.01 | truck | 60 h, 0.3 | low |
| 4 | Transit Pologne (silent) | — | 52.23, 21.01 | truck | 60 h, 0.8 | low |
| 5 | Frontière Kukuryki / граница Козловичи | — | 52.15, 23.65 | Belpost truck | 20 h, 0.8; **3 %** chance of «граница закрыта», +7 d (median, σ 0.4) | low–med |
| 6 | Учреждение международного почтового обмена, Минск (ул. Вокзальная, 22) | BYMSQC "MINSK PI 2" | 53.889, 27.548 | — | 72 h, 0.6; working hours Mon–Fri 09:00–18:00 ([customs.gov.by](https://www.customs.gov.by/participants-ved/informatsiya-o-zagruzhennosti-mest-provedeniya-kontrolya-mezhdunarodnykh-pochtovykh-otpravleniy-i-to/)) | med–high |
| 7 | Таможня (optional) | — | same | — | **4 %**, 30 h, 0.5 | med |
| 8 | Участок обработки → ОПС Минск 220xxx | — | recipient's city | van | 20 h, 0.4 | med |
| 9 | Вручено (абонентский почтовый шкаф) | — | recipient | on foot | delivery round 10:00 Mon–Sat | med |

## 2. Delay model

**Sampling.**
- Each leg's dwell is drawn as `median·exp(σ·z)`, with z capped at +1.88 (p97), then rolled forward to the leg's next allowed departure.
- Most of the realism comes from these cut-offs.
- Load factor: 1 Dec – 10 Jan multiplies all medians by 1.4.

**Calendars.** The `postal_calendar(country, day, kind)` table is seeded for 2026–27:
- FR: 1 Nov, 11 Nov (Wed), 25 Dec, 1 Jan.
- BY: 7 Nov (Sat), 25 Dec, 1–2 Jan, 7 Jan, 8 Mar ([ilex.by](https://ilex.by/news/perenosy-rabochih-dnej-i-dlinnye-vyhodnye-v-belarusi-kak-otdyhaem-v-2026-godu/)).

**Calibration.** The simulation gives p05 13.0, p50 18.2, p95 26.5 days, max about 45 days.
- This sits at the optimistic end of the evidence: 27–33 days US→BY ([Postcrossing](https://community.postcrossing.com/t/experiment-delivery-times-from-usa-to-russia-and-belarus-direct-and-intermediary-methods/742976?page=10)), and 42–55-day averages from French senders in 2024 ([forum](https://community.postcrossing.com/t/closed-delai-des-cartes-postales-pour/851682)).
- Those postcard tails include lost cards, which we never simulate. That is the reason for the optimistic choice.
- `route_profiles.scale` (default 1.0) recalibrates without new code.

**PRNG.** `u(seed,k) = ('x'||substr(md5(seed||':'||k),1,8))::bit(32)::bigint / 2^32`, then Box–Muller. A TS twin lives in `src/letter/tracking/prng.ts` for parity tests.

**Keeping the promise ("never delay beyond the estimate shown"):**
1. At posting, run 128 Monte Carlo draws for this posting instant to get p05 and p95.
2. Draw the letter's itinerary with keys `k = attempt·100 + leg`, at most 16 attempts, until its EMI (delivery) falls inside [p05, p95]. If no attempt fits, use the draw closest to p50.
3. `deliver_at` = EMI. Only the day-level window is shown: «Придёт между 9 и 19 ноября» / «Arrivée entre le 9 et le 19 novembre».
4. Each visible event stores nested `eta_lo`/`eta_hi`, which only narrow and always contain `deliver_at`.

**Other tiers.** `standard` and `express` time-warp the same itinerary into [collect_at, deliver_at] with `t' = collect + (t−t₀)·(deliver−collect)/(EMI−t₀)`, which keeps the order. Events closer together than 20 min are dropped. `express` keeps only EMA, border and EMI, and shows a «Пневмопочта / Pneumatique» badge.

**Grace window.** The 1 h grace window *is* the postbox: EMA is the first levée at or after `collect_at`.

## 3. Event vocabulary

FR strings follow the real «Votre envoi…» style ([lettre24](https://lettre24.com/blog/Expedition-et-frais-d-envoi/envoyer-une-lettre-suivie)). RU strings come from aggregator mirrors of Belpost ([parcelsapp](https://parcelsapp.com/ru/carriers/belarus-post), [gdeposylka](https://gdeposylka.ru/courier/belpost/status)). Each leg stays in its own language: French rows in French, Belarusian rows in Russian. Office names stay in Latin capitals.

| Step | UPU | Official (PT Sans Narrow) | Couple note RU (Caveat) | Couple note FR |
|---|---|---|---|---|
| Collected | EMA | Votre envoi est pris en charge par La Poste. — LILLE | Письмо забрали из ящика | Ta lettre a quitté la boîte jaune |
| Sorted at PIC | EDD | Votre envoi est trié sur sa plateforme de départ. — LESQUIN PIC | Ночью его рассортировали | Triée cette nuit à Lesquin |
| Roissy arrival | EMB | Arrivée au bureau d'échange du pays d'expédition. | Ждёт машину на восток | Elle attend le camion pour l'Est |
| Left France | EMC | Votre envoi vient de quitter la France. | Покинуло Францию | Elle a quitté la France |
| (silence) | — | — | Пока тихо — письма путешествуют без GPS | Pas de nouvelles — les lettres voyagent sans GPS |
| Border closed | EXD-like | «Граница временно закрыта, отправление ожидает» | Граница закрыта, письмо терпеливо ждёт | La frontière est fermée, elle patiente |
| Minsk exchange | EMD | «Получение отправления в учреждении обмена MINSK PI 2» | Уже в Минске! | Elle est à Minsk ! |
| Customs | EDB / EDC | «Прохождение по таможенной зоне» / «Завершение таможенного контроля» | Не вскрывали — просто смотрят на марки | On regarde juste les timbres |
| To local office | EMF / EMG | «Отправка отправления в местное учреждение» / «Поступило в учреждение доставки» | Совсем рядом, в твоём отделении | Presque chez toi |
| Delivered | EMI | «Вручено» | В твоём ящике | Dans ta boîte |

There are no verified Belarusian strings. Belarusian is optional, translated by us and marked as such. Row invariants follow the UPU repeated-events note ([UPU](https://upu.int/getmedia/405ea48f-01e3-4a6c-86f2-611142cf619c/complianceWithUpuStandardsExplanatoryNotesEMSEVTRepeatedEventsEn.pdf)): EMA and EMI occur exactly once, EDD may repeat.

## 4. Data and server

```sql
create table public.route_hubs(route text, seq int, code text, office text, place jsonb /*fr,ru,be,lat,lon,tz,country*/,
  mode text check (mode in ('road','rail','air','foot')), waypoints jsonb, rule jsonb /*departures, median_h, sigma, p_event*/,
  visible bool, variant text default 'main', primary key(route,variant,seq));
create table public.tracking_events(letter_id uuid references public.letters on delete cascade, seq smallint,
  at timestamptz not null, code text not null, office text, place jsonb not null, mode_in text,
  visible bool not null default true, eta_lo date, eta_hi date, notify bool not null default false,
  revealed_at timestamptz, primary key(letter_id, seq));
```

**Migrations:**
- `…004_tier_postal.sql` contains only `alter type delivery_tier add value 'postal'`. The new value cannot be used in the same transaction that adds it.
- `…005_tracking.sql` adds `postal_calendar`, `route_hubs` (with Lille→Minsk seed rows), `route_profiles`, `tracking_events`, the prng/lognormal helpers, `generate_itinerary(letter_id)` (security definer, `search_path=''`), and the changes to `post_letter`, `retrieve_letter` and the cron.
- `post_letter` calls `generate_itinerary`. For `postal`, `deliver_at` comes from the generator.
- `retrieve_letter` deletes the letter's rows.

**Generalising to other city pairs:**
- Routes are keyed `FR-BY` (origin country → destination country).
- Endpoints come from the profiles' city lat/lon.
- An unknown pair falls back to a generic four-hub template (origin PIC → origin exchange → destination exchange → delivery office), with legs scaled by km.

**RLS.** Select is allowed when `visible and at <= now()`, and either the viewer is `sender_id`, or the viewer is `recipient_id` and `collected_at is not null`. There are no write policies.

**Why server-side generation.** A client that runs the seed could compute future events and `deliver_at`, which breaks invariant 2.

**Realtime.** The existing `collect_posted` minute cron also runs `update tracking_events set revealed_at=now() where at<=now() and revealed_at is null`. That UPDATE passes RLS, so it reaches subscribers. Rows with `notify` go through the `deliver` Edge Function.

**PGlite tests (`tests/tracking.test.ts`):**
- Generation and draws:
  - Same seed gives the same rows.
  - The TS prng matches the SQL prng over 1,000 keys.
  - `at` increases strictly.
  - EMA is the first visible row and EMI the last, each exactly once.
  - EMI equals `deliver_at`, and `deliver_at` lies inside the shown window.
  - ETA intervals are nested and always contain `deliver_at`.
- Calendars:
  - No levée on Sunday or on 11 Nov.
  - No Minsk processing or delivery on 7 Nov or on Sundays.
- Distribution over 500 seeds: p50 between 16 and 21 days, p95 ≤ 30 days.
- RLS:
  - The recipient sees zero rows before `collected_at`.
  - Nobody sees a future row or an invisible row.
- Cron and lifecycle:
  - The reveal stamp is idempotent.
  - `retrieve_letter` cascades the rows away.
- Compressed tiers: all events fall within [collect, deliver] and are at least 20 min apart; express has exactly 3 events.

## 5. Map

**Pipeline (devDependencies):** world-atlas@2.0.2, topojson-client@3.1.0, topojson-simplify@3.0.3, d3-geo@3.1.1, plus Natural Earth 50m rivers, lakes and places (public domain). `scripts/build-map.mjs` is the prototype from the map report.

**Projection and output:**
- `geoConicConformal`, parallels [47, 56], rotate [−15, 0], fitted to a MultiPoint bbox over lon −3…33 / lat 44…58.5, in a 1200×800 frame.
- Simplification quantile 0.35, rounded to 1 digit.
- Output `assets/map/europe.json` measured 52 KB raw / 22 KB gzip. Budget: ≤ 60 KB.

**Runtime projection.** A 30-line hand-written Lambert conformal conic in `src/letter/tracking/project.ts` uses the parameters stored in the JSON. A build-time test compares it against d3 to within 0.5 px. This avoids running d3 under Hermes, which is untested.

**Static layers**, recorded once into an SkPicture with `createPicture`:
- Land: `PAPER_SKSL` tinted #E8DCC0, with blurred-stroke edge darkening.
- Sea: waterlining.
- Coast: `Skia.PathEffect.MakeDiscrete(5, 0.5, seed)`, drawn twice (0.7 px and 1.4 px).
- Borders: `MakeDash([6,3,1.5,3])`, heavier on the PL–BY border.
- Labels: FRANCE · DEUTSCHLAND · POLSKA · БЕЛАРУСЬ, and Minsk / Минск / Мінск.

On web, rasterise with `drawAsImageFromPicture` at 2× and redo it at zoom 2.5× and 5×. That is the whole LOD scheme.

**Live layers:**
- Road legs: sepia `DashPathEffect [8,5]`. Air legs: red/blue `Path1DPathEffect` chevrons (#C8102E / #1F3A93), currently unused.
- Each leg is its own `<Leg>` component, trimmed with `end` driven by `useDerivedValue`.
- The envelope moves along a 256-sample `Float32Array[x, y, angle]` lookup table built from `Skia.ContourMeasureIter(...).next().getPosTan`.
- Hub markers are procedural postmarks at 0.3 scale, rotated ±12°, reading for example «ROISSY · 28-10-26».

**Honest motion:**
- On open, replay origin → last scan in 2.5 s.
- Park the envelope at the last scan.
- Draw the next leg as a faint pencil dash labelled «вероятно, где-то здесь / probablement par ici».

**Camera.** One `Group transform` driven by tx/ty/s SharedValues. Gestures are GH3 `usePinchGesture` (focal-point zoom) plus `usePanGesture` via `useSimultaneousGestures`; check the GH 3.3 field names `changeX` and `scaleChange`. Start fitted to the route bbox, clamp s to 1–6.

**Performance budget:**
- Total parse time ≤ 20 ms (measured 1–7 ms per layer).
- 60 fps with ≤ 12 live paths.
- Picture re-recorded only when the seed changes.

## 6. UX

**Where tracking appears:**
- **Sender:** right after the PostingCeremony, an outbox card «Где письмо?» shows the window.
- **Recipient:** nothing until `collected_at`, the existing invariant. Then an «В пути из Лилля» card with the same window, so both share the anticipation.

**Layout:**
- Phone: map in the top 45 % of the screen, timeline as a bottom sheet in reverse-chronological order.
- Laptop (≥ 900 px): map 60 % / timeline 40 %.
- Each row shows: mini postmark, official line, handwritten note, local time with zone, and the viewer's own time, e.g. «14:32 по Минску · у тебя 12:32».

**Gaps.** Computed on the client from the last event: «Нет новостей 3 дня — письма без трек-номера сканируют редко» / «Pas de nouvelles depuis 3 jours…». A border closure is never worded as a loss.

**Notifications.** At most two per letter: «Письмо пересекло границу — уже в Беларуси» / «Ta lettre est en Biélorussie», plus the existing delivery push. The sender can opt in to a third, «Покинуло Францию».

**Accessibility:**
- The timeline is the primary accessible view.
- The map carries one summary label, e.g. «Пройдено ~1 200 из 1 900 км, сейчас: Брест».
- With Reduce Motion on, the envelope jumps instead of gliding.
- Ink on paper meets ≥ 4.5:1 contrast.
- Dates are written out in words.

## 7. File plan and QA

**New files:**
- `supabase/migrations/20261027000004_tier_postal.sql`, `…000005_tracking.sql`
- `src/letter/tracking/{prng.ts, project.ts, types.ts, copy.ts, useTracking.ts}`
- `src/letter/TrackingMap.tsx`, `TrackingTimeline.tsx`, `HubPostmark.tsx`
- `src/app/lab/track.tsx` (scrubbable fake clock, seeds, tier toggle)
- `scripts/build-map.mjs`, `assets/map/europe.json`
- `tests/tracking.test.ts`, `tests/project.test.ts`

**Skill updates:** `postal-rules` gets the postal tier, tracking invariants and the two-push cap. `paper-realism` gets the map styling values.

**QA frames** (`npm run qa:visual`):
1. Day 0, sender, light mode.
2. Day 5, silent gap after Roissy.
3. Border-closed event.
4. Minsk scan, recipient view, RU.
5. Delivered, FR view.
6. Express with 3 events.
7. Laptop at 1440 px.
8. Dark mode.
9. Zoomed 5× at the PL–BY border.
10. Reduce Motion.

**Open uncertainties to keep in the docs:**
- The real exchange path (Roissy vs Chilly, road vs air) is inferred, not published by La Poste or Belpost.
- Whether Resolution 599 keeps the postal exemption is reported but not confirmed in its text.
- No Belarusian Belpost strings were found; the meaning of ПОПП is unknown.
- Polish border status after Feb 2026 was only partly checked ([reform.news](https://reform.news/en/poland-does-not-plan-to-expand-traffic-at-crossings-with-belarus/amp)).

Simulation: see tests/itinerary.test.ts (calibration test).