# Great Smoky Mountains Original — Operational Readiness V1

Reviewed: 2026-08-04

Candidate: `smokies-operational-readiness-2026-v1`

Candidate SHA-256: `17b9eea045ac2369e7679f5fbec3291cca46374b004165f15087ceb4bded7a21`

Artifact: `docs/originals/smokies-operational-readiness-v1.json`

## Purpose

The Great Smoky Mountains Original must not freeze road closures, seasonal access, vehicle rules, or fees into narration. The checked-in candidate records the official sources and deterministic rules. A trusted backend source reader supplies a fresh observation when the user starts a chapter.

No chapter becomes available from a missing or stale observation. The result is `check_required`, not an inferred pass. An open-road result means only that the current NPS check did not list a closure for the required roads; it is not a claim that travel is safe or guaranteed.

## Official source review

| Source | Official facts bound to the candidate | Source page updated | Reviewed |
|---|---|---:|---:|
| [Current cautions and closures](https://www.nps.gov/grsm/planyourvisit/temproadclose.htm) | Current road/facility closure boundary used by the live Start Tour check. The July 31 page lists a temporary Carlos Campbell Overlook closure, not a Newfound Gap Road closure. Absence from the page is not persisted as an evergreen open state. | 2026-07-31 | 2026-08-04 |
| [Seasonal road schedule](https://www.nps.gov/grsm/planyourvisit/seasonalroads.htm) | Newfound Gap, Little River, and Cades Cove are primary roads open year-round weather permitting. Kuwohi Road is scheduled April 1–November 29, 2026. Roaring Fork is scheduled April 17–November 29, 2026 and is one-way. Both remain subject to unplanned closure. | 2026-04-20 | 2026-08-04 |
| [Cades Cove vehicle-free days](https://www.nps.gov/grsm/planyourvisit/cades-cove-vehicle-free-days.htm) | Cades Cove Loop Road is motor-vehicle-free all day Wednesdays from May 6 through September 30, 2026. NPS names Foothills Parkway, Little River Road, and Roaring Fork as alternatives. | 2026-02-09 | 2026-08-04 |
| [Roaring Fork Motor Nature Trail](https://www.nps.gov/grsm/planyourvisit/roaringfork.htm) | The road is one-way and seasonal. Buses, trailers, and motor homes are not permitted. The page names Foothills Parkway segments and Lakeview Drive as alternative scenic drives. | 2025-09-26 | 2026-08-04 |
| [Fees and passes](https://www.nps.gov/grsm/planyourvisit/fees.htm) | A parking tag is required when a vehicle is parked longer than 15 minutes. Current prices are $5 daily, $15 weekly, and $40 annual. A parking tag is not an entrance fee and does not guarantee a parking space. | 2026-07-07 | 2026-08-04 |
| [Superintendent's Compendium](https://www.nps.gov/grsm/learn/management/compendium.htm) | Cades Cove closes to motor vehicles at official sunset and on seasonal Wednesdays. Roaring Fork prohibits motor homes, buses, vans longer than 25 feet, and passenger vehicles towing a trailer. Commercial cargo/service use is restricted; ordinary passenger transportation has separate rules. | 2026-06-06 | 2026-08-04 |
| [Auto touring](https://www.nps.gov/grsm/planyourvisit/autotouring.htm) | NPS identifies Foothills Parkway, Cades Cove, Roaring Fork, Kuwohi/Newfound Gap, and Lakeview Drive as distinct scenic drives. | 2025-10-30 | 2026-08-04 |
| [Traffic and travel tips](https://www.nps.gov/grsm/planyourvisit/trafficandtraveltips.htm) | Large-vehicle restrictions and an NPS-backed Look Rock alternative for iconic views. Parking predictions are not treated as availability. | 2026-05-21 | 2026-08-04 |

## Chapter gates

### Mountain Crossing

- Required current road states: Newfound Gap Road and Kuwohi Road.
- Kuwohi's published 2026 motor-vehicle season is April 1 through November 29.
- If either required road is closed, the chapter is unavailable. A missing, stale, unknown, or restricted state requires another check.
- Alternate chapter references: Little River and Cades Cove, and Foothills Parkway. Each alternate must still pass its own readiness check.

### Little River and Cades Cove

- Required current road states: Little River Road and Cades Cove Loop Road.
- The driving chapter is unavailable on the published 2026 vehicle-free Wednesdays.
- The live road gate must represent daily gate status because Cades Cove closes to motor vehicles at official sunset. Trailhead does not calculate or invent an opening time.
- Alternate chapter references: Roaring Fork and Foothills Parkway. NPS also names Little River Road, which is already part of this chapter.

### Roaring Fork

- Required current road state: Roaring Fork Motor Nature Trail.
- Published 2026 motor-vehicle season: April 17 through November 29.
- Buses, motor homes, vans over 25 feet, and vehicles towing trailers are blocked.
- Alternate chapter reference: Foothills Parkway.

### Foothills Parkway

- Required current road state: the selected Foothills Parkway West segment.
- No evergreen availability is inferred. Weather or temporary closures still require a fresh official observation.
- No fallback chapter is claimed by the current source set. The UI may offer the chapter selector, but it must not label another route available until that route passes its own check.

## Runtime boundary

`db/originals_operational.py` provides four pure operations:

1. Strictly validate and hash the official-source candidate.
2. Project a chapter's sources and scopes into the existing `OriginalManifestV2` `operational_sources` and `operational_readiness` fields.
3. Evaluate a fresh, candidate-bound road observation for a selected chapter.
4. Resolve the exact candidate only from the backend's checked-in registry and reject a missing, replaced, mismatched, or expired publication candidate.

Every V2 chapter carries that candidate ID and SHA-256. The same binding is part of the authoritative route-validation input and immutable publication metadata. Immediately before Start Tour, the mobile app calls the server-owned readiness endpoint; a non-`available` result stops before location tracking or playback begins.

The source reader is intentionally separate. It must run server-side, bind its observation to the candidate ID, canonical candidate SHA-256, and official current-conditions source, and return explicit states for every required road. It may not treat a successful HTTP response, an empty alert list, or old cached HTML as proof that a road is open.

For V1 publication compatibility, each chapter also projects the canonical provenance scopes `route`, `access`, `fees`, `closures`, `surface`, `season`, and `safety`. These are not invented aliases: route identity comes from the NPS Auto Touring and chapter pages, access/season from the seasonal schedule and compendium, fees from the NPS fee page, closures/safety from current cautions and traffic guidance, and surface context from the NPS Auto Touring description. The authoritative route-network validator still owns segment-level surface evidence; the broad NPS statement that most park roads are paved is not converted into an exact per-segment claim.

The checked-in review expires after no more than 31 days. A new review must update official facts and the candidate hash; it must not silently extend the expiry date.

## Known limitations before internal preview

- The current candidate does not implement the server-side NPS page/feed reader. Until that source reader emits a fresh complete observation, every Start Tour gate returns `check_required`.
- The NPS current-conditions page does not provide a stable machine-readable open/closed record for every required road. A source reader needs explicit parsing plus a fail-closed fallback; an empty page is not an open-road result.
- The Cades Cove daily sunrise/sunset gate must come from a current official gate state or another reviewed official source. Trailhead will not approximate it from a generic daylight calculation.
- Every alternate is a suggestion only. It must pass its own current road, season, and vehicle checks.
- This packet includes no route geometry, scripts, cultural interpretation, narration, TTS, deployment, OTA, or public release.
