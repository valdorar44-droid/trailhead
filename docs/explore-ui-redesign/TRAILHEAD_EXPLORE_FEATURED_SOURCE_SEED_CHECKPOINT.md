# TrailHead Featured Source Seed Checkpoint

Date: 2026-06-19

## Seeded

- NPS rich source pack: Glacier National Park (`glac`).
  - NPS requests used: 14 of 750.
  - Runtime hub modules: 88 places to see, 48 things to do, 13 campgrounds, 3 visitor centers, 20+ photos.
- Wikidata/Wikimedia sidecar batches:
  - Pakistan: national parks, protected areas, glaciers, mountains, lakes, waterfalls.
  - Canada: national parks, protected areas, nature reserves.
  - New Zealand: national parks, protected areas, glaciers, mountains, lakes, waterfalls.

## Backend Foundation

- Added nearby v3 source-item attachment for non-NPS hubs.
- Non-NPS park/public-land/glacier hubs can now receive `things_to_see` cards from nearby source-linked v3 records when coordinates and country/region context match.
- Future NPS hourly rebuilds now include cached Wikidata source packs so international enrichment is not dropped by the next NPS batch.
- Wikidata live fetch now includes national parks, protected areas, and nature reserves in its default class set.

## Runtime Spot Check

- Central Karakoram National Park: 16 nearby peak/glacier cards, including K2, Godwin-Austen Glacier, Broad Peak, and Skil Brum.
- Fiordland National Park: 9 nearby waterfall/lake/peak cards, including Lady Alice Falls, Browne Falls, Sutherland Falls, Lake Poteriteri, and Mitre Peak.
- Banff National Park: merged Wikidata media and protected-area context; still needs a smaller Canadian landmark batch for denser nearby cards.
- Glacier National Park: full NPS official module pack.

## Next Seed Batches

- NPS next priority: `acad`, then `olym`, `grsm`, `arch`, `cany`, `seki`, `romo`.
- Non-NPS next priority: smaller country-specific Wikidata batches for Canada landmarks, Switzerland, Italy, Iceland, and Australia.
- Keep Wikidata live batches small. Multi-country broad landmark queries timed out; one-country or narrow class batches worked.
