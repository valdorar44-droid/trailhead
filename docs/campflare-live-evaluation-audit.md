## Campflare Live Evaluation Audit

Date:

2026-06-13

Shipped:

- fixed [scripts/evaluate_campflare.py](/home/sean/.openclaw/workspace/trailhead/scripts/evaluate_campflare.py) to use the real Campflare v2 search contract:
  - `POST /campgrounds/search`
  - bbox-first area probes for destination regions
  - keep searching when a query succeeds but returns zero campgrounds
- updated [campflare-provider-evaluation.md](/home/sean/.openclaw/workspace/trailhead/docs/campflare-provider-evaluation.md) with the live sandbox findings
- captured raw evaluation payloads in `/tmp/campflare-eval`

What improved:

- Campflare testing is now repeatable instead of one-off curl work
- the read key was validated against the real API host
- the team now has a concrete read on Campflare strengths:
  - campsite structure
  - amenities
  - rig-length fields
  - source IDs
  - cell-service fields
  - freshness metadata

What still feels weak:

- query-only place-name search is not reliable enough for destination regions
- coverage is still uneven for non-reservable and some nearby public-land cases
- notices did not add value in the spot check
- this does not yet prove commercial value over Trailhead’s current blended sourcing

Metrics or spot checks:

- API root auth check: passed
- website host test: confirmed wrong path/host failure mode
- live matrix run:
  - Moab
  - Yosemite
  - Yellowstone
  - Big Bend
  - White Sands
- sampled notices endpoint:
  - `kens-lake-group-sites-840` returned `[]`

Decision:

- complete
- keep Campflare in evaluation mode
- do not wire it into commercial production ranking yet
