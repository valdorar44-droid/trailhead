# Explore NPS Child Depth Batch 2 Checkpoint

Pre-change checkpoint created 2026-08-01 21:21 CDT
(America/Winnipeg).

## Resume first

- Branch: `feat/nps-child-depth-b2`
- Isolated registered worktree:
  `/mnt/c/Users/User/Documents/Codex/2026-07-15/awesome-github-plugin-github-openai-curated/trailhead-nps-b2-wt`
- Pre-change HEAD: `c03f5091082cad95ea180794057ed81e236418ca`
- Parent branch at worktree creation:
  `feat/trailhead-1.0.10-overhaul`
- This packet is cached-only and internal. It must not deploy, push, modify the
  internal-preview sidecar, or promote any catalog.

## Protected files

Never stage or modify `.cursor/`, `dashboard/explore_serving_index_v2.json`, or
`docs/app-store-copy.md`.

The isolated worktree starts from the clean tracked versions:

- `dashboard/explore_serving_index_v2.json` SHA-256:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`
- `docs/app-store-copy.md` SHA-256:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`

The user-owned dirty versions in the main worktree remain separately preserved:

- Explore serving index SHA-256:
  `7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4`
- App Store copy SHA-256:
  `aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86`

## Exact packet

Build one immutable NPS child-depth Batch 2 for these cached official source
packs only:

1. Guadalupe Mountains National Park (`gumo`)
2. Olympic National Park (`olym`)
3. Death Valley National Park (`deva`)
4. Joshua Tree National Park (`jotr`)
5. Rocky Mountain National Park (`romo`)

Reuse the accepted Batch 1 r7 rules for stable item identity, title-scope
uniqueness, source-backed module classification, child-specific official URLs,
HTTPS normalization, exact-page media identity and licensing, deterministic
ordering, and immutable non-promotable output.

Expected bounded output from the read-only coverage audit is 171 children:
Stay 53, Visitor Information 23, Activities 15, Trails 42, and See 38. The
earlier audit estimated 151 approved images. A disposable run of the accepted
r7 policy produced the same 171 children and module counts but 148 approved
images. Review that three-image difference against exact cached rights evidence;
do not weaken the policy to meet an estimate.

## Inputs

- Base catalog:
  `data/explore/audit_candidates/combined/live-20260801-b08-operational-r8/explore_catalog_v3_review.json`
- Base SHA-256:
  `462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080`
- Source cache: `data/explore/source_cache/nps`
- Provider/network requests allowed: `0`

The cached source inputs live in the main checkout and are read-only inputs;
generated artifacts remain in this isolated worktree.

## Verification required

- Immutable candidate and independent rebuild have identical relative-file
  hashes.
- Schema, coordinates, source URLs, parent relationships, categories/modules,
  title scopes, exact media identity, rights evidence, copy, and deterministic
  order pass.
- Run focused tests with:
  `uv run --with pytest --with-requirements requirements.txt python -m pytest ...`
- Run Python compilation and `git diff --check`.
- Perform an independent read-only audit before the implementation commit.

## Background processes

No Metro, Gradle, Maestro, Railway, EAS, provider-fetch, or candidate-build
process was started by this packet at checkpoint time. Existing host ADB, Node,
and Python processes belong to other work and must not be stopped.

## Exact next action

Make Batch 2 a selectable preset without changing Batch 1's default behavior,
generate the candidate and rebuild from the read-only cached inputs, then audit
the output and commit only the named builder, test, candidate, and checkpoint
files.

## Do not repeat

- Do not rebuild Batch 1 r1-r7 or refetch NPS data.
- Do not spend provider quota or use network fallback.
- Do not modify the authenticated internal-preview sidecar in this packet.
- Do not deploy, push, promote, or publish a mobile OTA.
- Do not repeat production, Map, Search, Layers, campground, Trails, Originals,
  Android Auto, Memory, or screenshot work.
