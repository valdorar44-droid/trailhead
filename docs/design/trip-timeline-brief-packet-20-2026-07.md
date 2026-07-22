# Packet 20 — Trip Timeline, Brief, Backup, Packing, and Weather

Status: design review only. No application code or API contract was changed.

Figma:

- File: `FJUcMWAfsNyjsguCEp2dBe`
- Section: `20 · Trip Timeline + Brief, Backup, Packing + Weather — Review 01`
- Section node: `571:1242`
- Screens: 39
- Prototype coverage: 216 cross-screen transitions, 5 official-source links, and 28 documented in-place, OS, or out-of-packet actions.

## Product decision

`Route brief & bailout` remains one entry point. The customer-facing direction is `Brief & Backup`: one trip scan checks route facts, stops, stays, access/fees, weather, offline readiness, packing context, service information, and backup options.

Backup comparison is not a second top-level tool. It opens from the Trip Brief result, preserves the original day plan, requires confirmation, and offers Undo. Emergency help remains a separate branch and backup routes are never described as rescue guidance.

Packing, Weather, and Notes remain separate tools beside Brief & Backup.

## Current behavior represented honestly

- Active-trip day selection and vertical itinerary.
- Start Trip / Start Day.
- Choose or swap an overnight stay.
- Main map, Route Editor, and flyover entry points.
- Review-only Route Brief.
- Display-only trip packing categories.
- Camp high/low/wind forecast cards.
- Comments, ratings, reports, edits, photos, campground site/rig details, official place information, and Notes remain in scope.

Current limitations shown in the design:

- The existing brief does not build an alternate route.
- `exit_options_status` remains `Not checked`.
- A campground waypoint does not confirm access or availability.
- Trip packing has no item IDs, checks, progress, edit, or share contract.
- Route weather is not reliably tied to itinerary dates and the current cache has no fetched-at/TTL contract.

## Android Brief audit and evidence gate

The connected Samsung audit captured the useful legacy result before redesigning it. The screen presented a readiness score, trip concerns, preparation actions, fuel and water totals, three `SIGNAL DEAD ZONES`, a fire-restriction note, one `EMERGENCY BAILOUT`, and daily highlights.

The presentation is worth preserving, but the underlying claims are not yet route evidence:

- The three service warnings are place-based prose around Desert View, Monument Valley, and Sand Island. They are not start/end intervals matched to route geometry, carrier scope, or a reviewed coverage dataset.
- `US-160 or US-191 to the nearest town with services` has no current route point, named destination, geometry, distance, ETA, surface/access check, closure check, or source.
- The legacy readiness, water, service, fire, and bailout fields were model-generated from waypoint names and a small report sample. They must not be restored as verified facts.
- The current safety pass correctly removes unsupported output, but its conservative `Not checked` state needs the richer source-backed target designed here.

Packet 20 now separates three concepts:

1. `Low-service areas` opens route evidence. A source-backed state highlights exact saved-route intervals; place-only, unavailable, stale, changed-route, and offline states never draw an exact interval.
2. `Backup options` changes the planned trip only after comparison and confirmation.
3. `Exit reference` is a planning reference with a precise origin and named destination. It never auto-applies and never implies rescue or emergency dispatch.

Required server-owned evidence:

- `RouteServiceSegmentV1`: route revision, start/end progress, geometry reference, distance, coverage class, carrier scope, modeled/observed method, source, source date, review time, confidence, and offline revision.
- `ExitReferenceV1`: route revision, originating segment, named destination, road sequence, geometry, distance, estimated time, surface, vehicle/access constraints, closure state, sources, review time, and offline revision.

Any edit to the route, traveler/vehicle context, weather, alerts, coverage source, or source freshness invalidates affected results. A model may summarize trusted evidence objects, but it cannot create service intervals or exit routes. The distances and route highlights in the Figma target screens are illustrative design fixtures and are not approved production data.

## Timeline media rule

Timeline photos are optional context, not required layout. `Stop` and `Stay` events may use a compact 56 px thumbnail only when the server has an exact canonical-place or facility match with usable licensing and attribution. Start, drive, alert, day-total, and non-place events remain text-only.

Both `Media=None` and `Media=Photo` variants stay 72 px high. The rail, title position, touch target, and return position therefore do not change when media is missing, restricted, not downloaded, or fails to load. The fallback is the complete text row; never show an empty image slot, generic scenery, or a generated destination image.

The design fixtures use:

- Dead Horse Point overlook: `Dead Horse Point, Moab, Utah (29001985134).jpg`, Fabio Achilli, CC BY 2.0, exact overlook match. Source: https://commons.wikimedia.org/wiki/File:Dead_Horse_Point,_Moab,_Utah_(29001985134).jpg
- Willow Flat Campground: NPS / Chris Wonderly, exact Island in the Sky (Willow Flat) campground image. Source: https://home.nps.gov/cany/planyourvisit/camp-isky.htm

The app's current Dead Horse Point imagery is not eligible for this timeline: one record resolves to Moraine Lake and another to Yosemite. Those images must not be reused. A server-owned `TimelineEventMediaV1` should resolve one approved thumbnail with `media_id`, canonical `place_id`, source URL, credit, license, revision, dimensions, commercial/offline permissions, bytes, SHA-256, and offline-ready state. Clients must not choose among unrelated `photo_url`, `hero_photo_url`, or `images` fields.

## Proposed implementation targets

