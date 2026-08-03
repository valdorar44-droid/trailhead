# Explore campground Map camera handoff — R1

## Baseline

- Recorded: 2026-08-02T20:42:14-05:00
- Branch: `fix/explore-camp-map-camera-handoff-r1-win`
- Exact source: `3ec05aebe23bc64bf1f321d6b08b274ff927c1ea`
- Android preview: build `69`, runtime `native-1.0.10-android.7`, update `019fc509-66b6-7747-9583-28c8e550eb0f`
- Internal Explore profiles: `13`; current child depth: `693`
- Main-workspace protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Main-workspace protected App Store copy SHA-256: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- `.cursor/`, `dashboard/explore_serving_index_v2.json`, and `docs/app-store-copy.md` are excluded from this packet.

## Deterministic reproduction

`Explore → Great Smoky Mountains → Stay → Abrams Creek Campground → Map`

- The canonical campground identity, exact NPS image, details, and campground Peek sheet are correct.
- The main Map remains at the cached Winnipeg browse viewport rather than framing Abrams Creek.
- Evidence: `C:\Users\User\AppData\Local\Temp\grsm-camp-map.png`.

## Evidence-backed cause

`NativeMap.handleMapReady` calls the parent `onMapReady`, then starts an asynchronous cached-viewport restore. The parent responds to `mapSurfaceReady` by consuming the pending Explore selection and issuing an explicit `flyTo`. The cached storage read can resolve afterward and overwrite both the remembered free camera and the live camera. Inactive-map resume only refreshes sources; it does not cause the override.

## Narrow scope

- Make an explicit camera command invalidate any in-flight cached-viewport restore.
- Add deterministic coordinator tests and a source contract assertion.
- Run only the focused camera/Map/camp tests and the Abrams handoff delta.
- Publish one paired preview OTA only after the focused gates pass.

## Do not repeat

- No broad Map, Layers, Memory, Search, NPS, Trails, Originals, Offline, or Android Auto crawl.
- No NPS refetch or public catalog promotion.
- Do not integrate the separately accepted 97-child B4 pack until this handoff passes.

## Task-owned background processes

- None at checkpoint creation.

