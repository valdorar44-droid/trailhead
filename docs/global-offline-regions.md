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
4. Terrain/contour packs after native multi-pack tile serving is available.
