# NPS Child Depth Batch 1 Checkpoint

Checkpoint created 2026-08-01.

## Status

Implemented and verified on branch `feat/nps-child-depth-b1` from base HEAD
`c121153b3018299f712f009d5e6af670080aecf9` in the isolated worktree
`/mnt/c/Users/User/Documents/Codex/2026-07-15/awesome-github-plugin-github-openai-curated/trailhead-nps-b1-wt`.

This packet is cached-only and internal-only. It used zero network requests and
did not change the live catalog, protected serving index, internal-preview
catalog, feature stage, backend deployment, OTA, or native binary.

## Scope

Batch `post-b08-nps-child-depth-b1` materializes official NPS child records for
five destinations selected from the accepted b08 cache:

| Park code | Destination | Children |
| --- | --- | ---: |
| `blri` | Blue Ridge Parkway | 36 |
| `seki` | Sequoia & Kings Canyon National Parks | 36 |
| `brca` | Bryce Canyon National Park | 24 |
| `shen` | Shenandoah National Park | 28 |
| `dino` | Dinosaur National Monument | 31 |

The batch contains 155 children across the existing destination capability
model:

| Module | Children |
| --- | ---: |
| Trails and trailheads | 44 |
| Camps and stays | 35 |
| See and scenic places | 33 |
| Activities | 23 |
| Visitor information | 20 |

Classification uses the official endpoint and reader-facing title. Incidental
words in descriptions cannot silently convert an activity into a trail or a
place into a campground.

## Reader and Media Boundaries

- Reader links remain on HTTPS NPS hosts. Ten cached legacy NPS links were
  upgraded to HTTPS, and two external child links fell back to the official
  parent-park NPS page.
- Stable IDs and normalized titles must be unique within the batch.
- Exact cached NPS media is accepted only through the existing media-rights
  policy with item-level URL, credit, license, rights state, and rights
  evidence.
- Missing, ambiguous, third-party, courtesy, copyright-conflicted, or
  mismatched media is stripped rather than assigned an invented NPS credit.
- Of 155 candidate media selections, 112 passed and 43 were stripped.
- Nine shared-coordinate clusters remain recorded as review warnings. They are
  distinct official records or access points and are not duplicate IDs or
  titles.

## Immutable Inputs

The fixed generated timestamp is `1785553072`. Relevant SHA-256 values:

| Input | SHA-256 |
| --- | --- |
| Accepted combined b08 catalog | `462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080` |
| Blue Ridge Parkway cache | `41b93b0a289ea02f6e44e2594d5fb3bf6272db0366187141f2f7cbdbe4051310` |
| Sequoia & Kings Canyon cache | `39a6b90011e5284ae51c43619e61966bd68f8ca9d5b66a1f0ce85fcf803c683c` |
| Bryce Canyon cache | `dc3b9660cc3149d88ce69bbe0dda0810161f52b4c954c4d61c3d82c3ced3f792` |
| Shenandoah cache | `3c8164073ece4cc8dca61a25af8999f517f2c3ae58c147dfcbf243c3ff88e6e4` |
| Dinosaur cache | `9deb60e11e40d3ab72993f3da09772d167d0f280eb15960b01beea7dd4bdd957` |

The protected `dashboard/explore_serving_index_v2.json` SHA-256 remained:

`c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`

## Immutable Candidate Builds

The first build was written once to:

`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1`

The independent repeat was written once to:

`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1-rebuild`

The two directories are byte-identical. Key output SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `7a57bd69de6dfd8efa9430d33f76346caa0bf693620d4bd56067eac01883838c` |
| `nps_child_depth_v1.json` | `fe1a092e6b241e7f60e3ae2b30adaf9e1a84c4bab777ecbd0a2dafcacde0ccf7` |
| `audit.json` | `6ede89ec1bb55fa205b82b7f77b63ef3b7aeb2e50ce2e83b9bd5bf96d4bf11e4` |
| `review.json` | `07c967ebbf693ebcc16e5f8ea79aa748061d20b550b0b86ee2cc40875f5b8078` |

Both builds report `requests_used: 0`, `promotion_ready: false`,
`live_catalog_modified: false`, and `live_serving_index_modified: false`.

## Verification

Passed:

```text
python3 -m py_compile scripts/build_nps_child_depth_batch.py

uv run --offline --with pytest --with-requirements requirements.txt \
  python -m pytest \
  tests/test_nps_child_depth_batch.py \
  tests/test_explore_nps_link_safety.py \
  tests/test_explore_nps_media_rights.py \
  tests/test_qa_explore_content_quality.py \
  tests/test_explore_b08_combined_candidate.py -q
# 28 passed

python3 scripts/qa_explore_content_quality.py \
  data/explore/audit_candidates/internal/post-b08-nps-child-depth-b1/nps_child_depth_v1.json
# PASS
```

The deterministic test coverage includes zero-request enforcement, protected
output rejection, immutable output directories, exact media-source matching,
missing-credit stripping, safe reader links, endpoint/title classification,
duplicate identity checks, and repeat-build equality.

## Next Action

Review this immutable internal sidecar and its nine shared-coordinate warnings.
If accepted, integrate it through the existing authenticated internal-preview
merge in a separate packet. Do not promote it to the serving index or refetch
NPS data as part of this checkpoint.
