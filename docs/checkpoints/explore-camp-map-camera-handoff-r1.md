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

## Completion — accepted Android delta

- Recorded: 2026-08-02T21:26:00-05:00
- Accepted implementation SHA: `cefc92f2c1036b3864f9a290ce4913191e436865`
- Android preview: build `69`, runtime `native-1.0.10-android.7`, update `019fc565-c11d-745f-a727-678a675c9a28`
- iOS paired preview: runtime `native-1.0.10-ios.6`, update `019fc566-1d9d-7ac3-80ab-397d2e5db563`
- Android QA identity matched the exact SHA, runtime, platform, channel, and update ID.
- Deterministic device path passed: `Explore → Great Smoky Mountains National Park → Where to Stay → Abrams Creek Campground → Map`.
- The Map framed Abrams Creek in Tennessee instead of restoring the cached Winnipeg viewport.
- The campground Peek kept the Abrams Creek identity without a blank frame or sheet-family swap.
- Android Back restored Abrams Creek Full first, then the exact Where to Stay child list and scroll anchor.
- No P0/P1 remains in this packet. A pre-existing P2 accessibility-label glyph encoding issue was observed in Explore module/card content descriptions; it is recorded for a bounded copy/accessibility cleanup and does not affect visible text or this handoff.

### Focused gates

- `MapRecentViewportRestoreGateV1`: 5/5 tests passed, including deferred-storage ordering and no-camera-ref behavior.
- Map camera ownership: 8/8 tests passed.
- Originals renderer/share, NPS hub preservation, Explore navigation/scroll, campground sheet/presentation/identity, telemetry, privacy, TypeScript, and whitespace gates passed.
- Sentry source maps uploaded for both paired preview updates.

### Evidence

- `qa-camera-fix.png`: `a0e308ba6ca093e6ce9052b1a959ee58d5e1791a6721c4e5fbe3d6b242c97de1`
- `qa-camera-fix.xml`: `a5ffb30479e36aa37c0a306aae0a7e7267898858f71bfbcae49d6a4f9b445e83`
- `grsm-hub-fix.png`: `f9ed4221d4beffd175571de03a94ade8fede60f9e3d4536d628b3032f51f78f7`
- `grsm-stay-fix.png`: `d8a4364ebd84b9c870d9345dd0696c8aa7ec8996ac684ecd1b7b877c8778467f`
- `abrams-full-fix.png`: `84655869a2f3048ee470a8190b00b62f0733c9367fe8d0bf19f5e45784b84ea8`
- `abrams-map-fix2.png`: `d20c9b250cd7f0ad2f7d8bbb70c57172a72a25c7195ad8ec513319d5a1cc1061`
- `abrams-return-fix.png`: `a12cd9ff4a0c44d61b6feb8c0687c40ee2aef1eaeb81001ec27c52bc12ae6112`
- `abrams-return-stay.png`: `3bfae1ded04038d77d396a85c4c3acd3bcddaa87af3564e7b4640e08d0e3783a`

### Protected files and processes

- Main Explore index SHA-256 remains `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`.
- Main App Store copy SHA-256 remains `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- No task-owned Metro, Gradle, Maestro, Expo publisher, or test process remains running.

## Exact next action

Integrate the separately accepted B4 97-child pack into an isolated internal-preview worktree, producing `790` internal NPS children across the same `13` proof destinations. Do not refetch NPS data or touch the protected serving index.

## Do not repeat after acceptance

- Do not repeat the Great Smoky search, hub, campground, or Map handoff proof unless new evidence appears.
- Do not repeat broad Map, Layers, Memory, Search, NPS, Trails, Originals, Offline, or Android Auto crawls.
