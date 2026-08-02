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

## Batch 2 r3 candidate built — 2026-08-01 21:38 CDT

- Pre-change checkpoint commit:
  `2cb56ada41d9488b68be95a9a519bcd6217ffc6b`
- Implementation commit:
  `0a5eabdb5e8f33a7163cc9ed8997e26bfbcac960`

Accepted candidate path:
`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r3`

Independent rebuild path:
`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r3-rebuild`

Earlier local r1/r2 outputs are superseded, ignored development artifacts and
must not be staged. r3 adds fixed source-freshness evidence and normalizes only
canonical NPS HTTP page links to the same HTTPS host/path before exact-page
media matching.

### Candidate profile

- Official child records: 171
- Destination counts: Guadalupe Mountains 36, Olympic 35, Death Valley 34,
  Joshua Tree 33, Rocky Mountain 33
- Module counts: Stay 53, Visitor Information 23, Trails 42, Activities 15,
  See 38
- Candidate images: 168
- Approved exact-page images: 151
- Conservatively stripped images: 17
- Provider/network requests: 0
- Promotion ready: false
- Live catalog and serving index modified: false
- Candidate/rebuild differing relative-file hashes: 0 of 4

Artifact SHA-256 values:

- Manifest:
  `ba5bd17aa2be9dae27a27dd5e8920e194edbda336df5ee00b890c603f6c2e579`
- Child sidecar:
  `9e5f9cbbfaea02787b8c28161ae30b008da28c090bf33b74a3fbd89f134fc41c`
- Audit:
  `24ab4dcdad62c3ffb897cf154af3a182b8908ed51bb49b6b7d6948289d05f443`
- Review:
  `921fc03c2c9f18e3dbbc9341c3bad9b43531a1db48cecba37792a04349a27197`

### Media evidence resolution

The preliminary coverage audit expected 151 approved images while the unchanged
r7 media matcher initially approved 148. The three differences were Black Rock
Nature Center, Cottonwood Visitor Center, and Joshua Tree Visitor Center. Each
cached item had an HTTPS NPS image, an NPS-prefixed exact credit, and the exact
official child page recorded with legacy `http://www.nps.gov/...` transport.

The media-rights normalizer now upgrades only credential-free NPS HTTP pages on
port 80/default to the same HTTPS host/path/query before exact-page matching.
It does not approve third-party hosts, missing credits, non-NPS credits,
ambiguous reused images, AI-modified media, or other rights warnings. The 17
remaining stripped images comprise nine missing exact credits and eight
non-NPS-prefixed credits.

### Verification so far

- Builder/media focused tests: `22 passed`.
- Final focused Explore/NPS/source/preview/content suite: `122 passed`.
- Content-quality QA: `PASS`, with one reviewed same-facility title across two
  distinct NPS endpoint records and ten reviewed shared-coordinate clusters.
- Python compilation: passed.
- Candidate/rebuild byte comparison: passed.
- `git diff --check`: passed.
- Protected tracked hashes in this isolated worktree remain unchanged.
- Open P0/P1: none found by the builder; independent read-only audit pending.
- Task-owned test/build processes after the final suite: none.

### Exact next action

Resolve any independent audit findings once, then record the implementation
commit and stop. Do not deploy, push, merge, edit the internal-preview sidecar,
or promote this candidate in this packet.

## Batch 2 r7 accepted — 2026-08-01 22:26 CDT

The independently audited immutable candidate is:

`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r7`

Its byte-identical rebuild is:

`data/explore/audit_candidates/internal/post-b08-nps-child-depth-b2-r7-rebuild`

r7 supersedes r3-r6. Those earlier outputs remain audit history only and must
not be integrated or promoted.

### Accepted profile

- Official child records: 170
- Destination counts: Guadalupe Mountains 36, Olympic 35, Death Valley 34,
  Joshua Tree 33, Rocky Mountain 32
- Module counts: Stay 52, Visitor Information 22, Trails 42, Activities 16,
  See 38
- Candidate images: 167
- Approved exact-page NPS images: 150
- Conservatively stripped images: 17
- Provider/network requests: 0
- Promotion ready: false
- Live catalog and serving index modified: false
- Candidate/rebuild differing relative-file hashes: 0 of 4

Artifact SHA-256 values:

- Manifest:
  `523b23375b909de4752a7d98fe448dd52f5ef6d8bcb815c7d3f329d7aa348295`
- Child sidecar:
  `16416e6fe8e9ece6de5c08787b8c284366d7dc0b4951d4819f4deb50c59a5d86`
- Audit:
  `dff1636e93c61e1f376d6b01c2a69eaea0086f3ab2454a6fcc71998bccd64468`
- Review:
  `683c6bff03b3a7a98cfe0d1315f172a6803869e4790ae18c0d17cac6572c2fef`

### Closed audit findings

- Removed the duplicate Beaver Meadows Visitor Center rendered in the same
  destination rail while preserving the canonical visitor-center endpoint.
- Classified Beach Access Trail from Kalaloch Campground as a trailhead, not a
  campground.
- Classified Tour Artists Drive and Trail Ridge Road as scenic-driving
  activities, not trails.
- Synchronized corrected categories into card facts, tags, aliases and source
  topics so stale labels cannot leak into Search or sheets.
- Corrected the reviewed Kalaloch, Arch Rock, Information Office, Fall River,
  Aurora Ridge, Rocky Mountain campground and Boy Scout Trail source-copy
  defects without inventing replacement facts.

### Final verification

- Builder/media/candidate focused tests: 24 passed.
- Broader Explore, NPS, serving, source, content and Search compatibility suite:
  179 passed plus 17 parameterized subtests.
- Python compilation: passed.
- `git diff --check`: passed.
- Candidate/rebuild byte comparison: passed.
- Independent source audit: 170/170 rows resolve to pinned cached NPS source
  items; 150/150 retained images pass the exact-page rights policy.
- Open P0/P1: none.
- Nonblocking P2: `reader_link_actions` in review metadata is a pre-dedupe
  counter and therefore totals 171 while the accepted sidecar totals 170. The
  reader data, manifest, artifact hashes and per-destination counts are correct;
  this is recorded rather than starting another rebuild loop.
- Task-owned test/build processes after verification: none.

Protected tracked hashes in the isolated worktree remain unchanged:

- Explore serving index:
  `c0726d8166ab7d110f437ff4e6acde7aa09702354f053103e3f6630a0129b869`
- App Store copy:
  `126af147b650c2f1077fb73036d26f34f940422c07a3193bade047c73b5c225a`

The user-owned dirty copies in the main worktree retain the hashes recorded in
the pre-change checkpoint and remain excluded from every commit.

### Exact next action

Commit and push this accepted candidate and its checkpoint. In a separate
packet, merge r7 into the authenticated internal Explore preview, run the
bounded Android destination-hub delta, and stop before public catalog
promotion.

### Do not repeat

- Do not refetch these five parks or rebuild r1-r7.
- Do not repeat production OTA, Batch 1, Map, Search, Layers, campground,
  Trails, Originals, Android Auto, Memory, NPS research or screenshot work.
- Do not expose this sidecar without both internal stage and authenticated
  administrator authorization.
- Do not overwrite or stage the user-owned Explore serving index.
