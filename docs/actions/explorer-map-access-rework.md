# Explorer map access rework action

Issue: #6

## Release message

Trailhead map access has been simplified. Trailhead Topo and Mapbox base styles are available to every account. Explorer now covers co-pilot, advanced place lookup, and any Mapbox-powered area download path. Safety layers remain available to everyone.

## Apply order

1. Backend compatibility first.
2. Mobile OTA after backend deploy is healthy.
3. Preview with a free account and an Explorer account.
4. Ship after the verification checklist below passes.

## Checkpoints

- [ ] App shows Explorer, not the old special-tier name.
- [ ] Trailhead Topo, Standard, Outdoors, Satellite, Dawn, Dusk, and Night are selectable by a free account.
- [ ] Fire, Radar, Avalanche, reports, closures, trails, MVUM, public lands, and camp status remain available.
- [ ] Smoke is hidden until a working source is verified.
- [ ] Co-pilot opens only for Explorer or admin.
- [ ] Trailhead offline packs remain free.
- [ ] Mapbox area download is hidden or Explorer-only.
- [ ] Normal routes try Trailhead Valhalla, then Mapbox, then OSRM.
- [ ] Offline route cache still works with no signal.

## Files to patch

- `dashboard/server.py`
- `db/store.py`
- `mobile/lib/api.ts`
- `mobile/components/NativeMap/index.tsx`
- `mobile/components/NativeMap/mapStyle.ts`
- `mobile/components/NativeMap/routing.ts`
- `mobile/components/NativeMap/OfflineModal.tsx`
- `mobile/components/map/MapLayerSheetContent.tsx`
- `mobile/components/map/MapStyleSheet.tsx`

## Preview notes

Use a free account first. Open the map, switch each free base style, toggle every safety layer, and start a normal route. Then use an Explorer account and confirm co-pilot opens. Do not ship if the old special-tier name appears anywhere in visible copy.
