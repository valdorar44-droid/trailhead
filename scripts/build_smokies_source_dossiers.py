#!/usr/bin/env python3
"""Build the deterministic S2 source/story dossier for the Smokies Original."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.originals_sources import normalize_original_source_dossier


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
REVIEWED_AT = "2026-08-05"


def _source(source_id: str, title: str, url: str, scope: list[str], publisher: str = "National Park Service") -> dict:
    return {
        "id": source_id,
        "title": title,
        "url": url,
        "publisher": publisher,
        "role": "story",
        "authority": "official",
        "reviewed_at": REVIEWED_AT,
        "rights_status": "reference_only",
        "scope": scope,
    }


SOURCES = [
    _source("nps_grsm_natural_features", "Natural Features & Ecosystems", "https://www.nps.gov/grsm/learn/nature/naturalfeaturesandecosystems.htm", ["biodiversity", "rainfall", "streams", "waterfalls"]),
    _source("nps_grsm_geology", "Geology", "https://www.nps.gov/grsm/learn/nature/geology.htm", ["cades_cove", "erosion", "mountain_building", "rock"]),
    _source("nps_grsm_air_quality", "Air Quality", "https://www.nps.gov/grsm/learn/nature/air-quality.htm", ["air_quality", "haze", "monitoring"]),
    _source("nps_grsm_vegetation", "Vegetation Types", "https://www.nps.gov/grsm/learn/nature/vegetation-types.htm", ["elevation", "forest", "habitat"]),
    _source("nps_grsm_nature", "Nature & Science", "https://www.nps.gov/grsm/learn/nature/index.htm", ["biodiversity", "climate", "old_growth", "species"]),
    _source("nps_grsm_animals", "Animals", "https://www.nps.gov/grsm/learn/nature/animals.htm", ["biodiversity", "wildlife"]),
    _source("nps_grsm_black_bears", "Black Bears", "https://www.nps.gov/grsm/learn/nature/black-bears.htm", ["black_bears", "wildlife_viewing"]),
    _source("nps_grsm_elk", "Elk", "https://www.nps.gov/grsm/learn/nature/elk.htm", ["elk", "restoration", "wildlife_viewing"]),
    _source("nps_grsm_history_culture", "History & Culture", "https://www.nps.gov/grsm/learn/historyculture/index.htm", ["ccc", "communities", "logging", "park_history"]),
    _source("nps_grsm_people", "People", "https://www.nps.gov/grsm/learn/historyculture/people.htm", ["communities", "displacement", "forest_recovery", "logging"]),
    _source("nps_grsm_timeline", "Smoky Mountain Timeline", "https://www.nps.gov/grsm/learn/historyculture/timeline.htm", ["cades_cove", "logging", "park_creation", "road_history"]),
    _source("nps_grsm_newfound_gap_road", "Newfound Gap Road Historic Corridor", "https://www.nps.gov/grsm/learn/news/newfound-gap-road-to-reopen-ahead-of-schedule-following-major-repairs.htm", ["ccc", "engineering", "newfound_gap_road"]),
    _source("nps_grsm_segregation", "Segregation at Great Smoky Mountains National Park", "https://www.nps.gov/grsm/learn/historyculture/segregation-at-great-smoky-mountains-national-park.htm", ["civil_rights", "newfound_gap"]),
    _source("nps_grsm_kuwohi_restoration", "Kuwohi name restored to the highest peak in the Smokies", "https://www.nps.gov/grsm/learn/news/kuwohi-name-restored-to-the-highest-peak-in-the-smokies.htm", ["kuwohi", "name_restoration"]),
    _source("nps_grsm_kuwohi_area", "Kuwohi & Newfound Gap Area", "https://www.nps.gov/grsm/planyourvisit/kuwohi-nfg.htm", ["kuwohi", "newfound_gap", "visitor_context"]),
    _source("ebci_cultural_irb", "Cultural Institutional Review Board", "https://www.ebci.gov/cultural-institutional-review-board/", ["cultural_review", "research_sovereignty"], "Eastern Band of Cherokee Indians"),
    _source("ebci_cultural_resources", "Enrollment and Cultural Resources Contact", "https://www.ebci.gov/enrollment/", ["cultural_contact", "cultural_practices"], "Eastern Band of Cherokee Indians"),
    _source("nps_grsm_oconaluftee", "Oconaluftee Area", "https://www.nps.gov/grsm/planyourvisit/oconaluftee.htm", ["mountain_farm", "oconaluftee", "visitor_context"]),
    _source("nps_grsm_mountain_farm", "Mountain Farm Museum", "https://www.nps.gov/places/mountain-farm-museum.htm", ["historic_structures", "mountain_farm", "relocation"]),
    _source("nps_grsm_cades_history", "History of Cades Cove", "https://www.nps.gov/grsm/learn/historyculture/cades-cove-history.htm", ["agriculture", "cades_cove", "churches", "community", "displacement"]),
    _source("nps_grsm_cades_cove", "Cades Cove", "https://www.nps.gov/grsm/planyourvisit/cadescove.htm", ["cades_cove", "historic_structures", "loop_road", "wildlife"]),
    _source("nps_grsm_cable_mill", "Cable Mill Historic Area", "https://www.nps.gov/places/cable-mill-historic-area.htm", ["cable_mill", "corn_milling", "gristmill", "water_power"]),
    _source("nps_grsm_general_stores", "General Stores", "https://www.nps.gov/grsm/learn/historyculture/stores.htm", ["becky_cable", "commerce", "community"]),
    _source("nps_grsm_roaring_fork", "Roaring Fork Motor Nature Trail", "https://www.nps.gov/grsm/planyourvisit/roaringfork.htm", ["historic_farms", "old_growth", "roaring_fork", "waterfalls"]),
    _source("nps_grsm_foothills", "Foothills Parkway", "https://www.nps.gov/places/foothills-parkway.htm", ["authorization", "foothills_parkway", "scenic_drive"]),
    _source("nps_grsm_foothills_history", "Foothills Parkway design and technical studies", "https://www.nps.gov/grsm/learn/news/national-park-service-plans-to-complete-additional-design-work-and-technical-studies-for-foothills-parkway-section-8d.htm", ["engineering", "foothills_parkway", "missing_link"]),
    _source("nps_grsm_missing_link_bridge", "Foothills Parkway Missing Link bridge construction", "https://www.nps.gov/grsm/learn/news/fhp-contract-award.htm", ["bridge_engineering", "foothills_parkway", "missing_link"]),
    _source("nps_grsm_statistics", "Park Statistics", "https://www.nps.gov/grsm/learn/management/statistics.htm", ["park_scale", "roads", "species", "streams"]),
]


def _claim(claim_id: str, chapter: str, statement: str, source_ids: list[str], *, cultural: bool = False) -> dict:
    return {
        "id": claim_id,
        "chapter_id": chapter,
        "statement": statement,
        "status": "cultural_review_required" if cultural else "source_verified",
        "cultural_gate": "ebci_required" if cultural else "not_required",
        "source_ids": source_ids,
    }


CLAIMS = [
    _claim("mc_gateway_watershed", "mountain_crossing", "Sugarlands begins beside a connected mountain watershed whose streams visibly shape the road corridor.", ["nps_grsm_natural_features"]),
    _claim("mc_deep_geology", "mountain_crossing", "Most exposed park rocks began as sediments and were later folded and uplifted during continental collisions.", ["nps_grsm_geology"]),
    _claim("mc_rain_and_streams", "mountain_crossing", "High-elevation rainfall feeds a dense network of mountain streams and waterfalls.", ["nps_grsm_natural_features", "nps_grsm_statistics"]),
    _claim("mc_forest_zones", "mountain_crossing", "Elevation and slope help organize distinct forest communities along the crossing.", ["nps_grsm_vegetation"]),
    _claim("mc_biodiversity", "mountain_crossing", "The park's elevation and climate gradients support exceptional biological diversity.", ["nps_grsm_nature", "nps_grsm_animals"]),
    _claim("mc_road_engineering", "mountain_crossing", "Newfound Gap Road was redesigned in the 1930s as a scenic, safer cross-mountain corridor.", ["nps_grsm_newfound_gap_road"]),
    _claim("mc_ccc_legacy", "mountain_crossing", "Civilian Conservation Corps-era stonework and road features remain visible along the corridor.", ["nps_grsm_history_culture", "nps_grsm_newfound_gap_road"]),
    _claim("mc_segregated_landscape", "mountain_crossing", "Some early visitor facilities at Newfound Gap were planned or operated within a segregated public landscape.", ["nps_grsm_segregation"]),
    _claim("mc_park_creation", "mountain_crossing", "Creating the park protected forest while requiring more than a thousand landowners to leave homes and communities.", ["nps_grsm_people", "nps_grsm_timeline"]),
    _claim("mc_logging_recovery", "mountain_crossing", "Industrial logging transformed much of the forest before park protection allowed broad recovery.", ["nps_grsm_people", "nps_grsm_history_culture"]),
    _claim("mc_haze_and_pollution", "mountain_crossing", "Natural blue haze and modern air pollution are different phenomena, and pollution can reduce views and harm high-elevation ecosystems.", ["nps_grsm_air_quality"]),
    _claim("mc_gap_context", "mountain_crossing", "Newfound Gap is a high pass connecting the Tennessee and North Carolina sides of the park.", ["nps_grsm_kuwohi_area"]),
    _claim("mc_high_country", "mountain_crossing", "High-elevation habitat supports species and forest communities uncommon in the surrounding lowlands.", ["nps_grsm_nature", "nps_grsm_vegetation"]),
    _claim("mc_kuwohi_name", "mountain_crossing", "The U.S. Board on Geographic Names restored the name Kuwohi in 2024 after an EBCI-led request.", ["nps_grsm_kuwohi_restoration"]),
    _claim("mc_kuwohi_living_meaning", "mountain_crossing", "Any interpretation of Kuwohi's living cultural meaning, Cherokee language, or pronunciation requires EBCI participation and approval.", ["ebci_cultural_irb", "ebci_cultural_resources"], cultural=True),
    _claim("mc_oconaluftee_valley", "mountain_crossing", "The Oconaluftee corridor presents river-valley ecology and preserved mountain-farm interpretation near the park's southern entrance.", ["nps_grsm_oconaluftee"]),
    _claim("mc_mountain_farm", "mountain_crossing", "Historic structures relocated and assembled at the Mountain Farm Museum interpret agricultural life in the region.", ["nps_grsm_mountain_farm", "nps_grsm_oconaluftee"]),
    _claim("mc_elk_restoration", "mountain_crossing", "Elk were reintroduced to the park and are now visible in some North Carolina valleys, subject to wildlife-viewing distance rules.", ["nps_grsm_elk", "nps_grsm_animals"]),
    _claim("mc_bear_country", "mountain_crossing", "Black bears inhabit all elevations of the park and require distance and food-storage discipline.", ["nps_grsm_black_bears"]),
    _claim("cc_little_river", "little_river_cades_cove", "Little River and its tributaries visibly connect rainfall, steep relief, and downstream valleys.", ["nps_grsm_natural_features"]),
    _claim("cc_logging_corridor", "little_river_cades_cove", "Logging communities and rail corridors changed the Little River landscape before park creation.", ["nps_grsm_people", "nps_grsm_timeline"]),
    _claim("cc_cove_geology", "little_river_cades_cove", "Cades Cove's broad valley reflects a different geologic setting from the surrounding ridges.", ["nps_grsm_geology"]),
    _claim("cc_cherokee_context", "little_river_cades_cove", "Any account of Cherokee presence, place names, or cultural relationships in Cades Cove requires EBCI review rather than generalized retelling.", ["ebci_cultural_irb", "ebci_cultural_resources"], cultural=True),
    _claim("cc_settlement", "little_river_cades_cove", "European-American settlement began in the early nineteenth century and developed into a farming community.", ["nps_grsm_cades_history"]),
    _claim("cc_farming", "little_river_cades_cove", "Cove farms combined crops, livestock, outbuildings, and shared seasonal labor.", ["nps_grsm_cades_history"]),
    _claim("cc_churches", "little_river_cades_cove", "Churches served religious, civic, and social roles in the valley community.", ["nps_grsm_cades_history", "nps_grsm_cades_cove"]),
    _claim("cc_population", "little_river_cades_cove", "The valley's population and public institutions grew through the nineteenth century.", ["nps_grsm_cades_history", "nps_grsm_timeline"]),
    _claim("cc_park_acquisition", "little_river_cades_cove", "Park land acquisition dispersed the community through sales, court challenges, and life leases.", ["nps_grsm_cades_history", "nps_grsm_people"]),
    _claim("cc_john_oliver", "little_river_cades_cove", "The John Oliver homesite helps locate one family's experience within early cove settlement and later park acquisition.", ["nps_grsm_cades_history", "nps_grsm_cades_cove"]),
    _claim("cc_cable_mill", "little_river_cades_cove", "Cable Mill used water from Mill Creek to power its gristmill and grind corn for Cades Cove households.", ["nps_grsm_cable_mill"]),
    _claim("cc_general_store", "little_river_cades_cove", "General stores near mills functioned as commercial, credit, and social centers.", ["nps_grsm_general_stores"]),
    _claim("cc_wildlife", "little_river_cades_cove", "Open fields and forest edges make the cove a common wildlife-viewing area, but viewing must remain at a safe distance.", ["nps_grsm_cades_cove", "nps_grsm_black_bears"]),
    _claim("cc_loop_context", "little_river_cades_cove", "The Cades Cove road is an eleven-mile, one-way loop connecting historic sites, trailheads, and wildlife-viewing areas.", ["nps_grsm_cades_cove"]),
    _claim("cc_waterfall_landscape", "little_river_cades_cove", "Abrams Falls and other park waterfalls form where moving water meets resistant rock and steep elevation change.", ["nps_grsm_geology", "nps_grsm_natural_features"]),
    _claim("rf_route_character", "roaring_fork", "Roaring Fork Motor Nature Trail is a narrow, winding, seasonal one-way road through a stream valley.", ["nps_grsm_roaring_fork"]),
    _claim("rf_stream", "roaring_fork", "The fast-flowing Roaring Fork gives the road and district their name.", ["nps_grsm_roaring_fork", "nps_grsm_natural_features"]),
    _claim("rf_ogle_farm", "roaring_fork", "The Noah Ogle farmstead interprets a mountain household at the edge of the motor trail.", ["nps_grsm_roaring_fork"]),
    _claim("rf_old_growth", "roaring_fork", "The route passes mature and old-growth forest shaped by elevation, moisture, and past land use.", ["nps_grsm_roaring_fork", "nps_grsm_nature"]),
    _claim("rf_farm_community", "roaring_fork", "Preserved cabins, mills, and farm sites record community life before the national park.", ["nps_grsm_roaring_fork", "nps_grsm_history_culture"]),
    _claim("rf_waterfalls", "roaring_fork", "Waterfalls and cascades reflect steep terrain, resistant rock, and abundant rainfall.", ["nps_grsm_roaring_fork", "nps_grsm_geology"]),
    _claim("rf_preservation", "roaring_fork", "The surviving road, structures, and forest let visitors read both natural change and human land use in one compact corridor.", ["nps_grsm_roaring_fork", "nps_grsm_people"]),
    _claim("fp_scenic_corridor", "foothills_parkway", "Foothills Parkway was authorized as a scenic corridor along the Tennessee side of the Smokies.", ["nps_grsm_foothills"]),
    _claim("fp_long_build", "foothills_parkway", "Construction unfolded in separated segments over decades and the full authorized corridor remains incomplete.", ["nps_grsm_foothills", "nps_grsm_foothills_history"]),
    _claim("fp_missing_link", "foothills_parkway", "The Missing Link used multiple bridges, including an 800-foot curved bridge carried on tall piers, to cross steep terrain.", ["nps_grsm_missing_link_bridge"]),
    _claim("fp_geologic_view", "foothills_parkway", "Parkway overlooks reveal the layered ridges produced by ancient mountain building and long erosion.", ["nps_grsm_geology"]),
    _claim("fp_forest_mosaic", "foothills_parkway", "The long view spans a mosaic of forest communities structured by elevation and aspect.", ["nps_grsm_vegetation", "nps_grsm_statistics"]),
    _claim("fp_air_monitoring", "foothills_parkway", "Look Rock is an air-quality monitoring and viewing location where haze and visibility can be discussed with measured context.", ["nps_grsm_air_quality"]),
]


def _entry(entry_id: str, chapter: str, sequence: int, kind: str, title: str, context: str, scene: str, purpose: str, claim_ids: list[str], *, directional: bool = False, cultural: bool = False, words: int | None = None) -> dict:
    return {
        "id": entry_id,
        "chapter_id": chapter,
        "sequence": sequence,
        "kind": kind,
        "title": title,
        "route_context": context,
        "visible_scene": scene,
        "purpose": purpose,
        "claim_ids": claim_ids,
        "target_words": words if words is not None else (450 if kind == "story" else 80),
        "directional_adaptation": directional,
        "script_status": "blocked_cultural_review" if cultural else "outline_only",
    }


ENTRIES = [
    # Mountain Crossing — 18 full stories.
    _entry("mc_story_01", "mountain_crossing", 1, "story", "Sugarlands and the watershed", "sugarlands", "The road leaves Sugarlands beside forest and moving water.", "Open with the watershed and orient the passenger to a cross-mountain journey.", ["mc_gateway_watershed"], directional=True),
    _entry("mc_story_02", "mountain_crossing", 2, "story", "Mountains made from an ancient basin", "sugarlands", "Layered rock appears in cuts beside the climbing road.", "Connect visible rock to the park's deep geologic history.", ["mc_deep_geology"], directional=True),
    _entry("mc_story_03", "mountain_crossing", 3, "story", "Rain becomes a river", "newfound_gap_return", "Creeks gather below steep, wet slopes.", "Explain how elevation and rainfall feed the park's waterways.", ["mc_rain_and_streams"], directional=True),
    _entry("mc_story_04", "mountain_crossing", 4, "story", "Forests stacked by elevation", "newfound_gap_return", "Tree communities change as the road climbs.", "Let passengers notice the forest transition rather than listing species without context.", ["mc_forest_zones"], directional=True),
    _entry("mc_story_05", "mountain_crossing", 5, "story", "A compressed continent of life", "newfound_gap_return", "Moist coves and high ridges pass within one drive.", "Explain why short horizontal distance contains exceptional biological variety.", ["mc_biodiversity"], directional=True),
    _entry("mc_story_06", "mountain_crossing", 6, "story", "Designing Newfound Gap Road", "newfound_gap_return", "Curves, retaining walls, and framed vistas follow the terrain.", "Tell the road's 1930s redesign as engineering shaped around a scenic landscape.", ["mc_road_engineering"], directional=True),
    _entry("mc_story_07", "mountain_crossing", 7, "story", "Stonework of the CCC", "newfound_gap_return", "Historic masonry and guardwalls sit at the road edge.", "Connect surviving construction details to the people and program that built them.", ["mc_ccc_legacy"], directional=True),
    _entry("mc_story_08", "mountain_crossing", 8, "story", "A park built in a segregated era", "newfound_gap_outbound", "Historic visitor facilities occupy the gap.", "Acknowledge how segregation shaped the early public landscape without treating it as an aside.", ["mc_segregated_landscape"], directional=True, words=500),
    _entry("mc_story_09", "mountain_crossing", 9, "story", "Protection and displacement", "newfound_gap_outbound", "Recovered forest now covers former homes and holdings.", "Hold conservation success and the cost paid by former residents in the same story.", ["mc_park_creation"], directional=True, words=500),
    _entry("mc_story_10", "mountain_crossing", 10, "story", "Forest after the logging boom", "newfound_gap_outbound", "Second-growth forest fills much of the visible slope.", "Show how industrial logging changed the mountains and how forest recovery followed.", ["mc_logging_recovery"], directional=True),
    _entry("mc_story_11", "mountain_crossing", 11, "story", "The blue view and the white veil", "newfound_gap_outbound", "Layered ridges fade into blue or pale haze.", "Separate the mountains' visual character from harmful air pollution.", ["mc_haze_and_pollution"], directional=True),
    _entry("mc_story_12", "mountain_crossing", 12, "story", "The pass between two watersheds", "newfound_gap_outbound", "The road crests at Newfound Gap.", "Explain the gap as geography, route, and turning point in the drive.", ["mc_gap_context"], directional=True),
    _entry("mc_story_13", "mountain_crossing", 13, "story", "Life in the high country", "kuwohi", "Cool, wind-shaped forest surrounds the Kuwohi road.", "Connect high-elevation habitat to species and communities found far south of their broader range.", ["mc_high_country"], directional=True),
    _entry("mc_story_14", "mountain_crossing", 14, "story", "Restoring the name Kuwohi", "kuwohi", "The signed summit road and high peak dominate the view.", "Cover the official 2024 name restoration as a factual civic event.", ["mc_kuwohi_name"], directional=True),
    _entry("mc_story_15", "mountain_crossing", 15, "story", "Cultural interpretation reserved", "kuwohi", "No cultural scene description has been drafted before EBCI review.", "Reserve this entry for the scope and voice approved through compensated EBCI participation.", ["mc_kuwohi_living_meaning"], directional=True, cultural=True, words=500),
    _entry("mc_story_16", "mountain_crossing", 16, "story", "The Oconaluftee valley", "oconaluftee", "The road follows forest and river into a broader valley.", "Shift from high-country ecology to the Oconaluftee river-valley landscape.", ["mc_oconaluftee_valley"], directional=True),
    _entry("mc_story_17", "mountain_crossing", 17, "story", "A farm museum made from many places", "oconaluftee", "Historic farm structures stand near the visitor center.", "Explain what the assembled buildings can—and cannot—show about regional farm life.", ["mc_mountain_farm"], directional=True),
    _entry("mc_story_18", "mountain_crossing", 18, "story", "Elk return to the valley", "oconaluftee", "Open fields near Oconaluftee may hold grazing elk.", "Tell the restoration story while keeping wildlife-viewing guidance factual and concise.", ["mc_elk_restoration", "mc_bear_country"], directional=True),
    # Mountain Crossing — 10 short cues.
    _entry("mc_cue_01", "mountain_crossing", 1, "cue", "Crossing orientation", "sugarlands", "The route leaves one park entrance for the other side of the mountains.", "State the route shape, expected high point, and that conditions can differ by elevation.", ["mc_gap_context"], directional=True),
    _entry("mc_cue_02", "mountain_crossing", 2, "cue", "Watch the water", "sugarlands", "A creek runs close to the road.", "Prompt a visible observation before the longer watershed story.", ["mc_gateway_watershed"], directional=True),
    _entry("mc_cue_03", "mountain_crossing", 3, "cue", "Rock at the roadside", "newfound_gap_return", "A cut exposes folded or layered rock.", "Direct attention to the roadcut without overstating a formation identification.", ["mc_deep_geology"], directional=True),
    _entry("mc_cue_04", "mountain_crossing", 4, "cue", "Forest turning point", "newfound_gap_return", "Leaf and canopy character change with the climb.", "Mark a visible forest transition.", ["mc_forest_zones"], directional=True),
    _entry("mc_cue_05", "mountain_crossing", 5, "cue", "Newfound Gap ahead", "newfound_gap_outbound", "The crest and memorial area approach.", "Prepare the driver for the high pass and optional stop.", ["mc_gap_context"], directional=True),
    _entry("mc_cue_06", "mountain_crossing", 6, "cue", "Kuwohi turn", "kuwohi", "The summit road branches from the crossing.", "Identify the optional summit spur without making an operational-open claim.", ["mc_high_country"], directional=True),
    _entry("mc_cue_07", "mountain_crossing", 7, "cue", "Name with care", "kuwohi", "Kuwohi signage appears along the summit approach.", "Hold pronunciation and cultural explanation for EBCI-approved wording.", ["mc_kuwohi_living_meaning"], directional=True, cultural=True),
    _entry("mc_cue_08", "mountain_crossing", 8, "cue", "Descending forest", "newfound_gap_outbound", "High forest gives way to lower-elevation communities.", "Help passengers notice the ecological descent.", ["mc_forest_zones"], directional=True),
    _entry("mc_cue_09", "mountain_crossing", 9, "cue", "Oconaluftee approach", "oconaluftee", "The valley widens near the visitor center.", "Introduce the river valley and optional stop.", ["mc_oconaluftee_valley"], directional=True),
    _entry("mc_cue_10", "mountain_crossing", 10, "cue", "Wildlife distance", "oconaluftee", "Open fields may draw drivers' attention away from the road.", "Give one brief wildlife-distance reminder tied to the visible setting.", ["mc_elk_restoration", "mc_bear_country"], directional=True),

    # Cades Cove — 14 full stories.
    _entry("cc_story_01", "little_river_cades_cove", 1, "story", "Following Little River", "sugarlands", "The road and river travel together through a steep valley.", "Introduce water as the chapter's physical thread.", ["cc_little_river"]),
    _entry("cc_story_02", "little_river_cades_cove", 2, "story", "Rails, timber, and a changed valley", "sugarlands", "Recovered forest borders the old Little River corridor.", "Connect the drive to the region's logging economy and later recovery.", ["cc_logging_corridor"]),
    _entry("cc_story_03", "little_river_cades_cove", 3, "story", "Why the cove opens wide", "townsend_wye", "A broad valley replaces the confined river gorge.", "Explain the geologic contrast that made farming land possible here.", ["cc_cove_geology"]),
    _entry("cc_story_04", "little_river_cades_cove", 4, "story", "Before the farms", "cades_cove_entrance", "The loop enters a valley with a longer history than its preserved cabins.", "Reserve Cherokee history and place relationships for compensated EBCI participation.", ["cc_cherokee_context"], cultural=True, words=500),
    _entry("cc_story_05", "little_river_cades_cove", 5, "story", "Building a valley community", "john_oliver_place", "A log home and cleared field sit against wooded ridges.", "Place early settlement within work, family, and landscape rather than a pioneer myth.", ["cc_settlement"]),
    _entry("cc_story_06", "little_river_cades_cove", 6, "story", "The work behind a farm", "john_oliver_place", "House, fields, fences, and outbuildings form one working system.", "Describe mixed farm labor and seasonal cooperation.", ["cc_farming"]),
    _entry("cc_story_07", "little_river_cades_cove", 8, "story", "Churches and a divided community", "methodist_church", "A white church and cemetery sit beside the loop.", "Explain churches as social institutions and leave room for documented disagreement rather than nostalgia.", ["cc_churches"]),
    _entry("cc_story_08", "little_river_cades_cove", 9, "story", "A valley full of families", "missionary_baptist_church", "Homesites and public buildings appear across the open cove.", "Use population and institution growth to show a connected community.", ["cc_population"]),
    _entry("cc_story_09", "little_river_cades_cove", 10, "story", "When the park arrived", "missionary_baptist_church", "Preserved structures stand in a landscape emptied of its former community.", "Explain sales, resistance, life leases, and dispersal without presenting removal as frictionless.", ["cc_park_acquisition"], words=500),
    _entry("cc_story_10", "little_river_cades_cove", 7, "story", "John Oliver's long argument", "john_oliver_place", "The Oliver cabin remains one of the loop's earliest homesites.", "Use the site to make park acquisition personal and specific.", ["cc_john_oliver"]),
    _entry("cc_story_11", "little_river_cades_cove", 12, "story", "Water power at Cable Mill", "cable_mill", "A millrace and gristmill occupy the valley floor.", "Show how water power connected grain, households, and local exchange.", ["cc_cable_mill"]),
    _entry("cc_story_12", "little_river_cades_cove", 13, "story", "The store beside the mill", "cable_mill", "The Becky Cable house stands near the mill complex.", "Describe general stores as commercial and social infrastructure.", ["cc_general_store"]),
    _entry("cc_story_13", "little_river_cades_cove", 11, "story", "A waterfall shaped by rock", "abrams_falls_trailhead", "The trailhead points toward a powerful waterfall beyond the road.", "Relate waterfall form to rock resistance and moving water without turning the drive into a hike claim.", ["cc_waterfall_landscape"]),
    _entry("cc_story_14", "little_river_cades_cove", 14, "story", "Wildlife in a worked landscape", "tipton_place", "Fields meet forest along the back half of the loop.", "Explain why animals are visible here and why a sighting is never promised.", ["cc_wildlife"]),
    # Cades Cove — 9 cues.
    _entry("cc_cue_01", "little_river_cades_cove", 1, "cue", "River road", "sugarlands", "Little River runs beside the road.", "Ask passengers to notice how tightly road and river share the gorge.", ["cc_little_river"]),
    _entry("cc_cue_02", "little_river_cades_cove", 2, "cue", "Townsend Wye", "townsend_wye", "Roads and water meet at the Wye.", "Mark the transition from Little River corridor toward Cades Cove.", ["cc_little_river"]),
    _entry("cc_cue_03", "little_river_cades_cove", 3, "cue", "One-way loop", "cades_cove_entrance", "The loop narrows into a one-way scenic road.", "State the real loop shape and invite a slower pace without operational timing claims.", ["cc_loop_context"]),
    _entry("cc_cue_04", "little_river_cades_cove", 4, "cue", "The first homesite", "john_oliver_place", "A cabin sits back from the road.", "Point out the homesite before the related story.", ["cc_john_oliver"]),
    _entry("cc_cue_05", "little_river_cades_cove", 5, "cue", "Church row", "methodist_church", "Churches and cemeteries appear near the loop.", "Orient the passenger among distinct community sites.", ["cc_churches"]),
    _entry("cc_cue_06", "little_river_cades_cove", 6, "cue", "Abrams Falls trailhead", "abrams_falls_trailhead", "The signed trailhead appears beside the loop.", "Name the stop without implying an easy or immediate waterfall view.", ["cc_waterfall_landscape"]),
    _entry("cc_cue_07", "little_river_cades_cove", 7, "cue", "Cable Mill stop", "cable_mill", "The visitor center and mill complex approach.", "Identify the most substantial services and historic stop on the loop.", ["cc_cable_mill", "cc_general_store"]),
    _entry("cc_cue_08", "little_river_cades_cove", 8, "cue", "Fields and forest", "tipton_place", "Open grass meets wooded slopes.", "Prepare the wildlife story without promising animals.", ["cc_wildlife"]),
    _entry("cc_cue_09", "little_river_cades_cove", 9, "cue", "Completing the loop", "cades_cove_exit", "The road returns to the valley entrance.", "Close the circular geography and point back to the community story.", ["cc_loop_context", "cc_park_acquisition"]),

    # Roaring Fork — 7 stories and 6 cues.
    _entry("rf_story_01", "roaring_fork", 1, "story", "A road that asks you to slow down", "roaring_fork_entrance", "A narrow one-way road enters dense forest.", "Introduce the route's physical character without generic safety filler.", ["rf_route_character"]),
    _entry("rf_story_02", "roaring_fork", 3, "story", "The stream behind the name", "roaring_fork_upper", "Fast water runs close to the road.", "Make the route name legible in the visible landscape.", ["rf_stream"]),
    _entry("rf_story_03", "roaring_fork", 2, "story", "The Ogle farm at the edge of town", "roaring_fork_entrance", "A preserved farmstead sits before the loop.", "Introduce a household and working landscape at the corridor entrance.", ["rf_ogle_farm"]),
    _entry("rf_story_04", "roaring_fork", 4, "story", "Old trees and a wet forest", "roaring_fork_upper", "Large trunks and layered canopy crowd the road.", "Connect moisture, land-use history, and surviving mature forest.", ["rf_old_growth"]),
    _entry("rf_story_05", "roaring_fork", 5, "story", "Homes, mills, and neighbors", "roaring_fork_mid", "Cabins and mill sites appear between forested slopes.", "Describe the corridor as a lived community, not a scattered collection of props.", ["rf_farm_community"]),
    _entry("rf_story_06", "roaring_fork", 6, "story", "Water falling through resistant rock", "thousand_drips", "Cascades descend beside the road.", "Use visible water to connect rainfall, gradient, and geology.", ["rf_waterfalls"]),
    _entry("rf_story_07", "roaring_fork", 7, "story", "Reading two landscapes at once", "roaring_fork_exit", "The route leaves forest, water, and preserved structures behind.", "Close with the way natural recovery and human history overlap.", ["rf_preservation"]),
    _entry("rf_cue_01", "roaring_fork", 1, "cue", "One way from here", "roaring_fork_entrance", "The motor trail begins as a narrow one-way road.", "State the route form before entry.", ["rf_route_character"]),
    _entry("rf_cue_02", "roaring_fork", 2, "cue", "Ogle farmstead", "roaring_fork_entrance", "The preserved farmstead is near the road.", "Identify the optional stop.", ["rf_ogle_farm"]),
    _entry("rf_cue_03", "roaring_fork", 4, "cue", "Water beside the road", "roaring_fork_upper", "The stream draws close.", "Prompt passengers to listen and look for the stream.", ["rf_stream"]),
    _entry("rf_cue_04", "roaring_fork", 3, "cue", "Grotto Falls trail access", "grotto_falls_parking", "A signed trail parking area appears.", "Name the access point without implying parking or trail conditions.", ["rf_waterfalls"]),
    _entry("rf_cue_05", "roaring_fork", 5, "cue", "Thousand Drips", "thousand_drips", "Thin cascades break across roadside rock.", "Mark the visible cascade before the full water story.", ["rf_waterfalls"]),
    _entry("rf_cue_06", "roaring_fork", 6, "cue", "Leaving the motor trail", "roaring_fork_exit", "The one-way corridor returns toward Gatlinburg.", "Close the route and release the chapter cleanly.", ["rf_route_character"]),

    # Foothills Parkway — 6 stories and 7 cues.
    _entry("fp_story_01", "foothills_parkway", 1, "story", "A parkway made for the view", "chilhowee_terminus", "The road runs along lower ridges facing the Smokies.", "Explain the scenic-corridor purpose and its relationship to the national park.", ["fp_scenic_corridor"], directional=True),
    _entry("fp_story_02", "foothills_parkway", 2, "story", "The unfinished road", "walland_east_connection", "Completed pavement ends while the authorized corridor continues on maps.", "Tell the multi-decade construction story without framing incompletion as failure alone.", ["fp_long_build"], directional=True),
    _entry("fp_story_03", "foothills_parkway", 3, "story", "Bridging the Missing Link", "foothills_missing_link", "Elevated bridges cross steep, broken terrain.", "Make engineering visible in the road's most difficult section.", ["fp_missing_link"], directional=True),
    _entry("fp_story_04", "foothills_parkway", 4, "story", "Reading the ridgelines", "look_rock", "Successive mountain ridges stack across the horizon.", "Connect the panorama to mountain building and erosion.", ["fp_geologic_view"], directional=True),
    _entry("fp_story_05", "foothills_parkway", 5, "story", "A forest mosaic from above", "look_rock", "Different slopes and elevations carry subtly different forests.", "Show how elevation and aspect organize the broad view.", ["fp_forest_mosaic"], directional=True),
    _entry("fp_story_06", "foothills_parkway", 6, "story", "What the view says about the air", "look_rock", "Visibility changes across the same mountain panorama.", "Use monitoring context to distinguish weather, natural haze, and pollution without guessing from one view.", ["fp_air_monitoring"], directional=True),
    _entry("fp_cue_01", "foothills_parkway", 1, "cue", "Parkway orientation", "chilhowee_terminus", "A ridge road opens toward the national park.", "State the chapter direction and scenic purpose.", ["fp_scenic_corridor"], directional=True),
    _entry("fp_cue_02", "foothills_parkway", 2, "cue", "A long view", "chilhowee_terminus", "The trees open to distant ridges.", "Invite the passenger to notice depth in the ridge sequence.", ["fp_geologic_view"], directional=True),
    _entry("fp_cue_03", "foothills_parkway", 3, "cue", "Look Rock", "look_rock", "The observation area and tower access appear.", "Identify the primary viewpoint without asserting visibility.", ["fp_air_monitoring"], directional=True),
    _entry("fp_cue_04", "foothills_parkway", 4, "cue", "Forest from the ridge", "look_rock", "The road crosses a change in slope and exposure.", "Point out the forest mosaic before the longer ecology story.", ["fp_forest_mosaic"], directional=True),
    _entry("fp_cue_05", "foothills_parkway", 5, "cue", "Walland connection", "walland_east_connection", "The parkway meets a major gap in its historic construction sequence.", "Orient the passenger to the segmented parkway history.", ["fp_long_build"], directional=True),
    _entry("fp_cue_06", "foothills_parkway", 6, "cue", "Across the Missing Link", "foothills_missing_link", "Bridges carry the road across steep terrain.", "Call attention to the engineering before the full story.", ["fp_missing_link"], directional=True),
    _entry("fp_cue_07", "foothills_parkway", 7, "cue", "Wears Valley end", "wears_valley_terminus", "The scenic section descends toward the valley road network.", "Close the chapter and return the listener to ordinary navigation context.", ["fp_scenic_corridor"], directional=True),
]


MEDIA_CANDIDATES = [
    {
        "id": "media_mc_kuwohi",
        "chapter_id": "mountain_crossing",
        "subject": "Exact Kuwohi or Newfound Gap landscape",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/kuwohi-nfg.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "chapter_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_mc_oconaluftee",
        "chapter_id": "mountain_crossing",
        "subject": "Exact Oconaluftee valley or Mountain Farm Museum scene",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/oconaluftee.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "story_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_cc_cove",
        "chapter_id": "little_river_cades_cove",
        "subject": "Exact Cades Cove landscape or historic structure",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/cadescove.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "chapter_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_cc_cable_mill",
        "chapter_id": "little_river_cades_cove",
        "subject": "Exact Cable Mill or Becky Cable house scene",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/cadescove.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "story_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_rf_stream",
        "chapter_id": "roaring_fork",
        "subject": "Exact Roaring Fork stream and motor-trail scene",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/roaringfork.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "chapter_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_rf_ogle",
        "chapter_id": "roaring_fork",
        "subject": "Exact Noah Ogle farmstead scene",
        "source_page_url": "https://www.nps.gov/grsm/planyourvisit/roaringfork.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "story_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_fp_panorama",
        "chapter_id": "foothills_parkway",
        "subject": "Exact Foothills Parkway ridge panorama",
        "source_page_url": "https://www.nps.gov/places/foothills-parkway.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "chapter_artwork",
        "status": "candidate_requires_clearance",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
    {
        "id": "media_fp_engineering",
        "chapter_id": "foothills_parkway",
        "subject": "Exact Missing Link bridge or construction scene",
        "source_page_url": "https://www.nps.gov/grsm/learn/news/foothills-parkway-opening.htm",
        "rights_policy_url": "https://www.nps.gov/aboutus/disclaimer.htm",
        "intended_use": "story_artwork",
        "status": "exact_asset_not_selected",
        "rights_requirements": ["asset_url", "dimensions", "exact_credit", "identity_match", "license_record", "rights_basis", "sha256"],
    },
]


def build_dossier() -> dict:
    blocked = sorted(entry["id"] for entry in ENTRIES if entry["script_status"] == "blocked_cultural_review")
    return {
        "schema_version": 1,
        "product_id": PRODUCT_ID,
        "title": "Great Smoky Mountains: Ridges, Rivers & Living Memory",
        "locale": "en-US",
        "reviewed_at": REVIEWED_AT,
        "source_review_max_age_days": 180,
        "target_counts": {
            "mountain_crossing": {"story": 18, "cue": 10},
            "little_river_cades_cove": {"story": 14, "cue": 9},
            "roaring_fork": {"story": 7, "cue": 6},
            "foothills_parkway": {"story": 6, "cue": 7},
        },
        "cultural_review": {
            "status": "required_before_drafting",
            "authority": "Eastern Band of Cherokee Indians Cultural Institutional Review Board",
            "official_review_url": "https://www.ebci.gov/cultural-institutional-review-board/",
            "contact_path": "EBCI Cultural IRB and Tribal Cultural Resources Department; request scope determination before recruiting a compensated reviewer or storyteller.",
            "compensation_required": True,
            "blocked_entry_ids": blocked,
            "prohibited_until_approved": ["cultural_interpretation", "pronunciation_guide", "script_drafting", "tts_rendering"],
        },
        "sources": copy.deepcopy(SOURCES),
        "claims": copy.deepcopy(CLAIMS),
        "entries": copy.deepcopy(ENTRIES),
        "media_candidates": copy.deepcopy(MEDIA_CANDIDATES),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "originals/smokies/source_dossiers_v1.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    validation_date = date.today() if args.check else date.fromisoformat(REVIEWED_AT)
    normalized, _ = normalize_original_source_dossier(build_dossier(), as_of=validation_date)
    rendered = json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != rendered:
            raise SystemExit(f"{args.output} is missing or not deterministic")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
