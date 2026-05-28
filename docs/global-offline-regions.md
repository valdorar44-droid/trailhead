# Global Offline Region Packs

Trailhead's offline download UI is now region-ready. U.S. states, Canada, and Mexico are live map/routing regions.

## R2 file contract

Map packs:

- `api/download/canada.pmtiles`
- `api/download/mexico.pmtiles`

Routing packs:

- `api/routing/canada.tar`
- `api/routing/mexico.tar`

Manifest keys:

- `canada.pmtiles`
- `mexico.pmtiles`
- `canada.tar` or `canada.tar.gz`
- `mexico.tar` or `mexico.tar.gz`

The mobile app can keep download actions disabled until both the map pack and route pack are advertised in the manifests. This prevents users from spending credits or seeing broken 404 downloads while extraction is still in progress for future regions.

## Storage estimates

Current uploaded sizes:

- Canada map: `20,303,863,930 bytes`
- Canada routing: `1,828,741,120 bytes`
- Mexico map: `2,647,056,184 bytes`
- Mexico routing: `1,835,325,440 bytes`
- Canada + Mexico map/routing total: about `24.8 GB`

Canada should later be split into province packs so users do not have to download one large country file for a short trip.

## Next extraction order

1. Canada province packs after the country pack is proven on-device.
2. Central America after Canada/Mexico routing is stable.
3. POI/place packs by region and trip corridor.
4. Terrain/contour packs from the owned Copernicus DEM pipeline in
   `docs/offline-contour-pipeline.md`.

## Planner Region Follow-Up Registry

AI Planner support should stay constrained to downloadable and routable regions until each region has map coverage, navigation coverage, place-pack coverage, and camp legality guidance.

Current planner regions:

- United States
- Canada
- Mexico
- Finland

Research before enabling:

- Australia
- New Zealand
- Norway
- Sweden
- Iceland
- Spain and Portugal
- South Africa

Minimum enablement checklist:

- Map pack exists and is advertised in the download manifest.
- Navigation pack exists or the region is explicitly online-only.
- Fuel, camp, government-place, trailhead, viewpoint, and service-place enrichment has at least one reliable source.
- Public camping rules are summarized well enough for the planner to avoid fake dispersed-camping claims.
- The onboarding/download UI can explain the region's offline readiness without technical pack names.
