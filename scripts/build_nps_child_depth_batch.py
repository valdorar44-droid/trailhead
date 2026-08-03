#!/usr/bin/env python3
"""Build an immutable, cached-only NPS child-depth internal candidate.

This builder deliberately cannot fetch data or write Trailhead's live catalog,
internal-preview overlay, or serving index. It reads a pinned set of cached NPS
source packs, applies the existing conservative child-promotion rules, and
writes a review sidecar beneath ``data/explore/audit_candidates``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.promote_nps_child_explore_places import (
    NPS_ATTRIBUTION,
    NPS_LICENSE,
    child_title,
    first_image,
    load_existing_keys,
    promote_from_fixture,
    title_key,
)
from scripts.explore_sources.nps.media_rights import (
    NPS_MEDIA_DISTRIBUTION_STATUS,
    NPS_MEDIA_RIGHTS_STATE,
    normalize_selected_nps_places,
)


BATCH_ID = "post-b08-nps-child-depth-b1"
BATCH_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("blri", "Blue Ridge Parkway"),
    ("seki", "Sequoia & Kings Canyon National Parks"),
    ("brca", "Bryce Canyon National Park"),
    ("shen", "Shenandoah National Park"),
    ("dino", "Dinosaur National Monument"),
)
BATCH_2_ID = "post-b08-nps-child-depth-b2"
BATCH_2_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("gumo", "Guadalupe Mountains National Park"),
    ("olym", "Olympic National Park"),
    ("deva", "Death Valley National Park"),
    ("jotr", "Joshua Tree National Park"),
    ("romo", "Rocky Mountain National Park"),
)
BATCH_3_ID = "post-b08-nps-child-depth-b3"
BATCH_3_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("bibe", "Big Bend National Park"),
    ("ever", "Everglades National Park"),
    ("cuva", "Cuyahoga Valley National Park"),
    ("havo", "Hawaiʻi Volcanoes National Park"),
    ("buff", "Buffalo National River"),
)
BATCH_4_ID = "post-b09-nps-child-depth-b4"
BATCH_4_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("hosp", "Hot Springs National Park"),
    ("hove", "Hovenweep National Monument"),
    ("indu", "Indiana Dunes National Park"),
    ("jeca", "Jewel Cave National Monument"),
    ("joda", "John Day Fossil Beds National Monument"),
)
BATCH_4_EXPECTED_INPUT_HASHES = {
    "base_catalog": "462ab1a8313e84073b2ce5347411b25771c19ebd17079b00227deb922e18a080",
    "normalized_nps_catalog": "8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80",
}
BATCH_4_EXPECTED_FIXTURE_HASHES = {
    "hosp": "43110d2d6a2a4ed2f6624baf0810d1b5a0c6649cd74e68c101b13400ec1a0834",
    "hove": "8431ba41d5ab0077d96bfa2093310403c85865a6e5068da85dc44779e187c02b",
    "indu": "22cfaf65da51c037dc6d1583f00e57bcffb9b6d1fcb111d72ef359615a66b881",
    "jeca": "550106bcb79cf9f45e08a12cb02cc613aa5652b665aef3110b0f65d2d92b149b",
    "joda": "b80fc6eaff16fd4b18f4671bad7792855cd5c3822559884bc446ddafa68eec3b",
}
BATCH_4_EXPECTED_DESTINATION_COUNTS = {
    "hosp": 24,
    "hove": 17,
    "indu": 26,
    "jeca": 11,
    "joda": 19,
}
BATCH_4_EXPECTED_MODULE_COUNTS = {
    "stay": 5,
    "visitor": 7,
    "do": 6,
    "trails": 33,
    "see": 46,
}
BATCH_4_EXPECTED_CATEGORY_COUNTS = {
    "campground": 5,
    "visitor_center": 7,
    "activity": 6,
    "trail": 23,
    "place": 16,
    "waterfall": 1,
    "hot_spring": 4,
    "historic_site": 11,
    "viewpoint": 14,
    "trailhead": 10,
}
BATCH_4_EXPECTED_LINK_ACTIONS = {
    "kept_item_url": 93,
    "used_parent_nps_url": 2,
    "upgraded_nps_https": 2,
}
BATCH_4_EXPECTED_PARENT_FALLBACKS = {
    "place:nps-child:indu:campgrounds:665a07f7-cd99-401a-8674-4c65ac41954c": (
        "https://www.nps.gov/indu/index.htm"
    ),
    "place:nps-child:indu:campgrounds:89cb27d1-22a1-437e-9528-3d99de6a22f0": (
        "https://www.nps.gov/indu/index.htm"
    ),
}
BATCH_4_EXPECTED_MEDIA_COUNTS = {
    "candidate_images": 97,
    "approved_images": 86,
    "stripped_images": 11,
}
BATCH_4_EXPECTED_TEXT_ONLY_IDS = {
    "place:nps-child:hosp:campgrounds:b09710b2-3d0b-47b0-b15e-abafc4243f75",
    "place:nps-child:hosp:places:d219abd2-714d-4793-b148-9aac20000ec2",
    "place:nps-child:indu:visitorcenters:af24dad9-0425-4259-a050-d3eacad69ef1",
    "place:nps-child:indu:thingstodo:e8fab275-df01-437d-9671-d2626d049032",
    "place:nps-child:indu:thingstodo:ff26d5dd-3eb0-46ca-a7af-4976acd84821",
    "place:nps-child:indu:thingstodo:5d9e1a12-d7da-4438-8269-24c923dd111b",
    "place:nps-child:indu:thingstodo:7566f877-6002-41e7-ae62-f39ffc140ba1",
    "place:nps-child:indu:thingstodo:77d42ac3-015b-41dd-ac5c-23d12d609ab1",
    "place:nps-child:indu:thingstodo:380f336e-8d28-40ff-8f29-1c75c4f960fa",
    "place:nps-child:indu:thingstodo:0615ba48-e72b-4655-8592-e367e0d2e931",
    "place:nps-child:indu:places:1557d73e-4ad4-487e-9eb1-4f9b29c48ab6",
}
CONTRACT_BATCH_ID = "post-b08-nps-child-contract-r1"
CONTRACT_DESTINATIONS: tuple[tuple[str, str], ...] = (
    ("acad", "Acadia National Park"),
    ("grsm", "Great Smoky Mountains National Park"),
    ("grte", "Grand Teton National Park"),
    ("grba", "Great Basin National Park"),
    ("badl", "Badlands National Park"),
    ("arch", "Arches National Park"),
    ("cany", "Canyonlands National Park"),
    ("glca", "Glen Canyon National Recreation Area"),
)
# This order and these caps are part of the reviewed identity contract. The
# normalized b09 rails select identity; raw caches only prove provenance and
# media rights.
CONTRACT_RAILS: tuple[tuple[str, str, str, int], ...] = (
    ("things_to_see", "places", "see", 14),
    ("things_to_do", "thingstodo", "do", 8),
    ("campgrounds", "campgrounds", "stay", 14),
    ("visitor_centers", "visitorcenters", "visitor", 8),
)
CONTRACT_LEGACY_DESTINATIONS = ("glac", "grca", "yell", "yose", "zion")
CONTRACT_EXPECTED_INPUT_HASHES = {
    "base_manifest": "79b3a7df32c02376a8e7322bd5c6f53ba417694fb01eb5ceb3afe1d5bb2c77c6",
    "base_catalog": "23f15894e46e381ccbd6df28baa8df0e018844876c68112c5872509211095f06",
    "base_index": "1773805d38537f74c6656165305a86595bb39d53a3e694c328a82ce4f33061ba",
    "normalized_nps_catalog": "8bc319b8b230d4272778671318903c9e0e05844b7c5a5d11d8f81438a1584c80",
}
CONTRACT_EXPECTED_FIXTURE_HASHES = {
    "acad": "c3945af89c0ef1364671a1b155491a72fa976782a92dcdbb1ee7263a0c422b20",
    "arch": "64976f68f01d8c174d6bebcdc306f23d818811950f12fdfa7448102001f7455e",
    "badl": "eefaf55010fc6e2f603a6d5e59052eed7b0cc6e4446f800adf339f99839701a3",
    "cany": "bc3a57cc8f37caea17413cac549fdb7ff8302ef5b93fb88ce9819ef8134371a4",
    "glac": "4c55ddb1252d6960189462548d9467f9279ffa627bc3a53706f6b8c139b4903e",
    "glca": "e5a3515def889dac6f3d1c198c11808ee7a79c598ec17a7033ba57c332744e77",
    "grba": "7b46138b05772bc6b6ee2a1f49d3df6ebe99f65a7086b1e0c53986b8231955f8",
    "grca": "e8779a192d7a260a10b1caff1897abaabb473363157dfe2e28a99bfa2ea9a2af",
    "grsm": "8c36b5a68a6469ad9182ebe4fb54578836ea8657832786903b0e78d232a1a898",
    "grte": "cf674109de5136be79a8a748f989c3d7440f46492af79a5261909d43496ac065",
    "yell": "f8694ca4f1ae01c6ed5583314852bf24e167791fecdca72c7fbb2da2266deb22",
    "yose": "c20ce6db9bf7bc206d5959cb730f0d7ecfffcefe963aa7304a588e2b4823bed9",
    "zion": "379adcc135569fc855e3a2617bc80518b8ce92004bff8bff084d7080278c2120",
}
CONTRACT_EXPECTED_IDENTITY_HASHES = {
    "legacy": "8a6dd528b262654e97a4b98625aeb3b1f4a6d77c96bc1fd27f9d6d8052ee33e4",
    "new": "d94ee87a0ca79e476297e44d7cb2f4224599b28749ffcae9ab90c2ede631bc0c",
    "combined": "fc6ea5fc19cf4ec1b3f794902502e0a30dbc6380ff9fb7cfd5eba9dfa94b6524",
}
CONTRACT_EXPECTED_COUNTS = {
    "legacy": 157,
    "new": 237,
    "total": 394,
    "materialized": 236,
    "served_legacy": 145,
    "catalog_only_legacy": 12,
    "missing_description": 49,
    "missing_media": 6,
    "materialized_source_media": 230,
    "approved_media": 183,
    "media_rights_excluded": 47,
    "reviewed_non_www_nps_urls": 13,
    "reviewed_external_urls": 11,
}
CONTRACT_REVIEWED_HOSTS = {
    "nps.gov": "National Park Service canonical host without the www alias",
    "www.mainetourism.com": "State tourism partner linked by the NPS source record",
    "www.fws.gov": "U.S. Fish and Wildlife Service",
    "antelopepointlakepowell.com": "Operational provider linked by the NPS source record",
    "www.pay.gov": "U.S. government payment service",
    "www.lakepowell.com": "Operational provider linked by the NPS source record",
    "www.blm.gov": "Bureau of Land Management",
    "www.canyonconservancy.org": "Nonprofit park partner linked by the NPS source record",
}
CONTRACT_VISIBLE_COPY_OVERRIDES = {
    "place:nps-child:glca:campgrounds:3ccb0af7-a364-4490-a788-ee00700bd108": (
        "Antelope Point RV Park is outside Glen Canyon National Recreation Area "
        "and operated by Antelope Point Marina. It has 104 full-hookup spaces, "
        "15 pull-through spaces, a 70-foot maximum length, and two RV dump stations. "
        "RV sites only."
    ),
    "place:nps-child:glca:campgrounds:4285489c-2d25-4967-91e7-18597c645a0f": (
        "Located in the Bullfrog developed area and operated by Lake Powell Resorts "
        "& Marinas. The campground has 78 sites, restrooms, phones, a dump station, "
        "potable water, and nearby laundry, a store, post office, and launch ramp. "
        "The 78-site campground does not accept reservations; fees apply. A separate 24-site RV "
        "park has full hookups, restrooms, and showers. Reservations: 800-528-6154."
    ),
    "place:nps-child:glca:campgrounds:97fc7f59-6472-4ab6-a411-a7e6874680bd": (
        "Operated by Lake Powell Resorts & Marinas, with 112 dry campsites, 90 "
        "full-hookup sites, and six group sites. Facilities include restrooms, "
        "laundry, showers, a store, phones, a dump station, and potable water. An "
        "amphitheater, picnic area, and swim beach are nearby. Reservations: "
        "800-528-6154. Camping store: 928-645-1059. Fees vary."
    ),
}
BATCH_DEFINITIONS: dict[str, tuple[tuple[str, str], ...]] = {
    BATCH_ID: BATCH_DESTINATIONS,
    BATCH_2_ID: BATCH_2_DESTINATIONS,
    BATCH_3_ID: BATCH_3_DESTINATIONS,
    BATCH_4_ID: BATCH_4_DESTINATIONS,
}
REVIEWED_BATCH_IDS = {BATCH_3_ID, BATCH_4_ID}
RENDERED_RAIL_ENDPOINT_PRIORITY = {
    "visitorcenters": 0,
    "campgrounds": 0,
    "thingstodo": 1,
    "places": 2,
}
DISPLAY_NAME_OVERRIDES = {
    "place:nps-child:olym:campgrounds:f8dfab23-efe0-4f31-98d0-cd5a871596a9": (
        "Kalaloch Campround",
        "Kalaloch Campground",
    ),
}
EXACT_CLASSIFICATION_OVERRIDES: dict[str, tuple[str, str]] = {
    "place:nps-child:ever:places:e3910ef1-d4c4-4c0f-83ab-0b7b779d8800": (
        "campground",
        "stay",
    ),
    "place:nps-child:cuva:places:517b46dd-0301-433b-ac54-8a0068930f29": (
        "historic_site",
        "see",
    ),
    "place:nps-child:havo:thingstodo:4fd7dae2-2a35-406e-8017-99a698cdaade": (
        "activity",
        "do",
    ),
    "place:nps-child:buff:places:2b86b851-d041-4772-88f8-3683c4771012": (
        "historic_site",
        "see",
    ),
    "place:nps-child:hosp:places:a6b52836-b617-442d-9989-b8d800fd1b6a": (
        "historic_site",
        "see",
    ),
    "place:nps-child:hosp:places:b265fcd3-ebc5-4591-aa37-83d87d53810d": (
        "hot_spring",
        "see",
    ),
    "place:nps-child:hosp:places:85ed0ad4-51e0-4abd-a779-03d1ee687432": (
        "hot_spring",
        "see",
    ),
    "place:nps-child:hosp:places:84810559-561e-48c1-9586-b8c6ddc3436f": (
        "hot_spring",
        "see",
    ),
    "place:nps-child:hosp:places:8dfd3a3b-3983-4431-813e-bbe26ead7850": (
        "hot_spring",
        "see",
    ),
    "place:nps-child:hosp:places:a0aba175-0403-4fbe-9d5c-3979fccecfa1": (
        "viewpoint",
        "see",
    ),
    "place:nps-child:hosp:places:4459aac0-dd80-4974-9ec9-9ff090c0c4d9": (
        "place",
        "see",
    ),
    "place:nps-child:hosp:places:1fc9879f-2f96-4faa-8ed0-e68691f502af": (
        "historic_site",
        "see",
    ),
    "place:nps-child:hosp:places:491647e9-c5f5-4f1a-b6f8-9388830a4139": (
        "place",
        "see",
    ),
    "place:nps-child:hove:places:c955bfee-8c04-4499-8433-fad3a665ed13": (
        "viewpoint",
        "see",
    ),
    "place:nps-child:indu:places:1557d73e-4ad4-487e-9eb1-4f9b29c48ab6": (
        "historic_site",
        "see",
    ),
    "place:nps-child:indu:places:3714878f-a334-4317-b529-cac78ab7ceea": (
        "trail",
        "trails",
    ),
    "place:nps-child:indu:places:d31f52b6-a23a-4308-a9d9-17e6f85910c9": (
        "historic_site",
        "see",
    ),
    "place:nps-child:indu:places:a438b359-fab9-4d1a-aa38-8e9958436a40": (
        "trailhead",
        "trails",
    ),
    "place:nps-child:indu:places:1e256355-708c-47c4-8988-6543e4c267b4": (
        "trailhead",
        "trails",
    ),
    "place:nps-child:joda:places:454636a0-765d-45fd-96bb-530c1fd56040": (
        "historic_site",
        "see",
    ),
    "place:nps-child:joda:places:601a772e-441c-4b77-a60b-9b9882bfc9ea": (
        "historic_site",
        "see",
    ),
    "place:nps-child:joda:places:ad26286d-5f16-4273-adeb-72c201ef13d0": (
        "historic_site",
        "see",
    ),
}
EXACT_COPY_REPLACEMENTS: dict[str, tuple[tuple[str, str], ...]] = {
    "place:nps-child:jeca:places:0f7d5a9f-4314-40d3-b90d-0717091ccb44": (
        (".. . ", ". "),
    ),
    "place:nps-child:joda:places:454636a0-765d-45fd-96bb-530c1fd56040": (
        (".. . ", ". "),
    ),
    "place:nps-child:joda:places:f7c3ca79-21e3-4fe3-85fe-0b9ab75609af": (
        (".. . ", ". "),
    ),
    "place:nps-child:joda:places:3d1494a4-e076-4068-930f-a3fa1b6af1f2": (
        (".. . ", ". "),
    ),
    "place:nps-child:joda:places:ebc06523-8699-4840-928a-6a84fb179391": (
        (".. . ", ". "),
    ),
    "place:nps-child:joda:places:ad26286d-5f16-4273-adeb-72c201ef13d0": (
        (".. . ", ". "),
    ),
    "place:nps-child:hove:places:d8a6cfaf-0aba-4041-b226-27d77f93f7ed": (
        ("This tall, this tower", "This tall tower"),
        ("expert craftmanship", "expert craftsmanship"),
    ),
    "place:nps-child:jotr:thingstodo:4b6d0fab-7f6b-4b19-b3fe-6c07566b8050": (
        (
            "A .6-mile trail leads to a .2-mile loop.",
            "A 0.6-mile trail leads to a 0.2-mile loop.",
        ),
        (
            "A.6-mile trail leads to a.2-mile loop.",
            "A 0.6-mile trail leads to a 0.2-mile loop.",
        ),
    ),
    "place:nps-child:romo:visitorcenters:593c4e0b-88ae-4ce3-8150-dc1ee862ada2": ((
        "help your plan your trips",
        "help you plan your trip",
    ),),
    "place:nps-child:romo:places:c3a54769-e360-4591-8650-cc7cf92fb7bc": (
        ("What to Expect? .", "What to expect?"),
        ("What to Expect?.", "What to expect?"),
    ),
    "place:nps-child:olym:places:b340cd12-f8e3-40af-b9ea-f00928240554": ((
        "Visit nps.gov/olym/planyourvisit/wic.htm to plan a backpacking trip!",
        "",
    ),),
    "place:nps-child:romo:campgrounds:7475825b-e844-4012-841b-0e29e05d4540": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Aspenglen Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:6715a7cc-280c-4093-85d3-492004c2db48": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Glacier Basin Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:d322e1e9-8058-4c42-80a3-9fbc82583190": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Moraine Park Campground",
        "",
    ),),
    "place:nps-child:romo:campgrounds:f7965b87-3035-49d4-b55a-d55d6cad0c93": ((
        "To make a reservation, visit www.recreation.gov online, use the Recreation.gov Mobile App or call 1-877-444-6777 and search for Rocky Mountain National Park - Timber Creek Campground",
        "",
    ),),
    "place:nps-child:jotr:places:013a1c84-4949-4cdc-958f-7283f1bc9ac5": ((
        "one way(16 miles round trip)",
        "one way (16 miles round trip)",
    ),),
    "place:nps-child:ever:places:52b7989f-b4f9-4dd4-b7fd-787145aa49bf": ((
        "accessible .2 miles trail",
        "accessible 0.2-mile trail",
    ), (
        "accessible.2 miles trail",
        "accessible 0.2-mile trail",
    )),
    "place:nps-child:buff:campgrounds:5aa6174e-b53c-46f7-9f7b-cc275dd91cbc": ((
        (
            "Some sites at Buffalo Point are available for reservation at "
            "www.recreation.gov (1-877-444-6777) and others are first-come, "
            "first-serve."
        ),
        (
            "Some sites at Buffalo Point can be reserved through Recreation.gov "
            "or by calling 1-877-444-6777; others are first come, first served."
        ),
    ),),
    "place:nps-child:buff:thingstodo:3d6daa8a-36a5-4a3e-bcb5-9aeb97fe8ad4": (
        (
            "This .25 mile to 1.5 mile trail",
            "This 0.25- to 1.5-mile trail",
        ),
        (
            "This.25 mile to 1.5 mile trail",
            "This 0.25- to 1.5-mile trail",
        ),
        ("historic, mining, landscape", "historic mining landscape"),
    ),
    "place:nps-child:bibe:visitorcenters:c5f00e54-bf45-46e1-8acf-bbe615867b78": (
        ("best place to begin your . Backcountry", "best place to begin your visit. Backcountry"),
        ("best place to begin your. Backcountry", "best place to begin your visit. Backcountry"),
        ("shown upon request.The", "shown upon request. The"),
    ),
    "place:nps-child:bibe:places:8327e2bb-1451-4af2-aab0-615dff15ee94": ((
        "10 mile trail",
        "10-mile trail",
    ),),
    "place:nps-child:ever:thingstodo:58de5168-a37a-4197-af24-3d227bee1d1c": (
        ("hisotry", "history"),
        ("opportunitys", "opportunities"),
        ("Shark valley Observation tower", "Shark Valley Observation Tower"),
    ),
    "place:nps-child:ever:places:6a7fa980-588a-44a1-b38f-a75898d4e34f": ((
        "1200meters",
        "1,200 meters",
    ),),
    "place:nps-child:ever:places:1bca5c56-d067-432b-b9b5-d68bb4d1d14d": ((
        "This trial is 7.5 miles one way.",
        "This trail is 7.5 miles one way.",
    ),),
    "place:nps-child:havo:places:5a8524b6-dad2-4e89-b71f-f653b4e90b03": ((
        "years.Today",
        "years. Today",
    ),),
    "place:nps-child:buff:campgrounds:1febd642-4de4-49fd-9df1-3ef8e499ac03": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
    "place:nps-child:buff:campgrounds:74277392-66f4-4feb-b95b-a9fd2b6d4258": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
    "place:nps-child:buff:campgrounds:5cea9f21-8cbb-4b5d-ab2f-7d6fc31ae52e": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
    "place:nps-child:buff:campgrounds:150af6e6-881a-4420-b535-7b31e3905549": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
    "place:nps-child:buff:campgrounds:3ea23346-5c4d-4e01-a4e0-748033e92446": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
    "place:nps-child:buff:campgrounds:dc5b8982-c3b5-40a4-b5c1-be320c39f637": ((
        "recreation.gov",
        "Recreation.gov",
    ),),
}
SEMANTIC_DUPLICATE_PREFERENCES = {
    ("place:nps:havo", "devastation trail"): {
        "kept_id": (
            "place:nps-child:havo:places:"
            "7696444d-7626-4fa5-b2c0-d0ab15951dda"
        ),
        "expected_dropped_ids": (
            "place:nps-child:havo:thingstodo:"
            "c59589f9-5f4b-4629-8655-58384e69bc60",
        ),
        "reason": (
            "The official place record is the source-backed trailhead, has an "
            "exact-page rights-approved image, and represents the same named "
            "reader destination as the uncredited activity record."
        ),
    },
}
BATCH_3_SHARED_COORDINATE_REVIEWS: dict[tuple[str, ...], str] = {
    tuple(sorted((
        "place:nps-child:ever:thingstodo:019c3d0f-0ad1-4a1b-8e5f-601a65918303",
        "place:nps-child:ever:thingstodo:bc316cc1-cf34-4e95-99aa-66e4752d5727",
    ))): "Birding and walking are distinct official activities sharing the Anhinga Trail access point.",
    tuple(sorted((
        "place:nps-child:ever:visitorcenters:52d781e2-1439-4202-b6ce-8d2d8f30757e",
        "place:nps-child:ever:thingstodo:9cd88771-f8f1-4db0-939c-155c8f5edbbb",
    ))): "The visitor center and biking activity are distinct records sharing the Shark Valley access point.",
    tuple(sorted((
        "place:nps-child:bibe:visitorcenters:c5f00e54-bf45-46e1-8acf-bbe615867b78",
        "place:nps-child:bibe:thingstodo:8e7e6012-1fa7-4165-91a6-e3e2f12f5a0f",
    ))): "The visitor center and passport-stamp activity are distinct records at Panther Junction.",
    tuple(sorted((
        "place:nps-child:cuva:visitorcenters:aed09a89-ca84-4cae-9949-9591688b05fc",
        "place:nps-child:cuva:thingstodo:73300e7a-4dd9-4e33-b605-12442ff36818",
    ))): "The Boston Mill facility and its visit activity are separate official endpoint records.",
    tuple(sorted((
        "place:nps-child:cuva:visitorcenters:18c3cbc0-556a-4e4f-8486-16723df55255",
        "place:nps-child:cuva:thingstodo:5acd5e72-ada8-4b57-9052-f454e23144d4",
    ))): "The Canal Exploration Center facility and visit activity are separate official endpoint records.",
}
BATCH_4_SHARED_COORDINATE_REVIEWS: dict[tuple[str, ...], str] = {
    tuple(sorted((
        "place:nps-child:hosp:places:a6b52836-b617-442d-9989-b8d800fd1b6a",
        "place:nps-child:hosp:places:fc7437d4-be5f-449b-b04c-bfb7a63d1cfb",
    ))): "Arlington Lawn and Hot Water Cascade are distinct official places sharing a visitor access point.",
    tuple(sorted((
        "place:nps-child:hove:visitorcenters:fe0c0aa2-f347-4cb2-902f-dbbd9d6e234f",
        "place:nps-child:hove:thingstodo:ec74ef1f-636d-4b52-a1ec-cd4d57242402",
    ))): "The visitor center and Square Tower Group overlook walk are distinct official records at the same access point.",
    tuple(sorted((
        "place:nps-child:indu:thingstodo:e8fab275-df01-437d-9671-d2626d049032",
        "place:nps-child:indu:thingstodo:ff26d5dd-3eb0-46ca-a7af-4976acd84821",
    ))): "Diana Dunes Dare and West Beach swimming are distinct official activities sharing the West Beach area point.",
    tuple(sorted((
        "place:nps-child:indu:thingstodo:7566f877-6002-41e7-ae62-f39ffc140ba1",
        "place:nps-child:indu:thingstodo:77d42ac3-015b-41dd-ac5c-23d12d609ab1",
        "place:nps-child:indu:thingstodo:380f336e-8d28-40ff-8f29-1c75c4f960fa",
    ))): "The one-hour, half-day, and full-day itinerary records are separate official activity options sharing one park reference point.",
    tuple(sorted((
        "place:nps-child:indu:thingstodo:5d9e1a12-d7da-4438-8269-24c923dd111b",
        "place:nps-child:indu:places:7e0308dc-3f4d-4b6f-b669-5b50775d7e8d",
    ))): "The horseback-riding activity and Glenwood Dunes main trail record are distinct official records sharing a trail access point.",
    tuple(sorted((
        "place:nps-child:indu:places:659cec24-1909-47bf-b758-5551bd5c407b",
        "place:nps-child:indu:places:e6e520b4-fff5-4c39-8cc7-698e8bbe05e6",
    ))): "Calumet Dunes Trail and the Glenwood Dunes alternate route are distinct official routes sharing an access point.",
    tuple(sorted((
        "place:nps-child:jeca:places:95a4627a-fbd4-4c75-969a-dd7c8acab945",
        "place:nps-child:jeca:places:5f6cad96-61bd-4c52-878b-b153266ca793",
    ))): "The front porch and north side of Jewel Cave's historic ranger cabin are distinct official interpretive viewpoints at one structure.",
}
SHARED_COORDINATE_REVIEWS = {
    BATCH_3_ID: BATCH_3_SHARED_COORDINATE_REVIEWS,
    BATCH_4_ID: BATCH_4_SHARED_COORDINATE_REVIEWS,
}
MAX_PER_DESTINATION = 36
MAX_TOTAL = 180
ALLOWED_MODULE_TARGETS = {"stay", "visitor", "trails", "do", "see"}
DEFAULT_BASE_CATALOG = (
    ROOT
    / "data/explore/audit_candidates/combined/live-20260801-b08-operational-r8/explore_catalog_v3_review.json"
)
DEFAULT_SOURCE_CACHE = ROOT / "data/explore/source_cache/nps"
AUDIT_CANDIDATE_ROOT = (ROOT / "data/explore/audit_candidates").resolve()
DEFAULT_OUTPUT = AUDIT_CANDIDATE_ROOT / f"internal/{BATCH_ID}"
PROTECTED_OUTPUTS = {
    (ROOT / "dashboard/explore_catalog_v3.json").resolve(),
    (ROOT / "dashboard/explore_serving_index_v2.json").resolve(),
    (ROOT / "dashboard/explore_internal_preview_v1.json").resolve(),
}
FORBIDDEN_COPY = re.compile(
    r"\b(?:artificial intelligence|provider slug|check local rules|verify current|"
    r"description not available|lorem ipsum|generated summary)\b",
    re.IGNORECASE,
)
URL_TOKEN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"expected a JSON object: {path}")
    return payload


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_ref(path: Path, logical_path: str) -> dict[str, Any]:
    resolved = path.resolve()
    display = str(logical_path or "").strip().replace("\\", "/").lstrip("/")
    if not display or display.startswith("../") or "/../" in display:
        raise ValueError("source reference needs a stable logical path")
    return {
        "path": display,
        "bytes": resolved.stat().st_size,
        "sha256": _sha256(resolved),
    }


def _places(payload: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    places = [item for item in payload.get("places") or [] if isinstance(item, dict)]
    declared = int(payload.get("count") or len(places))
    if declared != len(places):
        raise ValueError(f"declared place count does not match records: {path}")
    ids = [str(item.get("id") or "") for item in places]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError(f"base catalog contains missing or duplicate IDs: {path}")
    return places


def _compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _require_sha256(path: Path, expected: str, label: str) -> None:
    actual = _sha256(path)
    if actual != expected:
        raise ValueError(
            f"{label} hash mismatch: expected {expected}, got {actual}"
        )


def _contract_index_items(payload: dict[str, Any], path: Path) -> list[dict[str, Any]]:
    items = [item for item in payload.get("items") or [] if isinstance(item, dict)]
    declared = int(payload.get("count") or len(items))
    if declared != len(items):
        raise ValueError(f"declared serving-index count does not match records: {path}")
    ids = [_compact_text(item.get("id")) for item in items]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError(f"serving index contains missing or duplicate IDs: {path}")
    return items


def _contract_output_allowed(path: Path) -> bool:
    parts = tuple(part.casefold() for part in path.resolve().parts)
    marker = ("data", "explore", "audit_candidates", "internal")
    return any(parts[index : index + len(marker)] == marker for index in range(len(parts)))


def _contract_item_has_identity(item: dict[str, Any]) -> bool:
    lat = item.get("lat")
    lng = item.get("lng")
    if isinstance(lat, bool) or isinstance(lng, bool):
        return False
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    if not math.isfinite(float(lat)) or not math.isfinite(float(lng)):
        return False
    if not -90 <= float(lat) <= 90 or not -180 <= float(lng) <= 180:
        return False
    source_id = _compact_text(item.get("source_id"))
    source_url = _compact_text(item.get("url"))
    return bool(source_id and source_url.startswith("http"))


def _contract_url_host(value: Any) -> str:
    try:
        parsed = urlsplit(_compact_text(value))
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    return parsed.hostname.casefold().rstrip(".")


def _contract_reader_url(value: Any) -> str:
    raw = _compact_text(value)
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    host = (parsed.hostname or "").casefold().rstrip(".")
    if parsed.scheme == "http" and (host == "nps.gov" or host.endswith(".nps.gov")):
        return parsed._replace(scheme="https").geturl()
    return raw


def _contract_distance_meters(a: dict[str, Any], b: dict[str, Any]) -> float:
    lat1, lng1 = math.radians(float(a["lat"])), math.radians(float(a["lng"]))
    lat2, lng2 = math.radians(float(b["lat"])), math.radians(float(b["lng"]))
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    value = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    )
    return round(6_371_000 * 2 * math.asin(min(1.0, math.sqrt(value))), 1)


def _legacy_child_identity(place: dict[str, Any]) -> tuple[str, str, str]:
    place_id = _compact_text(place.get("id"))
    parts = place_id.split(":", 4)
    if len(parts) != 5 or parts[:2] != ["place", "nps-child"]:
        raise ValueError(f"legacy child has unsupported identity: {place_id}")
    code, endpoint = parts[2].casefold(), parts[3].casefold()
    source_id = ""
    for source in place.get("sources") or []:
        if not isinstance(source, dict) or _compact_text(source.get("source")) != "nps":
            continue
        source_id = _compact_text(source.get("source_id"))
        if source_id:
            break
    if not source_id:
        raise ValueError(f"legacy child has no NPS source identity: {place_id}")
    canonical_id = f"place:nps-child:{code}:{endpoint}:{source_id.casefold()}"
    return code, endpoint, canonical_id


def _contract_rail_key_for_endpoint(endpoint: str) -> str:
    mapping = {
        "places": "things_to_see",
        "thingstodo": "things_to_do",
        "campgrounds": "campgrounds",
        "visitorcenters": "visitor_centers",
    }
    try:
        return mapping[endpoint]
    except KeyError as exc:
        raise ValueError(f"unsupported NPS child endpoint: {endpoint}") from exc


def _contract_place_from_normalized(
    *,
    parent: dict[str, Any],
    candidate: dict[str, Any],
    source_item: dict[str, Any],
    generated_at: int,
) -> dict[str, Any]:
    code = candidate["park_code"]
    module = candidate["module_target"]
    endpoint = candidate["endpoint"]
    normalized = candidate["normalized_item"]
    source_id = candidate["source_id"]
    title = candidate["title"]
    description = _compact_text(normalized.get("description"))
    description = CONTRACT_VISIBLE_COPY_OVERRIDES.get(
        candidate["canonical_id"],
        description,
    )
    source_url = _contract_reader_url(normalized.get("url"))
    image_url = _compact_text(normalized.get("image_url"))
    image_caption = _compact_text(
        normalized.get("image_caption") or normalized.get("title")
    )
    image_credit = _compact_text(normalized.get("image_credit"))
    category = {
        "see": "place",
        "do": "activity",
        "stay": "campground",
        "visitor": "visitor_center",
    }[module]
    parent_name = _compact_text(parent.get("name"))
    region = _compact_text(parent.get("region"))
    media = []
    if image_url:
        media.append({
            "url": image_url,
            "caption": image_caption,
            "credit": image_credit,
            "license": NPS_LICENSE,
        })
    structured = {
        key: normalized[key]
        for key in (
            "address",
            "directions",
            "distance_mi",
            "operating_hours",
            "reservation_url",
        )
        if normalized.get(key) not in (None, "", [])
    }
    tags = sorted({parent_name, code, "nps", "official", module, category})
    place = {
        "id": candidate["canonical_id"],
        "source_ids": [f"nps:item:{source_id.casefold()}"],
        "name": title,
        "category": category,
        "canonical_role": "child",
        "parent_hub_id": f"place:nps:{code}",
        "parent_hub_title": parent_name,
        "module_target": module,
        "subcategories": [_compact_text(normalized.get("kind")) or category],
        "lat": float(normalized["lat"]),
        "lng": float(normalized["lng"]),
        "geometry": {
            "type": "Point",
            "coordinates": [float(normalized["lng"]), float(normalized["lat"])],
        },
        "country": _compact_text(parent.get("country")) or "US",
        "region": region,
        "admin": parent_name,
        "summary": description,
        "description": description,
        "tags": tags,
        "search_aliases": [parent_name, code.upper(), module.title(), category.replace("_", " ")],
        "search_blob": " ".join(
            part for part in (title, parent_name, module, category, description) if part
        ).casefold(),
        "amenities": [],
        "media": media,
        "source_pack": {
            "quality": "official",
            "primary": NPS_ATTRIBUTION,
            "official_url": source_url,
            "nps_park_code": code,
            "nps_endpoint": endpoint,
            "nps_item_id": source_id,
            "source_module_target": module,
            "sources": [{
                "title": title,
                "publisher": NPS_ATTRIBUTION,
                "url": source_url,
                "kind": "official",
            }],
            "photos": media,
            "activities": [],
            "topics": tags,
            "source_note": "Official National Park Service data",
            "extract": description,
            "license": NPS_LICENSE,
            "structured": structured,
        },
        "sources": [{
            "source": "nps",
            "source_id": source_id,
            "url": source_url,
            "license": NPS_LICENSE,
            "attribution": NPS_ATTRIBUTION,
            "quality": "official_source",
        }],
        "quality": "official_source",
        "hidden_from_featured": True,
        "last_seen_at": generated_at,
        "updated_at": generated_at,
        "card": {
            "title": title,
            "headline": title,
            "summary": description,
            "highlight": description,
            "region": region or parent_name,
            "quick_facts": [parent_name, module.title()],
            "source_badge": NPS_ATTRIBUTION,
        },
    }
    # Bind the normalized reader record to the exact raw source identity. Raw
    # text is not copied here; it is evidence, not a second presentation model.
    place["source_pack"]["raw_source_identity"] = _compact_text(source_item.get("id"))
    return place


def _fixture_for_code(source_cache: Path, code: str) -> Path:
    matches = sorted(source_cache.glob(f"source-pack_codes-{code}_with-*.json"))
    if len(matches) != 1:
        raise ValueError(f"expected exactly one cached NPS fixture for {code}, found {len(matches)}")
    return matches[0]


def _fixture_park(
    path: Path,
    code: str,
    expected_name: str,
) -> tuple[dict[str, Any], dict[str, Any], int]:
    payload = _read_json(path)
    parks = [item for item in payload.get("data") or [] if isinstance(item, dict)]
    related = payload.get("related") if isinstance(payload.get("related"), dict) else {}
    if len(parks) != 1:
        raise ValueError(f"expected one park record in cached fixture: {path}")
    park = parks[0]
    actual_code = str(park.get("parkCode") or park.get("id") or "").strip().lower()
    actual_name = str(park.get("fullName") or park.get("name") or "").strip()
    if actual_code != code or actual_name != expected_name:
        raise ValueError(
            f"cached fixture identity mismatch for {code}: {actual_code!r}, {actual_name!r}"
        )
    related_for_park = related.get(code)
    if not isinstance(related_for_park, dict):
        raise ValueError(f"cached fixture has no related records for {code}: {path}")
    fetched_at = int(payload.get("fetched_at") or 0)
    if fetched_at <= 0:
        raise ValueError(f"cached fixture has no fixed fetched_at timestamp for {code}: {path}")
    return park, related_for_park, fetched_at


def _nps_https_url(value: Any) -> bool:
    text = str(value or "").strip()
    try:
        parsed = urlsplit(text)
        port = parsed.port
    except ValueError:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    return (
        parsed.scheme == "https"
        and bool(parsed.path)
        and not parsed.username
        and not parsed.password
        and port in (None, 443)
        and (host == "nps.gov" or host.endswith(".nps.gov"))
    )


def _valid_point(place: dict[str, Any]) -> bool:
    try:
        lat = float(place.get("lat"))
        lng = float(place.get("lng"))
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def _source_child_index(related: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places"):
        for item in related.get(endpoint) or []:
            if not isinstance(item, dict):
                continue
            source_id = str(item.get("id") or "").strip().casefold()
            title = title_key(child_title(item))
            if source_id:
                result.setdefault(f"{endpoint}:id:{source_id}", item)
            if title:
                result.setdefault(f"{endpoint}:title:{title}", item)
    return result


def _source_id_from_place(place: dict[str, Any]) -> str:
    direct = str(place.get("source_item_id") or "").strip()
    if direct:
        return direct
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    packed = str(pack.get("nps_item_id") or "").strip()
    if packed:
        return packed
    for source in place.get("sources") or []:
        if isinstance(source, dict) and str(source.get("source_id") or "").strip():
            return str(source["source_id"]).strip()
    return ""


def _resolve_source_item(
    place: dict[str, Any],
    endpoint: str,
    source_index: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    source_id = _source_id_from_place(place).casefold()
    if source_id:
        item = source_index.get(f"{endpoint}:id:{source_id}")
        if item is not None:
            return item
    return source_index.get(f"{endpoint}:title:{title_key(place.get('name'))}")


def _safe_nps_reader_url(raw_url: Any, parent_url: Any) -> tuple[str, str]:
    """Return a safe NPS reader URL and the normalization action used."""
    raw = str(raw_url or "").strip()
    try:
        parsed = urlsplit(raw)
    except ValueError:
        parsed = urlsplit("")
    raw_host = (parsed.hostname or "").lower().rstrip(".")
    if raw_host == "nps.gov" or raw_host.endswith(".nps.gov"):
        if parsed.scheme == "http":
            return parsed._replace(scheme="https").geturl(), "upgraded_nps_https"
        if _nps_https_url(raw):
            return raw, "kept_item_url"
    parent = str(parent_url or "").strip()
    if _nps_https_url(parent):
        return parent, "used_parent_nps_url"
    return "", "rejected"


def _normalize_child_reader_link(
    place: dict[str, Any],
    park: dict[str, Any],
    source_item: dict[str, Any],
    *,
    batch_id: str = BATCH_ID,
) -> str:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    item_url = source_item.get("url") or source_item.get("relatedUrl")
    if batch_id not in REVIEWED_BATCH_IDS:
        item_url = item_url or pack.get("official_url")
    safe_url, action = _safe_nps_reader_url(
        item_url,
        park.get("url"),
    )
    if not safe_url:
        return action
    pack["official_url"] = safe_url
    for source in pack.get("sources") or []:
        if isinstance(source, dict):
            source["url"] = safe_url
    for source in place.get("sources") or []:
        if isinstance(source, dict):
            source["url"] = safe_url
    place["source_pack"] = pack
    return action


def _structured_terms(source_item: dict[str, Any], *keys: str) -> set[str]:
    terms: set[str] = set()
    for key in keys:
        raw = source_item.get(key)
        values = raw if isinstance(raw, list) else [raw]
        for value in values:
            if isinstance(value, dict):
                value = value.get("name") or value.get("title") or value.get("label")
            text = str(value or "").strip().casefold()
            if text:
                terms.add(text)
    return terms


def _normalize_child_classification(
    place: dict[str, Any],
    endpoint: str,
    source_item: dict[str, Any],
    *,
    batch_id: str = BATCH_ID,
) -> None:
    """Classify from endpoint and structured NPS facts, not incidental title tokens."""
    title = str(place.get("name") or "").casefold()
    original_category = str(place.get("category") or "")
    activity_terms = _structured_terms(source_item, "activities")
    tag_terms = _structured_terms(source_item, "tags", "topics")
    facility_terms = _structured_terms(source_item, "amenities", "facilities")
    # Explicit NPS activities are authoritative. Tags/topics are a fallback,
    # not a reason to override a populated activity field.
    activity_basis = " ".join(sorted(activity_terms or tag_terms))
    guided_activity = bool(re.search(r"\b(?:guided|ranger|tour|program|talk)\b", activity_basis))
    trail_activity = bool(
        re.search(
            r"\b(?:hiking|backcountry hiking|front-country hiking|biking|cycling|"
            r"horseback riding|mountain biking|walking|snowshoeing|cross-country skiing)\b",
            activity_basis,
        )
    )
    explicit_nontrail_route_activity = bool(
        re.search(
            r"\b(?:scenic driving|auto touring|driving|road touring)\b",
            " ".join(sorted(activity_terms)),
        )
    )
    structured_trailhead = bool(
        re.search(r"\btrailheads?\b", " ".join(sorted(facility_terms)))
    )
    facility_title = bool(
        re.search(
            r"\b(?:gazebo|wayside|trail stops?|petroglyphs?|exhibits?|markers?|"
            r"signs?|ranger walks?|walk with a ranger)\b",
            title,
        )
    )
    trail_title = bool(re.search(r"\b(?:trail|hike|loop|route)\b", title)) and not facility_title
    if endpoint == "campgrounds":
        place["category"] = "campground"
        place["module_target"] = "stay"
    elif endpoint == "visitorcenters":
        place["category"] = "visitor_center"
        place["module_target"] = "visitor"
    elif endpoint == "thingstodo":
        is_trail = (
            trail_activity or (trail_title and not explicit_nontrail_route_activity)
        ) and not guided_activity
        place["category"] = "trail" if is_trail else "activity"
        place["module_target"] = "trails" if is_trail else "do"
    elif endpoint == "places":
        if structured_trailhead and trail_title:
            place["category"] = "trailhead"
            place["module_target"] = "trails"
        elif re.search(r"\b(?:campground|campsite)\b", title):
            place["category"] = "campground"
            place["module_target"] = "stay"
        elif re.search(r"\btrailhead\b", title) and not facility_title:
            place["category"] = "trailhead"
            place["module_target"] = "trails"
        elif re.search(r"\bvisitor (?:center|centre)\b", title):
            place["category"] = "visitor_center"
            place["module_target"] = "visitor"
        elif facility_title:
            place["module_target"] = "see"
            if re.search(r"\b(?:petroglyphs?|archaeolog|historic|exhibit|wayside|marker)\b", title):
                place["category"] = "historic_site"
            else:
                place["category"] = "place"
        elif re.search(r"\b(?:overlook|viewpoint|vista)\b", title):
            place["category"] = "viewpoint"
            place["module_target"] = "see"
        elif re.search(r"\b(?:waterfall|falls|cascade)\b", title):
            place["category"] = "waterfall"
            place["module_target"] = "see"
        elif place.get("category") in {
            "waterfall",
            "viewpoint",
            "lake",
            "river",
            "shore",
            "hot_spring",
            "peak",
            "historic_site",
            "monument",
        }:
            place["module_target"] = "see"
        elif (trail_title or trail_activity) and not guided_activity and not facility_title:
            place["category"] = "trail"
            place["module_target"] = "trails"
        else:
            place["module_target"] = "see"
            if place.get("category") in {"trail", "trailhead", "campground", "visitor_center", "activity"}:
                place["category"] = "place"

    exact_override = (
        EXACT_CLASSIFICATION_OVERRIDES.get(str(place.get("id") or ""))
        if batch_id in REVIEWED_BATCH_IDS
        else None
    )
    if exact_override:
        place["category"], place["module_target"] = exact_override

    final_category = str(place.get("category") or "")
    if final_category == original_category:
        return

    category_labels = {
        "activity": "Activity",
        "campground": "Campground",
        "place": "Place",
        "trail": "Trail",
        "trailhead": "Trailhead",
        "visitor_center": "Visitor center",
    }
    if batch_id in REVIEWED_BATCH_IDS:
        category_labels.update({
            "climbing_area": "Climbing area",
            "historic_site": "Historic site",
            "hot_spring": "Hot spring",
            "lake": "Lake",
            "monument": "Monument",
            "peak": "Peak",
            "river": "River",
            "shore": "Shore",
            "viewpoint": "Viewpoint",
            "waterfall": "Waterfall",
        })
    classification_tokens = {key.casefold() for key in category_labels}
    classification_tokens.update(label.casefold() for label in category_labels.values())

    def aligned_terms(values: Any) -> list[str]:
        clean = [str(value).strip() for value in values or [] if str(value).strip()]
        clean = [value for value in clean if value.casefold() not in classification_tokens]
        label = category_labels.get(final_category, final_category.replace("_", " ").title())
        if label and label.casefold() not in {value.casefold() for value in clean}:
            clean.append(label)
        return clean

    place["tags"] = aligned_terms(place.get("tags"))
    place["search_aliases"] = aligned_terms(place.get("search_aliases"))
    if isinstance(place.get("subcategories"), list):
        place["subcategories"] = aligned_terms(place.get("subcategories"))
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    if isinstance(pack.get("topics"), list):
        pack["topics"] = aligned_terms(pack.get("topics"))
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    quick_facts = [str(value).strip() for value in card.get("quick_facts") or [] if str(value).strip()]
    label = category_labels.get(final_category, final_category.replace("_", " ").title())
    replaced = False
    for index, value in enumerate(quick_facts):
        if value.casefold() in classification_tokens:
            quick_facts[index] = label
            replaced = True
    if not replaced and label:
        quick_facts.append(label)
    if quick_facts:
        card["quick_facts"] = list(dict.fromkeys(quick_facts))


def _apply_exact_child_copy_fixes(place: dict[str, Any]) -> None:
    """Apply reviewed, identity-bound source-copy corrections only."""
    place_id = str(place.get("id") or "")
    name_override = DISPLAY_NAME_OVERRIDES.get(place_id)
    if name_override:
        old_name, new_name = name_override
        if str(place.get("name") or "") == old_name:
            place["name"] = new_name
            aliases = [str(value).strip() for value in place.get("search_aliases") or [] if str(value).strip()]
            if old_name not in aliases:
                aliases.append(old_name)
            place["search_aliases"] = aliases
            card = place.get("card") if isinstance(place.get("card"), dict) else {}
            if card.get("title") == old_name:
                card["title"] = new_name
            if card.get("headline") == old_name:
                card["headline"] = new_name
            pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
            for source in pack.get("sources") or []:
                if isinstance(source, dict) and source.get("title") == old_name:
                    source["title"] = new_name
            for source in place.get("sources") or []:
                if isinstance(source, dict) and source.get("title") == old_name:
                    source["title"] = new_name

    replacements = EXACT_COPY_REPLACEMENTS.get(place_id, ())
    if not replacements:
        return

    def cleaned(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        result = value
        for old, new in replacements:
            result = result.replace(old, new)
        return re.sub(r"\s+", " ", result).strip()

    for key in ("summary", "description"):
        if key in place:
            place[key] = cleaned(place.get(key))
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    for key in ("summary", "highlight"):
        if key in card:
            card[key] = cleaned(card.get(key))
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    if "extract" in pack:
        pack["extract"] = cleaned(pack.get("extract"))


def _rendered_rail_identity(
    place: dict[str, Any],
) -> tuple[str, str, str, float | None, float | None]:
    try:
        lat = round(float(place.get("lat")), 5)
        lng = round(float(place.get("lng")), 5)
    except (TypeError, ValueError):
        lat = None
        lng = None
    return (
        str(place.get("parent_hub_id") or ""),
        str(place.get("module_target") or ""),
        title_key(place.get("name")),
        lat,
        lng,
    )


def _dedupe_rendered_rail_children(
    children: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep one deterministic record per parent, rail, title, and exact point."""
    grouped: dict[tuple[str, str, str, float | None, float | None], list[dict[str, Any]]] = {}
    for place in children:
        key = _rendered_rail_identity(place)
        grouped.setdefault(key, []).append(place)

    dropped_ids: set[str] = set()
    diagnostics: list[dict[str, Any]] = []
    for key, group in sorted(grouped.items()):
        if len(group) < 2:
            continue
        ranked = sorted(
            group,
            key=lambda place: (
                RENDERED_RAIL_ENDPOINT_PRIORITY.get(_endpoint_from_place(place), 99),
                str(place.get("id") or ""),
            ),
        )
        kept = ranked[0]
        dropped = ranked[1:]
        dropped_ids.update(str(place.get("id") or "") for place in dropped)
        diagnostics.append({
            "parent_hub_id": key[0],
            "module_target": key[1],
            "title": str(kept.get("name") or ""),
            "lat": key[3],
            "lng": key[4],
            "kept_id": kept.get("id"),
            "kept_endpoint": _endpoint_from_place(kept),
            "dropped": [
                {"id": place.get("id"), "endpoint": _endpoint_from_place(place)}
                for place in dropped
            ],
        })
    return (
        [place for place in children if str(place.get("id") or "") not in dropped_ids],
        diagnostics,
    )