- Deterministic readiness checks with repair links and version invalidation.
- Source-backed backup geometry, delta comparison, apply, preserve-original, and Undo.
- Trip-specific packing item IDs, check state, custom items, rationale, and share/export.
- Itinerary-date-aware route weather with source, fetched time, offline freshness, official alerts, and affected-segment actions.
- Event/stop detail routes with origin-aware return state.
- Renderer-aware route bundles containing the active map style, route, places, trails, offline search, and licensed media.
- Server-selected timeline media with exact-place identity, attribution, license, revision, hashes, and deterministic text-only fallback.
- Route-revision-bound service intervals with carrier scope, source/date, modeled-versus-observed status, offline persistence, and explicit unavailable/stale states.
- Route-revision-bound exit references with a current origin, named destination, geometry, distance/time, road/access checks, sources, and a separate emergency-services handoff.

These screens are explicitly marked proposed in Figma and must not be treated as shipped behavior.

## Click path

1. Trip timeline
2. Brief & Backup scan
3. Brief result
4. Review missing items or open Backup options
5. Compare route
6. Confirm change
7. Updated timeline
8. Undo or Start Day

Parallel branches:

- Packing → category → add/edit item → saved progress → Brief or timeline
- Weather → day checkpoints → official alert → affected segment → adjust timing → timeline
- Stop/stay → official information or community actions → exact entity and timeline return
- Start Day → permission education only when permission is missing → main-map navigation

Additional prototype branches:

- Low-service areas -> route interval evidence -> source details or offline bundle.
- Exit reference -> exact route comparison -> main map; emergency-services handoff remains separate.

## Preservation requirements

- Keep the main Trailhead map renderer and compact compass.
- Keep Viator guided inventory; it remains separately labelled and externally fulfilled.
- Keep campground site types, camper/rig fit, amenities, weather, photos, comments, ratings, reports, and edits.
- Keep NPS-style hub depth: roads, fees, hours, weather, what to see, things to do, stays, and visitor services with source and review time.
- Keep Notes and the existing Profile → Trip Prep checklist. Do not silently merge Profile Trip Prep into trip packing.
- Keep community comments and add first-party ratings with `Be the first to rate this place.`
- Preserve context through comments, ratings, reports, and edits. Never open a composer for a different place.
- Permission education appears only when the user starts a feature that requires it.
- End Navigation fully stops navigation/background work; reopening the app must not auto-start it.

## Copy and safety rules

- No automation labels, internal identifiers, provider infrastructure, or robotic filler.
- No `safe`, `clear`, `guaranteed`, or go/no-go verdict based on incomplete data.
- `Ready to start` means required product checks completed for the saved version; it is followed by a reminder that conditions can change.
- Show source, updated/reviewed time, offline freshness, and `Not checked` when evidence is unavailable.
- Raw coordinates, traveled routes, personal search text, support content, and payout data remain excluded from analytics.

## Packet 19 corrections carried forward

- Replace duplicate `Day 2 · Canyonlands` cards with a continuous start → drive → stop → drive → stay → next-day spine.
- Correct the Day 1 preflight return.
- Remove raw Boolean prefixes and 10pt product kickers.
- Replace placeholder official-information copy.
- Replace generic campground/community destinations with current-entity destinations.
- Add missing Brief, backup, packing, weather, map, download, Start Day, End, and recovery branches.
- Preserve the exact selected day and scroll position on return.

## Verification

Final Figma audit:

- 39 top-level screens
- 0 product text labels below 12pt
- 0 missing fonts
- 0 clipped text
- 0 touch targets below 44pt
- 0 prohibited-copy findings
- 0 unresolved interactive controls
- 8 `Trip Timeline Event` variants, including fixed-height `Stop + Photo` and `Stay + Photo`
- 10 exact-place photo instances updated across overview, expanded-day, return, apply, and Undo states
- Android-informed Brief target with separate low-service evidence, backup planning, and exit-reference branches
- 216 prototype transitions after the service and exit-reference drill-downs

The reusable masters remain bound to Trailhead V2 semantic variables. Screens use warm white, near-black, and terrain orange with warning/critical colors reserved for their actual meanings.

## References

- Pangea itinerary: https://mobbin.com/flows/e0ac31b9-b908-47ef-9242-d489cab802f6
- Wanderlog itinerary: https://mobbin.com/flows/88a3eab3-6cca-496f-a3cb-bca2011df206
- Wanderlog route optimization: https://mobbin.com/flows/15696231-f5bd-4f85-91c9-af64fa116f81
- Waze alternate route: https://mobbin.com/screens/18861fde-d1bc-43a2-a98f-6c255f1bd6f4
- Komoot route detail and offline action: https://mobbin.com/screens/f95ad840-1c57-421f-8bdb-47a76692c209
- Waze alternate-route map: https://mobbin.com/screens/877badfa-539c-40bc-a28e-e58bc9a75ace
- KAYAK packing: https://mobbin.com/screens/ca310d37-570e-4228-a951-3a8932d5d58b
- AllTrails route weather: https://mobbin.com/screens/f2edfe2b-4ca2-4233-9ecf-3dbdf9fd8f58
- NPS Trip Planning Guide: https://www.nps.gov/subjects/healthandsafety/trip-planning-guide.htm
- NPS Ten Essentials: https://www.nps.gov/articles/10essentials.htm
- NPS Island in the Sky Campground: https://home.nps.gov/cany/planyourvisit/camp-isky.htm
- FCC mobile coverage map methodology: https://help.bdc.fcc.gov/hc/en-us/articles/13532984820379-What-s-on-the-National-Broadband-Map
- FCC mobile coverage data downloads: https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions
- NPS Canyonlands driving and limited-service guidance: https://www.nps.gov/cany/planyourvisit/driving.htm
- ADOT Kayenta-Monument Valley / US-163 scenic road reference: https://azdot.gov/sites/default/files/2019/05/cmp_kayenta_monument_valley.pdf
- Dead Horse Point photo and CC BY 2.0 license: https://commons.wikimedia.org/wiki/File:Dead_Horse_Point,_Moab,_Utah_(29001985134).jpg
