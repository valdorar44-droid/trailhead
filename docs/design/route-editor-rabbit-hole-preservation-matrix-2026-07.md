# Route Editor Rabbit-Hole Preservation Matrix

**Status:** Figma review packet complete; awaiting design review before implementation  
**Design packet:** `19 · Route Editor Rabbit Hole — Review 01`  
**Rule:** improve hierarchy and behavior without removing a working feature. Any uncertain branch is documented for review instead of silently deleted.

## Review artifacts

- Figma section: `551:1037` in file `FJUcMWAfsNyjsguCEp2dBe`.
- Full prototype starts: `552:1038`, `552:1408`, `552:1490`, `553:1608`, and `555:1189`.
- Shared components: Route Day Summary Card `551:1069`, Route Action Row `551:1082`, Route Readiness Row `551:1098`.
- Android evidence: `C:\Users\User\Documents\Codex\2026-07-15\awesome-github-plugin-github-openai-curated\android-audit-route-offline\ROUTE_EDITOR_RABBIT_HOLE.md`.
- Review export: `C:\Users\User\Documents\Codex\2026-07-15\awesome-github-plugin-github-openai-curated\trailhead-route-editor-rabbit-hole-packet-19.png`.

## Figma screen families

| Screens | Family |
|---|---|
| 01–05 | Actual Trip Planner entry, trip actions/share, main-map overview, route alerts/layers, opening state |
| 06–10 | All-days and selected-day editor, Co-Pilot handoff, day states, route/day options |
| 11–15 | Dates, day reorder, waypoint actions, stop movement, scoped instant search |
| 16–20 | Route insertion preview, camp/fuel/place/tour results, Start Day readiness/proximity gate |
| 21–25 | Camp quick profile, photos/loading, site/rig facts, community/edit/report, atomic replacement |
| 26–30 | NPS-style place detail, Viator results/handoff/return, contextual rentals |
| 31–35 | Factual readiness, verified offline bundle, route actions, rename, dirty exit |
| 36–40 | Draft warning, route-line recovery, build progress/failure, confirmed navigation end |

Validation frames cover 320×568, Android 412×915 with 48 dp actions, 390×844 large text, and a dark active-navigation state.

## Product boundaries

- `Trip Planner` owns trip organization and saved plans.
- `Route Editor` owns the detailed multi-day route, days, stops, route shape, overnight stays, and route readiness.
- `Trace a Trail` owns manual trail drawing.
- Trailhead uses the main map renderer and retains the compact navigation compass.
- Co-Pilot remains `Co-Pilot voice assistant · Explorer`; no AI badge or provider wording.
- Viator remains visibly separate, labelled, and externally fulfilled.
- Campground depth remains available: site types, rig fit, access, weather, photos, comments, Trailhead ratings, reports, and edit/contribution paths.

## Entry and library branches

| Origin | Control | Destination / outcome | Required states | Preserve / improve |
|---|---|---|---|---|
| Route Editor hub | Build New Route | Route setup | ready, active-route conflict | One clear primary action; do not replace setup choices |
| Route Editor hub | Open active route | Existing editor state | opening, failure, resume | Resume exact day, scroll, map camera, and unsaved state |
| Route Editor hub | Add/Edit vehicle details | Profile vehicle/rig editor | complete, incomplete, return | Preserve safer fuel and fit inputs; return to the same route |
| Recent route | Open | Saved route workspace | opening, stale/missing, error | Use compact library rows rather than promotional cards |
| Saved trail | Open | Trail route workspace | opening, incompatibility, error | Keep trail identity and saved geometry |
| Saved trail | Remove | Confirmation then removal | confirm, deleting, failure, undo/receipt | Destructive action never shares the primary tap target |
| Active route conflict | Save & Close | Save, close, then setup | saving, failure | No silent discard |
| Active route conflict | Discard & Close | Confirmed discard, then setup | confirm, discarding | Explicit destructive wording |
| Active route conflict | Cancel | Hub | — | No state change |

## Workspace overview branches

