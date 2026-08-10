# Great Smoky Mountains Original — Media rights record v1

Status: **candidate_only — no asset is approved for ingestion.** The source-dossier builder and public manifests remain unchanged and fail-closed; this record does not approve, ingest, or publish media. A later review packet may add tooling and tests without changing that boundary.

Correction recorded 2026-08-09: the file previously proposed for `media_rf_stream` is a mountain vista at stop three, not a stream scene. Its rights record remains valid, but the image is rejected for that slot on identity grounds and cannot be ingested as Roaring Fork stream artwork.

- Reviewed: 2026-08-06 (assets selected, downloaded, hashed, metadata verified via Commons API; access date 2026-08-06 for every row).
- Dossier: `originals/smokies/source_dossiers_v1.json` (`reviewed_at` 2026-08-05), product `great_smoky_mountains_ridges_rivers_living_memory`.
- Originals are retained outside the repository at `/home/sean/.openclaw/evidence/smokies-media-s2/originals/`, mirrored at `C:\Users\User\Documents\Codex\evidence\trailhead\smokies-s2-media\`.
- Envato certificate directory (pending): `docs/licenses/envato/smokies-1.0/`.

## Candidate assets

| Slot | Chapter | Use | Subject | Creator | License | Dimensions | Bytes | Status | Original SHA-256 |
|---|---|---|---|---|---|---:|---:|---|---|
| media_mc_kuwohi | mountain_crossing | chapter_artwork | Exact Kuwohi or Newfound Gap landscape | APK | CC BY 4.0 | 3996x2775 | 2524538 | candidate_only | `023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02` |
| media_mc_oconaluftee | mountain_crossing | story_artwork | Exact Oconaluftee valley or Mountain Farm Museum scene | Doug Brinkmeyer (NPS) | Public domain | 4032x3024 | 3782011 | candidate_only | `33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5` |
| media_cc_cove | little_river_cades_cove | chapter_artwork | Exact Cades Cove landscape or historic structure | David Haas (HAER) | Public domain | 5000x3956 | 19782736 | candidate_only | `c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476` |
| media_cc_cable_mill | little_river_cades_cove | story_artwork | Exact Cable Mill or Becky Cable house scene | HABS (Library of Congress) | Public domain | 5000x3611 | 18057520 | candidate_only | `6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd` |
| media_rf_stream | roaring_fork | chapter_artwork | Mountain vista at stop three; does not satisfy the exact stream slot | David Haas (HAER) | Public domain | 5000x4017 | 20087768 | rejected_identity_mismatch | `4a61195ac9a5d7a0dc6037cc3e3d4089def7335d1cafd2f0e20d34091d3c8011` |
| media_rf_ogle | roaring_fork | story_artwork | Exact Noah Ogle farmstead scene | Sarah Stierch (Missvain) | CC BY 4.0 | 4032x3024 | 5281216 | candidate_only | `a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551` |
| media_fp_panorama | foothills_parkway | chapter_artwork | Exact Foothills Parkway ridge panorama | Andrea Walton (NPS) | Public domain | 4032x3024 | 2067676 | candidate_only | `92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8` |
| media_fp_engineering | foothills_parkway | story_artwork | Exact Missing Link bridge or construction scene | Federal Highway Administration | Public domain | 4320x3240 | 1650379 | candidate_only | `ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af` |

Five of the seven retained candidates are public domain. Two (Kuwohi tower, Noah Ogle cabin) are CC BY 4.0 and are **not** public domain — attribution is mandatory and must be carried into product credits if either is approved. The rejected Roaring Fork vista is also public domain, but that does not cure its subject mismatch.

## Per-slot rights detail

### media_mc_kuwohi — Mountain Crossing chapter artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/1/16/Kuwohi_%28also_known_as_Clingmans_Dome%29_Observation_Tower_-_1.jpg` (JPEG)
- dimensions: 3996x2775, 2524538 bytes
- exact_credit: `"Kuwohi (also known as Clingmans Dome) Observation Tower - 1" by APK, CC BY 4.0, via Wikimedia Commons`
- identity_match: Commons file title names the Kuwohi (Clingmans Dome) observation tower, matching the slot subject "Exact Kuwohi or Newfound Gap landscape" for the Mountain Crossing Kuwohi segment. Slot source page reviewed: `https://www.nps.gov/grsm/planyourvisit/kuwohi-nfg.htm` (snapshot `kuwohi.html` in evidence).
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Kuwohi_(also_known_as_Clingmans_Dome)_Observation_Tower_-_1.jpg` — Commons API extmetadata (accessed 2026-08-06): LicenseShortName `CC BY 4.0`, Artist `APK`, Credit `Own work`. No certificate PDF applies to non-Envato sources.
- rights_basis: CC BY 4.0 grant by the creator; commercial use permitted with attribution.
- sha256: `023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02`

### media_mc_oconaluftee — Mountain Crossing story artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/b/ba/Elk_near_Oconaluftee_Visitor_Center--Doug_Brinkmeyer_%2840184499233%29.jpg` (JPEG)
- dimensions: 4032x3024, 3782011 bytes
- exact_credit: `Elk near Oconaluftee Visitor Center, Doug Brinkmeyer, Great Smoky Mountains National Park (NPS), public domain`
- identity_match: NPS photograph of elk near the Oconaluftee Visitor Center, matching the slot subject "Exact Oconaluftee valley or Mountain Farm Museum scene". Slot source page reviewed: `https://www.nps.gov/grsm/planyourvisit/oconaluftee.htm` (snapshot `oconaluftee.html` in evidence).
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Elk_near_Oconaluftee_Visitor_Center--Doug_Brinkmeyer_(40184499233).jpg` — extmetadata: LicenseShortName `Public domain`, Artist `Great Smoky Mountains National Park from Gatlinburg, TN` (official NPS Flickr account), Credit `Elk near Oconaluftee Visitor Center--Doug Brinkmeyer`.
- rights_basis: NPS-created work, public domain as a U.S. Government work (17 U.S.C. § 105); Commons designation confirms. Commercial republication must carry the NPS § 403 notice (see policy notes).
- sha256: `33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5`

### media_cc_cove — Little River / Cades Cove chapter artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/5/53/View_of_Cades_Cove_Loop_Road_with_fields_and_mountains_looking_NE._-_Great_Smoky_Mountains_National_Park_Roads_and_Bridges%2C_Cades_Cove_Road_and_Laurel_Creek_Road%2C_From_HAER_TENN%2C78-GAT.V%2C6D-26.tif` (TIFF)
- dimensions: 5000x3956, 19782736 bytes
- exact_credit: `View of Cades Cove Loop Road with fields and mountains looking NE, HAER TENN,78-GAT.V,6D-26 (David Haas), Great Smoky Mountains National Park Roads and Bridges survey, Library of Congress, public domain`
- identity_match: HAER survey photograph of the Cades Cove Loop Road with fields and mountains, matching "Exact Cades Cove landscape or historic structure". Slot source page reviewed: `https://www.nps.gov/grsm/planyourvisit/cadescove.htm`.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:View_of_Cades_Cove_Loop_Road_with_fields_and_mountains_looking_NE._-_Great_Smoky_Mountains_National_Park_Roads_and_Bridges,_Cades_Cove_Road_and_Laurel_Creek_Road,_From_HAER_TENN,78-GAT.V,6D-26.tif` — extmetadata: LicenseShortName `Public domain`, Artist `Haas, David, creator`, Credit/LOC item `https://www.loc.gov/pictures/item/tn0281.photos.365919p`.
- rights_basis: HABS/HAER photograph produced for the U.S. Government; public domain under 17 U.S.C. § 105.
- sha256: `c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476`

