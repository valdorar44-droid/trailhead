# Explore NPS Data Depth b09 Checkpoint

Pre-change checkpoint created 2026-08-02 15:44 CDT
(America/Winnipeg).

## Resume first

- Branch: `feat/explore-nps-depth-b09`
- Isolated registered worktree:
  `/home/sean/.openclaw/worktrees/trailhead-explore-nps-b09`
- Starting HEAD: `b00ea7a9860b474b6bd49b7731a51c80c9951e8e`
- Accepted public baseline: `explore-b08-child-depth-v1`
- Production backend source: `73860e01c00f2244474e21be43f326609954f385`
- Protected main-worktree Explore-index SHA-256:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Protected App Store copy SHA-256:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

Never stage or modify the main-worktree `.cursor/`,
`dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md`.

## Baseline data quality

- Accepted rich cache: `data/explore/audit_candidates/nps/live-20260731-b08`
- b08 audit SHA-256:
  `2c186f431d1c9b876ccc438058cc73ad794b8048ed9dc97e9acea240f3f1b3ff`
- Rich NPS parks: 228 of 474.
- Untouched NPS parks: 246.
- b08 NPS media records: 5,809.
- b08 candidate audit: promotion ready, zero errors, zero warnings.
- b08 public promotion and bounded Android/iOS acceptance are complete and
  must not be repeated.

## b09 bounded selection

A zero-network dry run selected the next 28 untouched park codes in resumable
source order:

`jame`, `hofr`, `home`, `hono`, `hocu`, `hofu`, `hobe`, `hosp`, `hove`,
`hutr`, `iafl`, `iatr`, `inde`, `indu`, `isro`, `inup`, `jaga`, `jela`,
`jeca`, `jica`, `joda`, `jofi`, `jomu`, `jofl`, `juba`, `kala`, `kaho`,
and `kaww`.

These codes resolve to Historic Jamestowne; Home of Franklin D. Roosevelt;
Homestead; Honouliuli; Hopewell Culture; Hopewell Furnace; Horseshoe Bend;
Hot Springs; Hovenweep; Hubbell Trading Post; Ice Age Floods; Ice Age Trail;
Independence; Indiana Dunes; Isle Royale; Inupiat Heritage Center; James A.
Garfield; Jean Lafitte; Jewel Cave; Jimmy Carter; John Day Fossil Beds; John
F. Kennedy; John Muir; Johnstown Flood; Juan Bautista de Anza; Kalaupapa;
Kaloko-Honokohau; and Katahdin Woods and Waters.

- Source-controlled request ceiling: 700.
- Conservative estimate: 25 calls per park, 700 total.
- Completed rich-cache codes are excluded unless an explicit future repair
  authorizes a refetch.
- No provider request had been made at checkpoint creation.
- Existing source depth for these parks is sparse: one place, four activities,
  no campgrounds, visitor centers, or alerts, and 187 article records.
- A fully successful batch should raise rich coverage to 256 parks and leave
  218 parks untouched.

## Active packet

1. Fetch only the 28 selected codes into the existing resumable NPS source
   cache under the hard request budget.
2. Build an isolated immutable `live-20260802-b09` candidate; do not write the
   public serving index or runtime catalog.
3. Profile intended grain, completeness, uniqueness, validity, parent/module
   integrity, freshness, source URLs, media rights, exact image identity, and
   deterministic ordering.
4. Run the existing Explore/NPS QA matrix and an independent cache-only
   deterministic rebuild.
5. Correct only evidenced source-normalization defects. Do not invent missing
   facts or NPS-style modules.
6. Stop at internal-candidate acceptance. Public promotion and device testing
   require a later bounded checkpoint.

## Acceptance rules

- Every selected park is accounted for as fetched, explicitly empty, or a
  documented source failure.
- Stable NPS parent identities remain unique and all child/module records keep
  valid parent relationships.
- Operational and editorial freshness are reported separately.
- No raw identifiers, provider wording, fabricated summaries, unsupported
  access/safety claims, or unlicensed media reach reader-facing artifacts.
- A second cache-only build must match the accepted candidate deterministically.
- The candidate stays outside `dashboard/` and remains unreferenced by public
  configuration.

## Exact next action

Run the single bounded b09 fetch through the authenticated Railway environment,
then inspect its audit before any retry, correction, or downstream integration.

## Do not repeat

- Do not refetch NPS batches b01-b08 or rebuild the accepted b08 public release.
- Do not repeat broad Explore, NPS, Search, Map, Layers, Trails, Originals,
  Android Auto, Memory, campground, or store checks without new evidence.
- Do not publish a mobile OTA, create a native build, deploy Railway, alter a
  feature stage, expose Community routes, or promote a public catalog in b09.
- Do not stage unrelated worktree changes or any protected file.
