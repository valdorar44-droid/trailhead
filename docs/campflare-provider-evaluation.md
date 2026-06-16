# Campflare Provider Evaluation

## Purpose

Evaluate Campflare as a read-side campground enrichment source without wiring it into production provider config.

This pass is for comparison only:

- campground search quality
- campground detail richness
- campsite-level structure
- rig-fit fields
- source connections
- availability and notice coverage

## Important auth note

Use a Campflare **read API key** for search/detail/campsite evaluation.

Do **not** use the webhook key for this step. The webhook key is only relevant for alert delivery testing and does not replace read auth for search/detail endpoints.

Live auth + base URL notes from the sandbox check:

- API base: `https://api.campflare.com/v2`
- working auth header: `Authorization: <READ_KEY>`
- `https://campflare.com/v1/...` is the website, not the API, and returns HTML 404s
- campground search is `POST /campgrounds/search`, not a `GET`

## Script

Use:

```bash
python3 scripts/evaluate_campflare.py --api-key '<READ_KEY>'
```

Optional raw payload capture:

```bash
python3 scripts/evaluate_campflare.py --api-key '<READ_KEY>' --save-dir /tmp/campflare-eval
```

The script will:

- fetch Campflare’s published OpenAPI spec
- locate the campground search/detail/campsite endpoints
- try likely auth header formats
- probe default areas:
  - Moab
  - Yosemite
  - Yellowstone
  - Big Bend
  - White Sands
- prefer geographic bbox probes for named destination areas
- summarize the first campground and first campsite payload

## Compare against Trailhead

Focus on whether Campflare is materially better on:

- `has_campsite_level_data`
- site kind normalization
- `max_rv_length` / `max_trailer_length`
- hookups, pull-through, ADA, firepit, picnic table
- source linkage like `ridb_facility_id` or `usfs_site_id`
- photo usefulness
- update freshness metadata

If Campflare does not materially improve one of those categories, keep it in evaluation only and do not prioritize provider integration yet.

## June 2026 live sandbox result

Working read-side test completed against the Campflare v2 API.

Areas checked:

- Moab
- Yosemite
- Yellowstone
- Big Bend
- White Sands

What Campflare clearly does well:

- normalized campground objects with good short/medium/long descriptions
- campsite-level payloads when available
- RV/trailer fields like `max_rv_length`, `max_trailer_length`, and some driveway/pull-through signals
- useful amenity structure: toilets, toilet kind, water, showers, dump station, hookups, fires allowed
- normalized `cell_service` carrier coverage
- official source links and IDs like `ridb_facility_id` and `usfs_site_id`
- freshness metadata via `metadata.last_updated`
- management agency metadata and reservation links

What looked weaker or inconsistent:

- text search alone can be ambiguous for destination names; bbox or land-scoped search is safer
- some results are clearly sourced from the same Recreation.gov / RIDB ecosystem we already use
- campsite-level coverage is uneven; some campgrounds return full site lists, some return none
- notices exist as an endpoint, but the live Moab test returned an empty list
- dispersed/public-land depth still does not look like a complete replacement for Trailhead’s blended sourcing

Area notes:

- `Moab`: good BLM group-site detail, campsite photos, schedules, official links, strong cell-service fields
- `Yosemite`: good campsite counts and reservation structure, but the sampled result was seasonally closed
- `Yellowstone`: strong campsite-level structure and utility fields
- `Big Bend`: good site-level structure, but geographic naming can drift if you rely on query-only search
- `White Sands`: nearby campground coverage exists, but the sampled result did not have campsite-level data

Current read:

- Campflare is a credible enrichment source.
- It is strongest as a normalized campground/campsite metadata layer.
- It is not obviously strong enough yet to become the primary production provider by itself.
- If integrated later, it should sit behind official/live sources and be used to fill field gaps, especially campsite structure, amenities, rig fields, and source IDs.