### media_cc_cable_mill — Little River / Cades Cove story artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/2/22/PERSPECTIVE_VIEW_OF_EAST_%28FRONT%29_AND_NORTH_SIDE_-_Becky_Cable_House%2C_Townsend%2C_Blount_County%2C_TN_HABS_TENN%2C5-CADCO%2C4-1.tif` (TIFF)
- dimensions: 5000x3611, 18057520 bytes
- exact_credit: `Perspective view of east (front) and north side, Becky Cable House, Townsend, Blount County, TN, HABS TENN,5-CADCO,4-1, Library of Congress, public domain`
- identity_match: HABS perspective view of the Becky Cable House (Cable family), matching the slot subject "Exact Cable Mill or Becky Cable house scene". Slot source page reviewed: `https://www.nps.gov/grsm/planyourvisit/cadescove.htm`.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:PERSPECTIVE_VIEW_OF_EAST_(FRONT)_AND_NORTH_SIDE_-_Becky_Cable_House,_Townsend,_Blount_County,_TN_HABS_TENN,5-CADCO,4-1.tif` — extmetadata: LicenseShortName `Public domain`, Credit/LOC item `https://www.loc.gov/pictures/item/tn0272.photos.153667p`.
- rights_basis: HABS photograph produced for the U.S. Government; public domain under 17 U.S.C. § 105.
- sha256: `6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd`

