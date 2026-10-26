> Critic review of tracking-spec.md (2026-10-27).

## Review: Lille → Minsk tracking spec v1

Sources were checked on 2026-10-26/27. "Unverified" means I found no primary source for the claim.

### Routing and facts

**[CORRECTION] Minsk exchange: hours and name.** The customs page lists «Пункт таможенного оформления «Минская почта»», г. Минск, ул. Вокзальная, 22, open **«С 9.00 до 18.00 ежедневно»** ([customs.gov.by](https://www.customs.gov.by/participants-ved/informatsiya-o-zagruzhennosti-mest-provedeniya-kontrolya-mezhdunarodnykh-pochtovykh-otpravleniy-i-to/)). The spec has Mon–Fri; it should be daily.
- Change the hub-6 rule to 7 days a week, 09–18. Weekend scans in Minsk are realistic.
- The Mon–Sat restriction belongs only on legs 8–9 (local office and delivery round). Whether Belpost delivers on Saturdays is unverified, so mark it `conf: low`.
- Other places listed on that page: «Аэропорт Минск-2» (24 h) and «Минск-Белтаможсервис-2» (Щитомиричи, 09–21). Store them as variant rows.
- Office codes: the aggregators disagree. Parcelsapp lists both BYMSQC "MINSK PI 2" and BYMSQG "MINSK NATIONAL AIRMAIL UNIT PI 2" ([BYMSQC](https://parcelsapp.com/en/mail-centers/BYMSQC), [BYMSQG](https://parcelsapp.com/en/mail-centers/BYMSQG)). Ordertracker uses different codes again ([ordertracker](https://www.ordertracker.com/carriers/belpost)). Show the office *name* «MINSK PI 2» and keep the code internal only.

**[CORRECTION] Chilly-Mazarin.** Parcelsapp lists the Chilly code as FRCYMB "SPID CHILLY MAZARIN – FRENCH MILITARY MAIL ONLY" ([parcelsapp](https://parcelsapp.com/en/mail-centers/FRCYMB)). That record is unverified, and a 2020 forum anecdote shows Roissy→Chelles→Chilly on an *inbound* letter ([quechoisir](https://forum.quechoisir.org/lettre-suivie-achilly-mazarin-apres-chelles-t261403.html)). Do not treat Chilly as an export alternative. Remove FRCYMA, or set it to p=0 with a note.
- Roissy "ROISSY COURRIER INTERNATIONAL" (FRCDGA) ([parcelsapp](https://parcelsapp.com/en/mail-centers/FRCDGA)) is supported by La Poste's historical move of international processing to Roissy-CDG ([AN answer](https://questions.assemblee-nationale.fr/dyn/10/questions/QANR5L10QE45031.pdf)). Keep it as the default with `conf: med`.

**[CORRECTION] Border status is out of date in both directions.**
- **Sept 2025:** Poland closed *all* crossings, Terespol (DK2) and Kukuryki (DK68) included, during Zapad, starting 12 Sept ([liga.net](https://news.liga.net/en/politics/news/poland-completely-closes-the-border-with-belarus-amid-zapad-exercises)).
- **Nov 2025:** Poland reopened Bobrowniki on 16–17 Nov ([Polskie Radio](https://www.polskieradio.pl/395/7786/Artykul/3608375), [Baker McKenzie](https://sanctionsnews.bakermckenzie.com/poland-reopens-its-border-with-belarus/)). EU-registered trucks resumed crossing by March 2026 ([cargoclub](https://cargoclub-initial.newsite.by/tr/news/the-ban-on-the-import-of-certain-goods-across-the-belarusian-lithuanian-border-has-been-extended.html)).
- **Lithuania:** Medininkai and Šalčininkai were closed in Oct–Nov 2025 over the balloons and reopened around 19 Nov 2025 ([lrv.lt](https://lrv.lt/en/news/the-salcininkai-and-medininkai-border-checkpoints-with-belarus-are-being-closed-for-one-month-0wPG), [Euronews](https://www.euronews.com/2025/11/19/lithuania-reopens-border-crossings-with-belarus-after-tensions-over-smuggling-balloons)).
- **Mid-2026:** queue data shows Koroszczyn/Kukuryki and Bobrowniki active, but these are snapshots, not statements of official status ([nakordoni.eu](https://nakordoni.eu/md/en/stat/2/7)).
- I found **no official 2026 notice**. Kukuryki–Козловичи stays the default (freight, EU plates), but it is `conf: low`.
- These closures give the "border closed" event a real base rate: about 1–2 multi-week closures a year across 2021–2025. So 3 % × 7 d is defensible; 4 % with a median of 9 d and σ 0.5 also fits.

**[CORRECTION] Resolution 599 exemption.** Several secondary sources agree it exempts mail and say it continues Resolution 247/2022 ([trans.info](https://trans.info/en/belarus-eu-truck-ban-435424), [Revera](https://belarus.revera.legal/?p=5033)). It was amended by No. 621 (10 Nov 2025) and No. 646 (20 Nov 2025), whose contents I could not read. The spec should name those amendments as the open point. Also note that 599 is Belarus banning EU trucks; it says nothing about who actually carries the mail. Poczta Polska handing over at Brest and Belpost's own truck are both unverified.

**[CORRECTION] Turkish Airlines.** BelTA confirms that Istanbul–Minsk resumed on 21 Sep 2026 at 6–7 flights a week ([BelTA](https://belta.by/society/view/aviakompanija-turkish-airlines-vozobnovila-polety-po-marshrutu-stambul-minsk-802002-2026/)). The article does not explain the earlier suspension, so the spec should not describe one. Keeping the air variant at p=0 is correct.

**[CORRECTION] Calibration reasoning is wrong.**
- Postcrossing travel times are computed only from cards that were *registered*. Cards that expired are not in the averages, so "tails include lost cards" does not justify going optimistic.
- The evidence for the route:
  - French senders to Belarus in 2024: averages of 42 and 55 days, plus one report of over 60 ([forum](https://community.postcrossing.com/t/closed-delai-des-cartes-postales-pour/851682)).
  - About 28 days average US→BY ([community](https://community.postcrossing.com/t/are-your-postcards-reaching-russia-belarus-and-ukraine/35845?page=31)).
  - The global 2025 Postcrossing median is 20.2 days and the mean 30.2 ([stats](https://www.postcrossing.com/blog/2026/01/12/postcrossing-in-numbers-2025-stats)).
- A real-world median is roughly 25–35 days. A p50 of 18 days is a **product choice** and should be documented as one.
- Suggested profile: `scale` defaults to 1.0 and is labelled "romantic". Add a `realistic` profile at about 1.6 (p50 ≈ 29 d).

**[CORRECTION] The example window does not match the calibration.** Posting on 27 Oct with p05 = 13 d and p95 = 27 d gives **9–23 Nov**, not 9–19 Nov.

**[CORRECTION] Distance.** Roissy → Warszawa by A2/E30 is about 1,550–1,650 km. Roissy → Minsk is about 2,150 km, and Lille → Minsk directly about 2,000 km. Make hub 3's "~1,900 km" and the a11y string «из 1 900 км» computed from the polyline, not hardcoded.

**[CORRECTION] UPU codes.**
- Verified from UPU material: EMA, EMB, EMC, EMI; EXA–EXD (export customs and hold at the outward office of exchange); EDD/EDE (in/out of a sorting centre); EMH (delivery failed) ([UPU FR note](https://www.upu.int/getmedia/22ae87b3-e622-47e0-87ff-7b5b384ceb29/complianceWithUpuStandardsExplanatoryNotesEMSEVTrepeatedEventsFr.pdf), [EMSEVT V3](https://www.ems.post/sites/default/files/content-block-files/EMSEVT%20V3%20part%202.pdf)).
- Not verified by my searches (I know them from memory): EMD, EDB/EDC as import customs, and EMF/EMG.
- EXD means held at the *outward* office (France), so it is wrong for a PL–BY border hold. Give the border event `code = null` (app-invented) or the internal `XBH`, and never display a UPU code for it.
- EDD on the French PIC row is acceptable; La Poste's domestic scans are not UPU events anyway.

**[CORRECTION] PRNG edge case.** `('x'||h)::bit(32)::bigint` can be 0, which sends Box–Muller to `ln 0`. Use `(n + 0.5) / 2^32`. Box–Muller also needs two independent uniforms, so use keys `k·2` and `k·2+1`. The TS twin must apply the same `+0.5`.

### Engine and data

**[SIMPLIFY] Drop the 128-draw Monte Carlo and the 16 rejection attempts.** They are complex in plpgsql and they distort the distribution. Rejection inside [p05, p95] throws away most border closures, the one event you most want to show.
- Instead, draw the itinerary once. Then derive the window *around* EMI: `lo = EMI − (2…5 d)` and `hi = EMI + (3…8 d)` from seeded uniforms, both day-rounded and clamped to `≥ posted + 6 d`.
- The promise "never later than shown" becomes true by construction.
- A border closure widens `hi` only once it is revealed. Narrowing still holds if `hi` is snapshotted at reveal time.

**[SIMPLIFY] Drop the TS PRNG twin in v1.** The client never generates itineraries. For the lab screen, add a dev-only `preview_itinerary(seed, posted_at, tier)` RPC that returns rows without inserting. That removes the parity test.

**[SIMPLIFY] Generic fallback template.** Defer it. Only FR-BY is seeded, and an unknown pair can raise until another pair exists.

**[MISSING] Merge or justify hubs 3–4.** Hubs 3 and 4 each add 60 h, which is about 5 days of "silent Germany/Poland" stacked. Merge them into one silent leg of about 90 h with σ 0.6. If the second dwell is meant to represent an intermediary exchange at Poczta Polska Warszawa, say so.

**[MISSING] Time zones and DST.**
- Store `place.tz` and evaluate every departure rule with `at time zone`.
- France left DST on 25 Oct 2026, so FR is UTC+1 and Minsk UTC+3 (no DST). The example «14:32 по Минску · у тебя 12:32» is correct in winter only.
- `eta_lo` and `eta_hi` must be dates in the **recipient's** zone. Document this.

**[MISSING] Time-warp guards.**
- EMA and EMI must never be dropped by the 20-minute rule.
- Clamp so EMA ≥ `collect_at`.
- Test the case where `deliver − collect` is shorter than 3 × 20 min.

**[MISSING] Realtime prerequisites.** `tracking_events` must be in the `supabase_realtime` publication. Note that Realtime checks RLS on UPDATE, which is fine at couple scale.

**[MISSING] Enum vs check constraint.** Confirm that `tier` really is a PG enum before writing `alter type`. If it is a check constraint, the 004 file must alter the constraint instead.

### Realism boosts

**[REALISM-BOOST] Make it a «Lettre recommandée internationale».** Plain lettres get zero scans in reality. Recommandée tracking is provided «jusqu'à la frontière et/ou de bout en bout suivant les destinations» ([La Poste CSV](https://www.laposte.fr/entreprise-collectivites/sites/default/files/2025-01/CSV%20Lettre%20recommand%C3%A9e%20-%20clients%20Entreprises%20et%20collectivit%C3%A9s%20-%201er%20janvier%202025%20VV%20%281%29.pdf)). That explains the real pattern exactly: French scans, then silence, then Minsk.
- Show an S10 number «RR 123 456 785 FR» with a valid check digit (weights 8 6 4 2 3 5 9 7).
- Show a red «R» label on the envelope.
- The gap copy then becomes «после границы отслеживание часто молчит» / «le suivi s'arrête souvent à la frontière». This is truer than «без трек-номера», which contradicts showing scans at all.

**[REALISM-BOOST]** Add the real customs-point wording «ПТО «Минская почта»» for the 4 % customs branch.

**[REALISM-BOOST]** Use Christmas load (×1.4) plus the Sept-2025-style Zapad closure as seeded "world events" in a `route_incidents(from, to, extra_h)` table. This avoids a per-letter coin flip, and both letters of the couple feel the same closure.

### Packages and APIs (checked against `node_modules`)

- `world-atlas` 2.0.2, `topojson-client` 3.1.0, `topojson-simplify` 3.0.3 and `d3-geo` 3.1.1 are all the latest versions on npm. They are ESM, so keep them build-time only, as planned.
- The project pins `@shopify/react-native-skia` 2.14.0. These APIs exist with the expected signatures:
  - `Skia.ContourMeasureIter(path, forceClosed, resScale)`
  - `MakeFromSVGString`
  - `PathBuilder`
  - `PathEffect.MakeDiscrete(seg, dev, seed)`, `MakeDash`, `MakePath1D(path, advance, phase, style)`
  - `createPicture(cb, rect)` and `drawAsImageFromPicture(picture, size)`
- **[CORRECTION]** Trimming is `Skia.Path.Trim(path, s, e, complement)` (a factory, because paths are immutable), or the `<Path start end>` props. There is no `path.trim()`. Driving `end` via `useDerivedValue` is correct.
- GH ~3.3.0: `usePinchGesture`, `usePanGesture` and `useSimultaneousGestures` exist, and `changeX`, `scaleChange` and `focalX` are present in the types.

### Recommended first-build scope (one session)

**Now**
- Migrations 004/005: `postal` tier, `postal_calendar` (FR + BY 2026–27), `route_hubs` (main FR-BY only, with the corrected hub-6 hours), `tracking_events`, RLS, reveal-stamp in the existing cron, Realtime publication.
- Single-draw `generate_itinerary` plus the window around EMI (no Monte Carlo); the PRNG with the `+0.5` fix.
- Time-warp for `standard`/`express`.
- `preview_itinerary` dev RPC.
- PGlite tests:
  - determinism, ordering, EMA/EMI exactly once;
  - EMI = `deliver_at` and inside the window;
  - calendars;
  - RLS;
  - time-warp edge cases;
  - distribution over 300 seeds.
- `TrackingTimeline` as the primary view: official line, handwritten note, dual time zones, gap copy, recommandée number.
- Static `TrackingMap`: baked SkPicture of land, coast, borders and labels, route polyline, `<Path end>` replay, envelope parked via a ContourMeasure lookup table, mini postmarks. Fit-to-route, **no gestures yet**.
- Lab screen (fake clock, seed, tier). QA frames 1, 2, 4, 5 and 8.

**Later**
- Pinch/pan camera and web LOD re-rasterisation; zoom 5×.
- Air variant, Lithuania and Bobrowniki variants, `route_incidents`.
- The "realistic" scale profile, the generic city-pair template, other routes.
- Push notifications (border crossed, left France), Belarusian strings, Reduce Motion polish, the full 10 QA frames, `paper-realism` and `postal-rules` skill updates beyond the invariants.

Open uncertainties to keep in the docs: the La Poste → Belpost carrier and route are unknown; the contents of Res. 599's amendments are unknown; there is no 2026 official status for Kukuryki; the codes for MINSK PI 2 conflict between aggregators; EMD/EMF/EMG/EDB/EDC are not verified from UPU text in this pass.