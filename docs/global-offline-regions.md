# Global Offline Region Packs

Trailhead's offline download UI is now region-ready. U.S. states remain live, and Canada/Mexico are present as planned regions that automatically unlock when their files appear in the R2 manifests.

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

The mobile app keeps download actions disabled until both the map pack and route pack are advertised in the manifests. This prevents users from spending credits or seeing broken 404 downloads while extraction is still in progress.

## Storage estimates

Reserve this R2 headroom before publishing the first international packs:

- Canada map + routing: `18-22 GB`
- Mexico map + routing: `4-6 GB`
- Canada + Mexico together: `25-30 GB`

Canada should later be split into province packs so users do not have to download one large country file for a short trip.

## Next extraction order

1. Mexico country map and route pack.
2. Canada country map and route pack.
3. Canada province packs after the country pack is proven on-device.
4. Central America after Canada/Mexico routing is stable.