### media_rf_stream — rejected Roaring Fork stream candidate

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/a/a4/Roaring_Fork_Motor_Nature_Trail%2C_vista_at_stop_three._-_Great_Smoky_Mountains_National_Park_Roads_and_Bridges%2C_Roaring_Fork_Motor_Nature_Trail%2C_Between_Cherokee_Orchard_Road_HAER_TENN%2C78-GAT.V%2C6G-5.tif` (TIFF)
- dimensions: 5000x4017, 20087768 bytes
- exact_credit: `Roaring Fork Motor Nature Trail, vista at stop three, HAER TENN,78-GAT.V,6G-5 (David Haas), Great Smoky Mountains National Park Roads and Bridges survey, Library of Congress, public domain`
- identity_mismatch: visual inspection confirms a mountain vista photographed at stop three. The file does not depict the stream-and-road scene required by the `media_rf_stream` slot. The authoritative HAER title also says `vista at stop three`; the earlier match claim was incorrect.
- disposition: `rejected_identity_mismatch`. Keep the file only as historical research evidence. Do not ingest, crop, rename, or reuse it as stream artwork. The dossier slot remains `exact_asset_not_selected` until a replacement is separately reviewed and approved.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Roaring_Fork_Motor_Nature_Trail,_vista_at_stop_three._-_Great_Smoky_Mountains_National_Park_Roads_and_Bridges,_Roaring_Fork_Motor_Nature_Trail,_Between_Cherokee_Orchard_Road_HAER_TENN,78-GAT.V,6G-5.tif` — extmetadata: LicenseShortName `Public domain`, Artist `Haas, David, creator`, Credit/LOC item `https://www.loc.gov/pictures/item/tn0284.photos.365952p`.
- rights_basis: HABS/HAER photograph produced for the U.S. Government; public domain under 17 U.S.C. § 105.
- sha256: `4a61195ac9a5d7a0dc6037cc3e3d4089def7335d1cafd2f0e20d34091d3c8011`