| Region | Control | Destination / outcome | Required states | Preserve / improve |
|---|---|---|---|---|
| Workspace header | Route title | Rename sheet | keyboard, validation, saving, error | Keep title editable without leaving the workspace |
| Workspace header | Overflow | Route actions sheet | unsaved, saved, offline | Save, new route, flyover, map, rename, discard all remain reachable |
| Day strip | All days | Full route + collapsed day summaries | long trip, warnings, offline | Default overview; map/list stay synchronized |
| Day strip | Day N | Filter list and emphasize that day's route | selected, rest day, needs overnight | Presentation filter only; renderer and route state do not change |
| Day strip | Jump to day | Calendar/list selector | long trip, dates absent | Avoid an endlessly scrolling horizontal strip |
| Day overflow | Edit/reorder days | Dedicated day edit mode | drag, keyboard/TalkBack reorder, failure | Normal scrolling list is not permanently draggable |
| Day overflow | Change dates | Date range + impact summary | validation, changed, failure, undo | Preserve stop order and show `Dates changed · Undo` |
| Day overflow | Insert/delete day | Confirmed timeline mutation | recalculating, failure, undo | Explain where stops move before deleting a populated day |
| Scout review | Review details | Route-fit findings | loading, ready, unavailable | Short factual copy; dismiss remains available |
| Scout review | Dismiss | Remove banner | — | Do not reappear repeatedly after dismissal |
| Timeline toolbar | Add day | Append a day | calculating, success, failure | Preserve current active day and show the inserted day |
| Timeline toolbar | Route shape | Shape selection sheet | one way, loop, there & back, recomputing, failure | Replace blind cycling with explicit choices |
| Day card | Select day | Active-day workspace | selected, rest day, needs overnight, warning | Selected state uses neutral/orange, not green |
| Day card | Choose overnight | Camp discovery scoped to day | loading, results, empty, error | Preserve campground data depth and return context |
| Day card | Camp | Camp discovery | loading, results, empty, error | Day-scoped insertion |
| Day card | Fuel | Fuel discovery | loading, results, empty, error | Day/leg-scoped insertion |
| Day card | Places | Place discovery | instant suggestions, results, empty, error | Shared Search V2 behavior |
| Day card | Side trips | Route-relevant discovery | loading, results, empty, error | Explain detour cost through data, not filler copy |
| Day card | Tours | Viator sheet | searching, results, external booking, return | Keep labelled external fulfillment |

## Active-day and stop branches

| Origin | Control | Destination / outcome | Required states | Preserve / improve |
|---|---|---|---|---|
| Day controls | Rest day | Toggle rest-day state | confirm if stops exist, recalculating, failure | Avoid accidental loss of stops |
| Day controls | Max hours | Inline numeric editor | keyboard, validation, recalculating, failure | Keyboard must not shift the whole workspace |
| Stop row | Select stop | Stable place/camp sheet | loading modules, offline, error | Same shell throughout; async data cannot swap entities |
| Stop row | Photo | Camp photo/gallery | missing photos, gallery, attribution | Add photos while keeping source/license details |
| Stop row | Replace camp | Camp results in replacement mode | loading, results, empty, cancel, success | Original camp remains until replacement succeeds |
| Stop row | Overflow | Context-specific waypoint menu | default, camp, start, destination, overnight | Avoid one universal menu full of invalid actions |
| Stop overflow | Move to day | Day selector + drive delta | preview, recalculating, failure, undo | Show destination day and changed drive time before commit |
| Stop overflow | Add stop after | Scoped add-stop chooser | loading, cancel | Preserve exact insertion point |
| Stop overflow | Edit notes & timing | Waypoint editor | keyboard, validation, saving, failure | Arrival, duration, reservation/budget, notes, routed toggle |
| Stop overflow | Keep in plan, don't route | Unrouted plan item | recalculating, failure, undo | Retain the item without distorting navigable geometry |
| Stop row | Move up/down | Reorder | disabled boundary, recalculating, failure, undo | Prefer drag/reorder plus accessible buttons; never silently fail |
| Stop row | Remove | Confirmation / removal | confirm, recalculating, failure, undo | Destructive action moves to overflow or guarded action |
| Between-stop leg | Fuel | Scoped fuel insertion | loading, results, empty, error | Keep insertion target visible |
| Between-stop leg | Camp | Scoped camp insertion | loading, results, empty, error | Keep insertion target visible |
| Between-stop leg | Place | Scoped place insertion | suggestions, results, empty, error | Shared search controller |
| Between-stop leg | Tour | Viator discovery | searching, results, booked-return, stale trip | External booking remains separate |

## Search, details, and commercial branches

