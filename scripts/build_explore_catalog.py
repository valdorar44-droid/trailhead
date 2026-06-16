#!/usr/bin/env python3
"""Build the seeded Explore catalog from Wikipedia page summaries.

The output is plain JSON so the API can serve it immediately and mobile can
cache it as a future downloadable place-pack shape.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path
import httpx


DEFAULT_TITLES = [
    ("Grand Canyon National Park", "Park", "AZ", ["parks", "scenic", "history"]),
    ("Yellowstone National Park", "Park", "WY", ["parks", "scenic", "geology"]),
    ("Yosemite National Park", "Park", "CA", ["parks", "scenic"]),
    ("Arches National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Zion National Park", "Park", "UT", ["parks", "scenic"]),
    ("Bryce Canyon National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Monument Valley", "Scenic Landmark", "AZ", ["scenic", "culture"]),
    ("Canyonlands National Park", "Park", "UT", ["parks", "scenic"]),
    ("Mesa Verde National Park", "Historic Site", "CO", ["history", "culture", "parks"]),
    ("Bears Ears National Monument", "National Monument", "UT", ["monuments", "culture", "scenic"]),
    ("Organ Pipe Cactus National Monument", "National Monument", "AZ", ["monuments", "desert", "scenic"]),
    ("Chaco Culture National Historical Park", "Historic Site", "NM", ["history", "culture"]),
    ("White Sands National Park", "Park", "NM", ["parks", "scenic", "geology"]),
    ("Great Sand Dunes National Park and Preserve", "Park", "CO", ["parks", "scenic"]),
    ("Badlands National Park", "Park", "SD", ["parks", "scenic", "geology"]),
    ("Devils Tower", "National Monument", "WY", ["monuments", "geology", "culture"]),
    ("Mount Rushmore", "Historic Site", "SD", ["history", "monuments"]),
    ("Little Bighorn Battlefield National Monument", "Historic Site", "MT", ["history", "monuments"]),
    ("Glacier National Park (U.S.)", "Park", "MT", ["parks", "scenic"]),
    ("Olympic National Park", "Park", "WA", ["parks", "scenic"]),
    ("Crater Lake National Park", "Park", "OR", ["parks", "scenic", "geology"]),
    ("Redwood National and State Parks", "Park", "CA", ["parks", "scenic"]),
    ("Death Valley National Park", "Park", "CA", ["parks", "desert", "scenic"]),
    ("Joshua Tree National Park", "Park", "CA", ["parks", "desert", "scenic"]),
    ("Sequoia National Park", "Park", "CA", ["parks", "scenic"]),
    ("Big Bend National Park", "Park", "TX", ["parks", "desert", "scenic"]),
    ("Carlsbad Caverns National Park", "Park", "NM", ["parks", "geology"]),
    ("Petrified Forest National Park", "Park", "AZ", ["parks", "geology", "history"]),
    ("Saguaro National Park", "Park", "AZ", ["parks", "desert"]),
    ("Craters of the Moon National Monument and Preserve", "National Monument", "ID", ["monuments", "geology"]),
    ("Dinosaur National Monument", "National Monument", "CO", ["monuments", "geology", "history"]),
    ("Colorado National Monument", "National Monument", "CO", ["monuments", "scenic"]),
    ("Black Canyon of the Gunnison National Park", "Park", "CO", ["parks", "scenic"]),
    ("Rocky Mountain National Park", "Park", "CO", ["parks", "scenic"]),
    ("Tallgrass Prairie National Preserve", "National Preserve", "KS", ["history", "scenic", "parks"]),
    ("Brown v. Board of Education National Historical Park", "Historic Site", "KS", ["history", "culture"]),
    ("Fort Larned National Historic Site", "Historic Site", "KS", ["history"]),
    ("Fort Scott National Historic Site", "Historic Site", "KS", ["history"]),
    ("Cahokia", "Historic Site", "IL", ["history", "culture"]),
    ("Gateway Arch", "National Park", "MO", ["history", "monuments"]),
    ("Hot Springs National Park", "Park", "AR", ["parks", "history"]),
    ("Mammoth Cave National Park", "Park", "KY", ["parks", "geology"]),
    ("Great Smoky Mountains National Park", "Park", "TN", ["parks", "scenic"]),
    ("Shenandoah National Park", "Park", "VA", ["parks", "scenic"]),
    ("Acadia National Park", "Park", "ME", ["parks", "scenic"]),
    ("Everglades National Park", "Park", "FL", ["parks", "wildlife"]),
    ("Dry Tortugas National Park", "Park", "FL", ["parks", "history"]),
    ("Cape Hatteras National Seashore", "National Seashore", "NC", ["scenic", "history"]),
    ("Gettysburg National Military Park", "Historic Site", "PA", ["history"]),
    ("Harpers Ferry National Historical Park", "Historic Site", "WV", ["history"]),
    ("Cuyahoga Valley National Park", "Park", "OH", ["parks", "scenic"]),
    ("Indiana Dunes National Park", "Park", "IN", ["parks", "scenic"]),
    ("Pictured Rocks National Lakeshore", "National Lakeshore", "MI", ["scenic", "parks"]),
    ("Apostle Islands National Lakeshore", "National Lakeshore", "WI", ["scenic", "parks"]),
    ("Voyageurs National Park", "Park", "MN", ["parks", "scenic"]),
    ("Theodore Roosevelt National Park", "Park", "ND", ["parks", "history", "scenic"]),
    ("Isle Royale National Park", "Park", "MI", ["parks", "wildlife"]),
    ("Denali National Park and Preserve", "Park", "AK", ["parks", "scenic"]),
    ("Haleakala National Park", "Park", "HI", ["parks", "scenic", "geology"]),
    ("Hawaii Volcanoes National Park", "Park", "HI", ["parks", "geology"]),
    ("Grand Teton National Park", "Park", "WY", ["parks", "scenic"]),
    ("Mount Rainier National Park", "Park", "WA", ["parks", "scenic"]),
    ("North Cascades National Park", "Park", "WA", ["parks", "scenic"]),
    ("Lassen Volcanic National Park", "Park", "CA", ["parks", "geology"]),
    ("Channel Islands National Park", "Park", "CA", ["parks", "wildlife"]),
    ("Pinnacles National Park", "Park", "CA", ["parks", "geology"]),
    ("Capitol Reef National Park", "Park", "UT", ["parks", "scenic", "geology"]),
    ("Guadalupe Mountains National Park", "Park", "TX", ["parks", "scenic"]),
    ("Wind Cave National Park", "Park", "SD", ["parks", "geology"]),
    ("Jewel Cave National Monument", "National Monument", "SD", ["monuments", "geology"]),
    ("Scotts Bluff National Monument", "National Monument", "NE", ["monuments", "history"]),
    ("Effigy Mounds National Monument", "National Monument", "IA", ["monuments", "history", "culture"]),
    ("Lincoln Home National Historic Site", "Historic Site", "IL", ["history"]),
    ("Vicksburg National Military Park", "Historic Site", "MS", ["history"]),
    ("Natchez Trace Parkway", "Scenic Landmark", "MS", ["history", "scenic"]),
    ("San Antonio Missions National Historical Park", "Historic Site", "TX", ["history", "culture"]),
    ("Padre Island National Seashore", "National Seashore", "TX", ["scenic", "wildlife"]),
    ("Chiricahua National Monument", "National Monument", "AZ", ["monuments", "geology"]),
    ("Bandelier National Monument", "National Monument", "NM", ["monuments", "history", "culture"]),
    ("Gila Cliff Dwellings National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Hovenweep National Monument", "National Monument", "UT", ["monuments", "history", "culture"]),
    ("Natural Bridges National Monument", "National Monument", "UT", ["monuments", "geology"]),
    ("Cedar Breaks National Monument", "National Monument", "UT", ["monuments", "scenic"]),
    ("Vermilion Cliffs National Monument", "National Monument", "AZ", ["monuments", "scenic", "geology"]),
    ("El Malpais National Monument", "National Monument", "NM", ["monuments", "geology"]),
    ("Kasha-Katuwe Tent Rocks National Monument", "National Monument", "NM", ["monuments", "geology"]),
    ("Tonto National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Montezuma Castle National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Wupatki National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Walnut Canyon National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Sunset Crater Volcano National Monument", "National Monument", "AZ", ["monuments", "geology"]),
    ("Tumacácori National Historical Park", "Historic Site", "AZ", ["history", "culture"]),
    ("Fort Union National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Pecos National Historical Park", "Historic Site", "NM", ["history", "culture"]),
    ("Aztec Ruins National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Salinas Pueblo Missions National Monument", "National Monument", "NM", ["monuments", "history"]),
    ("Fort Union Trading Post National Historic Site", "Historic Site", "ND", ["history"]),
    ("Pipe Spring National Monument", "National Monument", "AZ", ["monuments", "history"]),
    ("Golden Spike National Historical Park", "Historic Site", "UT", ["history"]),
    ("John Day Fossil Beds National Monument", "National Monument", "OR", ["monuments", "geology"]),
    ("Lava Beds National Monument", "National Monument", "CA", ["monuments", "geology", "history"]),
    ("Muir Woods National Monument", "National Monument", "CA", ["monuments", "scenic"]),
    ("Point Reyes National Seashore", "National Seashore", "CA", ["scenic", "wildlife"]),
    ("Cabrillo National Monument", "National Monument", "CA", ["monuments", "history"]),
    ("Manzanar", "Historic Site", "CA", ["history"]),
]

NPS_API = "https://developer.nps.gov/api/v1"
DEFAULT_SEED = Path("scripts/explore_seed_v2.json")
DEFAULT_ASSET_DIR = Path("dashboard/explore_assets")
GROUP_COPY = {
    "camping": {
        "category": "Camping",
        "tags": ["camping", "campgrounds", "outdoors"],
        "reason": "well-known camping access, public-land scenery, and nearby route options",
        "timing": "Check seasonal openings, reservation windows, fire restrictions, and road access before you commit to dates.",
        "access": "Use the official land-manager page for fees, rules, closures, pets, and current campground status.",
    },
    "glamping": {
        "category": "Glamping",
        "tags": ["glamping", "stays", "basecamp"],
        "reason": "comfortable outdoor stays near a major scenery or road-trip anchor",
        "timing": "Book early around weekends and peak seasons; confirm the exact address, check-in rules, and cancellation terms before driving out.",
        "access": "Open the external stay page for current pricing, availability, included amenities, and property rules.",
    },
    "huts_lodging": {
        "category": "Huts & Lodging",
        "tags": ["lodging", "huts", "cabins"],
        "reason": "classic park lodging, hut systems, or cabin-style stays that work as route anchors",
        "timing": "Plan far ahead for historic lodges, high huts, and remote stays; many book months in advance or close seasonally.",
        "access": "Confirm reservations, shuttle access, road status, and food or gear requirements with the official operator.",
    },
    "trails": {
        "category": "Trails",
        "tags": ["trails", "hiking", "trailheads"],
        "reason": "signature hikes, scenic trailheads, and strong route-day payoff",
        "timing": "Start early, carry current maps, and check permits, weather, heat, snow, and daylight before heading out.",
        "access": "Use the official land-manager page for trail closures, permits, parking, shuttle rules, and safety notices.",
    },
    "parks": {
        "category": "Parks",
        "tags": ["parks", "monuments", "historic sites", "landmarks"],
        "reason": "national parks, monuments, historic sites, and protected landscapes worth anchoring a route around",
        "timing": "Check seasonal access, road closures, permits, visitor capacity, and weather before building a route around the stop.",
        "access": "Use the official land-manager page for current access, fees, closures, cultural protocols, and safety notices.",
    },
    "monuments": {
        "category": "Monuments & History",
        "tags": ["monuments", "historic sites", "landmarks", "culture"],
        "reason": "historic sites, cultural landmarks, monuments, and protected stories worth planning a stop around",
        "timing": "Check hours, timed-entry rules, seasonal closures, tour availability, cultural protocols, and weather before routing there.",
        "access": "Use the official site for current hours, tickets, closures, road access, and visitor rules.",
    },
    "water_scenic": {
        "category": "Water & Scenic",
        "tags": ["water", "scenic", "lakes", "coast", "viewpoints"],
        "reason": "scenic water access, coastlines, overlooks, and route-worthy landscape stops",
        "timing": "Check road access, water levels, wind, surf, ferry schedules, parking rules, and seasonal closures before committing.",
        "access": "Use the official land-manager or park page for current access, fees, closures, permits, and safety notices.",
    },
}
BASE_FALLBACKS = {
    "Adirondack Park": {
        "lat": 43.9706, "lng": -74.0059,
        "source_url": "https://en.wikipedia.org/wiki/Adirondack_Park",
    },
    "Bear Lake (Idaho-Utah)": {
        "lat": 41.95, "lng": -111.34,
        "source_url": "https://en.wikipedia.org/wiki/Bear_Lake_(Idaho%E2%80%93Utah)",
    },
    "Bear Lake (Idaho\u2013Utah)": {
        "lat": 41.95, "lng": -111.34,
        "source_url": "https://en.wikipedia.org/wiki/Bear_Lake_(Idaho%E2%80%93Utah)",
    },
    "Acadia National Park": {
        "lat": 44.35, "lng": -68.21,
        "source_url": "https://www.nps.gov/acad/index.htm",
    },
    "Arches National Park": {
        "lat": 38.7331, "lng": -109.5925,
        "source_url": "https://www.nps.gov/arch/index.htm",
    },
    "Big Bend National Park": {
        "lat": 29.1275, "lng": -103.2425,
        "source_url": "https://www.nps.gov/bibe/index.htm",
    },
    "Bryce Canyon National Park": {
        "lat": 37.593, "lng": -112.1871,
        "source_url": "https://www.nps.gov/brca/index.htm",
    },
    "Black Canyon of the Gunnison National Park": {
        "lat": 38.5754, "lng": -107.7416,
        "source_url": "https://www.nps.gov/blca/index.htm",
    },
    "Canyonlands National Park": {
        "lat": 38.3269, "lng": -109.8783,
        "source_url": "https://www.nps.gov/cany/index.htm",
    },
    "Capitol Reef National Park": {
        "lat": 38.367, "lng": -111.2615,
        "source_url": "https://www.nps.gov/care/index.htm",
    },
    "Denali National Park and Preserve": {
        "lat": 63.1148, "lng": -151.1926,
        "source_url": "https://www.nps.gov/dena/index.htm",
    },
    "Badlands National Park": {
        "lat": 43.75, "lng": -102.5,
        "source_url": "https://www.nps.gov/badl/index.htm",
    },
    "Crater Lake National Park": {
        "lat": 42.9118, "lng": -122.1481,
        "source_url": "https://www.nps.gov/crla/index.htm",
    },
    "Everglades National Park": {
        "lat": 25.3125, "lng": -80.6875,
        "source_url": "https://www.nps.gov/ever/index.htm",
    },
    "Glacier National Park (U.S.)": {
        "lat": 48.755, "lng": -113.8,
        "source_url": "https://www.nps.gov/glac/index.htm",
    },
    "Great Sand Dunes National Park and Preserve": {
        "lat": 37.7916, "lng": -105.5943,
        "source_url": "https://www.nps.gov/grsa/index.htm",
    },
    "Great Smoky Mountains National Park": {
        "lat": 35.6118, "lng": -83.4895,
        "source_url": "https://www.nps.gov/grsm/index.htm",
    },
    "Hawaii Volcanoes National Park": {
        "lat": 19.4194, "lng": -155.2885,
        "source_url": "https://www.nps.gov/havo/index.htm",
        "image_url": "https://upload.wikimedia.org/wikipedia/commons/8/89/P%C4%81hoehoe_and_Aa_flows_at_Hawaii.jpg",
        "image_credit": "Wikimedia Commons",
    },
    "Great Basin National Park": {
        "lat": 38.9833, "lng": -114.3,
        "source_url": "https://www.nps.gov/grba/index.htm",
    },
    "Grand Canyon National Park": {
        "lat": 36.1069, "lng": -112.1129,
        "source_url": "https://www.nps.gov/grca/index.htm",
    },
    "Grand Staircase\u2013Escalante National Monument": {
        "lat": 37.4, "lng": -111.68,
        "source_url": "https://www.blm.gov/programs/national-conservation-lands/utah/grand-staircase-escalante-national-monument",
    },
    "Grand Teton National Park": {
        "lat": 43.7904, "lng": -110.6818,
        "source_url": "https://www.nps.gov/grte/index.htm",
    },
    "Joshua Tree National Park": {
        "lat": 34.1, "lng": -116.27,
        "source_url": "https://www.nps.gov/jotr/index.htm",
    },
    "Lassen Volcanic National Park": {
        "lat": 40.4937, "lng": -121.407,
        "source_url": "https://www.nps.gov/lavo/index.htm",
    },
    "Mount Rainier National Park": {
        "lat": 46.85, "lng": -121.75,
        "source_url": "https://www.nps.gov/mora/index.htm",
    },
    "Mount Rushmore": {
        "lat": 43.8791, "lng": -103.4591,
        "source_url": "https://www.nps.gov/moru/index.htm",
    },
    "North Cascades National Park": {
        "lat": 48.7718, "lng": -121.2985,
        "source_url": "https://www.nps.gov/noca/index.htm",
    },
    "Olympic National Park": {
        "lat": 47.8021, "lng": -123.6044,
        "source_url": "https://www.nps.gov/olym/index.htm",
    },
    "Pinnacles National Park": {
        "lat": 36.4906, "lng": -121.1825,
        "source_url": "https://www.nps.gov/pinn/index.htm",
    },
    "Point Reyes National Seashore": {
        "lat": 38.0667, "lng": -122.8833,
        "source_url": "https://www.nps.gov/pore/index.htm",
    },
    "Redwood National and State Parks": {
        "lat": 41.3, "lng": -124.0,
        "source_url": "https://www.nps.gov/redw/index.htm",
    },
    "Rocky Mountain National Park": {
        "lat": 40.3466, "lng": -105.7364,
        "source_url": "https://www.nps.gov/romo/index.htm",
        "image_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Rocky_Mountain_National_Park_in_September_2011_-_Glacier_Gorge_from_Bear_Lake.JPG/960px-Rocky_Mountain_National_Park_in_September_2011_-_Glacier_Gorge_from_Bear_Lake.JPG",
        "image_credit": "Wikimedia Commons",
    },
    "Sequoia National Park": {
        "lat": 36.4864, "lng": -118.5658,
        "source_url": "https://www.nps.gov/seki/index.htm",
    },
    "Shenandoah National Park": {
        "lat": 38.533, "lng": -78.35,
        "source_url": "https://www.nps.gov/shen/index.htm",
    },
    "Zion National Park": {
        "lat": 37.2982, "lng": -113.0263,
        "source_url": "https://www.nps.gov/zion/index.htm",
    },
    "Voyageurs National Park": {
        "lat": 48.5, "lng": -92.8833,
        "source_url": "https://www.nps.gov/voya/index.htm",
    },
    "Assateague Island National Seashore": {
        "lat": 38.0865, "lng": -75.2085,
        "source_url": "https://www.nps.gov/asis/index.htm",
    },
    "Padre Island National Seashore": {
        "lat": 27.0538, "lng": -97.3596,
        "source_url": "https://www.nps.gov/pais/index.htm",
    },
    "Pictured Rocks National Lakeshore": {
        "lat": 46.5644, "lng": -86.3163,
        "source_url": "https://www.nps.gov/piro/index.htm",
    },
    "Apostle Islands National Lakeshore": {
        "lat": 46.9658, "lng": -90.6644,
        "source_url": "https://www.nps.gov/apis/index.htm",
    },
    "Cape Cod National Seashore": {
        "lat": 41.95, "lng": -70.0,
        "source_url": "https://www.nps.gov/caco/index.htm",
    },
    "Mammoth Cave National Park": {
        "lat": 37.1862, "lng": -86.1005,
        "source_url": "https://www.nps.gov/maca/index.htm",
    },
    "Katmai National Park and Preserve": {
        "lat": 58.6126, "lng": -155.0631,
        "source_url": "https://www.nps.gov/katm/index.htm",
    },
    "Glacier Bay National Park and Preserve": {
        "lat": 58.6658, "lng": -136.9002,
        "source_url": "https://www.nps.gov/glba/index.htm",
    },
    "Yellowstone National Park": {
        "lat": 44.6, "lng": -110.5,
        "source_url": "https://www.nps.gov/yell/index.htm",
    },
    "Banff National Park": {
        "lat": 51.4968, "lng": -115.9281,
        "source_url": "https://parks.canada.ca/pn-np/ab/banff/activ/camping",
    },
    "Jasper National Park": {
        "lat": 52.8734, "lng": -118.0823,
        "source_url": "https://parks.canada.ca/pn-np/ab/jasper/activ/passez-stay/camping",
    },
    "Pacific Rim National Park Reserve": {
        "lat": 49.0523, "lng": -125.6925,
        "source_url": "https://parks.canada.ca/pn-np/bc/pacificrim/activ/camping",
    },
    "Algonquin Provincial Park": {
        "lat": 45.8372, "lng": -78.3791,
        "source_url": "https://www.algonquinpark.on.ca/visit/camping/",
    },
    "Gros Morne National Park": {
        "lat": 49.6728, "lng": -57.7381,
        "source_url": "https://parks.canada.ca/pn-np/nl/grosmorne/activ/camping",
    },
    "Fiordland National Park": {
        "lat": -45.4150, "lng": 167.7181,
        "source_url": "https://www.doc.govt.nz/parks-and-recreation/places-to-go/fiordland/places/fiordland-national-park/",
    },
    "Tongariro National Park": {
        "lat": -39.2000, "lng": 175.5833,
        "source_url": "https://www.doc.govt.nz/parks-and-recreation/places-to-go/central-north-island/places/tongariro-national-park/",
    },
    "Abel Tasman National Park": {
        "lat": -40.8333, "lng": 172.9000,
        "source_url": "https://www.doc.govt.nz/parks-and-recreation/places-to-go/nelson-tasman/places/abel-tasman-national-park/",
    },
    "Aoraki / Mount Cook National Park": {
        "lat": -43.7340, "lng": 170.0967,
        "source_url": "https://www.doc.govt.nz/parks-and-recreation/places-to-go/canterbury/places/aoraki-mount-cook-national-park/",
    },
    "Mount Aspiring National Park": {
        "lat": -44.3833, "lng": 168.7333,
        "source_url": "https://www.doc.govt.nz/parks-and-recreation/places-to-go/otago/places/mount-aspiring-national-park/",
    },
    "Blue Mountains National Park": {
        "lat": -33.6250, "lng": 150.4200,
        "source_url": "https://www.nationalparks.nsw.gov.au/camping-and-accommodation",
    },
    "Kosciuszko National Park": {
        "lat": -36.4559, "lng": 148.2636,
        "source_url": "https://www.nationalparks.nsw.gov.au/visit-a-park/parks/kosciuszko-national-park",
    },
    "Kakadu National Park": {
        "lat": -13.0923, "lng": 132.3938,
        "source_url": "https://kakadu.gov.au/plan/accommodation/camping/",
    },
    "Grampians National Park": {
        "lat": -37.2500, "lng": 142.5000,
        "source_url": "https://www.parks.vic.gov.au/places-to-see/parks/grampians-national-park",
    },
    "Freycinet National Park": {
        "lat": -42.1220, "lng": 148.2880,
        "source_url": "https://parks.tas.gov.au/explore-our-parks/freycinet-national-park",
    },
    "Daintree National Park": {
        "lat": -16.1700, "lng": 145.4180,
        "source_url": "https://parks.desi.qld.gov.au/parks/daintree",
    },
    "Nahanni National Park Reserve": {
        "lat": 61.5500, "lng": -125.5833,
        "source_url": "https://parks.canada.ca/pn-np/nt/nahanni",
    },
    "Wood Buffalo National Park": {
        "lat": 59.3750, "lng": -112.5000,
        "source_url": "https://parks.canada.ca/pn-np/nt/woodbuffalo",
    },
    "L'Anse aux Meadows": {
        "lat": 51.5965, "lng": -55.5335,
        "source_url": "https://parks.canada.ca/lhn-nhs/nl/meadows",
    },
    "Head-Smashed-In Buffalo Jump": {
        "lat": 49.7000, "lng": -113.6500,
        "source_url": "https://headsmashedin.ca/",
    },
    "Fortress of Louisbourg": {
        "lat": 45.8922, "lng": -59.9853,
        "source_url": "https://parks.canada.ca/lhn-nhs/ns/louisbourg",
    },
    "Te Wahipounamu": {
        "lat": -44.7000, "lng": 168.2000,
        "source_url": "https://whc.unesco.org/en/list/551/",
    },
    "Waitangi Treaty Grounds": {
        "lat": -35.2652, "lng": 174.0807,
        "source_url": "https://www.waitangi.org.nz/",
    },
    "Ulu\u1e5fu-Kata Tju\u1e6da National Park": {
        "lat": -25.3444, "lng": 131.0369,
        "source_url": "https://parksaustralia.gov.au/uluru/",
    },
    "Great Barrier Reef Marine Park": {
        "lat": -18.2871, "lng": 147.6992,
        "source_url": "https://www2.gbrmpa.gov.au/",
    },
    "Purnululu National Park": {
        "lat": -17.5000, "lng": 128.5000,
        "source_url": "https://exploreparks.dbca.wa.gov.au/park/purnululu-national-park",
    },
    "Port Arthur, Tasmania": {
        "lat": -43.1414, "lng": 147.8511,
        "source_url": "https://portarthur.org.au/",
    },
    "Royal National Park": {
        "lat": -34.1500, "lng": 151.0667,
        "source_url": "https://www.nationalparks.nsw.gov.au/visit-a-park/parks/royal-national-park",
    },
}
RELATED_IMAGE_BASE = {
    "Assateague Island National Seashore": "Acadia National Park",
    "Padre Island National Seashore": "Everglades National Park",
    "Pictured Rocks National Lakeshore": "Isle Royale National Park",
    "Apostle Islands National Lakeshore": "Isle Royale National Park",
    "Cape Cod National Seashore": "Acadia National Park",
    "Great Basin National Park": "Great Sand Dunes National Park and Preserve",
    "Capitol Reef National Park": "Arches National Park",
    "Pinnacles National Park": "Joshua Tree National Park",
    "Lassen Volcanic National Park": "Mount Rainier National Park",
    "Black Canyon of the Gunnison National Park": "Rocky Mountain National Park",
    "Grand Staircase\u2013Escalante National Monument": "Canyonlands National Park",
    "Katmai National Park and Preserve": "Denali National Park and Preserve",
    "Glacier Bay National Park and Preserve": "Denali National Park and Preserve",
    "Mammoth Cave National Park": "Great Smoky Mountains National Park",
    "Mount Rushmore": "Badlands National Park",
    "Jasper National Park": "Banff National Park",
    "Pacific Rim National Park Reserve": "Olympic National Park",
    "Algonquin Provincial Park": "Acadia National Park",
    "Gros Morne National Park": "Acadia National Park",
    "Fiordland National Park": "North Cascades National Park",
    "Tongariro National Park": "Hawaii Volcanoes National Park",
    "Abel Tasman National Park": "Olympic National Park",
    "Aoraki / Mount Cook National Park": "Mount Rainier National Park",
    "Mount Aspiring National Park": "North Cascades National Park",
    "Blue Mountains National Park": "Shenandoah National Park",
    "Kosciuszko National Park": "Rocky Mountain National Park",
    "Kakadu National Park": "Everglades National Park",
    "Grampians National Park": "Rocky Mountain National Park",
    "Freycinet National Park": "Acadia National Park",
    "Daintree National Park": "Olympic National Park",
    "Nahanni National Park Reserve": "North Cascades National Park",
    "Wood Buffalo National Park": "Denali National Park and Preserve",
    "L'Anse aux Meadows": "Acadia National Park",
    "Head-Smashed-In Buffalo Jump": "Badlands National Park",
    "Fortress of Louisbourg": "Acadia National Park",
    "Te Wahipounamu": "North Cascades National Park",
    "Waitangi Treaty Grounds": "Olympic National Park",
    "Ulu\u1e5fu-Kata Tju\u1e6da National Park": "Arches National Park",
    "Great Barrier Reef Marine Park": "Everglades National Park",
    "Purnululu National Park": "Arches National Park",
    "Port Arthur, Tasmania": "Acadia National Park",
    "Royal National Park": "Shenandoah National Park",
}
NPS_PARK_CODES = {
    "Grand Canyon National Park": "grca",
    "Yellowstone National Park": "yell",
    "Yosemite National Park": "yose",
    "Arches National Park": "arch",
    "Zion National Park": "zion",
    "Bryce Canyon National Park": "brca",
    "Canyonlands National Park": "cany",
    "Mesa Verde National Park": "meve",
    "Bears Ears National Monument": "beea",
    "Organ Pipe Cactus National Monument": "orpi",
    "Chaco Culture National Historical Park": "chcu",
    "White Sands National Park": "whsa",
    "Great Sand Dunes National Park and Preserve": "grsa",
    "Badlands National Park": "badl",
    "Devils Tower": "deto",
    "Mount Rushmore": "moru",
    "Little Bighorn Battlefield National Monument": "libi",
    "Glacier National Park (U.S.)": "glac",
    "Olympic National Park": "olym",
    "Crater Lake National Park": "crla",
    "Redwood National and State Parks": "redw",
    "Death Valley National Park": "deva",
    "Joshua Tree National Park": "jotr",
    "Sequoia National Park": "sequ",
    "Big Bend National Park": "bibe",
    "Carlsbad Caverns National Park": "cave",
    "Petrified Forest National Park": "pefo",
    "Saguaro National Park": "sagu",
    "Craters of the Moon National Monument and Preserve": "crmo",
    "Dinosaur National Monument": "dino",
    "Colorado National Monument": "colm",
    "Black Canyon of the Gunnison National Park": "blca",
    "Rocky Mountain National Park": "romo",
    "Tallgrass Prairie National Preserve": "tapr",
    "Brown v. Board of Education National Historical Park": "brvb",
    "Fort Larned National Historic Site": "fols",
    "Fort Scott National Historic Site": "fosc",
    "Gateway Arch": "jeff",
    "Hot Springs National Park": "hosp",
    "Mammoth Cave National Park": "maca",
    "Great Smoky Mountains National Park": "grsm",
    "Shenandoah National Park": "shen",
    "Acadia National Park": "acad",
    "Everglades National Park": "ever",
    "Dry Tortugas National Park": "drto",
    "Cape Hatteras National Seashore": "caha",
    "Gettysburg National Military Park": "gett",
    "Harpers Ferry National Historical Park": "hafe",
    "Cuyahoga Valley National Park": "cuva",
    "Indiana Dunes National Park": "indu",
    "Pictured Rocks National Lakeshore": "piro",
    "Apostle Islands National Lakeshore": "apis",
    "Voyageurs National Park": "voya",
    "Theodore Roosevelt National Park": "thro",
    "Isle Royale National Park": "isro",
    "Denali National Park and Preserve": "dena",
    "Haleakala National Park": "hale",
    "Hawaii Volcanoes National Park": "havo",
    "Grand Teton National Park": "grte",
    "Mount Rainier National Park": "mora",
    "North Cascades National Park": "noca",
    "Lassen Volcanic National Park": "lavo",
    "Channel Islands National Park": "chis",
    "Pinnacles National Park": "pinn",
    "Capitol Reef National Park": "care",
    "Guadalupe Mountains National Park": "gumo",
    "Wind Cave National Park": "wica",
    "Jewel Cave National Monument": "jeca",
    "Scotts Bluff National Monument": "scbl",
    "Effigy Mounds National Monument": "efmo",
    "Lincoln Home National Historic Site": "liho",
    "Vicksburg National Military Park": "vick",
    "Natchez Trace Parkway": "natr",
    "San Antonio Missions National Historical Park": "saan",
    "Padre Island National Seashore": "pais",
    "Chiricahua National Monument": "chir",
    "Bandelier National Monument": "band",
    "Gila Cliff Dwellings National Monument": "gicl",
    "Hovenweep National Monument": "hove",
    "Natural Bridges National Monument": "nabr",
    "Cedar Breaks National Monument": "cebr",
    "Tonto National Monument": "tont",
    "Montezuma Castle National Monument": "moca",
    "Wupatki National Monument": "wupa",
    "Walnut Canyon National Monument": "waca",
    "Sunset Crater Volcano National Monument": "sucr",
    "Tumacácori National Historical Park": "tuma",
    "Fort Union National Monument": "foun",
    "Pecos National Historical Park": "peco",
    "Aztec Ruins National Monument": "azru",
    "Salinas Pueblo Missions National Monument": "sapu",
    "Fort Union Trading Post National Historic Site": "fous",
    "Pipe Spring National Monument": "pisp",
    "Golden Spike National Historical Park": "gosp",
    "John Day Fossil Beds National Monument": "joda",
    "Lava Beds National Monument": "labe",
    "Muir Woods National Monument": "muwo",
    "Point Reyes National Seashore": "pore",
    "Cabrillo National Monument": "cabr",
    "Manzanar": "manz",
}


def slug(title: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return value or "place"


def coerce_seed_entry(raw, group: dict, rank: int) -> dict:
    if isinstance(raw, list):
        title = raw[0]
        base_title = raw[1] if len(raw) > 1 else raw[0]
        state = raw[2] if len(raw) > 2 else ""
        source_url = raw[3] if len(raw) > 3 else ""
        return {
            "title": title,
            "base_title": base_title,
            "state": state,
            "source_url": source_url,
            "rank": rank,
            "explore_group": group["key"],
            "group_label": group.get("label") or group["key"],
        }
    entry = dict(raw)
    entry.setdefault("rank", rank)
    entry.setdefault("explore_group", group["key"])
    entry.setdefault("group_label", group.get("label") or group["key"])
    entry.setdefault("base_title", entry.get("title", ""))
    return entry


def load_seed(path: Path) -> tuple[dict, list[dict]]:
    seed = json.loads(path.read_text())
    entries: list[dict] = []
    for group_idx, group in enumerate(seed.get("groups") or [], start=1):
        for rank, raw in enumerate(group.get("entries") or [], start=1):
            entry = coerce_seed_entry(raw, group, rank)
            entry["hero_rank"] = rank
            entry["rank"] = group_idx * 100 + rank
            entries.append(entry)
    return seed, entries


def load_existing_index(path: Path) -> dict[str, dict]:
    paths = [path]
    default_catalog = Path("dashboard/explore_catalog_v1.json")
    if default_catalog not in paths:
        paths.append(default_catalog)
    merged: dict[str, dict] = {}
    for candidate in paths:
        if not candidate.exists():
            continue
        try:
            catalog = json.loads(candidate.read_text())
        except Exception:
            continue
        for place in catalog.get("places") or []:
            summary = place.get("summary") or {}
            title = summary.get("title")
            if title:
                merged[str(title).lower()] = place
    return merged


def build_existing_base_asset_map(seed_entries: list[dict], existing_index: dict[str, dict]) -> dict[str, str]:
    assets: dict[str, str] = {}
    for entry in seed_entries:
        existing = existing_index.get(str(entry.get("title") or "").lower())
        summary = (existing or {}).get("summary") or {}
        image_url = summary.get("image_url") or summary.get("thumbnail_url") or ""
        if not isinstance(image_url, str) or not image_url.startswith("/assets/explore/"):
            continue
        base_title = str(entry.get("base_title") or entry.get("title") or "")
        if base_title and base_title not in assets:
            assets[base_title] = image_url
    return assets


def apply_existing_fallback(data: dict, source_pack: dict, existing: dict | None) -> tuple[dict, dict]:
    if not existing:
        return data, source_pack
    data = dict(data or {})
    summary = existing.get("summary") or {}
    existing_pack = existing.get("source_pack") or {}
    coords = data.get("coordinates") or []
    has_coords = bool(coords and coords[0].get("lat") not in (None, "") and coords[0].get("lon") not in (None, ""))
    if not has_coords and summary.get("lat") not in (None, "") and summary.get("lng") not in (None, ""):
        data["coordinates"] = [{"lat": summary.get("lat"), "lon": summary.get("lng")}]
    if not data.get("extract") and existing.get("wiki_extract"):
        data["extract"] = existing.get("wiki_extract")
    if not (data.get("thumbnail") or {}).get("source") and summary.get("thumbnail_url"):
        data["thumbnail"] = {"source": summary.get("thumbnail_url")}
    if not (data.get("original") or {}).get("source") and summary.get("image_url"):
        data["original"] = {"source": summary.get("image_url")}
    if existing_pack:
        source_pack = {
            **source_pack,
            **{key: value for key, value in existing_pack.items() if value not in (None, "", [], {})},
            "sources": (existing_pack.get("sources") or []) + (source_pack.get("sources") or []),
            "photos": existing_pack.get("photos") or source_pack.get("photos") or [],
            "extract": existing_pack.get("extract") or source_pack.get("extract") or data.get("extract") or "",
        }
    return data, source_pack


def apply_base_fallback(data: dict, source_pack: dict, base_title: str) -> tuple[dict, dict]:
    fallback = BASE_FALLBACKS.get(base_title)
    if not fallback:
        return data, source_pack
    data = dict(data or {})
    coords = data.get("coordinates") or []
    has_coords = bool(coords and coords[0].get("lat") not in (None, "") and coords[0].get("lon") not in (None, ""))
    if not has_coords:
        data["coordinates"] = [{"lat": fallback["lat"], "lon": fallback["lng"]}]
    if fallback.get("source_url") and not data.get("fullurl"):
        data["fullurl"] = fallback["source_url"]
    if fallback.get("source_url") and not source_pack.get("official_url"):
        source_pack = {**source_pack, "official_url": fallback["source_url"]}
    if fallback.get("image_url"):
        data["original"] = {"source": fallback["image_url"]}
        data["thumbnail"] = {"source": fallback["image_url"]}
        source_pack = {
            **source_pack,
            "photos": [{
                "url": fallback["image_url"],
                "caption": base_title,
                "credit": fallback.get("image_credit") or "Wikimedia Commons",
            }],
            "license": fallback.get("image_credit") or "Wikimedia Commons",
        }
    return data, source_pack


def sentence(text: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return fallback
    match = re.match(r"(.+?[.!?])(?:\s|$)", text)
    return (match.group(1) if match else text[:180]).strip()


def sentences(text: str) -> list[str]:
    text = re.sub(r"\([^)]*pronounced[^)]*\)", "", text or "", flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if len(p.strip()) > 8]


def join_sentences(parts: list[str], start: int, count: int, fallback: str) -> str:
    selected = parts[start:start + count]
    return " ".join(selected).strip() or fallback

def copy_theme(title: str, base: str, group_key: str, tags: list[str] | None = None) -> dict:
    text = " ".join([title, base, " ".join(tags or [])]).lower()
    if any(term in text for term in ("volcano", "volcanic", "lava", "craters")):
        return {
            "terrain": "volcanic terrain, stark overlooks, and geology you can read from the road",
            "action": "check eruption notices, heat, snow, and road status",
        }
    if any(term in text for term in ("cave", "caverns", "karst")):
        return {
            "terrain": "cave country, ranger-led timing, and weather-proof underground payoff",
            "action": "confirm tour windows, footwear rules, and surface-road closures",
        }
    if any(term in text for term in ("coast", "beach", "island", "seashore", "marine", "reef", "sound", "bay", "fjord", "lakeshore")):
        return {
            "terrain": "coastline, water access, wind, tides, and long-view scenery",
            "action": "check tides, ferries, surf, wind, and parking",
        }
    if any(term in text for term in ("lake", "river", "canoe", "water", "gorge", "gap")):
        return {
            "terrain": "water access, scenic pullouts, and weather-dependent route decisions",
            "action": "check water levels, boat rules, seasonal roads, and shoreline access",
        }
    if any(term in text for term in ("desert", "dunes", "cactus", "canyon", "arches", "escalante", "valley of fire", "white sands")):
        return {
            "terrain": "desert light, exposed roads, heat planning, and high-payoff geology",
            "action": "check heat, water, road surface, flash-flood risk, and camp rules",
        }
    if any(term in text for term in ("historic", "battlefield", "missions", "fort", "liberty", "ellis", "pearl harbor", "manzanar", "treaty", "meadows")):
        return {
            "terrain": "history, interpretation stops, walking time, and context that rewards slowing down",
            "action": "check hours, tickets, tour timing, and preservation rules",
        }
    if any(term in text for term in ("monument", "ruins", "cliff dwellings", "fossil", "dinosaur", "tower", "mesa verde", "bears ears")):
        return {
            "terrain": "landmark scenery, cultural context, and short detours with real route payoff",
            "action": "confirm access roads, permits, site protections, and current notices",
        }
    if any(term in text for term in ("forest", "rainforest", "redwood", "smoky", "pisgah", "white mountain", "superior")):
        return {
            "terrain": "forest roads, trailheads, shaded stops, and weather that can change the drive",
            "action": "check seasonal gates, fire rules, trail conditions, and camping limits",
        }
    if any(term in text for term in ("mount", "mountain", "alpine", "glacier", "teton", "rainier", "rocky", "kluane", "fiordland", "aspiring")):
        return {
            "terrain": "mountain access, elevation, weather windows, and big-scenery route anchors",
            "action": "check snow, storms, shuttle rules, and road openings",
        }
    if group_key == "glamping":
        return {
            "terrain": "a softer landing near a major outdoor route, with comfort trading off against price and availability",
            "action": "confirm check-in, location, cancellation terms, and included gear",
        }
    if group_key == "huts_lodging":
        return {
            "terrain": "fixed-roof lodging that can anchor a hard weather day or a classic park overnight",
            "action": "confirm reservation windows, food, shuttle access, and operating dates",
        }
    if group_key == "trails":
        return {
            "terrain": "trail time, parking logistics, and a route day that should be planned around daylight",
            "action": "check permits, closures, heat or snow, and trailhead access",
        }
    return {
        "terrain": "public-land scenery, practical route context, and enough payoff to justify a stop",
        "action": "verify access, fees, closures, and overnight rules",
    }


def copy_variant(title: str, count: int) -> int:
    if count <= 1:
        return 0
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % count


def choose_template(key: str, templates: list[str], **values: str) -> str:
    template = templates[copy_variant(key, len(templates))]
    return template.format(**values)


def preview_base_name(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = re.sub(r"\bNational Park and Preserve\b", "NP Preserve", text)
    text = re.sub(r"\bNational Park Reserve\b", "NP Reserve", text)
    text = re.sub(r"\bNational Recreation Area\b", "NRA", text)
    text = re.sub(r"\bNational Lakeshore\b", "Lakeshore", text)
    text = re.sub(r"\bNational Seashore\b", "Seashore", text)
    text = re.sub(r"\bNational Park\b", "NP", text)
    return text


def sentence_case(value: str) -> str:
    text = (value or "").strip()
    return text[:1].upper() + text[1:] if text else text


def generated_copy_for_seed(entry: dict, base_title: str) -> tuple[str, str, str, str]:
    group_key = entry.get("explore_group") or ""
    group = GROUP_COPY.get(group_key, GROUP_COPY["camping"])
    title = entry["title"]
    base = base_title or title
    state = entry.get("state") or entry.get("region") or ""
    tags = list(entry.get("tags") or [])
    theme = copy_theme(title, base, group_key, tags)
    preview_base = preview_base_name(base)
    action = theme["action"]
    action_sentence = sentence_case(action)
    place = title if title == base else f"{title} around {base}"
    region = f" in {state}" if state else ""

    if group_key == "camping":
        hook = choose_template(title, [
            "{title} gives camp search a real center near {base}{region}.",
            "Use {title} as the overnight search area for {base}{region}.",
            "{title} is the place to start looking for legal stays near {base}{region}.",
            "Start camp planning around {title}, then narrow it with live results.",
        ], title=title, base=preview_base, region=region)
        summary = choose_template(title, [
            "Search around {base} for legal overnight options. Then {action}.",
            "Start near {base}; live results show actual sites. {Action}.",
            "Good for overnight planning near {base}. Use live map results. {Action}.",
            "Use this area to avoid a blank camp search. Look nearby and {action}.",
        ], base=preview_base, action=action, Action=action_sentence)
        why = f"{title} matters because it gives the route planner a named camping area near {base}, not just a blank map search."
    elif group_key == "parks":
        hook = choose_template(title, [
            "{title} is worth slowing down for{region}.",
            "Put {title} on the route when the day needs more than road miles.",
            "{title} works as a real day stop{region}, not just a map label.",
            "Use {title} to shape nearby camps, walks, and services{region}.",
        ], title=title, region=region)
        summary = choose_template(title, [
            "A good place to slow the route down. Before you go, {action}.",
            "Use it as a day anchor when the drive needs more than mileage. {Action}.",
            "Build extra time around this stop, especially if weather or crowds matter. {Action}.",
            "Worth planning around, not just passing on the highway. {Action}.",
        ], action=action, Action=action_sentence)
        why = f"{title} earns a card because it can shape where you camp, fuel, walk, and slow down on the surrounding route."
    elif group_key == "monuments":
        hook = choose_template(title, [
            "History is the reason to stop at {title}{region}.",
            "{title} is best treated as a real stop, not a quick pin.",
            "Use {title} when the route needs context, not just scenery.",
            "{title} gives the drive a specific story to stop for{region}.",
        ], title=title, region=region)
        summary = choose_template(title, [
            "Plan enough time to get out, read the place, and walk it properly. {Action}.",
            "Best as a focused stop, not a drive-by pin. {Action}.",
            "A short detour can be worth it here if you give the site time. {Action}.",
            "Use it for context, photos, and a cleaner break in the drive. {Action}.",
        ], Action=action_sentence)
        why = f"{title} adds context to the map: history, land protection, and a specific reason to leave the fastest road."
    elif group_key == "water_scenic":
        hook = choose_template(title, [
            "Put {title} on the route when water and views matter.",
            "{title} is a good excuse to slow down near the water{region}.",
            "Use {title} when the route needs a scenic pause{region}.",
            "{title} is useful when the map needs more than roads and camps.",
        ], title=title, region=region)
        summary = choose_template(title, [
            "Good for a slower scenic leg, photos, or shoreline time. {Action}.",
            "Use this when the route needs water, views, and a real pause. {Action}.",
            "Plan around conditions here; wind and access can change the day. {Action}.",
            "Useful when nearby camps or towns feel too generic. {Action}.",
        ], Action=action_sentence)
        why = f"{title} helps turn nearby search into a better route choice by tying camps, stops, and weather to a visible landscape feature."
    elif group_key == "trails":
        hook = choose_template(title, [
            "Plan around {title} if hiking is the main event{region}.",
            "{title} can decide where the rest of the day goes.",
            "Use {title} to stage parking, camps, and post-hike services{region}.",
            "{title} is a better day anchor than a last-minute trail search.",
        ], title=title, region=region)
        summary = choose_template(title, [
            "Plan parking, daylight, nearby camps, and food around this one. {Action}.",
            "Use it when a hike should decide the day, not just fill an hour. {Action}.",
            "Good for staging the route before and after trail time. {Action}.",
            "Trail logistics can ripple into camp plans. {Action}.",
        ], Action=action_sentence)
        why = f"{title} belongs in Explore because trail timing often decides the rest of the day: sleep, food, fuel, and how far to drive next."
    elif group_key == "glamping":
        hook = choose_template(title, [
            "{title} is for the night you want comfort near {base}.",
            "Use {title} when the route needs a softer landing{region}.",
            "{title} gives the trip a paid reset option near {base}.",
            "Choose {title} when setup time matters more than roughing it.",
        ], title=title, base=preview_base, region=region)
        summary = choose_template(title, [
            "Use it for a reset night when camping every day stops sounding fun. {Action}.",
            "A paid comfort stop near {base}; useful after heat, weather, or long miles. {Action}.",
            "Good when the trip needs showers, easier sleep, and less setup. {Action}.",
            "Treat it as lodging, not public campground inventory. {Action}.",
        ], base=preview_base, Action=action_sentence)
        why = f"{title} gives the planner a paid-stay option near outdoor access without treating it like public campground inventory."
    elif group_key == "huts_lodging":
        hook = choose_template(title, [
            "{title} gives the route a real roof near {base}.",
            "Use {title} when weather or mileage makes camping less appealing.",
            "{title} can be the safer end point for a long day{region}.",
            "Build around {title} only if the reservation timing works.",
        ], title=title, base=preview_base, region=region)
        summary = choose_template(title, [
            "Useful when weather, mileage, or park access calls for a real roof. {Action}.",
            "Build around this only if the reservation and access details work. {Action}.",
            "A classic overnight anchor, especially when camp logistics get tight. {Action}.",
            "Use it for a recovery night or a safer end to a hard day. {Action}.",
        ], Action=action_sentence)
        why = f"{title} is useful because lodging can decide the safe end point for a long mountain, desert, or park day."
    else:
        hook = f"{title} is a Trailhead Explore anchor{region} for {theme['terrain']}."
        summary = f"Use it as a starting point for route context, then {theme['action']}."
        why = f"{title} adds enough travel context to be worth surfacing before a user zooms into the map."
    return hook, summary, why, theme["action"]


def is_generic_seed_text(value: str, title: str) -> bool:
    text = (value or "").lower()
    title_lower = title.lower()
    return (
        not text
        or "puts " in text and " on the shortlist for " in text
        or "curated trailhead pick" in text
        or "seeded trailhead campground-area anchor" in text
        or text.startswith(f"{title_lower} keeps ")
    )


def profile_from_summary(title: str, category: str, extract: str, state: str) -> dict:
    parts = sentences(extract)
    lead = parts[0] if parts else f"{title} is a featured Trailhead Explore stop."
    summary = join_sentences(parts, 0, 3, lead)
    know = join_sentences(parts, 1, 3, summary)
    story_core = join_sentences(parts, 0, 7, summary)
    story = (
        f"Here is the story of {title}. {story_core} "
        f"For a Trailhead stop, treat it as more than a photo marker: give yourself time to understand the place, check current access, and look around before moving on."
    )
    return {
        "hook": lead,
        "summary": summary,
        "story": story,
        "why_it_matters": join_sentences(parts, 0, 2, lead),
        "what_to_know": know,
        "best_time_to_stop": (
            "Plan enough daylight to park, walk, read the site context, and take photos without rushing. Early morning and late afternoon are usually the best windows for light, heat, crowds, and slower travel days."
        ),
        "access_notes": (
            f"Confirm current access, fees, hours, road closures, and permit rules before detouring to this {category.lower()} in {state}."
        ),
        "nearby_context": (
            "Treat this as an anchor stop: check nearby fuel, weather, camps, and road conditions before committing to a longer detour."
        ),
    }


def profile_from_seed(entry: dict, base_title: str, extract: str) -> dict:
    group_key = entry.get("explore_group") or ""
    group = GROUP_COPY.get(group_key, GROUP_COPY["camping"])
    title = entry["title"]
    base = base_title or title
    state = entry.get("state") or entry.get("region") or ""
    generated_hook, generated_summary, generated_why, generated_action = generated_copy_for_seed(entry, base)
    entry_hook = entry.get("hook") or ""
    entry_summary = entry.get("short_description") or ""
    lead = entry_hook if not is_generic_seed_text(entry_hook, title) else generated_hook
    summary = entry_summary if not is_generic_seed_text(entry_summary, title) else generated_summary
    story_core = sentence(extract, f"{base} is a major outdoor destination.")
    return {
        "hook": lead,
        "summary": summary,
        "story": (
            f"{title}. {summary} {story_core} "
            f"Build the stop around current conditions, reservation rules, and the time you want on the ground."
        ),
        "why_it_matters": entry.get("why_it_matters") or generated_why,
        "what_to_know": entry.get("what_to_know") or (
            f"This is a planning card, not live availability. Use it for discovery, then {generated_action}."
        ),
        "best_time_to_stop": entry.get("best_time_to_stop") or group["timing"],
        "access_notes": entry.get("access_notes") or (
            f"{group['access']} {('Region: ' + state + '.') if state else ''}".strip()
        ),
        "nearby_context": entry.get("nearby_context") or (
            "Check nearby fuel, food, water, weather, and road time before using it as an overnight or trail-day anchor."
        ),
    }


def audio_script(title: str, profile: dict) -> str:
    return profile.get("story") or f"{title}. {profile['hook']} {profile['why_it_matters']} {profile['access_notes']}"


def source_pack_from_wiki(summary: dict, extract: str) -> dict:
    return {
        "quality": "wiki",
        "primary": "Wikipedia",
        "official_url": "",
        "nps_park_code": "",
        "sources": [
            {
                "title": summary.get("title", ""),
                "publisher": "Wikipedia",
                "url": summary.get("source_url", ""),
                "kind": "encyclopedia",
            }
        ],
        "photos": [
            photo for photo in [{
                "url": summary.get("image_url") or summary.get("thumbnail_url"),
                "caption": summary.get("title", ""),
                "credit": "Wikimedia Commons",
            }] if photo["url"]
        ],
        "activities": [],
        "topics": summary.get("tags", []),
        "things_to_do": [],
        "things_to_see": [],
        "visitor_centers": [],
        "campgrounds": [],
        "fees": [],
        "operating_hours": "",
        "alerts": [],
        "source_note": "Wikipedia/Wikimedia source pack. Official agency enrichment will be added when a matching source is available.",
        "extract": extract,
    }


def source_pack_from_seed(entry: dict, base_pack: dict, summary: dict, extract: str) -> dict:
    source_url = entry.get("source_url") or base_pack.get("official_url") or summary.get("source_url") or ""
    booking_url = entry.get("booking_url") or (source_url if entry.get("explore_group") in {"glamping", "huts_lodging"} else "")
    sources = list(base_pack.get("sources") or [])
    if source_url and all(item.get("url") != source_url for item in sources):
        sources.insert(0, {
            "title": entry.get("title") or summary.get("title") or "",
            "publisher": entry.get("source_publisher") or ("External stay source" if entry.get("explore_group") in {"glamping", "huts_lodging"} else base_pack.get("primary") or "Official source"),
            "url": source_url,
            "kind": "booking" if booking_url else "official",
        })
    return {
        **base_pack,
        "sources": sources,
        "booking_url": booking_url,
        "license": entry.get("license") or base_pack.get("license") or "",
        "image_asset": entry.get("image_asset") or "",
        "source_note": entry.get("source_note") or (
            "Curated Explore source pack. Open the linked source for current access, pricing, reservation rules, and availability."
            if entry.get("explore_group") in {"glamping", "huts_lodging"}
            else base_pack.get("source_note") or "Curated Explore source pack."
        ),
        "extract": extract or base_pack.get("extract") or "",
    }


def nps_get(client: httpx.Client, endpoint: str, api_key: str, params: dict) -> dict:
    if not api_key:
        return {}
    headers = {"X-Api-Key": api_key, "User-Agent": "Trailhead/1.0 explore catalog builder"}
    res = client.get(f"{NPS_API}/{endpoint}", params=params, headers=headers)
    if res.status_code in (401, 403, 429):
        return {}
    res.raise_for_status()
    return res.json()


def fetch_nps_pack(client: httpx.Client, title: str, api_key: str) -> dict | None:
    code = NPS_PARK_CODES.get(title)
    if not code or not api_key:
        return None
    parks = nps_get(client, "parks", api_key, {"parkCode": code, "limit": 1}).get("data") or []
    if not parks:
        return None
    park = parks[0]
    alerts = nps_get(client, "alerts", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    things_to_do = nps_get(client, "thingstodo", api_key, {"parkCode": code, "limit": 8}).get("data") or []
    things_to_see = nps_get(client, "places", api_key, {"parkCode": code, "limit": 8}).get("data") or []
    visitor_centers = nps_get(client, "visitorcenters", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    campgrounds = nps_get(client, "campgrounds", api_key, {"parkCode": code, "limit": 5}).get("data") or []
    fees = []
    for fee in park.get("entranceFees") or []:
        title_value = fee.get("title") or "Entrance fee"
        cost = fee.get("cost")
        fees.append(f"{title_value}: ${cost}" if cost not in (None, "") else title_value)
    hours = ""
    operating = park.get("operatingHours") or []
    if operating:
        hours = operating[0].get("description") or operating[0].get("name") or ""
    return {
        "quality": "official",
        "primary": "National Park Service",
        "official_url": park.get("url") or "",
        "nps_park_code": code,
        "lat": as_float(park.get("latitude")),
        "lng": as_float(park.get("longitude")),
        "sources": [
            {
                "title": park.get("fullName") or title,
                "publisher": "National Park Service",
                "url": park.get("url") or "",
                "kind": "official",
            }
        ],
        "photos": [
            {
                "url": photo.get("url"),
                "caption": photo.get("caption") or photo.get("title") or "",
                "credit": photo.get("credit") or "National Park Service",
            }
            for photo in (park.get("images") or [])[:6]
            if photo.get("url")
        ],
        "activities": [item.get("name") for item in (park.get("activities") or [])[:10] if item.get("name")],
        "topics": [item.get("name") for item in (park.get("topics") or [])[:10] if item.get("name")],
        "things_to_do": [compact_nps_item(item, "todo") for item in things_to_do],
        "things_to_see": [compact_nps_item(item, "place") for item in things_to_see],
        "visitor_centers": [compact_nps_item(item, "visitor_center") for item in visitor_centers],
        "campgrounds": [compact_nps_item(item, "campground") for item in campgrounds],
        "fees": fees[:4],
        "operating_hours": hours,
        "alerts": [
            {
                "title": alert.get("title") or "Park alert",
                "category": alert.get("category") or "",
                "url": alert.get("url") or "",
            }
            for alert in alerts[:5]
        ],
        "source_note": "Official NPS source pack with live park details captured at catalog build time.",
        "extract": park.get("description") or "",
    }


def compact_nps_item(item: dict, kind: str) -> dict:
    image = next((photo for photo in item.get("images", []) if photo.get("url")), {})
    title = item.get("title") or item.get("name") or ""
    description = (
        item.get("shortDescription")
        or item.get("listingDescription")
        or item.get("description")
        or item.get("locationDescription")
        or ""
    )
    return {
        "kind": kind,
        "title": title,
        "description": sentence(description, title),
        "url": item.get("url") or "",
        "lat": as_float(item.get("latitude")),
        "lng": as_float(item.get("longitude")),
        "image_url": image.get("url") or "",
        "image_caption": image.get("caption") or image.get("title") or "",
        "image_credit": image.get("credit") or "National Park Service",
    }


def choose_image(summary: dict, source_pack: dict) -> tuple[str, str, str]:
    photo = next((item for item in source_pack.get("photos") or [] if item.get("url")), {})
    url = photo.get("url") or summary.get("image_url") or summary.get("thumbnail_url") or ""
    credit = photo.get("credit") or "Wikimedia Commons"
    license_name = source_pack.get("license") or ("Official/public source" if source_pack.get("quality") == "official" else "Wikimedia Commons")
    return url, credit, license_name


def provider_photo_query(entry: dict, base_title: str) -> str:
    title = str(entry.get("title") or base_title)
    group = str(entry.get("explore_group") or "")
    suffix = {
        "camping": "camping landscape",
        "glamping": "glamping cabin outdoor",
        "huts_lodging": "lodge cabin mountains",
        "trails": "hiking trail landscape",
    }.get(group, "outdoor landscape")
    return f"{title} {base_title} {suffix}"


def fetch_pexels_photo(client: httpx.Client, query: str) -> dict:
    api_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not api_key:
        return {}
    try:
        res = client.get(
            "https://api.pexels.com/v1/search",
            params={"query": query, "per_page": 5, "orientation": "landscape", "size": "large"},
            headers={"Authorization": api_key, "User-Agent": "Trailhead/1.0 explore catalog builder"},
            timeout=10,
        )
        if res.status_code in {401, 403, 429}:
            return {}
        res.raise_for_status()
        photos = res.json().get("photos") or []
    except Exception:
        return {}
    for photo in photos:
        src = photo.get("src") or {}
        url = src.get("large2x") or src.get("large") or src.get("original") or ""
        if url:
            photographer = photo.get("photographer") or "Pexels photographer"
            return {
                "url": url,
                "caption": photo.get("alt") or query,
                "credit": f"Pexels / {photographer}",
                "source_url": photo.get("url") or "https://www.pexels.com/",
                "license": "Pexels License",
            }
    return {}


def fetch_pixabay_photo(client: httpx.Client, query: str) -> dict:
    api_key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not api_key:
        return {}
    try:
        res = client.get(
            "https://pixabay.com/api/",
            params={
                "key": api_key,
                "q": query[:100],
                "image_type": "photo",
                "orientation": "horizontal",
                "safesearch": "true",
                "per_page": 5,
            },
            headers={"User-Agent": "Trailhead/1.0 explore catalog builder"},
            timeout=10,
        )
        if res.status_code in {401, 403, 429}:
            return {}
        res.raise_for_status()
        hits = res.json().get("hits") or []
    except Exception:
        return {}
    for hit in hits:
        url = hit.get("largeImageURL") or hit.get("webformatURL") or ""
        if url:
            user = hit.get("user") or "Pixabay contributor"
            return {
                "url": url,
                "caption": hit.get("tags") or query,
                "credit": f"Pixabay / {user}",
                "source_url": hit.get("pageURL") or "https://pixabay.com/",
                "license": "Pixabay Content License",
            }
    return {}


def fetch_provider_photo(client: httpx.Client, query: str) -> dict:
    for fetcher in (fetch_pexels_photo, fetch_pixabay_photo):
        photo = fetcher(client, query)
        if photo.get("url"):
            return photo
    return {}


def download_image(client: httpx.Client, url: str, out_dir: Path, place_id: str) -> str:
    if not url or not re.match(r"^https?://", url):
        return ""
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    prefix = slug(place_id)
    ext = Path(url.split("?", 1)[0]).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        ext = ".jpg"
    filename = f"{prefix}-{digest}{ext}"
    out_path = out_dir / filename
    if out_path.exists() and out_path.stat().st_size > 1000:
        return f"/assets/explore/{filename}"
    fallback_asset = next((path for path in sorted(out_dir.glob(f"{prefix}-*")) if path.is_file() and path.stat().st_size > 1000), None)
    try:
        res = client.get(url, headers={"User-Agent": "Trailhead/1.0 explore catalog builder"}, timeout=10)
        if res.status_code == 429:
            return f"/assets/explore/{fallback_asset.name}" if fallback_asset else ""
        res.raise_for_status()
    except httpx.HTTPError:
        return f"/assets/explore/{fallback_asset.name}" if fallback_asset else ""
    content_type = res.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        return f"/assets/explore/{fallback_asset.name}" if fallback_asset else ""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(res.content)
    return f"/assets/explore/{filename}"


def build_seed_place(entry: dict, data: dict, source_pack: dict, download_asset: str = "") -> dict:
    title = entry["title"]
    base_title = data.get("title") or entry.get("base_title") or title
    state = entry.get("state") or ""
    group_key = entry.get("explore_group") or ""
    group = GROUP_COPY.get(group_key, GROUP_COPY["camping"])
    coords = (data.get("coordinates") or [{}])[0]
    lat = entry.get("lat", coords.get("lat"))
    lng = entry.get("lng", coords.get("lon"))
    if lat in (None, ""):
        lat = source_pack.get("lat")
    if lng in (None, ""):
        lng = source_pack.get("lng")
    extract = data.get("extract") or source_pack.get("extract") or ""
    profile = profile_from_seed(entry, base_title, extract)
    place_id = f"explore:{group_key}:{slug(title)}"
    image_url, image_credit, image_license = choose_image({}, source_pack)
    if download_asset:
        image_url = download_asset
        source_pack["image_asset"] = download_asset
    source_url = entry.get("source_url") or source_pack.get("official_url") or data.get("fullurl") or ""
    summary = {
        "id": place_id,
        "title": title,
        "category": group["category"],
        "explore_group": group_key,
        "state": state,
        "region": state,
        "lat": lat,
        "lng": lng,
        "rank": entry["rank"],
        "hero_rank": entry.get("hero_rank") or entry["rank"],
        "tags": sorted(set(group["tags"] + list(entry.get("tags") or []))),
        "badges": entry.get("badges") or [entry.get("group_label") or group["category"]],
        "hook": profile["hook"],
        "short_description": profile["summary"],
        "thumbnail_url": image_url or (data.get("thumbnail") or {}).get("source"),
        "image_url": image_url,
        "image_credit": image_credit,
        "image_license": image_license,
        "source_url": source_url,
        "source_title": entry.get("source_title") or source_pack.get("primary") or "Source",
    }
    source_pack = source_pack_from_seed(entry, source_pack, summary, extract)
    return {
        "id": place_id,
        "summary": summary,
        "profile": profile,
        "audio_script": audio_script(title, profile),
        "wiki_extract": extract,
        "source_pack": source_pack,
        "facts": {
            "coordinates": f"{lat:.5f}, {lng:.5f}" if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) else "",
            "source_url": summary["source_url"],
            "source_title": summary["source_title"],
            "official_url": source_pack.get("official_url") or "",
            "source_quality": source_pack.get("quality") or "curated",
            "last_updated": int(time.time()),
        },
        "attribution": (
            f"Curated from {summary['source_title']} with photo credit: {image_credit}."
            if image_credit else f"Curated from {summary['source_title']}."
        ),
    }


def validate_catalog(places: list[dict]) -> None:
    group_counts: dict[str, int] = {}
    missing = []
    for place in places:
        summary = place.get("summary") or {}
        group = summary.get("explore_group")
        group_counts[group] = group_counts.get(group, 0) + 1
        required = ["title", "category", "explore_group", "state", "lat", "lng", "image_url", "source_url"]
        empty = [key for key in required if summary.get(key) in (None, "")]
        if not summary.get("image_credit"):
            empty.append("image_credit")
        if empty:
            missing.append(f"{summary.get('title') or place.get('id')}: {', '.join(empty)}")
    for group in ("camping", "glamping", "huts_lodging", "trails"):
        if group_counts.get(group, 0) < 24:
            raise RuntimeError(f"expected at least 24 {group} entries, found {group_counts.get(group, 0)}")
    if missing:
        raise RuntimeError("catalog validation failed:\n" + "\n".join(missing[:40]))


def as_float(value) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def chunks(items: list, size: int):
    for idx in range(0, len(items), size):
        yield items[idx:idx + size]


def fetch_pages(client: httpx.Client, titles: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for batch in chunks(titles, 40):
        for attempt in range(4):
            res = client.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "format": "json",
                    "redirects": 1,
                    "titles": "|".join(batch),
                    "prop": "extracts|pageimages|coordinates|info",
                    "exintro": 1,
                    "explaintext": 1,
                    "exsentences": 10,
                    "inprop": "url",
                    "piprop": "thumbnail|original",
                    "pithumbsize": 900,
                },
                headers={"User-Agent": "Trailhead/1.0 explore catalog builder"},
            )
            if res.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            res.raise_for_status()
            pages = res.json().get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title")
                if title:
                    out[title] = page
            time.sleep(0.35)
            break
    return out


def fetch_page(client: httpx.Client, title: str) -> dict | None:
    pages = fetch_pages(client, [title])
    return pages.get(title) or next(iter(pages.values()), None)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="dashboard/explore_catalog_v1.json")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--seed", default=str(DEFAULT_SEED))
    parser.add_argument("--download-images", action="store_true")
    parser.add_argument("--asset-dir", default=str(DEFAULT_ASSET_DIR))
    args = parser.parse_args()
    nps_api_key = os.environ.get("NPS_API_KEY", "").strip()

    seed_path = Path(args.seed)
    places = []
    existing_index = load_existing_index(Path(args.out))
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        if seed_path.exists():
            seed, seed_entries = load_seed(seed_path)
            if args.limit:
                seed_entries = seed_entries[:args.limit]
            base_image_assets = build_existing_base_asset_map(seed_entries, existing_index)
            base_titles = sorted({entry.get("base_title") or entry["title"] for entry in seed_entries})
            pages = fetch_pages(client, base_titles)
            asset_dir = Path(args.asset_dir)
            for entry in seed_entries:
                base_title = entry.get("base_title") or entry["title"]
                data = pages.get(base_title)
                if not data:
                    data = next((page for key, page in pages.items() if key.lower() == base_title.lower()), None)
                if not data:
                    data = fetch_page(client, base_title) or {}
                if data and not data.get("extract"):
                    data = fetch_page(client, base_title) or data
                extract = data.get("extract") or ""
                base_summary = {
                    "title": data.get("title") or base_title,
                    "image_url": (data.get("original") or data.get("thumbnail") or {}).get("source"),
                    "thumbnail_url": (data.get("thumbnail") or {}).get("source"),
                    "source_url": data.get("fullurl") or f"https://en.wikipedia.org/?curid={data.get('pageid')}" if data.get("pageid") else entry.get("source_url") or "",
                    "tags": entry.get("tags") or [],
                }
                source_pack = source_pack_from_wiki(base_summary, extract)
                nps_pack = fetch_nps_pack(client, base_title, nps_api_key)
                if nps_pack:
                    source_pack = {
                        **source_pack,
                        **nps_pack,
                        "sources": nps_pack["sources"] + source_pack["sources"],
                        "photos": nps_pack["photos"] or source_pack["photos"],
                        "extract": nps_pack.get("extract") or source_pack["extract"],
                    }
                data, source_pack = apply_existing_fallback(data, source_pack, existing_index.get(base_title.lower()))
                data, source_pack = apply_base_fallback(data, source_pack, base_title)
                image_url, _credit, _license = choose_image(base_summary, source_pack)
                image_asset = ""
                if args.download_images and image_url:
                    image_asset = download_image(client, image_url, asset_dir, f"{entry.get('explore_group')} {entry['title']}")
                if args.download_images and not image_asset:
                    provider_photo = fetch_provider_photo(client, provider_photo_query(entry, base_title))
                    if provider_photo.get("url"):
                        provider_asset = download_image(client, provider_photo["url"], asset_dir, f"{entry.get('explore_group')} {entry['title']}")
                        if provider_asset:
                            image_asset = provider_asset
                            source_pack = {
                                **source_pack,
                                "photos": [provider_photo] + list(source_pack.get("photos") or []),
                                "license": provider_photo.get("license") or source_pack.get("license") or "",
                                "sources": [{
                                    "title": provider_photo.get("caption") or entry["title"],
                                    "publisher": provider_photo.get("credit") or "Image provider",
                                    "url": provider_photo.get("source_url") or provider_photo.get("url") or "",
                                    "kind": "image",
                                }] + list(source_pack.get("sources") or []),
                            }
                if not image_asset:
                    related_base = RELATED_IMAGE_BASE.get(base_title, "")
                    image_asset = base_image_assets.get(base_title) or (base_image_assets.get(related_base) if related_base else "")
                places.append(build_seed_place(entry, data, source_pack, image_asset))
                if image_asset and str(image_asset).startswith("/assets/explore/"):
                    base_image_assets.setdefault(base_title, image_asset)
            validate_catalog(places)
            payload = {
                "schema_version": 2,
                "catalog_id": seed.get("catalog_id") or "explore-us-outdoor-seed-v2",
                "name": seed.get("name") or "Trailhead Explore",
                "generated_at": int(time.time()),
                "source": "Curated official, public, Wikimedia, and reviewed external Explore sources",
                "future_pack_compatible": True,
                "places": places,
            }
        else:
            titles = DEFAULT_TITLES[: args.limit] if args.limit else DEFAULT_TITLES
            pages = fetch_pages(client, [title for title, _category, _state, _tags in titles])
            for rank, (title, category, state, tags) in enumerate(titles, start=1):
                data = pages.get(title)
                if not data:
                    data = next((page for key, page in pages.items() if key.lower() == title.lower()), None)
                if not data:
                    continue
                if not data.get("extract"):
                    data = fetch_page(client, title) or data
                coords = (data.get("coordinates") or [{}])[0]
                lat = coords.get("lat")
                lng = coords.get("lon")
                extract = data.get("extract") or ""
                display_title = data.get("title") or title
                profile = profile_from_summary(display_title, category, extract, state)
                place_id = f"wiki:{data.get('pageid') or slug(display_title)}"
                summary = {
                    "id": place_id,
                    "title": display_title,
                    "category": category,
                    "state": state,
                    "region": state,
                    "lat": lat,
                    "lng": lng,
                    "rank": rank,
                    "tags": tags,
                    "hook": profile["hook"],
                    "short_description": sentence(extract, profile["hook"]),
                    "thumbnail_url": (data.get("thumbnail") or {}).get("source"),
                    "image_url": (data.get("original") or data.get("thumbnail") or {}).get("source"),
                    "source_url": data.get("fullurl") or f"https://en.wikipedia.org/?curid={data.get('pageid')}",
                    "source_title": "Wikipedia",
                }
                source_pack = source_pack_from_wiki(summary, extract)
                nps_pack = fetch_nps_pack(client, title, nps_api_key)
                if nps_pack:
                    source_pack = {
                        **source_pack,
                        **nps_pack,
                        "sources": nps_pack["sources"] + source_pack["sources"],
                        "photos": nps_pack["photos"] or source_pack["photos"],
                        "extract": nps_pack.get("extract") or source_pack["extract"],
                    }
                    if source_pack["photos"]:
                        summary["image_url"] = source_pack["photos"][0]["url"]
                        summary["thumbnail_url"] = summary["thumbnail_url"] or source_pack["photos"][0]["url"]
                places.append({
                    "id": place_id,
                    "summary": summary,
                    "profile": profile,
                    "audio_script": audio_script(display_title, profile),
                    "wiki_extract": extract,
                    "source_pack": source_pack,
                    "facts": {
                        "coordinates": f"{lat:.5f}, {lng:.5f}" if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) else "",
                        "source_url": summary["source_url"],
                        "source_title": "Wikipedia",
                        "official_url": source_pack.get("official_url") or "",
                        "source_quality": source_pack.get("quality") or "wiki",
                        "last_updated": int(time.time()),
                    },
                    "attribution": (
                        "Official NPS details plus Wikipedia/Wikimedia context, summarized for Trailhead."
                        if source_pack.get("quality") == "official"
                        else "Text and images sourced from Wikipedia/Wikimedia, summarized for Trailhead."
                    ),
                })
            payload = {
                "schema_version": 1,
                "catalog_id": "explore-us-top-v1",
                "name": "Trailhead Featured Explore",
                "generated_at": int(time.time()),
                "source": "Wikipedia/Wikimedia + Trailhead generated profiles",
                "future_pack_compatible": True,
                "places": places,
            }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {len(places)} places to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