### media_rf_ogle — Roaring Fork story artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/4/4e/Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg` (JPEG)
- dimensions: 4032x3024, 5281216 bytes
- exact_credit: `Noah "Bud" Ogle Cabin, October 2023, by Sarah Stierch (Missvain), CC BY 4.0, via Wikimedia Commons`
- identity_match: Photograph of the Noah "Bud" Ogle Cabin, matching "Exact Noah Ogle farmstead scene". Slot source page reviewed: `https://www.nps.gov/grsm/planyourvisit/roaringfork.htm`.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Noah_%22Bud%22_Ogle_Cabin_-_October_2023_-_Sarah_Stierch.jpg` — extmetadata: LicenseShortName `CC BY 4.0`, Artist `Missvain`, Credit `Own work`.
- rights_basis: CC BY 4.0 grant by the creator; commercial use permitted with attribution.
- sha256: `a828bf6c6d7f2650268f67b39669b1958f80c34dd845705f60423d8a0dfea551`

### media_fp_panorama — Foothills Parkway chapter artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/2/2a/Foothills_Parkway%2C_October_2018--Andrea_Walton_%2843968388000%29.jpg` (JPEG)
- dimensions: 4032x3024, 2067676 bytes
- exact_credit: `Foothills Parkway, October 2018, Andrea Walton, Great Smoky Mountains National Park (NPS), public domain`
- identity_match: NPS photograph of the Foothills Parkway, matching "Exact Foothills Parkway ridge panorama". Slot source page reviewed: `https://www.nps.gov/places/foothills-parkway.htm`.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Foothills_Parkway,_October_2018--Andrea_Walton_(43968388000).jpg` — extmetadata: LicenseShortName `Public domain`, Artist `Great Smoky Mountains National Park from Gatlinburg, TN` (official NPS Flickr account), Credit `Foothills Parkway, October 2018--Andrea Walton`.
- rights_basis: NPS-created work, public domain as a U.S. Government work (17 U.S.C. § 105); Commons designation confirms. Commercial republication must carry the NPS § 403 notice (see policy notes).
- sha256: `92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8`

### media_fp_engineering — Foothills Parkway story artwork

- asset_url: `https://upload.wikimedia.org/wikipedia/commons/5/58/Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_Tennessee_%2820133297129%29.jpg` (JPEG)
- dimensions: 4320x3240, 1650379 bytes
- exact_credit: `Foothills Parkway Bridge number 2, Great Smoky Mountains National Park, Federal Highway Administration (FHWA), public domain`
- identity_match: FHWA photograph of Foothills Parkway Bridge number 2, matching "Exact Missing Link bridge or construction scene" for the Foothills Parkway engineering story. Slot source page reviewed: `https://www.nps.gov/grsm/learn/news/foothills-parkway-opening.htm`.
- license_record: Commons file page `https://commons.wikimedia.org/wiki/File:Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_Tennessee_(20133297129).jpg` — extmetadata: LicenseShortName `Public domain`, Artist `Federal Highway Administration (FHWA)`, Credit `IMG_1682-FOOTHILLS PARKWAY BRIGE 2` (sic, original caption).
- rights_basis: FHWA (U.S. Department of Transportation) work, public domain under 17 U.S.C. § 105.
- sha256: `ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af`

## NPS rights policy notes (source: https://www.nps.gov/aboutus/disclaimer.htm, accessed 2026-08-06)

- NPS-produced material is "generally considered in the public domain. It may be distributed or copied as permitted by applicable law." A citation or acknowledgement of the National Park Service as the source is appreciated.
- Commercial republication requirement, verbatim: "when such information is published or republished commercially, in part or in full, the copyright notice must include a reference to the original U.S. Government work, (see, 17 U.S.C.§ 403), such as: 'No protection is claimed in original U.S. Government works' or 'No claim to original U.S. Government works.'" Any shipped product using the NPS-authored rows must carry that notice.
- Trademark exclusion, confirmed: "Some National Park Service sites contain registered trademarks, such as, the National Park Service Arrowhead symbol and National Park Service Secondary Mark." The Arrowhead is excluded from this project; none of the eight candidates depicts or includes the Arrowhead.
- Third-party caveat: "not all materials appearing on this website, social media, and associated National Park Service material are in the public domain." Third-party assets hosted on NPS pages require individual review. No third-party NPS-hosted asset is used here; the two NPS photographs above are NPS staff photographs published on the official NPS account and designated public domain on Commons.

## Envato Elements candidates — pending membership download

Browser automation was unavailable in this session, so no Envato item was downloaded and no license certificate was issued. The active Elements membership remains the intended source for supplemental cinematic photography. All three candidates stay unlicensed until downloaded with a certificate.

| Candidate | Envato item ID | Intended role | Status |
|---|---|---|---|
| Wide overlook shot | GPCYQEB | supplemental scenery, no dossier slot | pending_membership_download |
| Fog valley aerial | QMBV2WR | supplemental scenery, no dossier slot | pending_membership_download |
| Rain/forest mood | AD54PH5 | supplemental scenery, no dossier slot | pending_membership_download |

Certificates must land in `docs/licenses/envato/smokies-1.0/` with item ID, author, dimensions, original SHA-256, certificate SHA-256, and license date recorded before any Envato asset may be considered for ingestion.

## Gating

- Every retained row above is `candidate_only`; `media_rf_stream` is `rejected_identity_mismatch`. The dossier's fail-closed contract (no approved media until one exact asset is cleared with all seven rights fields) is unchanged, and `scripts/build_smokies_source_dossiers.py` and its tests were not modified in this packet.
- If an asset is later approved, the approval must name the exact slot, the exact SHA-256 above, and the exact credit, and the builder gate must be re-run before any ingestion path exists.
