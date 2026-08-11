#!/usr/bin/env python3
"""Build the deterministic Mountain Crossing + Cades Cove review packet.

This is a review-only builder.  It binds the exact remaining scripts, five
Mountain Crossing reverse-direction overrides, four artwork originals, the
six-original sanitation proposal, and the already accepted Foothills/Roaring
Fork evidence.  It cannot approve an item, create a derivative, synthesize
audio, access a database, upload media, deploy, or publish.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from PIL import Image


REPOSITORY = Path(__file__).resolve().parents[1]
ORIGINALS = REPOSITORY / "originals/smokies"
OUTPUT_PATH = ORIGINALS / "remaining_chapters_review_packet_v1.json"
MARKDOWN_OUTPUT_PATH = (
    REPOSITORY / "docs/originals/mountain-crossing-cades-cove-review-sheet-v1.md"
)

PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
PACKET_ID = "smokies_mountain_crossing_cades_cove_review_20260810_v1"
SOURCE_TASK_ID = "019fe9fb-cafa-75d3-b663-1e5051731cd5"
US_GOVERNMENT_WORK_NOTICE = "No claim to original U.S. Government works."

SOURCE_PATHS = {
    "mountain_editorial": ORIGINALS / "editorial_mountain_crossing_v1.json",
    "cades_editorial": ORIGINALS / "editorial_cades_cove_v1.json",
    "source_dossier": ORIGINALS / "source_dossiers_v1.json",
    "route_variants": ORIGINALS / "route_variants_v1.json",
    "official_route_evidence": ORIGINALS / "official_route_evidence_v1.json",
    "public_record_scope_determination": (
        ORIGINALS / "smokies_public_record_scope_determination_v1.json"
    ),
    "media_rights": REPOSITORY / "docs/originals/smokies-media-rights-v1.md",
    "foothills_review_packet": ORIGINALS / "foothills_parkway_review_packet_v1.json",
    "foothills_review_sheet": (
        REPOSITORY / "docs/originals/foothills-parkway-review-sheet-v1.md"
    ),
    "foothills_approval": ORIGINALS / "foothills_parkway_approval_v1.json",
    "james_foothills_lock": (
        ORIGINALS / "elevenlabs_james_foothills_parkway_lock_v1.json"
    ),
    "james_mountain_lock": (
        ORIGINALS / "elevenlabs_james_mountain_crossing_lock_v1.json"
    ),
    "james_cades_lock": ORIGINALS / "elevenlabs_james_cades_cove_lock_v1.json",
    "james_remaining_batch_preflight": (
        ORIGINALS / "elevenlabs_james_remaining_batch_preflight_v1.json"
    ),
    "roaring_fork_private_manifest": (
        ORIGINALS / "roaring_fork_private_manifest_v3.json"
    ),
    "roaring_fork_narration_profile": (
        ORIGINALS / "roaring_fork_narration_profile_v2.json"
    ),
    "roaring_fork_publication_readiness": (
        ORIGINALS / "roaring_fork_publication_readiness_v1.json"
    ),
}

EXPECTED_SOURCE_SHA256 = {
    "mountain_editorial": (
        "4a7e0acf04075da914ef486b86210167ff4220b8ea901083bd4df75d8fe21c58"
    ),
    "cades_editorial": (
        "1fedc6db4944bab671d7cfa0bacd2dda9670133d4165e27b3fe7b63ef8728845"
    ),
    "source_dossier": (
        "8eb22ca5110f0f9a4287b8f184624348c2a2ca2dbc36e27ef59fc022057ce18f"
    ),
    "route_variants": (
        "49d55fa8819822b18af54983ea11893a661689102c14532a88ebacf2ec587f24"
    ),
    "official_route_evidence": (
        "d946ffaf8f21ad97399b6dedfb5cbe9483fce0787653b389d7075d933f398c60"
    ),
    "public_record_scope_determination": (
        "bea2ed1a3a5df0a54c7369ec3738155a5530cea93f26531959475442b9758f3d"
    ),
    "media_rights": (
        "53e515e3f3ce46cb9dd4c9d19be38d008ea5bb603e31a6be53bf5afdb7f0ab15"
    ),
    "foothills_review_packet": (
        "7a3217f0dc11c503f43ca12d82b339d5537de6365441f607eacfd7c3945ea926"
    ),
    "foothills_review_sheet": (
        "aef724ffa60792be57d2efeed3668c32127518787119f31b44243f211620d240"
    ),
    "foothills_approval": (
        "a301c702155512c66df60e819274271fc9a6001b398266be5d9a6329a82592bb"
    ),
    "james_foothills_lock": (
        "eac2d636c4c26fd55fbc4ebe7b7be25882ffd51e6064703924d96d89fa71c119"
    ),
    "james_mountain_lock": (
        "561a8a8bf62f534d485df0ebf523d13a9defd962af136240fd46e1ca5aacec25"
    ),
    "james_cades_lock": (
        "6c6fecdaa85d91f4e29cd08ea9c46f20d404dba8ed72962390b8d8d8dc5b6a04"
    ),
    "james_remaining_batch_preflight": (
        "e396aff7b495f087838cfb284a5d9e6a7ac43c9b873550e2a71a5527a41379b4"
    ),
    "roaring_fork_private_manifest": (
        "7e9cab7e0325c6124a2605c83867929780f575e5814c7fdc634c091a9c351467"
    ),
    "roaring_fork_narration_profile": (
        "10fd4f5f04cbfbc411a1e7c31061700d17752af61e1501a4b7b4652c0d2ee377"
    ),
    "roaring_fork_publication_readiness": (
        "81317b0bcdb052f1b9396fbe861aec20db3b72a9bd3f745ab5d88618ad58a199"
    ),
}

CHAPTER_SPECS: dict[str, dict[str, Any]] = {
    "mountain_crossing": {
        "editorial_source": "mountain_editorial",
        "base_variant_id": "tn_to_nc",
        "variant_ids": ("tn_to_nc", "nc_to_tn"),
        "story_ids": tuple(f"mc_story_{index:02d}" for index in range(1, 19)),
        "cue_ids": tuple(f"mc_cue_{index:02d}" for index in range(1, 11)),
        "override_ids": (
            "mc_cue_01",
            "mc_cue_02",
            "mc_cue_04",
            "mc_cue_08",
            "mc_cue_09",
        ),
        "claim_ids": (
            "mc_bear_country",
            "mc_biodiversity",
            "mc_ccc_legacy",
            "mc_deep_geology",
            "mc_elk_restoration",
            "mc_forest_zones",
            "mc_gap_context",
            "mc_gateway_watershed",
            "mc_haze_and_pollution",
            "mc_high_country",
            "mc_kuwohi_name",
            "mc_kuwohi_public_record",
            "mc_logging_recovery",
            "mc_mountain_farm",
            "mc_oconaluftee_valley",
            "mc_park_creation",
            "mc_rain_and_streams",
            "mc_road_engineering",
            "mc_segregated_landscape",
        ),
        "source_ids": (
            "nps_grsm_air_quality",
            "nps_grsm_animals",
            "nps_grsm_black_bears",
            "nps_grsm_cherokee",
            "nps_grsm_elk",
            "nps_grsm_geology",
            "nps_grsm_history_culture",
            "nps_grsm_kuwohi_area",
            "nps_grsm_kuwohi_restoration",
            "nps_grsm_mountain_farm",
            "nps_grsm_natural_features",
            "nps_grsm_nature",
            "nps_grsm_newfound_gap_road",
            "nps_grsm_oconaluftee",
            "nps_grsm_people",
            "nps_grsm_segregation",
            "nps_grsm_statistics",
            "nps_grsm_timeline",
            "nps_grsm_vegetation",
        ),
        "geometry": {
            "tn_to_nc": {
                "sha256": "4a003a6bde4d0c9623a71875bb5f369050f11202f58cd5c02d9451377ad980ab",
                "distance_m": 73_505.4,
            },
            "nc_to_tn": {
                "sha256": "2da7812bfd8f129492420cf6cfeca2d990950a0eb057f98c586bbcbd4aaad5b3",
                "distance_m": 73_230.7,
            },
        },
    },
    "little_river_cades_cove": {
        "editorial_source": "cades_editorial",
        "base_variant_id": "sugarlands_to_cades_cove_loop",
        "variant_ids": ("sugarlands_to_cades_cove_loop",),
        # The accepted editorial order is intentionally non-lexical.
        "story_ids": (
            "cc_story_01",
            "cc_story_02",
            "cc_story_03",
            "cc_story_04",
            "cc_story_05",
            "cc_story_06",
            "cc_story_10",
            "cc_story_07",
            "cc_story_08",
            "cc_story_09",
            "cc_story_13",
            "cc_story_11",
            "cc_story_12",
            "cc_story_14",
        ),
        "cue_ids": tuple(f"cc_cue_{index:02d}" for index in range(1, 10)),
        "override_ids": (),
        "claim_ids": (
            "cc_cable_mill",
            "cc_cherokee_public_record",
            "cc_churches",
            "cc_cove_geology",
            "cc_farming",
            "cc_general_store",
            "cc_john_oliver",
            "cc_little_river",
            "cc_logging_corridor",
            "cc_loop_context",
            "cc_park_acquisition",
            "cc_population",
            "cc_settlement",
            "cc_waterfall_landscape",
            "cc_wildlife",
        ),
        "source_ids": (
            "nps_grsm_black_bears",
            "nps_grsm_cable_mill",
            "nps_grsm_cades_cove",
            "nps_grsm_cades_history",
            "nps_grsm_cades_overlook",
            "nps_grsm_general_stores",
            "nps_grsm_geology",
            "nps_grsm_natural_features",
            "nps_grsm_people",
            "nps_grsm_timeline",
        ),
        "geometry": {
            "sugarlands_to_cades_cove_loop": {
                "sha256": "9f77ba8f704e82b3fb43e81f330a20771e2d8d87b44fe1fae29329cf082255c8",
                "distance_m": 56_937.5,
            },
        },
    },
}

EXPECTED_SUBSET_SHA256 = {
    "mountain_crossing": {
        "claims": "b9f318d8b4eef209ffb5cbb9e99e09510e154b094dc96afd050c1c3ba4de317d",
        "dossier_entries": "a523420e802c4fe2082b37f7af949537500a095f27f3350e222f088f0dee179c",
        "sources": "145aa845c0be64baeebf0cafeb68c7bd87903b1a9d491bb9afdba3fb5ff77611",
        "media_candidates": "61bd187feecd8c1ad7df514164afb556e17ef8d8b97ffd381a839c4f979dc52f",
        "editorial_entries": "a71f9d3a1b16e6d9b48e2070ada86e6110a03c32afb09f080be466a1ed058c18",
        "route_variants": "11aad126275b3c2dec7789e525341fa2be27db5cba5daf1e10592c8ac0e47b28",
        "route_evidence": "a36c7cfaa94810cb1f0eaab2e7ee1f5f1f3450222308d1f95eb0c7a269bdc748",
    },
    "little_river_cades_cove": {
        "claims": "795d697a546ac328e13813e57bc0389f838093d086bd4cdbdbfd2effdc170295",
        "dossier_entries": "2e5914b259407fc91ff57a14501ba3629f600e382841197c162166841eb64317",
        "sources": "991698693474e5afc224769da9684b50147eed7eebb4fb7e47455ddbfdd14020",
        "media_candidates": "71f4511f75fcda2ed535efce7b75db32439af858bbe5897f395a6d223bb36abd",
        "editorial_entries": "8b08f4bf250cb6d72cf03225e7f51fb992e61f2d760f69fd5c5dd108081284ae",
        "route_variants": "65082ce66d7fd6f8ef536f156d14dc30246a3a2c92082991d58f4f5f81bbd6a2",
        "route_evidence": "8dd088049471402f33b73f8646ba703169293c6f2691efbbbfe54b1c73f71cd8",
    },
}

ARTWORK: tuple[dict[str, Any], ...] = (
    {
        "stable_order": 1,
        "candidate_id": "media_mc_kuwohi",
        "chapter_id": "mountain_crossing",
        "intended_use": "chapter_artwork",
        "subject": "Exact Kuwohi or Newfound Gap landscape",
        "creator": "APK",
        "license_name": "CC BY 4.0",
        "rights_basis": "cc_by_4_0_creator_grant",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/1/16/"
            "Kuwohi_%28also_known_as_Clingmans_Dome%29_Observation_Tower_-_1.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:Kuwohi_"
            "(also_known_as_Clingmans_Dome)_Observation_Tower_-_1.jpg"
        ),
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/kuwohi-nfg.htm",
        "exact_credit": (
            '"Kuwohi (also known as Clingmans Dome) Observation Tower - 1" '
            "by APK, CC BY 4.0, via Wikimedia Commons"
        ),
        "required_commercial_notice": None,
        "identity_match": (
            "Commons file title identifies the Kuwohi observation tower, "
            "matching the exact Mountain Crossing Kuwohi slot"
        ),
        "dimensions": {"width": 3_996, "height": 2_775},
        "original_bytes": 2_524_538,
        "original_sha256": (
            "023e027f74aff09bacbec01e89c144248cf3e633f33faa0413e41518d7157c02"
        ),
        "rights_record_format": "JPEG",
        "source_format": "MPO",
        "source_mode": "RGB",
        "source_frame_count": 2,
        "selected_primary_frame_index": 0,
        "selected_primary_frame_type": "Baseline MP Primary Image",
        "selected_primary_decoded_pixel_sha256": (
            "9a10631cbc0956ff74e985b1612b7945f58e433b90d1194d057968ca7ce2b2a9"
        ),
        "excluded_frame": {
            "index": 1,
            "mp_type": "Undefined",
            "dimensions": {"width": 1_998, "height": 1_388},
            "mode": "L",
            "decoded_pixel_sha256": (
                "e6a5bf9404280b65469fdfba99d8f9aeacbf021a4b1014fe87232399b6aa38a3"
            ),
            "included_in_proposed_derivative": False,
        },
        "exif_orientation": 1,
        "gps_metadata_present": True,
        "device_metadata_present": True,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 536,
        "icc_profile_sha256": (
            "0ff6958f98684c61f6bbdce1368ddeaf3873baf84545baba482e920d92a914c0"
        ),
        "local_evidence_locator": "smokies_media_s2:media_mc_kuwohi",
    },
    {
        "stable_order": 2,
        "candidate_id": "media_mc_oconaluftee",
        "chapter_id": "mountain_crossing",
        "intended_use": "story_artwork",
        "subject": "Exact Oconaluftee valley or Mountain Farm Museum scene",
        "creator": "Doug Brinkmeyer (NPS)",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/b/ba/"
            "Elk_near_Oconaluftee_Visitor_Center--Doug_Brinkmeyer_"
            "%2840184499233%29.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:"
            "Elk_near_Oconaluftee_Visitor_Center--Doug_Brinkmeyer_"
            "(40184499233).jpg"
        ),
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/oconaluftee.htm",
        "exact_credit": (
            "Elk near Oconaluftee Visitor Center, Doug Brinkmeyer, Great "
            "Smoky Mountains National Park (NPS), public domain"
        ),
        "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
        "identity_match": (
            "NPS photograph of elk near Oconaluftee Visitor Center matching "
            "the exact valley or Mountain Farm Museum scene slot"
        ),
        "dimensions": {"width": 4_032, "height": 3_024},
        "original_bytes": 3_782_011,
        "original_sha256": (
            "33a44dea4f933f68af8d6e9cc70aaf68ede2ef418f675b87ef3d51cfd8bc21c5"
        ),
        "rights_record_format": "JPEG",
        "source_format": "JPEG",
        "source_mode": "RGB",
        "source_frame_count": 1,
        "selected_primary_frame_index": 0,
        "selected_primary_frame_type": "single_image",
        "selected_primary_decoded_pixel_sha256": (
            "45662a01caa9006164aa1abe6d7938020035c24ee46e16dc8ea991bce631d661"
        ),
        "excluded_frame": None,
        "exif_orientation": 1,
        "gps_metadata_present": True,
        "device_metadata_present": True,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 548,
        "icc_profile_sha256": (
            "e468e89239fc0493d5e8fb9b014e91b210c6caa73c81edf04c3d21a734f377cc"
        ),
        "local_evidence_locator": "smokies_media_s2:media_mc_oconaluftee",
    },
    {
        "stable_order": 3,
        "candidate_id": "media_cc_cove",
        "chapter_id": "little_river_cades_cove",
        "intended_use": "chapter_artwork",
        "subject": "Exact Cades Cove landscape or historic structure",
        "creator": "David Haas (HAER)",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/5/53/"
            "View_of_Cades_Cove_Loop_Road_with_fields_and_mountains_looking_NE._-_"
            "Great_Smoky_Mountains_National_Park_Roads_and_Bridges%2C_Cades_"
            "Cove_Road_and_Laurel_Creek_Road%2C_From_HAER_TENN%2C78-GAT.V%2C6D-26.tif"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:View_of_Cades_Cove_Loop_"
            "Road_with_fields_and_mountains_looking_NE._-_Great_Smoky_Mountains_"
            "National_Park_Roads_and_Bridges,_Cades_Cove_Road_and_Laurel_Creek_"
            "Road,_From_HAER_TENN,78-GAT.V,6D-26.tif"
        ),
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/cadescove.htm",
        "exact_credit": (
            "View of Cades Cove Loop Road with fields and mountains looking NE, "
            "HAER TENN,78-GAT.V,6D-26 (David Haas), Great Smoky Mountains "
            "National Park Roads and Bridges survey, Library of Congress, public domain"
        ),
        "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
        "identity_match": (
            "HAER survey photograph of Cades Cove Loop Road with fields and "
            "mountains matching the exact Cades Cove landscape slot"
        ),
        "dimensions": {"width": 5_000, "height": 3_956},
        "original_bytes": 19_782_736,
        "original_sha256": (
            "c01e63f283a7b8b63d721792172ffcc772c168a4f6e32c788e9f4344308de476"
        ),
        "rights_record_format": "TIFF",
        "source_format": "TIFF",
        "source_mode": "L",
        "source_frame_count": 1,
        "selected_primary_frame_index": 0,
        "selected_primary_frame_type": "single_image",
        "selected_primary_decoded_pixel_sha256": (
            "48f75e13a45043481385ea91e31f411c08816ab6255d2091acaa60e9ab0ea8c3"
        ),
        "excluded_frame": None,
        "exif_orientation": 1,
        "gps_metadata_present": False,
        "device_metadata_present": False,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 0,
        "icc_profile_sha256": None,
        "local_evidence_locator": "smokies_media_s2:media_cc_cove",
    },
    {
        "stable_order": 4,
        "candidate_id": "media_cc_cable_mill",
        "chapter_id": "little_river_cades_cove",
        "intended_use": "story_artwork",
        "subject": "Exact Cable Mill or Becky Cable house scene",
        "creator": "HABS (Library of Congress)",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/2/22/"
            "PERSPECTIVE_VIEW_OF_EAST_%28FRONT%29_AND_NORTH_SIDE_-_Becky_Cable_"
            "House%2C_Townsend%2C_Blount_County%2C_TN_HABS_TENN%2C5-CADCO%2C4-1.tif"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:PERSPECTIVE_VIEW_OF_EAST_"
            "(FRONT)_AND_NORTH_SIDE_-_Becky_Cable_House,_Townsend,_Blount_"
            "County,_TN_HABS_TENN,5-CADCO,4-1.tif"
        ),
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/cadescove.htm",
        "exact_credit": (
            "Perspective view of east (front) and north side, Becky Cable "
            "House, Townsend, Blount County, TN, HABS TENN,5-CADCO,4-1, "
            "Library of Congress, public domain"
        ),
        "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
        "identity_match": (
            "HABS perspective view of Becky Cable House matching the exact "
            "Cable Mill or Becky Cable house scene slot"
        ),
        "dimensions": {"width": 5_000, "height": 3_611},
        "original_bytes": 18_057_520,
        "original_sha256": (
            "6b9d41b9ce8599d17fe94d478866d2d0384d6f0b8dd005ee5183e41abe5549cd"
        ),
        "rights_record_format": "TIFF",
        "source_format": "TIFF",
        "source_mode": "L",
        "source_frame_count": 1,
        "selected_primary_frame_index": 0,
        "selected_primary_frame_type": "single_image",
        "selected_primary_decoded_pixel_sha256": (
            "16c9641cd5175cec983c0d6cfdd3d8dabe34a676236f465564731b06e4fc7ea1"
        ),
        "excluded_frame": None,
        "exif_orientation": 1,
        "gps_metadata_present": False,
        "device_metadata_present": False,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 0,
        "icc_profile_sha256": None,
        "local_evidence_locator": "smokies_media_s2:media_cc_cable_mill",
    },
)

FOOTHILLS_SANITATION_SOURCES: tuple[dict[str, Any], ...] = (
    {
        "candidate_id": "media_fp_panorama",
        "chapter_id": "foothills_parkway",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/2/2a/"
            "Foothills_Parkway%2C_October_2018--Andrea_Walton_"
            "%2843968388000%29.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:Foothills_Parkway,_"
            "October_2018--Andrea_Walton_(43968388000).jpg"
        ),
        "source_page_url": "https://www.nps.gov/places/foothills-parkway.htm",
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "exact_credit": (
            "Foothills Parkway, October 2018, Andrea Walton, Great Smoky "
            "Mountains National Park (NPS), public domain"
        ),
        "original_bytes": 2_067_676,
        "original_sha256": (
            "92da599e63f7f2afabd81106d6649441b11b5406e7c94ec3ba448c643e6f19d8"
        ),
        "source_format": "JPEG",
        "source_mode": "RGB",
        "source_frame_count": 1,
        "selected_primary_frame_index": 0,
        "dimensions": {"width": 4_032, "height": 3_024},
        "selected_primary_decoded_pixel_sha256": (
            "aefcc7e4e6fed1cb0c9b8bb93ade3fe9185f3399e8aa9bdd78c00f46ece2b3e6"
        ),
        "exif_orientation": 1,
        "gps_metadata_present": True,
        "device_metadata_present": True,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 0,
        "icc_profile_sha256": None,
        "exact_original_user_visual_approval": True,
        "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
    },
    {
        "candidate_id": "media_fp_engineering",
        "chapter_id": "foothills_parkway",
        "asset_url": (
            "https://upload.wikimedia.org/wikipedia/commons/5/58/"
            "Foothills_Parkway_Bridge_number_2_in_Great_Smoky_Mountains_"
            "National_Park_in_Tennessee_%2820133297129%29.jpg"
        ),
        "license_record_url": (
            "https://commons.wikimedia.org/wiki/File:Foothills_Parkway_"
            "Bridge_number_2_in_Great_Smoky_Mountains_National_Park_in_"
            "Tennessee_(20133297129).jpg"
        ),
        "source_page_url": (
            "https://www.nps.gov/grsm/learn/news/foothills-parkway-opening.htm"
        ),
        "license_name": "Public domain",
        "rights_basis": "public_domain_us_government_work",
        "exact_credit": (
            "Foothills Parkway Bridge number 2, Great Smoky Mountains "
            "National Park, Federal Highway Administration (FHWA), public domain"
        ),
        "original_bytes": 1_650_379,
        "original_sha256": (
            "ed4f3bc69b7fd0f34040e3214a1633f410327c0deb3c0c04412d861760de78af"
        ),
        "source_format": "JPEG",
        "source_mode": "RGB",
        "source_frame_count": 1,
        "selected_primary_frame_index": 0,
        "dimensions": {"width": 4_320, "height": 3_240},
        "selected_primary_decoded_pixel_sha256": (
            "6be15ca5db35336ee346160d312bf1bea55d1a6152a8aa9493cc845cee72798d"
        ),
        "exif_orientation": 1,
        "gps_metadata_present": False,
        "device_metadata_present": True,
        "date_or_identity_metadata_present": True,
        "icc_profile_bytes": 7_261,
        "icc_profile_sha256": (
            "a5371b9dce12310e48b2dd8684a15ef1a36b931af156e60f8ee9065f69687488"
        ),
        "exact_original_user_visual_approval": True,
        "required_commercial_notice": US_GOVERNMENT_WORK_NOTICE,
    },
)


class RemainingReviewError(ValueError):
    """The review evidence is incomplete, altered, or over-authorized."""


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise RemainingReviewError(f"unavailable input: {path.name}") from error
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RemainingReviewError(f"unavailable JSON input: {path.name}") from error
    if not isinstance(value, dict):
        raise RemainingReviewError(f"expected JSON object: {path.name}")
    return value


def _binding(name: str, path: Path) -> dict[str, Any]:
    actual = _sha256_path(path)
    if actual != EXPECTED_SOURCE_SHA256[name]:
        raise RemainingReviewError(f"source binding drifted: {name}")
    try:
        display_path = path.relative_to(REPOSITORY).as_posix()
    except ValueError:
        # Test fixtures may replace a bound file; never serialize their host path.
        display_path = f"external_fixture/{path.name}"
    return {
        "path": display_path,
        "byte_count": path.stat().st_size,
        "sha256": actual,
    }


def _subset(chapter_id: str, name: str, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if _canonical_sha256(value) != EXPECTED_SUBSET_SHA256[chapter_id][name]:
        raise RemainingReviewError(f"{chapter_id} {name} subset drifted")
    return value


def _assert_dossier(dossier: dict[str, Any]) -> None:
    if dossier.get("product_id") != PRODUCT_ID:
        raise RemainingReviewError("source dossier product identity drifted")
    cultural = dossier.get("cultural_review")
    if not isinstance(cultural, dict):
        raise RemainingReviewError("source dossier cultural scope is missing")
    if cultural.get("status") != "public_record_only":
        raise RemainingReviewError("source dossier is no longer public-record only")
    if cultural.get("blocked_entry_ids") != []:
        raise RemainingReviewError("blocked cultural entries entered review")


def _assert_public_record_determination(
    value: dict[str, Any], review_claim_ids: list[str]
) -> dict[str, Any]:
    if value.get("schema_version") != 1:
        raise RemainingReviewError("public-record determination schema drifted")
    if value.get("product_id") != PRODUCT_ID:
        raise RemainingReviewError("public-record determination product drifted")
    if value.get("status") != "accepted_internal_scope_determination":
        raise RemainingReviewError("public-record determination is no longer accepted")
    if value.get("scope") != "exact_checked_in_public_record_factual_claims_only":
        raise RemainingReviewError("public-record determination scope drifted")
    if value.get("authority") != "Trailhead project owner":
        raise RemainingReviewError("public-record determination authority drifted")
    if value.get("dossier_sha256") != EXPECTED_SOURCE_SHA256["source_dossier"]:
        raise RemainingReviewError("public-record determination dossier drifted")
    all_claim_ids = value.get("public_record_claim_ids")
    if not isinstance(all_claim_ids, list) or len(all_claim_ids) != 47:
        raise RemainingReviewError("public-record determination inventory drifted")
    if not set(review_claim_ids) <= set(all_claim_ids):
        raise RemainingReviewError("review claim escaped owner determination")
    if value.get("external_outreach_required") is not False:
        raise RemainingReviewError("public-record determination requires outreach")
    if value.get("external_outreach_performed") is not False:
        raise RemainingReviewError("public-record determination claims outreach")
    if value.get("ebci_approval_claimed") is not False:
        raise RemainingReviewError("public-record determination claims EBCI approval")
    expected_prohibited = [
        "culturally_supplied_pronunciation",
        "direct_ebci_member_research",
        "research_on_ebci_tribal_land",
        "sacred_or_traditional_interpretation",
        "tts_rendering_of_gated_content",
        "unpublished_or_restricted_knowledge",
    ]
    if value.get("prohibited_until_approved") != expected_prohibited:
        raise RemainingReviewError("cultural prohibition boundary drifted")
    return {
        "determination_id": value.get("determination_id"),
        "status": value.get("status"),
        "scope": value.get("scope"),
        "authority": value.get("authority"),
        "review_claim_count": len(review_claim_ids),
        "review_claims_all_in_determination": True,
        "external_outreach_required": False,
        "external_outreach_performed": False,
        "ebci_approval_claimed": False,
        "prohibited_until_approved": expected_prohibited,
    }


def _chapter_review(
    chapter_id: str,
    editorial: dict[str, Any],
    dossier: dict[str, Any],
    route_spec: dict[str, Any],
    route_evidence: dict[str, Any],
) -> dict[str, Any]:
    spec = CHAPTER_SPECS[chapter_id]
    expected_entry_ids = spec["story_ids"] + spec["cue_ids"]
    if editorial.get("product_id") != PRODUCT_ID:
        raise RemainingReviewError(f"{chapter_id} editorial product drifted")
    if editorial.get("chapter_id") != chapter_id:
        raise RemainingReviewError(f"{chapter_id} editorial identity drifted")
    if editorial.get("editorial_status") != "draft_review_required":
        raise RemainingReviewError(f"{chapter_id} escaped review-only status")
    if editorial.get("dossier_sha256") != EXPECTED_SOURCE_SHA256["source_dossier"]:
        raise RemainingReviewError(f"{chapter_id} dossier binding drifted")

    entries = editorial.get("entries")
    if not isinstance(entries, list):
        raise RemainingReviewError(f"{chapter_id} editorial entries are invalid")
    entries = _subset(chapter_id, "editorial_entries", entries)
    if tuple(row.get("id") for row in entries) != expected_entry_ids:
        raise RemainingReviewError(f"{chapter_id} entry order or membership drifted")
    if any(row.get("script_status") != "draft_review_required" for row in entries):
        raise RemainingReviewError(f"{chapter_id} script escaped review gate")
    if any(
        not isinstance(row.get("transcript"), str) or not row["transcript"].strip()
        for row in entries
    ):
        raise RemainingReviewError(f"{chapter_id} transcript is missing")

    direction_review = editorial.get("direction_review")
    if chapter_id == "mountain_crossing":
        if direction_review != {
            "base_variant_id": "tn_to_nc",
            "reviewed_variant_ids": ["tn_to_nc", "nc_to_tn"],
            "reviewed_entry_ids": list(expected_entry_ids),
        }:
            raise RemainingReviewError("Mountain Crossing direction review drifted")
    elif direction_review not in (None, {}):
        raise RemainingReviewError("Cades Cove unexpectedly acquired a direction review")

    override_ids = tuple(row["id"] for row in entries if row.get("variant_overrides"))
    if override_ids != spec["override_ids"]:
        raise RemainingReviewError(f"{chapter_id} direction override inventory drifted")

    scripts: list[dict[str, Any]] = []
    for stable_order, entry in enumerate(entries, start=1):
        overrides: list[dict[str, Any]] = []
        for override in entry.get("variant_overrides", []):
            if override.get("chapter_id") != chapter_id:
                raise RemainingReviewError("direction override chapter drifted")
            if override.get("variant_id") != "nc_to_tn":
                raise RemainingReviewError("unexpected Mountain direction override")
            transcript = override.get("transcript")
            if not isinstance(transcript, str) or not transcript.strip():
                raise RemainingReviewError("direction override transcript is missing")
            title = override.get("title")
            overrides.append(
                {
                    **override,
                    "transcript_sha256": hashlib.sha256(
                        transcript.encode("utf-8")
                    ).hexdigest(),
                    "title_sha256": (
                        hashlib.sha256(title.encode("utf-8")).hexdigest()
                        if isinstance(title, str)
                        else None
                    ),
                    "decision_status": "user_approve_or_revise_required",
                    "rendering_allowed": False,
                }
            )
        transcript = entry["transcript"]
        scripts.append(
            {
                **entry,
                "variant_overrides": overrides,
                "stable_order": stable_order,
                "base_variant_id": spec["base_variant_id"],
                "transcript_sha256": hashlib.sha256(
                    transcript.encode("utf-8")
                ).hexdigest(),
                "decision_status": "user_approve_or_revise_required",
                "rendering_allowed": False,
            }
        )

    claims = _subset(
        chapter_id,
        "claims",
        [
            row
            for row in dossier.get("claims", [])
            if isinstance(row, dict) and row.get("chapter_id") == chapter_id
        ],
    )
    if tuple(row.get("id") for row in claims) != spec["claim_ids"]:
        raise RemainingReviewError(f"{chapter_id} claim membership drifted")
    for claim in claims:
        if claim.get("status") != "source_verified":
            raise RemainingReviewError(f"{chapter_id} claim is not source verified")
        if claim.get("cultural_gate") != "not_required":
            raise RemainingReviewError("culturally gated claim entered review")
        if claim.get("cultural_scope") != {
            "classification": "public_record_factual",
            "collection_method": "published_public_record",
            "review_triggers": [],
        }:
            raise RemainingReviewError("claim escaped public-record scope")

    dossier_entries = _subset(
        chapter_id,
        "dossier_entries",
        [
            row
            for row in dossier.get("entries", [])
            if isinstance(row, dict) and row.get("chapter_id") == chapter_id
        ],
    )
    by_id = {row.get("id"): row for row in dossier_entries}
    if set(by_id) != set(expected_entry_ids):
        raise RemainingReviewError(f"{chapter_id} dossier membership drifted")
    for entry in entries:
        outline = by_id[entry["id"]]
        for field in ("kind", "sequence", "title", "claim_ids"):
            if entry.get(field) != outline.get(field):
                raise RemainingReviewError(
                    f"editorial/dossier parity drifted: {entry['id']} {field}"
                )

    used_source_ids = {
        source_id for entry in entries for source_id in entry.get("source_ids", [])
    }
    if tuple(sorted(used_source_ids)) != spec["source_ids"]:
        raise RemainingReviewError(f"{chapter_id} source membership drifted")
    sources = _subset(
        chapter_id,
        "sources",
        [
            row
            for row in dossier.get("sources", [])
            if isinstance(row, dict) and row.get("id") in used_source_ids
        ],
    )
    if tuple(sorted(row.get("id") for row in sources)) != spec["source_ids"]:
        raise RemainingReviewError(f"{chapter_id} source record membership drifted")
    if any(
        row.get("authority") != "official"
        or row.get("publisher") != "National Park Service"
        or row.get("rights_status") != "reference_only"
        or row.get("reviewed_at") not in {"2026-08-05", "2026-08-08"}
        for row in sources
    ):
        raise RemainingReviewError(f"{chapter_id} official source policy drifted")

    media = _subset(
        chapter_id,
        "media_candidates",
        [
            row
            for row in dossier.get("media_candidates", [])
            if isinstance(row, dict) and row.get("chapter_id") == chapter_id
        ],
    )
    expected_media_ids = {
        row["candidate_id"] for row in ARTWORK if row["chapter_id"] == chapter_id
    }
    if {row.get("id") for row in media} != expected_media_ids:
        raise RemainingReviewError(f"{chapter_id} artwork membership drifted")
    if any(row.get("status") != "exact_asset_not_selected" for row in media):
        raise RemainingReviewError(f"{chapter_id} artwork escaped candidate gate")

    variants = _subset(
        chapter_id,
        "route_variants",
        [
            row
            for row in route_spec.get("variants", [])
            if isinstance(row, dict) and row.get("chapter_id") == chapter_id
        ],
    )
    evidence = _subset(
        chapter_id,
        "route_evidence",
        [
            row
            for row in route_evidence.get("variants", [])
            if isinstance(row, dict) and row.get("chapter_id") == chapter_id
        ],
    )
    if tuple(row.get("variant_id") for row in variants) != spec["variant_ids"]:
        raise RemainingReviewError(f"{chapter_id} route variants drifted")
    if tuple(row.get("variant_id") for row in evidence) != spec["variant_ids"]:
        raise RemainingReviewError(f"{chapter_id} route evidence drifted")
    if len(variants) == 2:
        if variants[0].get("reverse_pair_id") != variants[1].get("id"):
            raise RemainingReviewError("Mountain reverse-pair binding drifted")
        if variants[1].get("reverse_pair_id") != variants[0].get("id"):
            raise RemainingReviewError("Mountain reverse-pair binding drifted")
        if [row.get("id") for row in variants[0].get("anchors", [])] != list(
            reversed([row.get("id") for row in variants[1].get("anchors", [])])
        ):
            raise RemainingReviewError("Mountain route anchor reversal drifted")
    route_rows = []
    for variant, row in zip(variants, evidence, strict=True):
        expected_geometry = spec["geometry"][row["variant_id"]]
        if row.get("status") != "official_geometry_candidate":
            raise RemainingReviewError("route evidence status drifted")
        if row.get("geometry_ready_for_editorial_cues") is not True:
            raise RemainingReviewError("route is not ready for editorial review")
        if row.get("blocking_issues") != []:
            raise RemainingReviewError("route acquired a blocking issue")
        if row.get("geometry_sha256") != expected_geometry["sha256"]:
            raise RemainingReviewError("route geometry identity drifted")
        if row.get("distance_m") != expected_geometry["distance_m"]:
            raise RemainingReviewError("route distance drifted")
        route_rows.append(
            {
                "variant_id": row["variant_id"],
                "route_spec_id": variant["id"],
                "reverse_pair_id": variant.get("reverse_pair_id"),
                "anchor_ids": [anchor["id"] for anchor in variant["anchors"]],
                "geometry_sha256": row["geometry_sha256"],
                "distance_m": row["distance_m"],
                "status": row["status"],
                "geometry_ready_for_editorial_cues": True,
                "publication_evidence": False,
            }
        )

    return {
        "chapter_id": chapter_id,
        "base_variant_id": spec["base_variant_id"],
        "variant_ids": list(spec["variant_ids"]),
        "script_count": len(scripts),
        "story_count": len(spec["story_ids"]),
        "cue_count": len(spec["cue_ids"]),
        "direction_override_count": len(spec["override_ids"]),
        "direction_override_entry_ids": list(spec["override_ids"]),
        "claim_count": len(claims),
        "claim_ids": list(spec["claim_ids"]),
        "claim_set_sha256": EXPECTED_SUBSET_SHA256[chapter_id]["claims"],
        "claims": claims,
        "dossier_entries": dossier_entries,
        "official_sources": sources,
        "route_review_context": {
            "status": "official_geometry_candidate_for_editorial_review_only",
            "publication_status": "blocked",
            "variants": route_rows,
        },
        "scripts": scripts,
    }


def _artwork_rows(dossier: dict[str, Any], rights_text: str) -> list[dict[str, Any]]:
    dossier_media = {
        row.get("id"): row
        for row in dossier.get("media_candidates", [])
        if isinstance(row, dict)
    }
    rows = []
    for artwork in ARTWORK:
        candidate_id = artwork["candidate_id"]
        if f"### {candidate_id} " not in rights_text:
            raise RemainingReviewError(f"rights detail missing: {candidate_id}")
        if artwork["original_sha256"] not in rights_text:
            raise RemainingReviewError(f"rights hash missing: {candidate_id}")
        dossier_row = dossier_media.get(candidate_id)
        if not isinstance(dossier_row, dict):
            raise RemainingReviewError(f"dossier artwork missing: {candidate_id}")
        if dossier_row.get("chapter_id") != artwork["chapter_id"]:
            raise RemainingReviewError(f"artwork chapter drifted: {candidate_id}")
        if dossier_row.get("subject") != artwork["subject"]:
            raise RemainingReviewError(f"artwork subject drifted: {candidate_id}")
        if dossier_row.get("intended_use") != artwork["intended_use"]:
            raise RemainingReviewError(f"artwork intended use drifted: {candidate_id}")
        if dossier_row.get("status") != "exact_asset_not_selected":
            raise RemainingReviewError(f"artwork dossier gate drifted: {candidate_id}")
        rows.append(
            {
                **artwork,
                "status": "candidate_only_user_visual_approval_required",
                "dossier_status": dossier_row["status"],
                "local_hash_verified_at_packet_build": True,
                "exact_original_user_visual_approval": False,
                "sanitation_authorized": False,
                "sanitized_derivative_complete": False,
                "derivative_user_visual_approval": False,
                "ingestion_allowed": False,
                "rendering_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    return rows


def _assert_foothills_approval(value: dict[str, Any]) -> dict[str, Any]:
    approval = value.get("approval", {})
    boundary = value.get("approval_boundary", {})
    scripts = value.get("approved_scripts")
    artwork = value.get("approved_artwork_originals")
    if approval.get("decision_message_sha256") != (
        "7f8518f7db5e9a55049f49c4ea6d6e8f509695231e60cbd607bcb36c88a75a14"
    ):
        raise RemainingReviewError("Foothills owner-decision binding drifted")
    if not isinstance(scripts, list) or len(scripts) != 13:
        raise RemainingReviewError("Foothills approved-script inventory drifted")
    if not isinstance(artwork, list) or len(artwork) != 2:
        raise RemainingReviewError("Foothills approved-artwork inventory drifted")
    expected_review_bindings = [
        {
            "byte_count": SOURCE_PATHS["foothills_review_packet"].stat().st_size,
            "path": SOURCE_PATHS["foothills_review_packet"]
            .relative_to(REPOSITORY)
            .as_posix(),
            "sha256": EXPECTED_SOURCE_SHA256["foothills_review_packet"],
        },
        {
            "byte_count": SOURCE_PATHS["foothills_review_sheet"].stat().st_size,
            "path": SOURCE_PATHS["foothills_review_sheet"]
            .relative_to(REPOSITORY)
            .as_posix(),
            "sha256": EXPECTED_SOURCE_SHA256["foothills_review_sheet"],
        },
    ]
    if value.get("source_bindings") != expected_review_bindings:
        raise RemainingReviewError("Foothills review packet/sheet binding drifted")
    if value.get("source_revision") != {
        "guarded_review_source_commit": "7b37de90f8df9a5f9a04e6fda0a6fc276d4e3cd5",
        "review_gate_checkpoint_commit": "b501dedcb381705a8c84328650f1bfc5db6afc19",
        "review_packet_and_sheet_unchanged_between_bound_commits": True,
        "review_packet_id": "smokies_foothills_parkway_review_20260810_v1",
    }:
        raise RemainingReviewError("Foothills review revision binding drifted")
    if boundary.get("foothills_exact_scripts_user_approved") is not True:
        raise RemainingReviewError("Foothills script approval drifted")
    if boundary.get("foothills_exact_original_artwork_user_approved") is not True:
        raise RemainingReviewError("Foothills artwork approval drifted")
    false_gates = (
        "artwork_sanitation_authorized",
        "artwork_derivatives_created",
        "derivative_visual_approval",
        "foothills_narrator_approved",
        "tts_or_render_authorized",
        "narration_generated",
        "ingestion_allowed",
        "manifest_creation_or_mutation_allowed",
        "upload_allowed",
        "production_mutation_allowed",
        "publication_allowed",
        "public_release",
    )
    if any(boundary.get(name) is not False for name in false_gates):
        raise RemainingReviewError("Foothills downstream boundary drifted")
    expected_art = {row["candidate_id"]: row for row in FOOTHILLS_SANITATION_SOURCES}
    for row in artwork:
        expected = expected_art.get(row.get("candidate_id"))
        if expected is None:
            raise RemainingReviewError("Foothills artwork identity drifted")
        for field in ("original_bytes", "original_sha256", "source_format"):
            source_field = "format" if field == "source_format" else field
            if row.get(source_field) != expected[field]:
                raise RemainingReviewError("Foothills artwork binding drifted")
        if row.get("exact_original_user_visual_approval") is not True:
            raise RemainingReviewError("Foothills exact-original approval drifted")
        if row.get("sanitation_authorized") is not False:
            raise RemainingReviewError("Foothills sanitation became authorized")
    return {
        "status": "preserved_unchanged_s4u_approval_downstream_still_blocked",
        "guarded_source_commit": "bc70fae8a8dad021818d07df5d517c556d133968",
        "approval_event_at": approval.get("approved_at"),
        "decision_text": approval.get("decision_text"),
        "decision_message_sha256": approval.get("decision_message_sha256"),
        "approved_script_count": 13,
        "approved_original_artwork_count": 2,
        "review_source_bindings": expected_review_bindings,
        "review_source_commit": "7b37de90f8df9a5f9a04e6fda0a6fc276d4e3cd5",
        "review_checkpoint_commit": "b501dedcb381705a8c84328650f1bfc5db6afc19",
        "artwork_sanitation_authorized": False,
        "narration_authorized": False,
        "ingestion_allowed": False,
        "publication_allowed": False,
    }


def _assert_roaring_fork(documents: dict[str, dict[str, Any]]) -> dict[str, Any]:
    manifest = documents["roaring_fork_private_manifest"]
    profile = documents["roaring_fork_narration_profile"]
    readiness = documents["roaring_fork_publication_readiness"]
    assets = manifest.get("assets")
    if manifest.get("schema_version") != 3 or not isinstance(assets, list):
        raise RemainingReviewError("Roaring Fork private manifest drifted")
    kinds = [row.get("kind") for row in assets]
    if len(assets) != 20 or kinds.count("narration") != 13 or kinds.count("image") != 7:
        raise RemainingReviewError("Roaring Fork asset inventory drifted")
    if profile.get("schema_version") != 2 or profile.get("provider") != "elevenlabs":
        raise RemainingReviewError("Roaring Fork narration profile drifted")
    accepted = readiness.get("accepted_private_evidence")
    trusted = readiness.get("trusted_private_validation")
    if not isinstance(accepted, dict) or accepted.get("current_asset_count") != 20:
        raise RemainingReviewError("Roaring Fork accepted evidence drifted")
    if accepted.get("narration_count") != 13 or accepted.get("artwork_count") != 7:
        raise RemainingReviewError("Roaring Fork evidence counts drifted")
    if accepted.get("published_version_count") != 0:
        raise RemainingReviewError("Roaring Fork unexpectedly has a published version")
    if accepted.get("narration_profile_canonical_sha256") != (
        "f79b386031ca0faf6e07332e53ea037f957eb7d9871c4bbf05d5b0aff09c2af5"
    ):
        raise RemainingReviewError("Roaring Fork profile identity drifted")
    if not isinstance(trusted, dict) or trusted.get("report_id") != (
        "original_validation_9df694c93ee9ef3809c33f451d04bf28"
    ):
        raise RemainingReviewError("Roaring Fork trusted report drifted")
    if trusted.get("publication_approval") is not False:
        raise RemainingReviewError("Roaring Fork publication gate drifted")
    if trusted.get("must_rerun_after_final_manifest_or_source_change") is not True:
        raise RemainingReviewError("Roaring Fork rerun boundary drifted")
    return {
        "status": "preserved_unchanged_and_excluded_from_this_review",
        "draft_revision": readiness.get("scope", {}).get("draft_revision"),
        "current_asset_count": accepted["current_asset_count"],
        "narration_count": accepted["narration_count"],
        "artwork_count": accepted["artwork_count"],
        "published_version_count": accepted["published_version_count"],
        "private_manifest_file_sha256": EXPECTED_SOURCE_SHA256[
            "roaring_fork_private_manifest"
        ],
        "narration_profile_file_sha256": EXPECTED_SOURCE_SHA256[
            "roaring_fork_narration_profile"
        ],
        "trusted_private_validation": {
            "report_id": trusted["report_id"],
            "redacted_report_sha256": trusted["redacted_report_sha256"],
            "status": trusted["status"],
            "publication_approval": False,
            "must_rerun_after_final_manifest_or_source_change": True,
        },
    }


def _assert_james_render_proposal(
    documents: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    expected = (
        {
            "source_name": "james_foothills_lock",
            "chapter_id": "foothills_parkway",
            "request_count": 16,
            "payload_character_count": 21_408,
            "normalized_character_count": 21_369,
            "reserved_provider_credit_ceiling": 23_557,
            "renderer_character_cap": 23_600,
            "proposed_one_day_api_key_credit_quota": 25_000,
            "dollar_cap_usd": "2.50",
        },
        {
            "source_name": "james_mountain_lock",
            "chapter_id": "mountain_crossing",
            "request_count": 33,
            "payload_character_count": 59_928,
            "normalized_character_count": 59_801,
            "reserved_provider_credit_ceiling": 65_938,
            "renderer_character_cap": 66_000,
            "proposed_one_day_api_key_credit_quota": 70_000,
            "dollar_cap_usd": "7.00",
        },
        {
            "source_name": "james_cades_lock",
            "chapter_id": "little_river_cades_cove",
            "request_count": 23,
            "payload_character_count": 44_259,
            "normalized_character_count": 44_158,
            "reserved_provider_credit_ceiling": 48_695,
            "renderer_character_cap": 48_700,
            "proposed_one_day_api_key_credit_quota": 50_000,
            "dollar_cap_usd": "5.00",
        },
    )
    rows = []
    for row in expected:
        lock = documents[row["source_name"]]
        if lock.get("schema_version") != 1:
            raise RemainingReviewError("James lock schema drifted")
        if lock.get("product_id") != PRODUCT_ID:
            raise RemainingReviewError("James lock product identity drifted")
        if lock.get("chapter_id") != row["chapter_id"]:
            raise RemainingReviewError("James lock chapter identity drifted")
        aggregate = lock.get("aggregate")
        budget = lock.get("budget")
        authorization = lock.get("authorization")
        profile = lock.get("generation_profile")
        if not all(
            isinstance(value, dict)
            for value in (aggregate, budget, authorization, profile)
        ):
            raise RemainingReviewError("James lock contract is incomplete")
        if aggregate.get("provider_request_count") != row["request_count"]:
            raise RemainingReviewError("James request count drifted")
        for field in (
            "payload_character_count",
            "normalized_character_count",
            "reserved_provider_credit_ceiling",
            "renderer_character_cap",
            "proposed_one_day_api_key_credit_quota",
            "dollar_cap_usd",
        ):
            if budget.get(field) != row[field]:
                raise RemainingReviewError(f"James budget drifted: {row['chapter_id']} {field}")
        if budget.get("cross_chapter_borrowing_allowed") is not False:
            raise RemainingReviewError("cross-chapter budget borrowing became allowed")
        if budget.get("rerender_budget") != 0:
            raise RemainingReviewError("James rerender budget drifted")
        if budget.get("paid_overage_authorized") is not False:
            raise RemainingReviewError("James paid overage became authorized")
        false_authorizations = (
            "api_key_creation_authorized",
            "chapter_render_authorized",
            "database_mutation_authorized",
            "ingestion_authorized",
            "manifest_mutation_authorized",
            "network_access_authorized",
            "production_mutation_authorized",
            "provider_credit_spend_authorized",
            "provider_request_authorized",
            "public_release_authorized",
            "rerender_authorized",
            "upload_authorized",
        )
        if any(authorization.get(name) is not False for name in false_authorizations):
            raise RemainingReviewError("James lock escaped fail-closed authorization")
        if profile.get("provider") != "elevenlabs":
            raise RemainingReviewError("James provider identity drifted")
        if profile.get("voice_id") != "EkK5I93UQWFDigLMpZcX":
            raise RemainingReviewError("James voice identity drifted")
        if profile.get("model_id") != "eleven_multilingual_v2":
            raise RemainingReviewError("James model identity drifted")
        if profile.get("voice_settings") != {
            "similarity_boost": 0.5,
            "speed": 1.0,
            "stability": 0.5,
            "style": 0.1,
            "use_speaker_boost": True,
        }:
            raise RemainingReviewError("James voice settings drifted")
        rows.append(
            {
                **{key: value for key, value in row.items() if key != "source_name"},
                "lock_binding": {
                    "path": SOURCE_PATHS[row["source_name"]]
                    .relative_to(REPOSITORY)
                    .as_posix(),
                    "byte_count": SOURCE_PATHS[row["source_name"]].stat().st_size,
                    "sha256": EXPECTED_SOURCE_SHA256[row["source_name"]],
                },
                "voice_name": profile.get("voice_name"),
                "voice_id": profile.get("voice_id"),
                "model_id": profile.get("model_id"),
                "output_format": profile.get("output", {}).get("format_id"),
                "provider_request_authorized": False,
                "provider_credit_spend_authorized": False,
                "render_authorized": False,
            }
        )

    preflight = documents["james_remaining_batch_preflight"]
    if preflight.get("schema_version") != 1 or preflight.get("product_id") != PRODUCT_ID:
        raise RemainingReviewError("combined James preflight identity drifted")
    if preflight.get("status") != (
        "network_free_review_ready_authenticated_preflight_not_run"
    ):
        raise RemainingReviewError("combined James preflight status drifted")
    scope = preflight.get("scope")
    if not isinstance(scope, dict) or scope.get("new_provider_request_count") != 72:
        raise RemainingReviewError("combined James request inventory drifted")
    if scope.get("new_base_entry_count") != 64:
        raise RemainingReviewError("combined James base-entry inventory drifted")
    if scope.get("new_directional_override_count") != 8:
        raise RemainingReviewError("combined James override inventory drifted")
    if scope.get("final_product_narration_asset_count") != 85:
        raise RemainingReviewError("final narration inventory drifted")
    effects = preflight.get("builder_effects")
    if not isinstance(effects, dict):
        raise RemainingReviewError("combined James builder effects are missing")
    if effects.get("provider_requests_sent") != 0:
        raise RemainingReviewError("James builder sent a provider request")
    if effects.get("provider_credits_spent") != 0:
        raise RemainingReviewError("James builder spent provider credits")
    if effects.get("network_accessed") is not False:
        raise RemainingReviewError("James builder accessed the network")
    return {
        "status": "owner_render_and_spend_authorization_required",
        "voice": {
            "provider": "elevenlabs",
            "voice_name": rows[0]["voice_name"],
            "voice_id": rows[0]["voice_id"],
            "model_id": rows[0]["model_id"],
            "output_format": rows[0]["output_format"],
            "accepted_profile_selected_for_all_three_chapters": True,
            "voice_settings": {
                "similarity_boost": 0.5,
                "speed": 1.0,
                "stability": 0.5,
                "style": 0.1,
                "use_speaker_boost": True,
            },
        },
        "chapter_envelopes": rows,
        "combined_preflight_binding": {
            "path": SOURCE_PATHS["james_remaining_batch_preflight"]
            .relative_to(REPOSITORY)
            .as_posix(),
            "byte_count": SOURCE_PATHS[
                "james_remaining_batch_preflight"
            ].stat().st_size,
            "sha256": EXPECTED_SOURCE_SHA256["james_remaining_batch_preflight"],
        },
        "aggregate": {
            "provider_request_count": 72,
            "base_entry_request_count": 64,
            "direction_override_request_count": 8,
            "payload_character_count": 125_595,
            "normalized_character_count": 125_328,
            "reserved_provider_credit_ceiling": 138_190,
            "renderer_character_cap": 138_300,
            "proposed_one_day_api_key_credit_quota": 145_000,
            "dollar_cap_usd": "14.50",
            "chapter_key_count": 3,
            "key_expiry_hours": 24,
            "cross_chapter_borrowing_allowed": False,
            "paid_overage_authorized": False,
            "rerender_budget": 0,
        },
        "fresh_authenticated_provider_preflight_complete": False,
        "api_key_creation_authorized": False,
        "provider_request_authorized": False,
        "provider_credit_spend_authorized": False,
        "render_authorized": False,
        "narration_generated": False,
    }


def _sanitation_job(
    artwork: list[dict[str, Any]],
    foothills_approval: dict[str, Any],
) -> dict[str, Any]:
    approved_foothills = {
        row["candidate_id"]: row
        for row in foothills_approval["approved_artwork_originals"]
    }
    items = []
    all_sources: list[dict[str, Any]] = [*FOOTHILLS_SANITATION_SOURCES, *artwork]
    for stable_order, source in enumerate(all_sources, start=1):
        candidate_id = source["candidate_id"]
        if source["chapter_id"] == "foothills_parkway":
            if approved_foothills[candidate_id]["original_sha256"] != source[
                "original_sha256"
            ]:
                raise RemainingReviewError("Foothills sanitation source drifted")
            original_approved = True
        else:
            original_approved = False

        if candidate_id == "media_mc_kuwohi":
            transform = (
                "select_mpo_baseline_primary_frame_0_then_embedded_rgb_icc_to_"
                "srgb_perceptual_lcms2"
            )
            frame_policy = (
                "preserve_full_selected_primary_frame_only; do_not_merge_or_"
                "retain_secondary_mpo_frame"
            )
            change_note = (
                "Modified from the original: selected the Baseline MP Primary "
                "Image at MPO frame 0, applied recorded EXIF orientation, "
                "converted its embedded ICC profile to sRGB, excluded the "
                "secondary MPO frame, and removed metadata; no crop or resize."
            )
        elif source["source_mode"] == "L":
            transform = "untagged_l_to_srgb_rgb_equal_channel_replication"
            frame_policy = "preserve_full_single_frame"
            change_note = (
                "Modified from the original: applied recorded TIFF orientation, "
                "replicated each 8-bit grayscale sample equally into sRGB R/G/B "
                "channels, and removed metadata; no crop or resize."
            )
        elif source["icc_profile_bytes"]:
            transform = "embedded_rgb_icc_to_srgb_perceptual_lcms2"
            frame_policy = "preserve_full_single_frame"
            change_note = (
                "Modified from the original: applied recorded EXIF orientation, "
                "converted the embedded ICC profile to sRGB, and removed "
                "metadata; no crop or resize."
            )
        else:
            transform = "untagged_rgb_assume_srgb_preserve_sample_values"
            frame_policy = "preserve_full_single_frame"
            change_note = (
                "Modified from the original: applied recorded EXIF orientation, "
                "preserved full-frame RGB samples under an sRGB assumption, and "
                "removed metadata; no crop or resize."
            )

        items.append(
            {
                "stable_order": stable_order,
                "candidate_id": candidate_id,
                "chapter_id": source["chapter_id"],
                "source_original_sha256": source["original_sha256"],
                "source_original_bytes": source["original_bytes"],
                "source_asset_url": source["asset_url"],
                "source_license_record_url": source["license_record_url"],
                "source_page_url": source["source_page_url"],
                "license_name": source["license_name"],
                "rights_basis": source["rights_basis"],
                "exact_credit": source["exact_credit"],
                "required_commercial_notice": source[
                    "required_commercial_notice"
                ],
                "change_note": change_note,
                "source_format": source["source_format"],
                "source_mode": source["source_mode"],
                "source_frame_count": source["source_frame_count"],
                "selected_source_frame_index": source["selected_primary_frame_index"],
                "selected_source_frame_type": source.get(
                    "selected_primary_frame_type", "single_image"
                ),
                "selected_source_pixel_sha256": source[
                    "selected_primary_decoded_pixel_sha256"
                ],
                "source_dimensions": source["dimensions"],
                "source_exif_orientation": source["exif_orientation"],
                "source_gps_metadata_present": source["gps_metadata_present"],
                "source_device_metadata_present": source["device_metadata_present"],
                "source_date_or_identity_metadata_present": source[
                    "date_or_identity_metadata_present"
                ],
                "source_icc_profile_bytes": source["icc_profile_bytes"],
                "source_icc_profile_sha256": source["icc_profile_sha256"],
                "exact_original_user_visual_approval": original_approved,
                "logical_output_filename": f"{candidate_id}_sanitized_v1.png",
                "output_format": "PNG",
                "output_mode": "RGB",
                "output_dimensions": source["dimensions"],
                "frame_policy": frame_policy,
                "color_transform": transform,
                "apply_recorded_exif_orientation": True,
                "crop_allowed": False,
                "resize_allowed": False,
                "png_allowed_chunk_types": ["IHDR", "IDAT", "IEND"],
                "metadata_retained": False,
                "source_rights_credit_change_note_and_notice_bound": True,
                "sanitation_authorized": False,
                "derivative_created": False,
                "derivative_user_visual_approval": False,
                "ingestion_allowed": False,
                "upload_allowed": False,
                "publication_allowed": False,
            }
        )
    return {
        "status": "owner_authorization_required_no_derivatives_created",
        "item_count": 6,
        "owner_decision": "approve_or_revise_required",
        "all_or_itemized_decision_allowed": True,
        "items": items,
        "sanitation_authorized": False,
        "derivatives_created": False,
        "derivative_visual_approval": False,
        "ingestion_allowed": False,
    }


def build() -> dict[str, Any]:
    bindings = {name: _binding(name, path) for name, path in SOURCE_PATHS.items()}
    documents = {
        name: _load_json(path)
        for name, path in SOURCE_PATHS.items()
        if path.suffix == ".json"
    }
    dossier = documents["source_dossier"]
    _assert_dossier(dossier)
    route_spec = documents["route_variants"]
    route_evidence = documents["official_route_evidence"]
    if route_spec.get("product_id") != PRODUCT_ID or route_spec.get(
        "expected_variant_count"
    ) != 6:
        raise RemainingReviewError("full-product route contract drifted")
    if route_evidence.get("product_id") != PRODUCT_ID:
        raise RemainingReviewError("route-evidence product identity drifted")
    if route_evidence.get("publication_status") != "blocked":
        raise RemainingReviewError("route evidence unexpectedly authorizes publication")

    chapters = [
        _chapter_review(
            chapter_id,
            documents[CHAPTER_SPECS[chapter_id]["editorial_source"]],
            dossier,
            route_spec,
            route_evidence,
        )
        for chapter_id in CHAPTER_SPECS
    ]
    rights_text = SOURCE_PATHS["media_rights"].read_text(encoding="utf-8")
    artwork = _artwork_rows(dossier, rights_text)
    foothills = _assert_foothills_approval(documents["foothills_approval"])
    roaring_fork = _assert_roaring_fork(documents)
    james = _assert_james_render_proposal(documents)
    sanitation = _sanitation_job(artwork, documents["foothills_approval"])
    claim_ids = [claim_id for chapter in chapters for claim_id in chapter["claim_ids"]]
    public_record_determination = _assert_public_record_determination(
        documents["public_record_scope_determination"], claim_ids
    )

    return {
        "schema_version": 1,
        "packet_id": PACKET_ID,
        "kind": "original_remaining_chapters_combined_review_only",
        "product_id": PRODUCT_ID,
        "status": "explicit_remaining_script_artwork_and_sanitation_decisions_required",
        "recorded_from_task_id": SOURCE_TASK_ID,
        "source_bindings": bindings,
        "subset_bindings": EXPECTED_SUBSET_SHA256,
        "product_contract": {
            "pack_scope": "one_premium_four_chapter_product",
            "chapter_ids": [
                "mountain_crossing",
                "little_river_cades_cove",
                "roaring_fork",
                "foothills_parkway",
            ],
            "route_variant_count": 6,
            "permanent_credit_price": 900,
            "credit_type": "earned_credits",
            "explorer_included": True,
            "standalone_chapter_products_approved": False,
            "standalone_roaring_fork_public_product_approved": False,
            "standalone_foothills_public_product_approved": False,
            "changing_scope_or_price_requires_separate_product_decision": True,
        },
        "review_scope": {
            "chapter_ids": ["mountain_crossing", "little_river_cades_cove"],
            "combined_owner_review": True,
            "script_count": 51,
            "story_count": 32,
            "cue_count": 19,
            "direction_override_count": 5,
            "direction_override_entry_ids": list(
                CHAPTER_SPECS["mountain_crossing"]["override_ids"]
            ),
            "artwork_original_candidate_count": 4,
            "proposed_sanitation_original_count": 6,
            "proposed_new_narration_request_count": 72,
            "proposed_new_base_narration_count": 64,
            "proposed_directional_replacement_narration_count": 8,
            "other_chapters_approved_by_this_packet": False,
        },
        "public_record_scope": {
            "claim_count": 34,
            "claim_ids": claim_ids,
            "classification": "public_record_factual",
            "collection_method": "published_public_record",
            "culturally_gated_claim_count": 0,
            "blocked_entry_count": 0,
            "external_outreach_required": False,
            "owner_scope_determination": public_record_determination,
        },
        "chapter_reviews": chapters,
        "artwork_candidates": artwork,
        "proposed_six_image_sanitation_job": sanitation,
        "proposed_james_render_and_spend": james,
        "protected_foothills_s4u_evidence": foothills,
        "protected_roaring_fork_evidence": roaring_fork,
        "local_evidence_verification": {
            "verification_method": "read_only_exact_hash_and_image_fact_check",
            "candidate_count": 6,
            "mirror_count": 2,
            "verified_copy_count": 12,
            "paths_serialized": False,
            "raw_exif_values_serialized": False,
            "production_asset_use_authorized": False,
        },
        "decision_gate": {
            "remaining_script_decisions_recorded": False,
            "remaining_override_decisions_recorded": False,
            "remaining_artwork_original_decisions_recorded": False,
            "six_image_sanitation_authorized": False,
            "artwork_derivatives_created": False,
            "derivative_visual_approval": False,
            "exact_james_render_and_spend_envelopes_approved": False,
            "fresh_authenticated_provider_preflight_complete": False,
            "one_day_provider_keys_created": False,
            "accepted_james_profile_selected_for_remaining_chapters": True,
            "tts_or_render_authorized": False,
            "provider_spend_authorized": False,
            "narration_generated": False,
            "ingestion_allowed": False,
            "manifest_creation_or_mutation_allowed": False,
            "upload_allowed": False,
            "database_accessed": False,
            "network_accessed_by_builder": False,
            "production_mutation_allowed": False,
            "trusted_validation_allowed": False,
            "publication_allowed": False,
            "public_release": False,
            "next_action": (
                "collect_explicit_approve_or_revise_decisions_for_51_scripts_"
                "5_direction_overrides_4_originals_the_6_image_sanitation_job_"
                "and_the_exact_james_render_and_spend_envelopes"
            ),
        },
    }


def _inspect_image(path: Path, expected: dict[str, Any]) -> dict[str, Any]:
    try:
        with Image.open(path) as image:
            frame_count = getattr(image, "n_frames", 1)
            if frame_count != expected["source_frame_count"]:
                raise RemainingReviewError(
                    f"source frame count drifted: {expected['candidate_id']}"
                )
            image.seek(expected["selected_primary_frame_index"])
            image.load()
            exif = image.getexif()
            gps_present = bool(exif.get_ifd(0x8825)) if 0x8825 in exif else False
            device_present = any(tag in exif for tag in (271, 272, 305, 316))
            date_or_identity_present = any(
                tag in exif for tag in (269, 306, 315, 36867, 36868)
            )
            icc = image.info.get("icc_profile") or b""
            facts = {
                "source_format": image.format,
                "source_mode": image.mode,
                "source_frame_count": frame_count,
                "dimensions": {"width": image.width, "height": image.height},
                "selected_primary_decoded_pixel_sha256": hashlib.sha256(
                    image.tobytes()
                ).hexdigest(),
                "exif_orientation": exif.get(274, 1),
                "gps_metadata_present": gps_present,
                "device_metadata_present": device_present,
                "date_or_identity_metadata_present": date_or_identity_present,
                "icc_profile_bytes": len(icc),
                "icc_profile_sha256": hashlib.sha256(icc).hexdigest() if icc else None,
            }
            for name, actual in facts.items():
                if expected[name] != actual:
                    raise RemainingReviewError(
                        f"source image fact drifted: {expected['candidate_id']} {name}"
                    )
            if expected.get("excluded_frame"):
                excluded = expected["excluded_frame"]
                mp_entries = getattr(image, "mpinfo", {}).get(45058)
                if not isinstance(mp_entries, list) or len(mp_entries) != frame_count:
                    raise RemainingReviewError("MPO frame directory drifted")
                primary_type = mp_entries[
                    expected["selected_primary_frame_index"]
                ].get("Attribute", {}).get("MPType")
                if primary_type != expected["selected_primary_frame_type"]:
                    raise RemainingReviewError("MPO primary-frame type drifted")
                excluded_type = mp_entries[excluded["index"]].get(
                    "Attribute", {}
                ).get("MPType")
                if excluded_type != excluded["mp_type"]:
                    raise RemainingReviewError("MPO excluded-frame type drifted")
                image.seek(excluded["index"])
                image.load()
                if image.size != (
                    excluded["dimensions"]["width"],
                    excluded["dimensions"]["height"],
                ):
                    raise RemainingReviewError("MPO excluded-frame dimensions drifted")
                if image.mode != excluded["mode"]:
                    raise RemainingReviewError("MPO excluded-frame mode drifted")
                if hashlib.sha256(image.tobytes()).hexdigest() != excluded[
                    "decoded_pixel_sha256"
                ]:
                    raise RemainingReviewError("MPO excluded-frame pixels drifted")
            return facts
    except RemainingReviewError:
        raise
    except (OSError, SyntaxError) as error:
        raise RemainingReviewError(
            f"unreadable source image: {expected['candidate_id']}"
        ) from error


def verify_artwork_evidence(evidence_roots: tuple[Path, ...]) -> dict[str, Any]:
    if not evidence_roots:
        raise RemainingReviewError("at least one artwork evidence root is required")
    all_sources: tuple[dict[str, Any], ...] = (
        *FOOTHILLS_SANITATION_SOURCES,
        *ARTWORK,
    )
    verified_copy_count = 0
    for expected in all_sources:
        candidate_id = expected["candidate_id"]
        names = (candidate_id, f"{candidate_id}.jpg", f"{candidate_id}.tif")
        for root in evidence_roots:
            matches = [root / name for name in names if (root / name).is_file()]
            if len(matches) != 1:
                raise RemainingReviewError(
                    f"expected one evidence copy for {candidate_id} in supplied root"
                )
            path = matches[0]
            if path.stat().st_size != expected["original_bytes"]:
                raise RemainingReviewError(f"artwork byte count drifted: {candidate_id}")
            if _sha256_path(path) != expected["original_sha256"]:
                raise RemainingReviewError(f"artwork SHA-256 drifted: {candidate_id}")
            _inspect_image(path, expected)
            verified_copy_count += 1
    return {
        "verified_candidate_count": 6,
        "verified_root_count": len(evidence_roots),
        "verified_copy_count": verified_copy_count,
        "copies_match": True,
        "paths_serialized": False,
        "raw_exif_values_serialized": False,
        "derivative_creation_allowed": False,
        "ingestion_allowed": False,
    }


def default_evidence_roots() -> tuple[Path, ...]:
    configured = os.environ.get("SMOKIES_MEDIA_EVIDENCE_ROOTS", "").strip()
    if configured:
        return tuple(Path(value) for value in configured.split(os.pathsep) if value)
    roots = [Path.home() / ".openclaw/evidence/smokies-media-s2/originals"]
    windows_parent = Path("/mnt/c/Users")
    windows_matches = (
        sorted(
            path
            for path in windows_parent.glob(
                "*/Documents/Codex/evidence/trailhead/smokies-s2-media"
            )
            if path.is_dir()
        )
        if windows_parent.is_dir()
        else []
    )
    if len(windows_matches) > 1:
        raise RemainingReviewError("multiple Windows evidence mirrors are ambiguous")
    roots.extend(windows_matches)
    return tuple(path for path in roots if path.is_dir())


def serialize(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_markdown(value: dict[str, Any]) -> str:
    lines = [
        "# Mountain Crossing + Little River / Cades Cove review sheet v1",
        "",
        "Status: **review only - explicit decisions required**",
        "",
        (
            "This sheet presents 51 exact source-locked scripts, five separate "
            "Mountain Crossing reverse-direction overrides, four original artwork "
            "candidates, and one six-image sanitation proposal. Nothing on this "
            "sheet records a new approval: the two prior S4U Foothills original "
            "approvals remain preserved, while their sanitation is still unapproved."
        ),
        "",
        "## Product boundary",
        "",
        "- One premium four-chapter bundle: Mountain Crossing; Little River / Cades Cove; Roaring Fork; Foothills Parkway",
        "- Six route variants across the complete product",
        "- Permanent price: 900 earned credits",
        "- Explorer access: included",
        "- Standalone chapter products: not approved",
        "- Other chapters approved by this sheet: no",
        "",
        "## Original artwork decisions",
        "",
    ]
    for row in value["artwork_candidates"]:
        notice = row["required_commercial_notice"] or "not applicable; exact CC BY 4.0 credit is mandatory"
        lines.extend(
            [
                f"### Artwork {row['stable_order']}: {row['candidate_id']}",
                "",
                "Decision: [ ] Approve exact original  [ ] Revise: ____________________",
                "",
                f"- Chapter: `{row['chapter_id']}`",
                f"- Subject: {row['subject']}",
                f"- Intended use: {row['intended_use']}",
                f"- Creator: {row['creator']}",
                f"- Rights: {row['license_name']} ({row['rights_basis']})",
                f"- Required credit: {row['exact_credit']}",
                f"- Commercial notice: {notice}",
                f"- Identity basis: {row['identity_match']}",
                f"- Source asset: {row['asset_url']}",
                f"- License record: {row['license_record_url']}",
                f"- Exact source format/mode: {row['source_format']} / {row['source_mode']}",
                f"- Dimensions: {row['dimensions']['width']} x {row['dimensions']['height']}",
                f"- Bytes: {row['original_bytes']}",
                f"- SHA-256: `{row['original_sha256']}`",
                f"- Local evidence locator: `{row['local_evidence_locator']}`",
                f"- Frame count: {row['source_frame_count']}; proposed primary frame: {row['selected_primary_frame_index']}",
                (
                    "- MPO caveat: exact original contains a secondary frame; the "
                    "later proposal selects only frame 0 and does not merge or retain frame 1"
                    if row["candidate_id"] == "media_mc_kuwohi"
                    else "- Multi-frame caveat: none"
                ),
                "- Gate: original decision required; sanitation, derivative approval, ingestion, upload, and publication are false",
                "",
            ]
        )

    lines.extend(["## Six-image sanitation proposal", ""])
    lines.extend(
        [
            "Decision: [ ] Authorize this exact six-image sanitation job  [ ] Revise: ____________________",
            "",
            (
                "This proposed job covers the two already approved Foothills originals "
                "and the four originals above only. Authorization would permit creating "
                "metadata-stripped derivatives; it would not approve derivative pixels, "
                "ingestion, upload, narration, a manifest, deployment, or publication."
            ),
            "",
        ]
    )
    for row in value["proposed_six_image_sanitation_job"]["items"]:
        lines.extend(
            [
                f"### Sanitation item {row['stable_order']}: {row['candidate_id']}",
                "",
                f"- Source: `{row['source_original_sha256']}` ({row['source_format']} / {row['source_mode']}, {row['source_frame_count']} frame(s))",
                f"- Selected frame: {row['selected_source_frame_index']} ({row['selected_source_frame_type']})",
                f"- Output: `{row['logical_output_filename']}`; RGB PNG; {row['output_dimensions']['width']} x {row['output_dimensions']['height']}",
                f"- Frame policy: {row['frame_policy']}",
                f"- Color policy: {row['color_transform']}",
                f"- Rights: {row['license_name']} ({row['rights_basis']})",
                f"- Exact retained credit: {row['exact_credit']}",
                f"- Required government-work notice: {row['required_commercial_notice'] or 'not applicable; CC BY 4.0 attribution and modification indication still required'}",
                f"- Exact change note: {row['change_note']}",
                "- Full selected frame preserved; no crop or resize; only IHDR/IDAT/IEND PNG chunks permitted",
                "- GPS, EXIF, device, date, identity, ICC, text, and ancillary metadata retained in file: no",
                "",
            ]
        )

    james = value["proposed_james_render_and_spend"]
    lines.extend(
        [
            "## James narration render and spend proposal",
            "",
            "Decision: [ ] Authorize the exact three-chapter James render and spend envelopes  [ ] Revise: ____________________",
            "",
            (
                "The four lock artifacts are deterministic and network-free. This "
                "decision would authorize only a later fresh authenticated preflight "
                "and the exact capped render. It does not approve uncertain retries, "
                "paid overage, rerenders, ingestion, upload, or publication."
            ),
            "",
            f"- Voice: {james['voice']['voice_name']} (`{james['voice']['voice_id']}`)",
            f"- Model/output: `{james['voice']['model_id']}` / `{james['voice']['output_format']}`",
            "- Settings: stability 0.5; similarity 0.5; style 0.1; speed 1.0; speaker boost on",
            "- Three independent one-day keys and ledgers; no cross-chapter borrowing",
            "",
        ]
    )
    for row in james["chapter_envelopes"]:
        lines.extend(
            [
                f"### James envelope: `{row['chapter_id']}`",
                "",
                f"- Requests: {row['request_count']}",
                f"- Raw / normalized characters: {row['payload_character_count']} / {row['normalized_character_count']}",
                f"- Reserved credits / renderer cap / one-day key quota: {row['reserved_provider_credit_ceiling']} / {row['renderer_character_cap']} / {row['proposed_one_day_api_key_credit_quota']}",
                f"- Dollar ceiling: ${row['dollar_cap_usd']}",
                f"- Exact lock: `{row['lock_binding']['sha256']}` ({row['lock_binding']['byte_count']} bytes)",
                "- Render, provider request, and provider spend authorized: no",
                "",
            ]
        )
    aggregate = james["aggregate"]
    lines.extend(
        [
            "### Combined James ceiling",
            "",
            f"- Requests: {aggregate['provider_request_count']} ({aggregate['base_entry_request_count']} base + {aggregate['direction_override_request_count']} direction replacements)",
            f"- Raw / normalized characters: {aggregate['payload_character_count']} / {aggregate['normalized_character_count']}",
            f"- Reserved credits / renderer caps / key quotas: {aggregate['reserved_provider_credit_ceiling']} / {aggregate['renderer_character_cap']} / {aggregate['proposed_one_day_api_key_credit_quota']}",
            f"- Dollar ceiling: ${aggregate['dollar_cap_usd']}",
            f"- Combined preflight: `{james['combined_preflight_binding']['sha256']}` ({james['combined_preflight_binding']['byte_count']} bytes)",
            "- Authenticated provider preflight complete: no",
            "",
        ]
    )

    for chapter in value["chapter_reviews"]:
        chapter_title = (
            "Mountain Crossing"
            if chapter["chapter_id"] == "mountain_crossing"
            else "Little River / Cades Cove"
        )
        lines.extend([f"## {chapter_title} script review", ""])
        sources = {row["id"]: row for row in chapter["official_sources"]}
        for row in chapter["scripts"]:
            lines.extend(
                [
                    f"### Script {row['stable_order']}: {row['title']} (`{row['id']}`, {row['kind']})",
                    "",
                    "Decision: [ ] Approve exact script  [ ] Revise: ____________________",
                    "",
                    f"Claims: {', '.join(f'`{item}`' for item in row['claim_ids'])}",
                    "",
                    "Sources:",
                    "",
                ]
            )
            for source_id in row["source_ids"]:
                source = sources[source_id]
                lines.append(f"- [{source['title']}]({source['url']}) (`{source_id}`)")
            lines.extend(
                [
                    "",
                    "Exact base transcript:",
                    "",
                    row["transcript"],
                    "",
                    f"Base transcript SHA-256: `{row['transcript_sha256']}`",
                    "",
                ]
            )
            for override in row.get("variant_overrides", []):
                lines.extend(
                    [
                        f"#### Separate override decision: `{row['id']}` / `{override['variant_id']}`",
                        "",
                        "Override decision: [ ] Approve exact override  [ ] Revise: ____________________",
                        "",
                        "Exact override transcript:",
                        "",
                        override["transcript"],
                        "",
                        f"Override transcript SHA-256: `{override['transcript_sha256']}`",
                        "",
                    ]
                )
                if override.get("title"):
                    lines.extend(
                        [
                            f"Override title: {override['title']}",
                            f"Override title SHA-256: `{override['title_sha256']}`",
                            "",
                        ]
                    )

    lines.extend(
        [
            "## Preserved approvals and stop boundary",
            "",
            "- Foothills S4U: 13 scripts and two exact originals remain approved; sanitation, narration, ingestion, and publication remain false.",
            "- Roaring Fork: accepted 20-asset private evidence remains unchanged and excluded from this review.",
            "- No EBCI or other external outreach is required or authorized for this exact public-record claim set.",
            "",
            (
                "After owner decisions are recorded, stop. This review does not "
                "authorize derivatives, TTS/provider spend, narration generation, "
                "ingestion, manifest work, uploads, database access, deployment, "
                "trusted validation, or publication."
            ),
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--markdown-output", type=Path, default=MARKDOWN_OUTPUT_PATH)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-evidence", action="store_true")
    parser.add_argument(
        "--evidence-root",
        action="append",
        type=Path,
        default=[],
        help="Local evidence root; repeat for mirrors; paths are never serialized",
    )
    args = parser.parse_args()

    value = build()
    rendered_json = serialize(value)
    rendered_markdown = render_markdown(value)
    if args.verify_evidence:
        roots = tuple(args.evidence_root) or default_evidence_roots()
        result = verify_artwork_evidence(roots)
        if result["verified_copy_count"] != 12:
            raise SystemExit("expected twelve exact source copies across two mirrors")
    if args.check:
        if not args.output.is_file() or args.output.read_text(
            encoding="utf-8"
        ) != rendered_json:
            raise SystemExit("remaining-chapters review packet is stale; rebuild it")
        if not args.markdown_output.is_file() or args.markdown_output.read_text(
            encoding="utf-8"
        ) != rendered_markdown:
            raise SystemExit("remaining-chapters review sheet is stale; rebuild it")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered_json, encoding="utf-8")
    args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_output.write_text(rendered_markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