def _dedupe_semantic_children(
    children: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Apply only reviewed, exact-identity cross-endpoint dedupe decisions."""
    by_scope: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for place in children:
        scope = (
            str(place.get("parent_hub_id") or ""),
            title_key(place.get("name")),
        )
        by_scope.setdefault(scope, []).append(place)

    dropped_ids: set[str] = set()
    diagnostics: list[dict[str, Any]] = []
    for scope, decision in sorted(SEMANTIC_DUPLICATE_PREFERENCES.items()):
        group = by_scope.get(scope, [])
        if len(group) < 2:
            continue
        kept_id = str(decision["kept_id"])
        expected_dropped_ids = tuple(sorted(str(value) for value in decision["expected_dropped_ids"]))
        group_ids = {str(place.get("id") or "") for place in group}
        if kept_id not in group_ids:
            raise ValueError(f"semantic dedupe is missing its reviewed keeper: {kept_id}")
        actual_dropped_ids = tuple(sorted(group_ids - {kept_id}))
        if actual_dropped_ids != expected_dropped_ids:
            raise ValueError(
                "semantic dedupe membership changed for "
                f"{scope[0]} / {scope[1]}: {actual_dropped_ids!r}"
            )
        dropped_ids.update(actual_dropped_ids)
        kept = next(place for place in group if str(place.get("id") or "") == kept_id)
        diagnostics.append({
            "parent_hub_id": scope[0],
            "title": str(kept.get("name") or ""),
            "kept_id": kept_id,
            "kept_endpoint": _endpoint_from_place(kept),
            "kept_media_count": len(kept.get("media") or []),
            "dropped": [
                {
                    "id": place.get("id"),
                    "endpoint": _endpoint_from_place(place),
                    "media_count": len(place.get("media") or []),
                }
                for place in sorted(group, key=lambda value: str(value.get("id") or ""))
                if str(place.get("id") or "") != kept_id
            ],
            "reason": decision["reason"],
        })
    return (
        [place for place in children if str(place.get("id") or "") not in dropped_ids],
        diagnostics,
    )


def _review_shared_coordinates(audit: dict[str, Any], *, batch_id: str) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []
    for warning in audit.get("warnings") or []:
        if warning.get("code") == "shared_coordinate_clusters":
            clusters.extend(warning.get("samples") or [])
    expected_reviews = SHARED_COORDINATE_REVIEWS.get(batch_id)
    if expected_reviews is None:
        return []

    reviewed: list[dict[str, Any]] = []
    for cluster in clusters:
        place_ids = tuple(sorted(str(value) for value in cluster.get("place_ids") or []))
        reason = expected_reviews.get(place_ids)
        if not reason:
            raise ValueError(f"unreviewed {batch_id} shared-coordinate cluster: {place_ids!r}")
        reviewed.append({
            "place_ids": list(place_ids),
            "decision": "keep_distinct",
            "reason": reason,
        })
    if len(reviewed) != len(expected_reviews):
        raise ValueError(
            f"{batch_id} shared-coordinate review set changed: "
            f"expected {len(expected_reviews)}, got {len(reviewed)}"
        )
    return reviewed


def _validate_batch4_contract(
    *,
    batch_id: str,
    audit: dict[str, Any],
    link_actions: Counter[str],
    parent_page_fallbacks: list[dict[str, Any]],
    media_before_policy: int,
    media_after_policy: int,
    children: list[dict[str, Any]],
) -> None:
    if batch_id != BATCH_4_ID:
        return
    expected_count = sum(BATCH_4_EXPECTED_DESTINATION_COUNTS.values())
    if int(audit.get("count") or 0) != expected_count:
        raise ValueError(
            f"Batch 4 child count changed: expected {expected_count}, "
            f"got {int(audit.get('count') or 0)}"
        )
    if audit.get("destination_counts") != BATCH_4_EXPECTED_DESTINATION_COUNTS:
        raise ValueError("Batch 4 destination counts changed")
    if audit.get("module_counts") != BATCH_4_EXPECTED_MODULE_COUNTS:
        raise ValueError("Batch 4 module counts changed")
    category_counts = dict(Counter(str(item.get("category") or "") for item in children))
    if category_counts != BATCH_4_EXPECTED_CATEGORY_COUNTS:
        raise ValueError("Batch 4 category counts changed")
    if dict(link_actions) != BATCH_4_EXPECTED_LINK_ACTIONS:
        raise ValueError("Batch 4 reader-link actions changed")
    actual_fallbacks = {
        str(item.get("place_id") or ""): str(item.get("official_url") or "")
        for item in parent_page_fallbacks
    }
    if actual_fallbacks != BATCH_4_EXPECTED_PARENT_FALLBACKS:
        raise ValueError("Batch 4 parent-page fallback set changed")
    actual_media = {
        "candidate_images": media_before_policy,
        "approved_images": media_after_policy,
        "stripped_images": media_before_policy - media_after_policy,
    }
    if actual_media != BATCH_4_EXPECTED_MEDIA_COUNTS:
        raise ValueError("Batch 4 media-rights counts changed")
    text_only_ids = {
        str(item.get("id") or "")
        for item in children
        if not (item.get("media") or [])
    }
    if text_only_ids != BATCH_4_EXPECTED_TEXT_ONLY_IDS:
        raise ValueError("Batch 4 text-only media identities changed")


def _rebuild_search_blob(
    place: dict[str, Any],
    endpoint: str,
    source_item: dict[str, Any],
) -> None:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    terms = [
        place.get("name"),
        place.get("parent_hub_title"),
        endpoint,
        place.get("category"),
        place.get("module_target"),
        place.get("summary"),
        place.get("description"),
        *(place.get("tags") or []),
        *(place.get("search_aliases") or []),
        *sorted(_structured_terms(source_item, "activities", "tags", "topics")),
        pack.get("primary"),
    ]
    place["search_blob"] = " ".join(
        re.sub(r"\s+", " ", URL_TOKEN.sub("", str(term or ""))).strip()
        for term in terms
        if URL_TOKEN.sub("", str(term or "")).strip()
    ).casefold()


def _endpoint_from_place(place: dict[str, Any]) -> str:
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    explicit = str(pack.get("nps_endpoint") or "").strip()
    if explicit:
        return explicit
    parts = str(place.get("id") or "").split(":", 4)
    return parts[3] if len(parts) == 5 else ""


def _stabilize_evidence_paths(value: Any) -> None:
    """Keep cached-rights evidence portable across checkout locations."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "source_cache_path" and str(child or "").strip():
                value[key] = f"nps-cache/{Path(str(child)).name}"
            else:
                _stabilize_evidence_paths(child)
    elif isinstance(value, list):
        for child in value:
            _stabilize_evidence_paths(child)


def _visible_copy(place: dict[str, Any]) -> str:
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
    return " ".join(
        str(value or "")
        for value in (
            place.get("name"),
            place.get("summary"),
            place.get("description"),
            card.get("summary"),
            pack.get("extract"),
        )
    )


def _audit_children(
    children: list[dict[str, Any]],
    sources_by_destination: dict[str, dict[str, dict[str, Any]]],
    *,
    batch_id: str = BATCH_ID,
) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    ids = [str(item.get("id") or "") for item in children]
    title_scopes = [
        (
            str(item.get("parent_hub_id") or ""),
            _endpoint_from_place(item),
            title_key(item.get("name")),
        )
        for item in children
    ]
    rendered_rail_scopes = [_rendered_rail_identity(item) for item in children]

    def fail(code: str, place: dict[str, Any], detail: str) -> None:
        errors.append({"code": code, "place_id": place.get("id"), "detail": detail})

    if len(ids) != len(set(ids)):
        errors.append({"code": "duplicate_id", "count": len(ids) - len(set(ids))})
    if len(title_scopes) != len(set(title_scopes)):
        errors.append({
            "code": "duplicate_title_scope",
            "count": len(title_scopes) - len(set(title_scopes)),
        })
    if len(rendered_rail_scopes) != len(set(rendered_rail_scopes)):
        errors.append({
            "code": "duplicate_rendered_rail_identity",
            "count": len(rendered_rail_scopes) - len(set(rendered_rail_scopes)),
        })

    module_counts: Counter[str] = Counter()
    destination_counts: Counter[str] = Counter()
    coordinate_groups: dict[tuple[float, float], list[str]] = {}
    media_count = 0
    for place in children:
        place_id = str(place.get("id") or "")
        parent_id = str(place.get("parent_hub_id") or "")
        code = parent_id.removeprefix("place:nps:")
        module_target = str(place.get("module_target") or "")
        module_counts[module_target] += 1
        destination_counts[code] += 1
        if not place_id.startswith(f"place:nps-child:{code}:") or place.get("canonical_role") != "child":
            fail("identity_contract", place, "child ID, parent ID, and canonical role must agree")
        if module_target not in ALLOWED_MODULE_TARGETS:
            fail("invalid_module_target", place, module_target)
        if not _valid_point(place):
            fail("invalid_coordinates", place, "missing or out-of-range point")
        else:
            point = (round(float(place["lat"]), 4), round(float(place["lng"]), 4))
            coordinate_groups.setdefault(point, []).append(place_id)
        if FORBIDDEN_COPY.search(_visible_copy(place)):
            fail("forbidden_or_filler_copy", place, "reader copy contains a forbidden generic phrase")
        if URL_TOKEN.search(_visible_copy(place)):
            fail("visible_copy_url", place, "reader copy may not retain source URLs")
        if re.search(r"https?://", str(place.get("search_blob") or ""), re.IGNORECASE):
            fail("unsafe_search_blob_url", place, "search data may not retain reader URLs")
        compatible_categories = {
            "stay": {"campground"},
            "visitor": {"visitor_center"},
            "trails": {"trail", "trailhead"},
            "do": {"activity"},
        }
        if module_target in compatible_categories and place.get("category") not in compatible_categories[module_target]:
            fail("module_category_mismatch", place, str(place.get("category") or "missing"))

        pack = place.get("source_pack") if isinstance(place.get("source_pack"), dict) else {}
        official_url = pack.get("official_url")
        if pack.get("primary") != NPS_ATTRIBUTION or pack.get("license") != NPS_LICENSE:
            fail("source_pack_identity", place, "NPS attribution or license is missing")
        if not _nps_https_url(official_url):
            fail("unsafe_official_url", place, str(official_url or "missing"))

        parts = place_id.split(":", 4)
        endpoint = parts[3] if len(parts) == 5 else ""
        source_item = _resolve_source_item(
            place,
            endpoint,
            sources_by_destination.get(code, {}),
        )
        if source_item is None:
            fail("source_item_missing", place, "accepted child did not resolve to its cached source row")
            continue
        stable_source_id = str(source_item.get("id") or "").strip()
        if not stable_source_id or _source_id_from_place(place) != stable_source_id:
            fail("source_identity_mismatch", place, "child is not bound to its stable NPS item ID")
        source_image = str(first_image(source_item).get("url") or "").strip()
        media = [item for item in place.get("media") or [] if isinstance(item, dict)]
        pack_photos = [item for item in pack.get("photos") or [] if isinstance(item, dict)]
        media_count += len(media)
        if media or pack_photos:
            if not source_image or not _nps_https_url(source_image):
                fail("unsafe_source_image", place, source_image or "missing")
            if [str(item.get("url") or "").strip() for item in media] != [source_image]:
                fail("media_identity_mismatch", place, "card media is not the exact cached child image")
            if [str(item.get("url") or "").strip() for item in pack_photos] != [source_image]:
                fail("pack_media_identity_mismatch", place, "source-pack media is not the exact cached child image")
            for image in [*media, *pack_photos]:
                if (
                    image.get("license") != NPS_LICENSE
                    or not str(image.get("credit") or "").strip()
                    or image.get("distribution_status") != NPS_MEDIA_DISTRIBUTION_STATUS
                    or image.get("rights_state") != NPS_MEDIA_RIGHTS_STATE
                    or not isinstance(image.get("rights_evidence"), dict)
                ):
                    fail("media_rights_missing", place, "approved cached rights evidence is missing")

    shared_coordinates = [
        {"lat": point[0], "lng": point[1], "place_ids": place_ids}
        for point, place_ids in sorted(coordinate_groups.items())
        if len(place_ids) > 1
    ]
    if shared_coordinates:
        warnings.append({
            "code": "shared_coordinate_clusters",
            "count": len(shared_coordinates),
            "samples": shared_coordinates[:12],
            "detail": "Distinct official child records can share an access point; review but do not merge by coordinate alone.",
        })
    return {
        "schema_version": 1,
        "batch_id": batch_id,
        "intended_grain": "one approved cached NPS child record per stable place ID",
        "count": len(children),
        "destination_counts": dict(destination_counts),
        "module_counts": dict(module_counts),
        "media_count": media_count,
        "unique_ids": len(ids) == len(set(ids)),
        "unique_title_scopes": len(title_scopes) == len(set(title_scopes)),
        "errors": errors,
        "warnings": warnings,
        "passed": not errors,
    }


def _build_child_contract(args: argparse.Namespace) -> dict[str, Any]:
    base_catalog_raw = getattr(args, "base_catalog", "")
    base_index_raw = getattr(args, "base_index", "")
    normalized_raw = getattr(args, "normalized_nps_catalog", "")
    source_cache_raw = getattr(args, "source_cache", "")
    out_dir_raw = getattr(args, "out_dir", "")
    if not all((base_catalog_raw, base_index_raw, normalized_raw, source_cache_raw, out_dir_raw)):
        raise ValueError(
            "contract mode requires --base-catalog, --base-index, "
            "--normalized-nps-catalog, --source-cache, and --out-dir"
        )

    base_catalog = Path(base_catalog_raw).resolve()
    base_index = Path(base_index_raw).resolve()
    normalized_catalog = Path(normalized_raw).resolve()
    source_cache = Path(source_cache_raw).resolve()
    out_dir = Path(out_dir_raw).resolve()
    base_manifest = base_catalog.parent / "manifest.json"
    for path in (base_manifest, base_catalog, base_index, normalized_catalog):
        if not path.is_file():
            raise FileNotFoundError(path)
    if not source_cache.is_dir():
        raise FileNotFoundError(source_cache)
    if not _contract_output_allowed(out_dir):
        raise ValueError("contract output must remain below data/explore/audit_candidates/internal")
    if out_dir.exists():
        raise FileExistsError(f"immutable candidate output already exists: {out_dir}")
    for source in (base_manifest, base_catalog, base_index, normalized_catalog, source_cache):
        if out_dir == source or out_dir in source.parents or source in out_dir.parents:
            raise ValueError(f"contract output overlaps an input: {source}")

    pinned_inputs = {
        "base_manifest": base_manifest,
        "base_catalog": base_catalog,
        "base_index": base_index,
        "normalized_nps_catalog": normalized_catalog,
    }
    for label, path in pinned_inputs.items():
        _require_sha256(path, CONTRACT_EXPECTED_INPUT_HASHES[label], label)

    base_manifest_payload = _read_json(base_manifest)
    base_payload = _read_json(base_catalog)
    base_places = _places(base_payload, base_catalog)
    base_index_payload = _read_json(base_index)
    base_index_items = _contract_index_items(base_index_payload, base_index)
    normalized_payload = _read_json(normalized_catalog)
    normalized_places = _places(normalized_payload, normalized_catalog)
    generated_at = int(normalized_payload.get("generated_at") or 0)
    if generated_at <= 0:
        raise ValueError("normalized NPS catalog needs a fixed generated_at timestamp")

    normalized_parents = {
        _compact_text(place.get("id")).removeprefix("place:nps:"): place
        for place in normalized_places
        if _compact_text(place.get("id")).startswith("place:nps:")
        and not _compact_text(place.get("id")).startswith("place:nps-child:")
    }
    required_codes = {
        *(code for code, _ in CONTRACT_DESTINATIONS),
        *CONTRACT_LEGACY_DESTINATIONS,
    }
    if missing := sorted(required_codes - normalized_parents.keys()):
        raise ValueError(f"normalized catalog lacks required NPS parents: {', '.join(missing)}")

    fixture_refs: dict[str, dict[str, Any]] = {}
    raw_indexes: dict[str, dict[str, dict[str, Any]]] = {}
    raw_occurrences: dict[str, Counter[tuple[str, str]]] = {}
    for code in sorted(required_codes):
        fixture = _fixture_for_code(source_cache, code)
        _require_sha256(
            fixture,
            CONTRACT_EXPECTED_FIXTURE_HASHES[code],
            f"NPS source cache {code}",
        )
        parent = normalized_parents[code]
        _, related, _ = _fixture_park(fixture, code, _compact_text(parent.get("name")))
        raw_indexes[code] = _source_child_index(related)
        occurrences: Counter[tuple[str, str]] = Counter()
        for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places"):
            for item in related.get(endpoint) or []:
                if not isinstance(item, dict):
                    continue
                source_id = _compact_text(item.get("id")).casefold()
                if source_id:
                    occurrences[(endpoint, source_id)] += 1
        raw_occurrences[code] = occurrences
        fixture_refs[code] = _source_ref(fixture, f"nps/{code}/{fixture.name}")

    release_public_ids = {
        _compact_text(row.get("public_id"))
        for row in base_manifest_payload.get("child_dispositions") or []
        if isinstance(row, dict) and _compact_text(row.get("public_id"))
    }
    legacy_places = sorted(
        (
            place
            for place in base_places
            if place.get("parent_hub_id")
            and not (place.get("source_pack") or {}).get("nps_endpoint")
        ),
        key=lambda place: _compact_text(place.get("id")),
    )
    legacy_by_release_rule = sorted(
        (
            place
            for place in base_places
            if place.get("canonical_role") == "child"
            and _compact_text(place.get("id")) not in release_public_ids
        ),
        key=lambda place: _compact_text(place.get("id")),
    )
    legacy_ids = [_compact_text(place.get("id")) for place in legacy_places]
    if legacy_ids != [_compact_text(place.get("id")) for place in legacy_by_release_rule]:
        raise ValueError("legacy child scope disagrees with the accepted b08 release manifest")
    if len(legacy_ids) != CONTRACT_EXPECTED_COUNTS["legacy"]:
        raise ValueError(f"expected 157 legacy children, got {len(legacy_ids)}")

    base_index_ids = {_compact_text(item.get("id")) for item in base_index_items}
    legacy_dispositions: list[dict[str, Any]] = []
    legacy_aliases: list[dict[str, Any]] = []
    legacy_normalized_rail_exceptions: list[dict[str, Any]] = []
    proposed_legacy_ids: set[str] = set()
    for place in legacy_places:
        existing_id = _compact_text(place.get("id"))
        code, endpoint, canonical_id = _legacy_child_identity(place)
        source_id = canonical_id.rsplit(":", 1)[-1]
        if raw_occurrences[code][(endpoint, source_id)] != 1:
            raise ValueError(f"legacy source identity is not unique in raw cache: {existing_id}")
        if canonical_id in proposed_legacy_ids:
            raise ValueError(f"duplicate proposed legacy canonical identity: {canonical_id}")
        proposed_legacy_ids.add(canonical_id)
        rail_key = _contract_rail_key_for_endpoint(endpoint)
        rail_ids = {
            _compact_text(item.get("source_id")).casefold()
            for item in (normalized_parents[code].get("source_pack") or {}).get(rail_key) or []
            if isinstance(item, dict)
        }
        normalized_rail_present = source_id in rail_ids
        if not normalized_rail_present:
            legacy_normalized_rail_exceptions.append({
                "existing_id": existing_id,
                "name": _compact_text(place.get("name")),
                "source_identity": f"nps:item:{source_id}",
                "reason": "Raw cached source remains valid but is absent from the normalized parent rail.",
            })
        served = existing_id in base_index_ids
        row = {
            "contract_kind": "legacy_normalization",
            "contract_action": "alias_existing_identity",
            "existing_id": existing_id,
            "proposed_canonical_id": canonical_id,
            "source_identity": f"nps:item:{source_id}",
            "parent_hub_id": _compact_text(place.get("parent_hub_id")),
            "module_target": _compact_text(place.get("module_target")),
            "served_in_base_index": served,
            "normalized_rail_present": normalized_rail_present,
            "reason": "Preserve the public ID while preparing a source-ID-qualified canonical alias.",
        }
        legacy_dispositions.append(row)
        legacy_aliases.append({
            "from": existing_id,
            "to": canonical_id,
            "source_identity": f"nps:item:{source_id}",
        })

    new_candidates: list[dict[str, Any]] = []
    new_identity_rows: list[dict[str, str]] = []
    for code, expected_name in CONTRACT_DESTINATIONS:
        parent = normalized_parents[code]
        if _compact_text(parent.get("name")) != expected_name:
            raise ValueError(f"normalized parent identity mismatch for {code}")
        source_pack = parent.get("source_pack") or {}
        for source_key, endpoint, module_target, cap in CONTRACT_RAILS:
            eligible = [
                item
                for item in source_pack.get(source_key) or []
                if isinstance(item, dict) and _contract_item_has_identity(item)
            ]
            for normalized in eligible[:cap]:
                source_id = _compact_text(normalized.get("source_id"))
                title = _compact_text(normalized.get("title"))
                identity = {
                    "park_code": code,
                    "module_target": module_target,
                    "source_key": source_key,
                    "source_id": source_id,
                    "title": title,
                }
                new_identity_rows.append(identity)
                canonical_id = (
                    f"place:nps-child:{code}:{endpoint}:{source_id.casefold()}"
                )
                if raw_occurrences[code][(endpoint, source_id.casefold())] != 1:
                    raise ValueError(
                        f"normalized source identity is not unique in raw cache: {canonical_id}"
                    )
                raw_item = raw_indexes[code].get(
                    f"{endpoint}:id:{source_id.casefold()}"
                )
                if raw_item is None:
                    raise ValueError(f"normalized candidate lacks raw cache evidence: {canonical_id}")
                new_candidates.append({
                    **identity,
                    "endpoint": endpoint,
                    "canonical_id": canonical_id,
                    "normalized_item": normalized,
                    "raw_item": raw_item,
                    "parent": parent,
                })

    identity_hashes = {
        "legacy": _canonical_sha256(legacy_ids),
        "new": _canonical_sha256(new_identity_rows),
        "combined": _canonical_sha256({
            "legacy_ids": legacy_ids,
            "new_candidates": new_identity_rows,
        }),
    }
    if identity_hashes != CONTRACT_EXPECTED_IDENTITY_HASHES:
        raise ValueError(f"child contract identity drift: {identity_hashes}")

    module_counts = Counter(item["module_target"] for item in new_candidates)
    destination_counts = Counter(item["park_code"] for item in new_candidates)
    expected_modules = {"see": 112, "do": 45, "stay": 49, "visitor": 31}
    expected_destinations = {
        "acad": 32,
        "grsm": 39,
        "grte": 34,
        "grba": 31,
        "badl": 18,
        "arch": 19,
        "cany": 25,
        "glca": 39,
    }
    if len(new_candidates) != CONTRACT_EXPECTED_COUNTS["new"]:
        raise ValueError(f"expected 237 normalized candidates, got {len(new_candidates)}")
    if dict(module_counts) != expected_modules:
        raise ValueError(f"normalized module count drift: {dict(module_counts)}")
    if dict(destination_counts) != expected_destinations:
        raise ValueError(f"normalized destination count drift: {dict(destination_counts)}")
    candidate_ids = [item["canonical_id"] for item in new_candidates]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise ValueError("new candidate canonical identities are not unique")
    base_place_ids = {_compact_text(place.get("id")) for place in base_places}
    if collision := sorted(base_place_ids.intersection(candidate_ids)):
        raise ValueError(f"new candidate collides with public catalog: {collision[0]}")

    title_clusters: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for candidate in new_candidates:
        key = (candidate["park_code"], title_key(candidate["title"]))
        title_clusters.setdefault(key, []).append(candidate)
    duplicate_clusters = [items for items in title_clusters.values() if len(items) > 1]
    if len(duplicate_clusters) != 1 or len(duplicate_clusters[0]) != 2:
        raise ValueError("expected exactly one two-record normalized-title collision")
    duplicate = duplicate_clusters[0]
    if title_key(duplicate[0]["title"]) != "acadia gateway center":
        raise ValueError("unexpected normalized-title collision")
    priority = {"visitor": 0, "stay": 1, "see": 2, "do": 3}
    duplicate_sorted = sorted(
        duplicate,
        key=lambda item: (priority[item["module_target"]], item["canonical_id"]),
    )
    duplicate_target = duplicate_sorted[0]
    duplicate_merged = duplicate_sorted[1]
    duplicate_merged["merge_target_id"] = duplicate_target["canonical_id"]
    duplicate_review = {
        "normalized_title": "Acadia Gateway Center",
        "kept_id": duplicate_target["canonical_id"],
        "merged_id": duplicate_merged["canonical_id"],
        "distance_meters": _contract_distance_meters(
            duplicate_target["normalized_item"],
            duplicate_merged["normalized_item"],
        ),
        "reason": (
            "Two official endpoint records describe the same colocated visitor facility; "
            "the richer visitor-center identity is retained."
        ),
    }

    missing_description: list[dict[str, str]] = []
    missing_media: list[dict[str, str]] = []
    visible_copy_overrides: list[dict[str, str]] = []
    reviewed_urls: list[dict[str, str]] = []
    new_dispositions: list[dict[str, Any]] = []
    materialized: list[dict[str, Any]] = []
    for candidate in new_candidates:
        normalized = candidate["normalized_item"]
        flags: list[str] = []
        if not _compact_text(normalized.get("description")):
            flags.append("missing_description_text_only")
            missing_description.append({
                "candidate_id": candidate["canonical_id"],
                "name": candidate["title"],
            })
        if not _compact_text(normalized.get("image_url")):
            flags.append("missing_media_text_only")
            missing_media.append({
                "candidate_id": candidate["canonical_id"],
                "name": candidate["title"],
            })
        if candidate["canonical_id"] in CONTRACT_VISIBLE_COPY_OVERRIDES:
            flags.append("visible_copy_url_removed")
            visible_copy_overrides.append({
                "candidate_id": candidate["canonical_id"],
                "name": candidate["title"],
                "reason": "Keep booking links in actions and sources, not reader-facing copy.",
            })
        host = _contract_url_host(normalized.get("url"))
        if not host:
            raise ValueError(f"candidate has an invalid reader URL: {candidate['canonical_id']}")
        if host != "www.nps.gov":
            if host not in CONTRACT_REVIEWED_HOSTS:
                raise ValueError(f"candidate uses an unreviewed reader host: {host}")
            flag = "reviewed_nps_alias_host" if host == "nps.gov" else "reviewed_external_source_link"
            flags.append(flag)
            reviewed_urls.append({
                "candidate_id": candidate["canonical_id"],
                "name": candidate["title"],
                "host": host,
                "url": _compact_text(normalized.get("url")),
                "review": CONTRACT_REVIEWED_HOSTS[host],
            })
        merge_target = _compact_text(candidate.get("merge_target_id"))
        action = "merge_duplicate_candidate" if merge_target else "review_new_candidate"
        disposition = {
            "contract_kind": "new_candidate",
            "contract_action": action,
            "candidate_id": candidate["canonical_id"],
            "source_identity": f"nps:item:{candidate['source_id'].casefold()}",
            "parent_hub_id": f"place:nps:{candidate['park_code']}",
            "module_target": candidate["module_target"],
            "source_key": candidate["source_key"],
            "review_flags": flags,
            "reason": (
                "Merge into the richer colocated visitor-center record."
                if merge_target
                else "Review as a source-bound internal child candidate."
            ),
        }
        if merge_target:
            disposition["merge_target_id"] = merge_target
        else:
            materialized.append(_contract_place_from_normalized(
                parent=candidate["parent"],
                candidate=candidate,
                source_item=candidate["raw_item"],
                generated_at=generated_at,
            ))
        new_dispositions.append(disposition)

    if len(missing_description) != CONTRACT_EXPECTED_COUNTS["missing_description"]:
        raise ValueError("missing-description review scope drifted")
    if len(missing_media) != CONTRACT_EXPECTED_COUNTS["missing_media"]:
        raise ValueError("missing-media review scope drifted")
    if len(reviewed_urls) != CONTRACT_EXPECTED_COUNTS["reviewed_non_www_nps_urls"]:
        raise ValueError("reviewed reader-host scope drifted")
    external_urls = [row for row in reviewed_urls if row["host"] != "nps.gov"]
    if len(external_urls) != CONTRACT_EXPECTED_COUNTS["reviewed_external_urls"]:
        raise ValueError("reviewed external reader-host scope drifted")
    if len(materialized) != CONTRACT_EXPECTED_COUNTS["materialized"]:
        raise ValueError(f"expected 236 materialized candidates, got {len(materialized)}")
    if len(visible_copy_overrides) != len(CONTRACT_VISIBLE_COPY_OVERRIDES):
        raise ValueError("reviewed visible-copy override scope drifted")

    media_before_ids = {
        _compact_text(place.get("id"))
        for place in materialized
        if place.get("media")
    }
    media_before = len(media_before_ids)
    evidence_root = source_cache.parents[3] if len(source_cache.parents) > 3 else source_cache.parent
    materialized = normalize_selected_nps_places(
        materialized,
        cache_dir=source_cache,
        evidence_root=evidence_root,
    )
    _stabilize_evidence_paths(materialized)
    media_after_ids = {
        _compact_text(place.get("id"))
        for place in materialized
        if place.get("media")
    }
    media_after = len(media_after_ids)
    media_rights_excluded_ids = sorted(media_before_ids - media_after_ids)
    if media_before != CONTRACT_EXPECTED_COUNTS["materialized_source_media"]:
        raise ValueError(f"materialized source-media count drifted: {media_before}")
    if media_after != CONTRACT_EXPECTED_COUNTS["approved_media"]:
        raise ValueError(f"approved media count drifted: {media_after}")
    if len(media_rights_excluded_ids) != CONTRACT_EXPECTED_COUNTS["media_rights_excluded"]:
        raise ValueError("media-rights exclusion scope drifted")
    disposition_by_id = {
        _compact_text(row.get("candidate_id")): row
        for row in new_dispositions
        if _compact_text(row.get("candidate_id"))
    }
    materialized_name_by_id = {
        _compact_text(place.get("id")): _compact_text(place.get("name"))
        for place in materialized
    }
    media_rights_excluded = []
    for candidate_id in media_rights_excluded_ids:
        disposition_by_id[candidate_id]["review_flags"].append(
            "media_excluded_by_rights_policy"
        )
        media_rights_excluded.append({
            "candidate_id": candidate_id,
            "name": materialized_name_by_id[candidate_id],
            "reason": "Cached media did not meet the strict NPS distribution-evidence policy.",
        })
    for place in materialized:
        if FORBIDDEN_COPY.search(_visible_copy(place)):
            raise ValueError(f"candidate contains forbidden reader copy: {place.get('id')}")
        if URL_TOKEN.search(_visible_copy(place)) or re.search(
            r"\bwww\.", _visible_copy(place), re.IGNORECASE
        ):
            raise ValueError(f"candidate reader copy contains a URL: {place.get('id')}")
        if URL_TOKEN.search(_compact_text(place.get("search_blob"))) or re.search(
            r"\bwww\.", _compact_text(place.get("search_blob")), re.IGNORECASE
        ):
            raise ValueError(f"candidate search data contains a URL: {place.get('id')}")
        for media in place.get("media") or []:
            if media.get("distribution_status") != NPS_MEDIA_DISTRIBUTION_STATUS:
                raise ValueError(f"candidate media lacks distribution review: {place.get('id')}")
            if media.get("rights_state") != NPS_MEDIA_RIGHTS_STATE:
                raise ValueError(f"candidate media lacks rights evidence: {place.get('id')}")

    served_legacy = sum(row["served_in_base_index"] for row in legacy_dispositions)
    catalog_only_legacy = len(legacy_dispositions) - served_legacy
    if served_legacy != CONTRACT_EXPECTED_COUNTS["served_legacy"]:
        raise ValueError(f"legacy serving-index coverage drifted: {served_legacy}")
    if catalog_only_legacy != CONTRACT_EXPECTED_COUNTS["catalog_only_legacy"]:
        raise ValueError(f"legacy catalog-only coverage drifted: {catalog_only_legacy}")
    if len(legacy_normalized_rail_exceptions) != 1:
        raise ValueError("expected one legacy normalized-rail exception")
    exception = legacy_normalized_rail_exceptions[0]
    if exception["name"] != "Fountain Freight Road Bike Trail":
        raise ValueError("unexpected legacy normalized-rail exception")

    dispositions = [*legacy_dispositions, *new_dispositions]
    if len(dispositions) != CONTRACT_EXPECTED_COUNTS["total"]:
        raise ValueError(f"expected 394 child dispositions, got {len(dispositions)}")

    child_dispositions = {
        "schema": "ExploreNpsChildAuditDispositionsV1",
        "schema_version": 1,
        "contract_id": CONTRACT_BATCH_ID,
        "stage": "internal",
        "public_promotion_compatible": False,
        "count": len(dispositions),
        "identity_hashes": identity_hashes,
        "rows": dispositions,
    }
    contract = {
        "schema": "ExploreNpsChildContractV1",
        "schema_version": 1,
        "contract_id": CONTRACT_BATCH_ID,
        "stage": "internal",
        "generated_at": generated_at,
        "promotion_ready": False,
        "counts": {
            "legacy_aliases": len(legacy_aliases),
            "new_candidate_dispositions": len(new_dispositions),
            "materialized_places": len(materialized),
            "merged_duplicates": 1,
        },
        "identity_hashes": identity_hashes,
        "selection_rule": {
            "authority": "accepted normalized b09 source_pack rails",
            "order": [source_key for source_key, _, _, _ in CONTRACT_RAILS],
            "limits": {
                source_key: cap for source_key, _, _, cap in CONTRACT_RAILS
            },
            "requirements": ["valid coordinates", "stable NPS source ID", "HTTP-linked source record"],
            "raw_cache_role": "provenance and media-rights evidence only",
        },
        "legacy_aliases": legacy_aliases,
        "places": materialized,
    }
    review = {
        "schema": "ExploreNpsChildContractReviewV1",
        "schema_version": 1,
        "contract_id": CONTRACT_BATCH_ID,
        "stage": "internal",
        "requests_used": 0,
        "promotion_ready": False,
        "counts": {
            "legacy_normalization": len(legacy_dispositions),
            "new_candidates": len(new_dispositions),
            "total_dispositions": len(dispositions),
            "materialized_places": len(materialized),
            "module_counts": dict(module_counts),
            "destination_counts": dict(destination_counts),
            "served_legacy": served_legacy,
            "catalog_only_legacy": catalog_only_legacy,
            "missing_description": len(missing_description),
            "missing_media": len(missing_media),
            "materialized_source_media": media_before,
            "approved_media": media_after,
            "media_rights_excluded": len(media_rights_excluded),
            "reviewed_non_www_nps_urls": len(reviewed_urls),
            "reviewed_external_urls": len(external_urls),
            "visible_copy_overrides": len(visible_copy_overrides),
        },
        "duplicate_title_review": duplicate_review,
        "missing_description": missing_description,
        "missing_media": missing_media,
        "media_rights_excluded": media_rights_excluded,
        "reader_url_reviews": reviewed_urls,
        "visible_copy_overrides": visible_copy_overrides,
        "legacy_normalized_rail_exceptions": legacy_normalized_rail_exceptions,
        "copy_policy": {
            "missing_description": "Keep list/text-only; do not synthesize prose.",
            "missing_media": "Use a clean text fallback; do not fabricate destination imagery.",
            "unresolved_media_rights": "Exclude the image until exact distribution evidence is reviewed.",
        },
        "internal_preview_contract": {
            "stage": "internal",
            "requires_authenticated_admin": True,
            "required_header": "X-Trailhead-Explore-Preview: internal",
            "header_is_not_a_credential": True,
            "automatically_mounted": False,
        },
    }
    audit = {
        "schema": "ExploreNpsChildContractAuditV1",
        "schema_version": 1,
        "contract_id": CONTRACT_BATCH_ID,
        "stage": "internal",
        "passed": True,
        "errors": [],
        "warnings": [],
        "checks": {
            "pinned_inputs_match": True,
            "requests_used_zero": True,
            "legacy_scope_exact": True,
            "new_scope_exact": True,
            "combined_scope_exact": True,
            "raw_bindings_complete": True,
            "legacy_aliases_unique": True,
            "new_candidate_ids_unique": True,
            "public_id_collisions_absent": True,
            "duplicate_disposition_complete": True,
            "missing_copy_stays_empty": True,
            "media_rights_bound": True,
            "reader_hosts_reviewed": True,
            "public_promotion_compatible": False,
            "live_catalog_modified": False,
            "live_serving_index_modified": False,
        },
        "identity_hashes": identity_hashes,
    }

    out_dir.mkdir(parents=True, exist_ok=False)
    artifacts = {
        "audit.json": audit,
        "child_dispositions.json": child_dispositions,
        "nps_child_contract_v1.json": contract,
        "review.json": review,
    }
    for name, payload in artifacts.items():
        _write_json(out_dir / name, payload)
    manifest = {
        "schema": "ExploreNpsChildContractManifestV1",
        "schema_version": 1,
        "contract_id": CONTRACT_BATCH_ID,
        "stage": "internal",
        "generated_at": generated_at,
        "requests_used": 0,
        "promotion_ready": False,
        "public_promotion_compatible": False,
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "identity_hashes": identity_hashes,
        "inputs": {
            "base_manifest": _source_ref(base_manifest, "b08/manifest.json"),
            "base_catalog": _source_ref(base_catalog, "b08/explore_catalog_v3.json"),
            "base_index": _source_ref(base_index, "b08/explore_serving_index_v2.json"),
            "normalized_nps_catalog": _source_ref(
                normalized_catalog,
                "b09-accepted-v3/explore_catalog_v3.json",
            ),
            "fixtures": fixture_refs,
        },
        "protected_artifacts": {
            "dashboard/explore_serving_index_v2.json": (
                "7e59e5e2273dbbe1a26d7bbd4d947faa20935c51fb79c464eed8a17babf4d8f4"
            ),
            "docs/app-store-copy.md": (
                "aaad7e9ced46e5931bda0c50a82cc66c331bcee5dd5ea8c8a24641e617a24a86"
            ),
        },
        "artifacts": [
            {
                "path": name,
                "bytes": (out_dir / name).stat().st_size,
                "sha256": _sha256(out_dir / name),
            }
            for name in sorted(artifacts)
        ],
    }
    _write_json(out_dir / "manifest.json", manifest)
    return {
        "out_dir": str(out_dir),
        "disposition_count": len(dispositions),
        "materialized_count": len(materialized),
        "module_counts": dict(module_counts),
        "destination_counts": dict(destination_counts),
        "identity_hashes": identity_hashes,
        "manifest_sha256": _sha256(out_dir / "manifest.json"),
    }


def build(args: argparse.Namespace) -> dict[str, Any]:
    batch_id = str(getattr(args, "batch_id", BATCH_ID) or BATCH_ID).strip()
    if batch_id == CONTRACT_BATCH_ID:
        return _build_child_contract(args)
    try:
        batch_destinations = BATCH_DEFINITIONS[batch_id]
    except KeyError as exc:
        supported = ", ".join(sorted(BATCH_DEFINITIONS))
        raise ValueError(f"unsupported NPS child-depth batch {batch_id!r}; choose {supported}") from exc
    base_catalog = Path(args.base_catalog).resolve()
    normalized_catalog: Path | None = None
    source_cache = Path(args.source_cache).resolve()
    out_dir = Path(args.out_dir).resolve()
    if not base_catalog.is_file():
        raise FileNotFoundError(base_catalog)
    if not source_cache.is_dir():
        raise FileNotFoundError(source_cache)
    if batch_id == BATCH_4_ID:
        normalized_raw = str(getattr(args, "normalized_nps_catalog", "") or "").strip()
        if not normalized_raw:
            raise ValueError("Batch 4 requires --normalized-nps-catalog")
        normalized_catalog = Path(normalized_raw).resolve()
        if not normalized_catalog.is_file():
            raise FileNotFoundError(normalized_catalog)
        _require_sha256(
            base_catalog,
            BATCH_4_EXPECTED_INPUT_HASHES["base_catalog"],
            "Batch 4 base catalog",
        )
        _require_sha256(
            normalized_catalog,
            BATCH_4_EXPECTED_INPUT_HASHES["normalized_nps_catalog"],
            "Batch 4 normalized NPS catalog",
        )
    if out_dir == AUDIT_CANDIDATE_ROOT or AUDIT_CANDIDATE_ROOT not in out_dir.parents:
        raise ValueError("output must remain below data/explore/audit_candidates")
    if out_dir in PROTECTED_OUTPUTS or any(out_dir in path.parents for path in PROTECTED_OUTPUTS):
        raise ValueError("output may not target a protected live artifact")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise FileExistsError(f"immutable candidate directory is not empty: {out_dir}")

    base_payload = _read_json(base_catalog)
    base_places = _places(base_payload, base_catalog)
    existing_ids, existing_titles = load_existing_keys({"places": base_places})
    generated_at = int(base_payload.get("generated_at") or 0)
    if normalized_catalog is not None:
        normalized_payload = _read_json(normalized_catalog)
        normalized_parents = {
            str(place.get("id") or ""): place
            for place in _places(normalized_payload, normalized_catalog)
            if str(place.get("id") or "").startswith("place:nps:")
            and not str(place.get("id") or "").startswith("place:nps-child:")
        }
        for code, expected_name in batch_destinations:
            parent = normalized_parents.get(f"place:nps:{code}")
            if not parent or str(parent.get("name") or "").strip() != expected_name:
                raise ValueError(
                    f"Batch 4 normalized parent mismatch for {code}: "
                    f"{str((parent or {}).get('name') or '').strip()!r}"
                )
        generated_at = int(normalized_payload.get("generated_at") or 0)
    if generated_at <= 0:
        raise ValueError("base catalog needs a fixed generated_at timestamp")

    children: list[dict[str, Any]] = []
    fixture_refs: dict[str, dict[str, Any]] = {}
    source_indexes: dict[str, dict[str, dict[str, Any]]] = {}
    destination_review: list[dict[str, Any]] = []
    link_actions: Counter[str] = Counter()
    parent_page_fallbacks: list[dict[str, Any]] = []
    for code, expected_name in batch_destinations:
        fixture = _fixture_for_code(source_cache, code)
        if batch_id == BATCH_4_ID:
            _require_sha256(
                fixture,
                BATCH_4_EXPECTED_FIXTURE_HASHES[code],
                f"Batch 4 NPS source cache {code}",
            )
        park, related, source_fetched_at = _fixture_park(fixture, code, expected_name)
        source_indexes[code] = _source_child_index(related)
        additions = promote_from_fixture(
            fixture,
            existing_ids,
            existing_titles,
            generated_at,
            max_per_park=MAX_PER_DESTINATION,
        )
        for child in additions:
            parts = str(child.get("id") or "").split(":", 4)
            endpoint = parts[3] if len(parts) == 5 else ""
            source_item = _resolve_source_item(child, endpoint, source_indexes[code])
            if source_item is None:
                continue
            _normalize_child_classification(
                child,
                endpoint,
                source_item,
                batch_id=batch_id,
            )
            _apply_exact_child_copy_fixes(child)
            link_action = _normalize_child_reader_link(
                child,
                park,
                source_item,
                batch_id=batch_id,
            )
            link_actions[link_action] += 1
            if link_action == "used_parent_nps_url":
                parent_page_fallbacks.append({
                    "place_id": child.get("id"),
                    "name": child.get("name"),
                    "endpoint": endpoint,
                    "parent_hub_id": child.get("parent_hub_id"),
                    "official_url": (
                        child.get("source_pack", {}).get("official_url")
                        if isinstance(child.get("source_pack"), dict)
                        else None
                    ),
                    "reason": "The cached official child record has no reader URL; use the official parent park page.",
                })
            _rebuild_search_blob(child, endpoint, source_item)
        children.extend(additions)
        module_counts = Counter(str(item.get("module_target") or "") for item in additions)
        destination_review.append(
            {
                "park_code": code,
                "name": expected_name,
                "accepted": len(additions),
                "module_counts": dict(module_counts),
                "cached_counts": {
                    endpoint: len(related.get(endpoint) or [])
                    for endpoint in ("campgrounds", "visitorcenters", "thingstodo", "places")
                },
                "parent_hub_id": f"place:nps:{code}",
                "source_fetched_at": source_fetched_at,
            }
        )
        fixture_refs[code] = _source_ref(fixture, f"nps/{code}/{fixture.name}")

    children, rendered_rail_dedupe = _dedupe_rendered_rail_children(children)
    children, semantic_dedupe = _dedupe_semantic_children(children)
    for destination in destination_review:
        code = str(destination.get("park_code") or "")
        final_children = [
            child
            for child in children
            if str(child.get("parent_hub_id") or "") == f"place:nps:{code}"
        ]
        destination["accepted_before_dedupe"] = destination["accepted"]
        destination["accepted"] = len(final_children)
        destination["module_counts"] = dict(
            Counter(str(child.get("module_target") or "") for child in final_children)
        )
    if not children or len(children) > MAX_TOTAL:
        raise ValueError(f"bounded batch count must be between 1 and {MAX_TOTAL}, got {len(children)}")
    media_before_policy = sum(len(item.get("media") or []) for item in children)
    evidence_root = source_cache.parents[3] if len(source_cache.parents) > 3 else source_cache.parent
    children = normalize_selected_nps_places(
        children,
        cache_dir=source_cache,
        evidence_root=evidence_root,
    )
    _stabilize_evidence_paths(children)
    if batch_id in REVIEWED_BATCH_IDS:
        for child in children:
            endpoint = _endpoint_from_place(child)
            code = str(child.get("parent_hub_id") or "").removeprefix("place:nps:")
            source_item = _resolve_source_item(
                child,
                endpoint,
                source_indexes.get(code, {}),
            )
            _apply_exact_child_copy_fixes(child)
            if source_item is not None:
                _rebuild_search_blob(child, endpoint, source_item)
    media_after_policy = sum(len(item.get("media") or []) for item in children)
    audit = _audit_children(children, source_indexes, batch_id=batch_id)
    if not audit["passed"]:
        codes = sorted({str(item.get("code") or "unknown") for item in audit["errors"]})
        raise ValueError(f"NPS child-depth audit failed: {', '.join(codes)}")
    shared_coordinate_review = _review_shared_coordinates(audit, batch_id=batch_id)
    _validate_batch4_contract(
        batch_id=batch_id,
        audit=audit,
        link_actions=link_actions,
        parent_page_fallbacks=parent_page_fallbacks,
        media_before_policy=media_before_policy,
        media_after_policy=media_after_policy,
        children=children,
    )

    sidecar = {
        "schema_version": 1,
        "batch_id": batch_id,
        "stage": "internal",
        "generated_at": generated_at,
        "source": "Cached official National Park Service child records",
        "count": len(children),
        "places": children,
    }
    review = {
        "schema_version": 1,
        "batch_id": batch_id,
        "generated_at": generated_at,
        "requests_used": 0,
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "promotion_ready": False,
        "destinations": destination_review,
        "counts": {
            "base_places": len(base_places),
            "sidecar_places": len(children),
            "destination_count": len(destination_review),
        },
        "reader_link_actions": dict(link_actions),
        "media_policy": {
            "candidate_images": media_before_policy,
            "approved_images": media_after_policy,
            "stripped_images": media_before_policy - media_after_policy,
            "policy": "exact cached NPS media with NPS-prefixed credit only",
        },
        "rendered_rail_dedupe": {
            "rule": (
                "one stable child per parent, rendered module, normalized title, and "
                "5-decimal point; endpoint priority then stable ID"
            ),
            "dropped_count": sum(len(item["dropped"]) for item in rendered_rail_dedupe),
            "records": rendered_rail_dedupe,
        },
        "internal_preview_contract": {
            "stage": "internal",
            "requires_authenticated_admin": True,
            "required_header": "X-Trailhead-Explore-Preview: internal",
            "header_is_not_a_credential": True,
        },
    }
    if batch_id in REVIEWED_BATCH_IDS:
        review.update({
            "parent_page_source_fallbacks": sorted(
                parent_page_fallbacks,
                key=lambda item: str(item.get("place_id") or ""),
            ),
            "semantic_dedupe": {
                "rule": "reviewed exact parent and normalized-title decisions only",
                "dropped_count": sum(len(item["dropped"]) for item in semantic_dedupe),
                "records": semantic_dedupe,
            },
            "shared_coordinate_review": shared_coordinate_review,
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts = {
        "nps_child_depth_v1.json": sidecar,
        "audit.json": audit,
        "review.json": review,
    }
    for name, payload in artifacts.items():
        _write_json(out_dir / name, payload)
    manifest = {
        "schema_version": 1,
        "batch_id": batch_id,
        "generated_at": generated_at,
        "requests_used": 0,
        "live_catalog_modified": False,
        "live_serving_index_modified": False,
        "promotion_ready": False,
        "inputs": {
            "base_catalog": _source_ref(base_catalog, f"base_catalog/{base_catalog.name}"),
            **({
                "normalized_nps_catalog": _source_ref(
                    normalized_catalog,
                    f"normalized_nps_catalog/{normalized_catalog.name}",
                ),
            } if normalized_catalog is not None else {}),
            "fixtures": fixture_refs,
        },
        "artifacts": [
            {"path": name, "bytes": (out_dir / name).stat().st_size, "sha256": _sha256(out_dir / name)}
            for name in sorted(artifacts)
        ],
    }
    _write_json(out_dir / "manifest.json", manifest)
    return {
        "out_dir": str(out_dir),
        "count": len(children),
        "destination_counts": audit["destination_counts"],
        "module_counts": audit["module_counts"],
        "manifest_sha256": _sha256(out_dir / "manifest.json"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--batch-id",
        choices=sorted((*BATCH_DEFINITIONS, CONTRACT_BATCH_ID)),
        default=BATCH_ID,
    )
    parser.add_argument("--base-catalog", default=str(DEFAULT_BASE_CATALOG))
    parser.add_argument("--base-index")
    parser.add_argument("--normalized-nps-catalog")
    parser.add_argument("--source-cache", default=str(DEFAULT_SOURCE_CACHE))
    parser.add_argument("--out-dir")
    args = parser.parse_args()
    if not args.out_dir:
        args.out_dir = str(AUDIT_CANDIDATE_ROOT / f"internal/{args.batch_id}")
    return args


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), indent=2))
