# Seeded Audio Guides Explore Tab

## Summary
Build `Guide -> Explore` as a pre-populated premium discovery surface, not an empty live-search tab. On first open, users see a ready-made US Top 100 Explore catalog with photos, brief descriptions, and generated Trailhead-style profiles. Selecting a card opens instantly with no AI wait because the profiles are generated ahead of time.

## Core Product Behavior
- Add `EXPLORE` inside Audio Guides alongside `NARRATIONS` and `WEATHER`.
- Default view shows featured places from a seeded catalog: national monuments, parks, scenic landmarks, historic sites, museums, ghost towns, ruins, viewpoints, culturally significant public places, and road-trip-worthy stops.
- Cards include photo, place name, category, state/region, hook, and `Play`, `Read`, `Navigate`.
- Profiles include hero photo, custom Trailhead profile sections, Wikipedia attribution, audio script playback, `Navigate Here`, and cache state.

## Seed Catalog Architecture
- Store a repo/R2 Explore catalog using a pack-like JSON shape that can later become downloadable Explore packs.
- Add a build script that takes curated Wikipedia titles, fetches summaries/images/coordinates, generates or templates Trailhead profile sections, and writes `explore_catalog_v1.json`.
- Mobile fetches the catalog from the backend and caches it locally. If the network fails, it shows the last cached catalog.
- Future downloadable place packs should reuse the same `ExplorePlaceSummary` and `ExplorePlaceProfile` shape.

## Backend/API
- `GET /api/explore/catalog` returns the current featured catalog with no request-time AI.
- `GET /api/explore/places?lat=&lng=&mode=featured|nearby|trip` ranks the same catalog by featured order or distance.
- Viewing seeded Explore profiles is free. Future live/custom profile generation may cost credits if a place is not in the seed catalog.

## Mobile Implementation
- Add Explore tab UI in `guide.tsx`.
- Add modes: `Featured`, `Near Me`, `Trip`.
- `Featured` uses seeded rank order.
- `Near Me` uses GPS distance against the seeded catalog.
- `Trip` ranks by active trip waypoint proximity and shows nearest day.
- `Navigate Here` hands off to the Map tab through existing destination navigation.
- Audio uses `playTrailheadVoice(text, 'guide')`.

## Future Offline Packs
- V1 caches viewed catalog/profile data locally.
- Later: downloadable Explore packs by state, route corridor, or trip area, including profiles and optional pregenerated audio.
