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

## Bounded fetch interruption and pipeline correction

- First provider run: 2026-08-02, one process, no retry loop.
- Historic Jamestowne, Home of Franklin D. Roosevelt, and Homestead completed
  atomically using 35 logged requests before the NPS response for Honouliuli
  timed out during `response.read()`.
- Honouliuli was not written, no candidate was built, no public state changed,
  and the enrichment lock was released.
- The old runner did not persist a state file for this raw `TimeoutError`.
- Accepted partial source hashes:
  - `jame` `70fe87c232c5d0c163edd4d6ec7353ef264f1930de71c45de37705735b912fa8`
  - `hofr` `02dd0a46d23074ef46036961e05332e424ad42f04a06aa8539ba0f8ba41e4e67`
  - `home` `ad36fd5352a987552f6e8d8cb0a658282e974a15af6948b88aec1dd7c491bc2b`
- Each partial source contains the correct park identity and all ten requested
  endpoint buckets. They must not be deleted or refetched.
- The pipeline now retries read-time `TimeoutError` through its existing bounded
  four-attempt backoff and charges every attempt to the request budget.
- Live failures now persist fixed `fetch_failed` state with selected/completed
  codes, request count, and successfully written paths before re-raising. No
  exception text, request URL, API key, or response content is stored.
- Budget exhaustion also preserves successfully written paths.
- Focused source/runner verification: 51 passed; Python compilation and
  `git diff --check` passed.

### Revised exact next action

Resume once with the same explicitly pinned 28-code list and without
`--force-fetch`. The three accepted cache files must be skipped, leaving the
original 25 parks rather than expanding the frozen b09 scope. Inspect the
candidate audit before any further provider action.

## Completion checkpoint

Completed 2026-08-02 17:04 CDT (America/Winnipeg).

- Implementation commit: `5dbb7288dad08d8a6579973630a528a984761adb`.
- Branch: `feat/explore-nps-depth-b09`.
- Accepted candidate:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/audit_candidates/nps/live-20260802-b09-accepted-v3`.
- Deterministic rebuild:
  `/home/sean/.openclaw/workspace/trailhead/data/explore/audit_candidates/nps/live-20260802-b09-determinism-v3`.
- Final state: `success`; zero requests in the accepted cache-only build;
  256 rich-cache parks complete and 218 untouched.
- Fetch lineage: the first bounded invocation used 35 requests and completed
  three parks; the single resume used 284 requests and completed the remaining
  25. Total b09 source acquisition was 319 requests across those two
  invocations. No selected park was refetched.

### Accepted artifact evidence

- Catalog: 729 places,
  `8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80`.
- Source records: 500,
  `d3e69df7f0a045808d93f4c60199516a3fa1734c24a711f81a200c3687fef71f`.
- Trail geometries: 7,
  `974326332df4757f2d6aa0269490b11aeb9243e42bd00e31f23aaf2a99e09d6b`.
- Delta manifest:
  `01f2a704a3ae15648cb9f3a61456d64983b87e027fdadfd02aaeb2f4dce20d23`.
- Audit report:
  `7d37d0721633a173dc6d14931ec2f401a0e4047a11a96b04757670e210f6a541`.
- State:
  `936deab78114d7a9d2515344c6bf7b8da5d02ade7264d2e71ebe7eacc972b5c1`.
- Accepted and deterministic-rebuild catalog, source-record, and trail hashes
  match exactly.
- Candidate audit: promotion ready, zero errors, zero warnings, 6,149 reviewed
  media entries.

### Corrections and safety controls

- Corrected reader-text handling for `your visit` and fractional-mile phrases.
- Removed 44 expired events; 175 current or future events remain in the b09
  selection.
- Layered only the selected 28 NPS parents and 28 NPS source records over the
  accepted b08 candidate; no outside parent changed and trail artifacts remain
  identical to b08.
- Preserved per-fixture source timestamps and audited NPS operational freshness
  against its NPS source record rather than a cross-source merged timestamp.
- Audit subprocesses no longer receive `NPS_API_KEY` or other live provider
  credentials.
- Live replacement codes must exactly equal the selected/fetched batch.
- Candidate preflight now rejects reused output, a missing/tampered base, or
  overlapping base/output before any provider request. Rebuild repeats these
  checks for race protection.
- Candidate core artifacts stage in a sibling temporary directory and publish
  through one directory rename. Existing outputs are never overwritten.
- Delta manifests contain stable release IDs, audited base hashes, rebuilt and
  final artifact hashes, and the request count for that build invocation.
- State writes are atomic and candidate/state paths reject protected project
  locations.

### Verification

- Focused Explore/source/official-place/link/media/copy suite: 114 passed.
- Cache-only post-build audit suite: 66 passed.
- Explore QA matrix: passed with no dead-end scenario.
- Content-quality QA: passed; only inherited baseline warnings remain (Mount
  Hutt weak source text, five coordinate clusters, and far-child mini-map
  suppression).
- Python compilation and `git diff --check`: passed.
- Independent code review found no remaining P0/P1 after the preflight fix.
- Protected Explore-index and App Store copy hashes remain
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
  and
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`.
- Task-owned enrichment, test, Gradle, Metro, and Maestro processes: none.
- No Railway deployment, mobile OTA, native build, feature-stage change,
  serving-index write, or device crawl occurred.

## Next packet

Build the zero-network internal NPS child contract
`post-b08-nps-child-contract-r1` in a fresh clean worktree.

- Identity authority: the accepted b09 normalized catalog above.
- Provenance/media evidence: existing NPS source-cache files only.
- Exact disposition scope: 394 rows = 157 legacy normalization rows plus 237
  new child candidates.
- New module split: See 112, Do 45, Stay 49, Visitor 31.
- Combined identity hash:
  `fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524`.
- Keep the packet internal, use zero NPS requests, preserve the public index,
  and treat the 394 count as dispositions rather than an automatic publication
  count.

## Do not repeat

- Do not refetch NPS batches b01-b08 or rebuild the accepted b08 public release.
- Do not repeat broad Explore, NPS, Search, Map, Layers, Trails, Originals,
  Android Auto, Memory, campground, or store checks without new evidence.
- Do not publish a mobile OTA, create a native build, deploy Railway, alter a
  feature stage, expose Community routes, or promote a public catalog in b09.
- Do not stage unrelated worktree changes or any protected file.
