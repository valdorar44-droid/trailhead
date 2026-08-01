# BLM Moab Reader-Depth Packet Checkpoint

Checkpoint created 2026-08-01.

## Status

Implemented and verified on branch `feat/blm-moab-reader-depth` from feature
HEAD `8270a40c6b99ef7fd672341206a5128e1c4188b1` in the clean worktree
`/home/sean/.openclaw/worktrees/trailhead-blm-reader-depth`.

This packet is cached-only. It did not fetch network data, change the live
serving index, promote a candidate, deploy a service, or produce an OTA/native
release.

## Reader-Depth Contract

Only records from the cached `blm_moab_featured_sites` dataset can populate
the BLM reader source pack. The importer:

- maps `RecSiteFee`, `RecSiteSeason`, `ContactPhoneNumber`, and
  `FeaturedActivity` to reader-facing facts;
- normalizes the fee sentinel `None` to `No fee` and the source typo
  `Decmeber` to `December`;
- accepts `WebLink` only when it is an HTTPS URL on the explicit public reader
  host allowlist (`blm.gov` or `www.blm.gov`), without user information or an
  explicit port; and
- deliberately does not import `FlickrAlbumImage` because the cached rows do
  not carry item-level approved rights evidence.

The optional `Description Not Available` suppression was not implemented.
It is not needed for the five accepted cards and would make the currently
quarantined Captain Ahab candidate newly reviewable, changing the accepted
catalog rather than only enriching it.

## Accepted Cards Enriched

| Place ID | Reader facts added |
| --- | --- |
| `place:blm:blm-moab-mtb-opportunities-19` | Klondike Bluff Trails: fee, season, phone, Mountain Biking, official BLM URL |
| `place:blm:blm-moab-mtb-opportunities-20` | Moab Brand Trails: fee, season, phone, Mountain Biking, official BLM URL |
| `place:blm:blm-moab-featured-sites-145` | Castleton Tower: No fee, year-round season, phone, Climbing, official BLM URL |
| `place:blm:blm-moab-featured-sites-146` | Fisher Towers: No fee, corrected `December`, phone, Climbing, official BLM URL |
| `place:blm:blm-moab-featured-sites-148` | Indian Creek: No fee, seasonal-closure note, phone, Climbing, official BLM URL |

The Klondike and Moab Brand featured rows merge into their existing canonical
mountain-bike opportunity IDs. All five accepted cards have an empty media
list.

## Immutable Cached Inputs

Both builds reused the accepted source cache at
`data/explore/audit_candidates/agencies/live-20260801-b08-operational-r8/source`
from the existing Trailhead checkout. Relevant input SHA-256 values:

- `blm_moab_featured_sites.geojson`:
  `1a65ba304df0dbb4dce43e558e4c654184dd7ad9bde3d796a0b067723181297f`
- `blm_moab_mtb_opportunities.geojson`:
  `fd3ddee7ca419942c644d6fc2a3737bfe75e483303b8b2b0e36c918453460159`
- `blm_moab_sites_point.geojson`:
  `a03b988ca1610b17e7cef070d2c8a627f45a8413704c1a41dc6d895b2d3cb9d8`
- `usfs_sierra_sites.geojson`:
  `da01ee43a3b5a57493b6415280d99162d28b967f2348781348dc69c193f580e3`

The fixed build timestamp was `1785553072`.

## Immutable Candidate Builds

The first build was written once to:

`data/explore/audit_candidates/agencies/post-b08-blm-reader-depth-r2`

The independent repeat was written once to:

`data/explore/audit_candidates/agencies/post-b08-blm-reader-depth-r2-rebuild`

Both manifests report `requests_used: 0`, `promotion_ready: true`, and
`live_serving_index_modified: false`. The two directories contain the same 23
relative files, and every file has the same SHA-256 in both builds. Key hashes:

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `a65604e65b985a1ef843c6705a58772afcf4567dd9876536332e6206774d7181` |
| `explore_catalog_v3.json` | `dca19c8f5f19f3069d092f49857b8af2d11226a140b1a4711bdd5c8b62a22f1c` |
| `source_records.jsonl` | `f6022725aecf24c7c69b2d8fec213eb30d50d3c5f231750b9ffa62c218968860` |
| `places.json` | `255dd39324cdb66768ed329c66ac429e8c10e54c42620868ea7bb1e14c381ea3` |
| `trails.json` | `2659df549f807748146feec371208fb3420157286b547eb9596a502982bccd4f` |
| `destinations.json` | `641b4717158e0322fe05f073de4e6d66b37c39b00aaf6281d43babf44e29ab4f` |
| `promotion_review.json` | `fc93d012362d0f5ba13b32ed62e1fd68ebd0d7ba1c98faf29c663c568c29e896` |
| `audit.json` | `9b77d6e67c420ff0c865c638b33b7499f2e2f74674c99dfee72004c14d984623` |

## Counts and Boundary

- Accepted catalog: 108 cards, unchanged from the accepted input candidate.
- Accepted BLM: 8 cards total: one destination hub plus seven standalone
  cards.
- Standalone BLM cards with source packs: 5 of 7.
- Whole catalog cards with source packs: 106 of 108.
- Whole catalog cards with official reader URLs: 101 of 108.
- Raw place candidates: 1,117; reviewable raw places: 106.
- Captain Ahab remains outside the accepted catalog; no new admission was
  forced.

## Verification

Passed:

```text
python3 -m py_compile scripts/explore_sources/blm/import_blm.py
uv run --offline --with pytest --with-requirements requirements.txt \
  python -m pytest tests/test_explore_agency_pilots.py -q
# 35 passed

uv run --offline --with pytest --with-requirements requirements.txt \
  python -m pytest tests/test_explore_agency_pilots.py \
  tests/test_explore_agency_rebuild_determinism.py \
  tests/test_explore_b08_combined_candidate.py \
  tests/test_explore_b08_promotion_gate.py -q
# 49 passed, 4 subtests passed

python3 scripts/qa_explore_content_quality.py \
  data/explore/audit_candidates/agencies/post-b08-blm-reader-depth-r2/explore_catalog_v3.json
# PASS
```

Content QA retained the existing warnings for nine sanitized weak
descriptions and one duplicate coordinate cluster; it reported no blocking
error.

## Remaining Boundary

Two accepted point-only BLM cards still have no reader source pack. Cached
Flickr URLs remain excluded pending item-level rights evidence. The ignored
candidate directories are evidence only and are not part of the tracked
commit.
