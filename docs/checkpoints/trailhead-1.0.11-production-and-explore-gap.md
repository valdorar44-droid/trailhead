# Trailhead 1.0.11 Production OTA and Explore Gap Checkpoint

Checkpoint created 2026-08-01 19:25 CDT (America/Winnipeg).

## Resume first

- Feature branch: `feat/trailhead-1.0.10-overhaul`
- Current feature HEAD: `db2add34` (`feat(explore): add BLM Moab reader depth`)
- Immutable production release source: `c115579341fbd68dd61495b18e620cc6992ab0d2`
- Immutable tag: `v1.0.11-b08-ota3`
- Protected Explore index SHA-256: `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- Protected App Store copy SHA-256: `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`
- Never stage `.cursor/`, `dashboard/explore_serving_index_v2.json`, or `docs/app-store-copy.md`.

## Production OTA complete

The production publisher was changed from a three-platform concurrent export
to sequential native exports. Android and iOS are exported to separate
directories, both Sentry source-map uploads must pass, and only then are the
two native updates published to one isolated candidate branch. The existing
paired SHA/runtime checks and the atomic channel move remain unchanged.

- Production channel ID: `019dc26b-268a-794b-8aa8-3497b4d38487`
- Active candidate branch: `production-candidate-c115579341fbd68dd61495b18e620cc6992ab0d2-msb1ekop-b0699736346b07493d23ef47`
- Active candidate branch ID: `019fbfd0-1e00-7f87-bc55-06b4f2ebb0d2`
- Android runtime: `native-1.0.11-android.1`
- Android update ID: `019fbfd0-3850-75f0-b197-1801391f78e0`
- Android group: `dfc12d03-f7ea-4cd6-bb27-a2f5a36eaf57`
- iOS runtime: `native-1.0.11-ios.1`
- iOS update ID: `019fbfd0-9a10-79d5-a11e-039500f7bfc4`
- iOS group: `bffb81e5-32ce-447f-b3dc-e7d2f8c0f793`
- Both server-owned update records resolve to exact commit `c1155793`.
- Runtime coverage is exact: all 12 prior runtime/platform entries plus both
  new 1.0.11 entries are present (14 total).
- The production channel moved only after both update groups and the complete
  legacy matrix passed validation.

The paired binaries remain build-source `0f7431d32088405f4c381ed1a220fcb2169ec761`:

- Android build `70`, ID `723dca56-01a3-416b-a22d-98c838a849ee`
- iOS build `62`, ID `712109e9-6b7f-4f72-ab51-2aa42a6095da`

Native inputs remained exact at release:

- Android tree `8cfe772d0cacdc49e6fd223419051cfac99094ed`
- iOS tree `59212996751833d8f36fdc1d390204c9817b29fd`
- `app.config.js` blob `fba1fd3ec1492129dd07ec94292e1c09889be0e0`
- `eas.json` blob `891d18373307290b492492b90b3702fe7624b89c`

Focused release tooling, paired-update evidence, runtime-matrix,
native-compatibility, release-environment, syntax, and source-map input tests
passed. The corrected full backend gate passed `980` tests plus `135`
subtests. The publisher completed once; no blind retry followed.

## Backend production complete

Railway deployment `1282785d-62f1-4d2f-ab86-709dee40bfa9` reached terminal
`SUCCESS` from release source `c1155793`. The deployment retained:

- Nixpacks builder
- `/api/health` health check
- `/data` persistent volume
- `mkdir -p /data && python run.py` start command
- the configured restart policy

`https://api.gettrailhead.app/api/health` returned `status=ok` and
`service=trailhead` after the terminal success state.

Evidence directory:
`C:\Users\User\Documents\Codex\evidence\trailhead\production-ota-c1155793`

| Evidence | SHA-256 |
| --- | --- |
| `eas-channel-production.json` | `1d08fa0c36591e2da1da2ec89d3dbe801acc948ba39d7b532ae7a0c7a437f900` |
| `eas-android-update.json` | `cde120fd6139011218325edb81390be4df5b71ce161108c9c7c1010cd5f5606e` |
| `eas-ios-update.json` | `497c80195cf1b1c86d43011ef9b50f8c3007ea52078df3e380ca48f2b96ff717` |
| `railway-deployment.json` | `5f6284c56b73f15fd21b94c7b79a5c6087737f5012d69d4cbd9cadc4bf9d18ba` |
| `api-health.json` | `bfe245f1518c7ada1d68d389a7f8de7c0cf755db4cb9ff6406814d9f8f77e3ee` |

Open production P0/P1: none.

## Explore data gap in progress

The cached-only BLM Moab reader-depth packet is now merged and pushed as
feature commit `db2add34`. It did not fetch any provider, mutate the protected
serving index, deploy a public catalog, or change a feature stage.

- Accepted catalog size remains 108 cards.
- Five of seven standalone BLM cards now have source packs (previously zero).
- Whole-catalog source-pack coverage is 106 of 108.
- Official reader URL coverage is 101 of 108.
- Fee, season, phone, activity, and allowlisted official BLM links are
  preserved where cached source evidence exists.
- `None` is normalized to `No fee`; the cached `Decmeber` typo is corrected.
- Flickr media remains excluded because item-level rights evidence is absent.
- Captain Ahab remains outside the accepted catalog boundary.
- Immutable candidate manifest SHA-256:
  `a65604e65b985a1ef843c6705a58772afcf4567dd9876536332e6206774d7181`
- Immutable catalog SHA-256:
  `dca19c8f5f19f3069d092f49857b8af2d11226a140b1a4711bdd5c8b62a22f1c`
- Rebuild comparison matched all 23 files with zero provider requests.

Verification passed: Python compilation; 49 focused tests plus four subtests;
and content QA. Content QA retained nine weak-description sanitization
warnings and one duplicate-coordinate cluster, with no blocking error.

## Exact next action

1. Audit the two accepted point-only BLM cards without reader source packs and
   classify each missing field as source absence, join failure, or policy/licensing hold.
2. Audit the nine sanitized weak descriptions and the one duplicate-coordinate
   cluster against cached records only. Do not fill gaps with generated prose.
3. Build the next immutable internal sidecar from explicit cached inputs and
   require deterministic hashes, real-data-only modules, and source attribution.
4. Keep `TRAILHEAD_EXPLORE_DATA_STAGE=internal`; require an authenticated admin
   plus `X-Trailhead-Explore-Preview: internal` for device review.
5. Stop for review before any public serving-index promotion or provider fetch.

## Do not repeat

- Do not rerun production OTA publication, the 980-test full backend suite,
  Memory, Layers, Yellowstone, NPS research, Trails T1-T6, Originals,
  Android Auto, or store screenshots without new evidence.
- Do not refetch b06/b08, spend provider quota, fabricate destination modules,
  use unlicensed media, or overwrite the protected serving index.
- Do not expose Community routes, change public Explore stages, or advertise
  this internal data candidate.

Task-owned EAS, Expo, Metro, Gradle, Maestro, pytest, Railway-tail, and recording
processes: none after completion.
