# Great Smoky Mountains Original — Source Dossier V1

Status: **editorial evidence candidate; not ready for scripts, narration, or publication**

Reviewed: 2026-08-05

Machine-readable source: `originals/smokies/source_dossiers_v1.json`

## What this packet establishes

- 45 full-story outlines and 32 shorter cues.
- Exact allocation by chapter:
  - Mountain Crossing: 18 stories and 10 cues.
  - Little River and Cades Cove: 14 stories and 9 cues.
  - Roaring Fork: 7 stories and 6 cues.
  - Foothills Parkway: 6 stories and 7 cues.
- 47 claim records tied to 28 reviewed official sources.
- Visible-scene and editorial-purpose notes for every entry. These are outlines, not narration prose.
- Three culturally sensitive entries blocked until Eastern Band of Cherokee Indians review:
  - `mc_story_15` — reserved cultural interpretation at Kuwohi.
  - `mc_cue_07` — Kuwohi naming and pronunciation cue.
  - `cc_story_04` — Cherokee history and relationships to Cades Cove.
- Eight media leads. None is approved for distribution yet.

## Editorial rules

Every full story should eventually follow four beats:

1. Begin with something a passenger can actually see or hear.
2. Explain a sourced fact in plain language.
3. Show a human or ecological consequence.
4. Return to the visible landscape.

The dossier does not authorize a writer to turn every outline into narration automatically. A claim can be used only while its source review is current, and an entry with an EBCI gate cannot compile into a story citation before cultural approval.

Facts and operational guidance stay separate. Closures, vehicle restrictions, parking requirements, weather, and road availability come from the existing operational-readiness system at Start Tour; they are not frozen into narration.

## Source and citation contract

The validator requires:

- An official or otherwise authoritative HTTPS source for every claim.
- Review within 180 days for editorial sources.
- Stable claim IDs and deterministic canonical output.
- Rights status compatible with the existing `OriginalManifestV2` citation fields.
- Every source and every claim to be used; orphan evidence fails validation.
- Culturally sensitive claims to include an official EBCI review source and remain blocked.

`original_story_citations()` projects approved claim evidence directly into the Manifest V2 citation shape. Approved cultural claims also carry the immutable review record ID, review date, and SHA-256; no parallel consumer citation system is introduced.

## Media-rights state

The eight current records are only subject/page leads. A page carrying an NPS logo or an image hosted on an NPS domain is not enough to authorize reuse. Before an item can become `approved`, its record must include:

- Exact asset URL.
- Exact displayed credit.
- Confirmed identity of the depicted place.
- Rights or license basis for Trailhead's commercial distribution.
- License/attestation record.
- Pixel dimensions.
- SHA-256 of the downloaded original.

Named third-party credits such as Smokies Life or an individual photographer require individual clearance. The NPS Arrowhead will not be used as product artwork.

## Route permanence finding

The S1 Mapbox geometries remain temporary candidate evidence. They cannot be copied into a permanent or offline Original bundle.

The next route-evidence packet should evaluate the official Great Smoky Mountains National Park road-centerline dataset as the durable park-road source. It should also:

- Keep Cades Cove landmarks as projected cue anchors instead of Directions waypoints; the current candidate makes unnecessary parking/campground detours.
- Decide whether Little River/Cades Cove needs a separate Townsend-start variant.
- Use a reviewed public-road source, or a consciously chosen endpoint, for the short extension beyond the park toward Cherokee.
- Add a compiler-enforced geometry-rights gate before S4.

These findings do not reopen S1. They are prerequisites for permanent cue placement and offline publication.

## What remains blocked

- EBCI scope determination and compensated participation.
- Cultural wording and pronunciations.
- Full narration scripts and human editorial review.
- Exact media selection and rights clearance.
- Permanent route geometry and cue projection.
- Trusted current-road observations and server-owned rig/vehicle binding.
- Cartesia auditions and production narration.
- Internal or public device preview.

No Cartesia credits were used in this packet.
