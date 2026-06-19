# TrailHead Explore Hub Grouping Checkpoint

Date: 2026-06-19

## Scope

- Top-level Explorer browse now favors destination hubs instead of sibling child cards.
- Child records such as campgrounds, glamping, trail areas, trailheads, visitor centers, and K2 base-camp treks remain searchable through the parent hub.
- Official/richer NPS destination cards win duplicate-title dedupe over older curated cards.
- Zion was seeded as the next rich NPS park target without running a full all-parks per-park refresh.

## Checkpoints

1. Client grouping patch
   - `mergeCuratedExplorePlaces` preserves hub identity and attaches curated trail details inside parent places.
   - Explorer ranking builds parent-child metadata, hides child cards from browse, and boosts parent hubs for child searches.
   - Short alphanumeric mountain roots such as `K2` are valid hub roots.

2. Backend search/index patch
   - `/api/explore/catalog/index`, `/api/explore/places`, route ranking, and nearby fallback search now use token-aware matching.
   - Destination-specific terms such as `zion`, `yosemite`, and `k2` must match place identity, avoiding broad NPS article/topic false positives.
   - Source-pack nested text is included in search/category indexing so rich NPS modules can make parent hubs discoverable.

3. Data seed
   - Targeted live NPS probe for `zion` only.
   - Cached payload: `data/explore/source_cache/nps/source-pack_codes-zion_with-places-thingstodo-campgrounds-visitorcenters-alerts-articles-events-tours-parkin_max-500.json`
   - Zion cache after probe: 21 things to do, 48 things to see, 3 campgrounds, 4 visitor centers.
   - Catalog rebuilt from cached national + Yosemite + Zion NPS payloads.

4. UI audit
   - Expo web checked at 390 x 844 viewport.
   - Search probes:
     - `yosemite campgrounds` -> `Yosemite National Park`
     - `zion trails` -> `Zion National Park`
     - `k2 base camp` -> `K2`
   - Playwright screenshot: `.playwright-cli/page-2026-06-19T19-14-35-534Z.png`

5. Figma checkpoint
   - File: https://www.figma.com/design/JrsVhV6Wcq5ELETypeoxnr
   - Frame: `TrailHead Explore home - hub grouping audit`
   - Purpose: visual audit artifact for the new parent-hub browse/search hierarchy.

## Commands Run

- `npx tsc --noEmit`
- `python3 -m py_compile dashboard/server.py scripts/build_explore_catalog_v3.py`
- `railway run -- python3 scripts/build_explore_catalog_v3.py ... --nps-live --nps-rich --nps-park-code zion ... --out /tmp/zion_catalog_probe.json`
- `python3 scripts/build_explore_catalog_v3.py ... --nps-fixture ...yose... --nps-fixture ...zion... --out dashboard/explore_catalog_v3.json`
- Playwright CLI browser audit at `http://localhost:8099/guide`

## Follow-Up

- Continue batching rich NPS parks in small groups from the existing NPS refresh plan.
- Consider shortening NPS park descriptions in compact cards so source-rich cards do not feel too text-heavy on mobile.