| Origin | Control | Destination / outcome | Required states | Preserve / improve |
|---|---|---|---|---|
| Search | Type chip | Change insertion category | selected, disabled | Camp, fuel, place, side-trip intent remains explicit |
| Search | Query field | Instant suggestions | keyboard, cached, slow, offline, no result | Never auto-select an asynchronous result |
| Search | Add/result | Insert or open detail | resolving, duplicate, failure | Result row names intent and match reason; no raw coordinates |
| Camp result | Card | Campground detail sheet | loading modules, offline, error | Site types, rig fit, weather, photos, comments, ratings, reports, edit |
| Camp result | Use/Replace | Commit camp | saving, recalculating, failure | Button reflects insert vs. replace |
| Camp replacement | Confirm | Atomic old/new route swap | old/new comparison, carried data, reservation warning, failure, undo | Carry night/vehicle preferences; never copy payment, site assignment, confirmation, comments, reports, or reservation number |
| Place detail | Save side stop | Add without rerouting main line | saving, duplicate, failure | Preserve day context |
| Place detail | Route through | Add as routed stop | recalculating, failure | Preview route impact before committing when material |
| Viator offer | Browse/View | External Viator page | handoff, return, unavailable | `Viator` label and external-booking disclosure stay visible |
| Viator return | I booked it | Add booked tour to trip | exact location, approximate location, stale trip, failure | Do not imply Trailhead completed the booking |
| Viator return | I didn’t book it / Skip | Close | — | No route mutation |
| Rental idea | View rentals | External provider | handoff, return, unavailable | Contextual, provider-neutral module; no invented availability |
| Rental idea | Save idea | Saved trip idea | saving, duplicate, failure | Preserve if backend contract is real |
| Rental idea | Dismiss | Hide module | — | Do not repeatedly interrupt the route |

## Readiness, map, flyover, and exit branches

| Origin | Control | Destination / outcome | Required states | Preserve / improve |
|---|---|---|---|---|
| Readiness | Each check | Exact fixing surface | ready, needs attention, unavailable | No vague assurance; show source/time where trust matters |
| Overview | Reorder for less driving | Deterministic before/after preview | calculating, apply, keep current, revert | Show exact time/distance delta; no smart/AI wording |
| Readiness | Offline | Plan → Downloads / scoped bundle | estimate, queued, downloading, verifying, ready, partial, repair, error | Active map style, route, places, trails, offline search, hashes |
| Footer | Map | Save if needed, then main map | saving, failure, return | Preserve map camera and editor return state |
| Footer | Flyover | 3D route preview | preparing, playing, unavailable, return | Label as preview, not live navigation |
| Main-map overview | Start day | Readiness and proximity preflight | missing stay, far from route, permission, offline, ready | Never begin guidance immediately when the route is incomplete or the device is far away |
| Active guidance | End | End-navigation confirmation | confirm, keep navigating, end | Ending cannot silently leave a stale nearby-results mode active |
| Route actions | Save | Persist in place | saving, saved receipt, failure | Workspace stays open |
| Route actions | Save and start another | Save then new setup | saving, failure | Do not start new until save succeeds |
| Route actions | Rename route | Rename sheet | keyboard, validation, saving, error | One anchored keyboard strategy |
| Route actions | Discard changes | Confirmation then hub/map | confirm, discarding, error | Explicit destructive path |
| System/back | Exit with changes | Unsaved-changes sheet | save, keep editing, discard | No ambiguous close behavior |

## Review gates

- [x] Android crawl confirms every visible control and return path.
- [x] Source handler graph confirms every mutation, external handoff, and destructive action.
- [x] Pattern research supports the proposed hierarchy and recovery behavior.
- [x] Figma packet includes the truthful overview plus every branch above.
- [x] Loading, empty, offline, permission, keyboard, failure, and destructive states are not hidden in notes alone.
- [x] Small-screen and dynamic-type frames keep the compass, primary action, and selected-day context visible.
- [x] Copy scan finds no AI badge, provider slug, raw enum, invented certainty, or unnecessary explanatory paragraph.
- [x] Recalculation keeps the last valid route visible and never flashes stale pin numbers or the previous place sheet.
- [x] Share/export text contains no API hostname, dangling metrics, provider names, or internal identifiers.
- [x] Route alerts use honest source age; 14–140-day-old incidents are not labelled live.
- [x] Camp candidates de-duplicate and show the facts needed to choose: route delta, site type, rig fit, access, source freshness, and known limitations.
- [x] Co-Pilot results are structured selectable results rather than prose-only duplicate names; support transcript attachment remains available with consent.

Final automated Figma QA: 40 screens, 89 prototype transitions, exact 390×844 master sizes, no overlap or clipping, no missing fonts, no sub-44-point interactive targets, and zero prohibited-copy hits.
