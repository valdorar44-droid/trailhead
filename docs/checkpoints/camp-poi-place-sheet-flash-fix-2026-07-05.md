# Camp POI place-sheet flash fix — 2026-07-05

## Problem

Tapping a Mapbox basemap's built-in POI icon for a camp/RV/dispersed/wild
site (Standard and Outdoors styles, both native and web) would briefly show
the generic **place sheet** before flashing to the correct **camp sheet**.

## Root cause

`openPoiFeature()` in `mobile/app/(tabs)/map.tsx` always called
`setSelectedPlace(nextPlace)` synchronously for any tapped POI that wasn't
already typed `trail`/`trailhead` — including basemap-rendered camp icons
(`mapWebMapboxFeatureToPlace` on web / `mapboxPlaceType` on native already
classify these as `type: 'camp'`).

Separately, a `useEffect` keyed on `selectedPlace` (~line 7360) calls
`api.resolveMapCard(...)` to enrich the card. When the response resolves
(network round trip), `mergeResolvedCard` checks:

```ts
const shouldOpenCampCard = !selectedPlaceIsExplore
  && (!!resolved.camp || !!resolved.camp_detail || isOvernightPlaceLike(selectedPlace) || isOvernightPlaceLike(resolvedCard));
```

If true, it builds a `CampsitePin` and swaps `setSelectedCamp(camp)` +
`setSelectedPlace(null)` — which is the visible "flash" the user reported.
Since `isOvernightPlaceLike(selectedPlace)` was already knowable
**synchronously** at tap time (the POI's `type` is already `'camp'`), the
network round trip before swapping sheets was pure unnecessary flicker.

## Fix

`mobile/app/(tabs)/map.tsx` — `openPoiFeature()`: added a new branch,
mirroring the existing trail/trailhead branch, that runs *before* any place
sheet is ever shown:

```ts
if (isOvernightPlaceLike(poi)) {
  const camp = smartPlaceToCampPin(poi);
  if (camp) {
    // reset the other sheet/selection state, then open the camp sheet
    // directly (mirrors the standard onCampTap reset pattern) and return.
    setSelectedCamp(camp);
    ...
    return;
  }
}
```

`smartPlaceToCampPin` (already existed) builds a best-effort `CampsitePin`
straight from the raw `OsmPoi`, so no network call is needed before opening
the correct sheet. The existing `useEffect` on `selectedCamp` still fires
`loadCampDetailForCamp` to progressively enrich the card (photos,
description, amenities, fullness, weather) — same pattern the app already
uses for camps tapped from custom markers.

Since `selectedPlace` is never set for these POIs anymore, the
`resolveMapCard` effect never runs for them either — no redundant request,
no flash.

This fix lives in the shared `openPoiFeature` function used by **both**
native (`onPoiTap` fed by `bestMapboxPoiFromFeatures`) and web (`onPoiTap`
fed by `bestWebMapboxPlaceFromFeatures`), so it applies uniformly across
platforms and map styles.

## Secondary copy fix

`mobile/components/NativeMap/index.web.tsx` — `mapWebMapboxFeatureToPlace()`
had a hardcoded `summary: 'Selected place from the map.'` for every
basemap-rendered feature. This filler text was leaking into camp card
descriptions (via `smartPlaceToCampPin`'s `place.summary` fallback chain).
Removed it, matching the native equivalent's convention of leaving
`summary` `undefined` for rendered-mapbox features so downstream fallbacks
("Camp option near this area.", etc.) kick in instead.

## Validation

- `npx tsc --noEmit` — clean.
- Playwright (web dev server, `http://127.0.0.1:8082/map`):
  - Patched `map.queryRenderedFeatures` to return a synthetic
    `maki: 'campsite'` point feature, then clicked the map canvas (the same
    code path a real Mapbox Standard/Outdoors campsite icon tap takes).
    Result: camp sheet (weather chips, site types, coordinates, camp guide,
    nearby camps) opened **immediately** — no place-sheet frame ever
    rendered first.
  - Repeated with a synthetic `maki: 'museum'` / `category: 'attraction'`
    feature to confirm non-camp POIs are unaffected — regular place sheet
    ("Attraction" type, nearby things to do/trails) opens as before.
  - Confirmed camp card description now reads "Camp option near this
    area." instead of "Selected place from the map."

## Files changed

- `mobile/app/(tabs)/map.tsx`
- `mobile/components/NativeMap/index.web.tsx`
