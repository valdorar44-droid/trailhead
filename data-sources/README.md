# Trailhead Official Data Sources

Trailhead keeps official outdoor data in a raw-first pipeline. Normal app
screens should read processed Trailhead records, not live agency APIs. Live
calls are reserved for short-cache safety, weather, fire, and booking state.

## Rules

- Save raw responses or files before normalization.
- Write `.metadata.json` beside every downloaded file.
- Keep attribution and license notes from the registry.
- Never commit API keys.
- Keep internal source names out of normal user-facing copy.

## First Sources

- PAD-US: land ownership and management backbone.
- USFS EDW: recreation sites, forests, trails, roads, and ranger districts.
- NPS API and spatial services: parks, places, Things to Do, visitor centers,
  campgrounds, alerts, trails, roads, buildings, and parking.
- RIDB/Recreation.gov: rec areas, facilities, campsites, activities, links,
  addresses, media, and reservation URLs.

See `registry.json` for source URLs and refresh cadence.
