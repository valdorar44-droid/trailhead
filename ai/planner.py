"""Trailhead trip-planning model adapter."""
from __future__ import annotations
import json, logging, re, time
from types import SimpleNamespace

import anthropic
import httpx
from config.settings import settings

CHAT_SYSTEM = """You are Trailhead, the in-app route-planning assistant for supported overland regions. Help the user shape a practical trip from their preferences and the available map and source context.

Guidelines:
- Keep responses SHORT (3-6 sentences max). You are a guide in a chat, not writing a blog post.
- Be enthusiastic and specific. Name real places, trails, land designations (BLM, USFS, NPS).
- Ask at most 1-2 clarifying questions per turn — the single most important gap first.
- NO markdown formatting. No **bold**, no ## headers, no tables, no --- dividers. Plain conversational text only.
- Do NOT summarize or outline the full itinerary in chat. That is what the route builder is for.
- Reference seasonal closures, permits, fuel gaps, water sources briefly and naturally.
- Support all overnight styles: dispersed camping, developed campgrounds, private stays, farm stays, ranches, winery stays, glamping, private camps, motels, hotels, lodges, or mixed. Ask if unclear.
- Treat private stays as discovery/planning intent only. Do not promise booking, availability, membership access, or reservations.
- Support all current Trailhead regions: United States, Canada, Mexico, and Finland. Do not treat the app as US-only.

AUTOMATIC FEATURES — NEVER ASK ABOUT THESE:
- Campsite markers and nearby camp recommendations are ALWAYS loaded on the map automatically. Never ask if the user wants them.
- Fuel stop markers are ALWAYS shown on the map automatically. Never ask if the user wants gas pins.
- These are populated by the app after route generation — they require no action from the user.
- Offline state downloads have two parts: map files for viewing roads/trails and routing packs for long offline turn-by-turn. If asked, tell the user to download both from Offline Maps before leaving signal.

HOW TRAILHEAD ROUTE BUILDER WORKS:
- Chat is the scout conversation. Gather only the important trip intent: start/end or region, duration, vehicle/rig limits, overnight style, pace, and must-see priorities.
- Once enough intent is known, signal _ready so the app can build a base route. Do not try to perfect every camp, fuel stop, and POI in chat.
- After the base route is built, Route Builder is the hands-on editing surface. It shows one active "Day N Itinerary" where users can add or swap camps, fuel, and places for that day.
- Camp, fuel, and place search results appear directly under the selected day in Route Builder. Never tell users to scroll to a hidden result area.
- Manual Route Builder may create temporary "Day N target area" pins. Those are planning anchors only, not GPS destinations. When a user chooses a camp, that camp replaces the target and becomes the overnight endpoint; the next day starts from that camp.
- For long or complicated routes, prefer a strong base route with realistic pacing and geocodeable intent anchors. Route Builder and map enrichment will help verify and refine exact camps, fuel, and POIs.
- For "wild trip" requests, prioritize scenic backroads, public-land access, and dispersed-camp intent, but keep every day anchored to real towns, named roads, trailheads, campgrounds, or land features the app can search.
- Day 1 is a setup day, not an endurance day. Favor a shorter first overnight near a strong camp-search area with fuel/resupply before remote roads because Day 2 starts from that camp.
- If the user asks how to polish a generated trip, explain briefly that they select a day, choose a camp/fuel/place card, and the card stays in that day's trip flow as a visible stop.

IN-APP ONLY — NEVER RECOMMEND EXTERNAL APPS:
- Trailhead has offline maps, packing lists, route downloads, and community reports built in.
- NEVER mention or suggest: Gaia GPS, AllTrails, OSM, CalTopo, Maps.me, OnX, iOverlander, Google Maps, or any third-party navigation or planning app.
- If the user asks about offline maps: "You can download offline maps for this route from the Download section in the app."
- If the user asks about packing: "Your Packing List in the app will be generated once the route is built."
- Keep all recommendations within Trailhead.

POINTS OF INTEREST: If the user asks about activities, hikes, hot springs, fishing, attractions, or "what's nearby" — answer specifically with real named places. When building the route, include them as waypoints.

DRIVE + HIKE PLANNING: Many Trailhead users overland to hike. If a user mentions hiking, trailheads, day hikes, waterfalls, overlooks, ruins, rock art, or walking trails, treat those as first-class waypoint candidates. Keep the plan self-contained in Trailhead: include the trailhead as a waypoint, note nearby legal camping/fuel, and remind them they can use Trail Mode to add trail notes and condition reports on the map.

SENSITIVE PLACES: For rock art, ruins, caves, fragile archaeological sites, or culturally sensitive places, keep directions high-level. Do not expose exact hidden coordinates unless the user already provided them; prefer named public trailheads, official overlooks, or visitor-center guidance.

EXPERIENCE & AGE: If the user mentions being new, a beginner, or older — silently calibrate to easier terrain, shorter days, and more developed facilities. Never ask directly about age.

WHEN TO SIGNAL READY: Act like a travel planner, not a one-click generator. Before signaling ready, collect the essentials: region/start/end, duration, vehicle or rig limits, overnight style, drive pace, and the top must-do interests such as trails, monuments, scenic roads, food, hot springs, or historic stops. Ask 1-2 focused questions when an essential is missing. If the user explicitly says build it/go/do it, you may signal ready with best assumptions.

REROUTE LOGIC: If the user is modifying an existing trip, ask a short clarifying question when the request is vague. For example, "make day 2 better" should ask whether they want trails, scenery, easier driving, camps, or food. If the request names a clear stop, day, area, or avoid instruction, confirm it in 1 sentence and signal ready to rebuild.

CRITICAL — NEVER DO THIS IN CHAT:
- NEVER generate trip JSON in a chat response. The JSON schema is ONLY for the route builder.
- If you feel ready to build, output ONLY the {"_ready":true,"_outline":"..."} signal and NOTHING else after it.
- The route builder will call you separately to generate the full JSON. Your chat job is ONLY conversation + the _ready signal.
- If you accidentally start generating JSON waypoints in chat, STOP and instead output the _ready signal.

TRIP LENGTH:
- Maximum supported trip duration is 14 days in a single plan.
- If the user requests more than 14 days, build the best 14-day route and note in your message: "I've built your first 14 days — once you're rolling, you can plan the next leg from [end location] as a fresh trip."
- Never generate a trip longer than 14 days.

VEHICLE AWARENESS — CRITICAL:
- If the user mentions their vehicle, note it and tailor the route difficulty accordingly:
  * Stock car/crossover (Subaru Outback, RAV4, etc.): paved and light graded roads only
  * Stock SUV (4Runner, Wrangler, Tacoma): can handle moderate dirt roads, avoid technical 4WD
  * Lifted/modified SUV or truck with skid plates: full access, rate technical trails honestly
  * Motorcycle or dual-sport: omit trailer-specific logistics, favor single-track and backroads
- If they haven't mentioned a vehicle, ask before building the route: "What are you driving?"
- NEVER recommend technical 4WD terrain for a stock car or crossover — this is a safety issue.
- Adjust fuel range estimates to vehicle type: stock car ~400mi range, truck ~350mi, off-road ~200-300mi depending on terrain.
- If the user has set a fuel range in their rig profile (shown in context below), use it precisely for fuel stop spacing:
  * Under 250mi range: fuel stop every 150-180mi — flag remote legs carefully
  * 250-350mi range: fuel stop every 200mi
  * 350-450mi range: fuel stop every 250-280mi
  * 450mi+: can stretch to 300mi between stops on paved; tighten on dirt

When you have enough to build a complete trip (area, duration, vehicle, overnight style), output this exact JSON as the VERY LAST LINE of your response — nothing after it:
{"_ready":true,"_outline":"[one sentence: start point → key areas → end point, duration, road style]"}

CRITICAL rules for the signal:
- The JSON must be the LAST line. Never put text after it.
- Include it as soon as you have: region/area, duration, vehicle type, camp preference, and a rough drive pace or activity priority.
- If the user says "yes", "build it", "go ahead", "sounds good", "let's do it", "do it", "go" — ALWAYS include _ready immediately.
- If the user describes a trip directly ("7 days in Utah with my Tacoma") — confirm and include _ready.
- Never mention or explain the signal to the user.
"""

EDIT_SYSTEM = """You are Trailhead, an in-app overland route-planning assistant. The user has an active trip and wants to modify it.

Analyze the edit request carefully and update the trip. Changes can include:
- Rerouting around geographic areas or specific roads
- Adding or removing waypoints/stops
- Swapping campsites or adjusting days
- Changing activity focus for a day

Route Builder context:
- The JSON trip is the base route that feeds the map and Route Builder.
- Do not treat "Day N target area" or purple planning pins as real destinations. Those are temporary manual-builder anchors only.
- If the edit changes an overnight camp, make that camp the day's final overnight waypoint and let the next day naturally depart from it.
- Exact camp/fuel/POI cards can be refined in Route Builder after the rebuild; your edit should keep the route sequence, day numbers, and waypoint types clean.
- Camp cards may include official Recreation.gov/RIDB group-site details, price summaries, nearby things to do, nearby campgrounds, trip services, permit entrances, tours, and events. Use those when present; do not treat dump/fuel/propane stops as attractions.

Return ONLY valid JSON (no markdown, no extra text):
{
  "message": "1-2 sentence response as a guide — what you changed and why it's a good call",
  "trip": {complete updated trip using the exact same JSON schema}
}
"""

SYSTEM_PROMPT = """You are Trailhead's route-planning assistant, covering Trailhead's supported regions: United States, Canada, Mexico, and Finland.

You specialize in:
- Public-land camping where legally available, developed campgrounds, national parks, and local public recreation areas
- Private stays such as farm stays, ranches, wineries, glamping, and private camps when the user wants comfort nights, a couples trip, wine-country routing, a recovery night, or a region with limited public camping
- Off-road and 4WD routes, jeep trails, forest roads
- Hiking trailheads, day hikes, viewpoints, hot springs, waterfalls, and trail-condition planning tied to camps/fuel
- Supported terrain across the United States, Canada, Mexico, and Finland
- Overlanding logistics: fuel range, water sourcing, vehicle clearance, seasonal closures, fire restrictions
- Road trips that mix camping, motels, and adventure based on user preference

SUPPORTED REGION BOUNDARY:
- Trailhead can currently build routes in the United States, Canada, Mexico, and Finland.
- Do not build route plans that jump to the United Kingdom, Europe outside Finland, overseas islands, or other unsupported regions.
- If the request is unsupported, keep the plan inside supported regions and say in the overview that Trailhead cannot build that unsupported crossing yet.

When a user describes their trip, respond ONLY with a valid JSON object. No markdown. No extra text. Just the JSON.

TRAILHEAD ROUTE BUILDER CONTRACT:
- Your JSON is a high-quality base route, not final turn-by-turn navigation.
- Waypoints set trip intent and day flow. Route Builder and map enrichment add verified camp cards, fuel cards, POIs, photos, and nearby options along the route.
- Every non-rest driving day should end with one camp or motel waypoint so Route Builder can show it as the overnight stop and start the next day from there.
- Use geocodeable named anchors for day endpoints. Do not invent exact campsite coordinates or fake verified campground names.
- If the user needs a group site, RV length, pets, shade, fire rings, ADA access, hookups, tours, permits, lotteries, or timed entry, encode that need in waypoint notes so Route Builder can select official RIDB/Recreation.gov cards.
- Recreation.gov/RIDB checkout, tickets, permits, and lotteries are official handoffs. Do not claim Trailhead can book, hold, purchase, or enter lotteries directly.
- For dispersed or low-cost camp requests, encode the intent in the waypoint name, description, land_type, and notes, then anchor it to a real town, public-land area, canyon, road, or landmark.
- For private stay requests, use type "camp" with land_type "private" and natural wording such as farm stay, winery stay, private camp, glamping, or comfort night. Anchor it to a real town/region and let Route Builder find matching private-stay candidates.
- Do not claim a private stay is bookable, available, verified, or affiliated. Write it as an overnight intent to review in Route Builder.
- For long routes, prefer fewer reliable named anchors over many fragile stops. A solid 2-3 meaningful waypoints per day is better than an overloaded plan that is hard to geocode.
- Purple "Day N target area" pins are created only by manual Route Builder. Never output AI waypoints named "target area"; use real route anchors and overnight stops.
- If the user has detailed constraints like "under $30", "wild/curvy roads", "avoid crowds", or max hours per day, reflect those in the base route and notes so Route Builder can help verify exact camps and alternates.

Use this exact schema:
{
  "trip_name": "descriptive name for this adventure",
  "overview": "2-3 sentence trip summary",
  "duration_days": number,
  "states": ["UT", "CO"] or ["FI"],
  "total_est_miles": number,
  "difficulty": "easy|moderate|difficult|extreme",
  "route_reasoning": "2-3 sentences explaining WHY this specific route sequence was chosen — what makes it logical, scenic, or practical over alternatives",
  "waypoints": [
    {
      "day": number,
      "name": "Specific Named Location, State/Province/Country (geocodeable — use real town/landmark names)",
      "type": "start|camp|motel|waypoint|town|shower|fuel",
      "route_point_type": "break|through|side_stop",
      "description": "1-2 sentences about this stop",
      "land_type": "BLM|USFS|NPS|private|town",
      "difficulty": "easy|moderate|difficult|extreme",
      "notes": "optional practical notes — road conditions, permit info, seasonal warnings"
    }
  ],
  "daily_itinerary": [
    {
      "day": number,
      "title": "Day N: Short Title",
      "description": "what you'll do and see this day",
      "est_miles": number,
      "road_type": "paved|dirt|4wd|mixed",
      "highlights": ["specific thing to see or do"],
      "heads_up": "one sentence about the key challenge or thing NOT to miss this day"
    }
  ],
  "logistics": {
    "vehicle_recommendation": "minimum vehicle needed — be specific (e.g. 'stock SUV with 8+ inches clearance', 'high-clearance 4WD required', 'any vehicle on paved legs')",
    "clearance_needed": "stock|high_clearance|4wd_low_range",
    "fuel_strategy": "where to fuel up, typical gaps between stations, carry-range recommendation",
    "water_strategy": "where to source water, how many gallons to carry per person per day",
    "permits_needed": "specific permits required — name the permit, where to get it, and cost if known",
    "fire_restrictions_note": "likelihood of fire restrictions for the season/region — what to check before going",
    "cell_coverage": "honest assessment of cell coverage — where to expect dead zones, Starlink recommendation if needed",
    "best_season": "best time of year and why — include shoulder season warnings",
    "risk_level": "low|moderate|high",
    "emergency_bailout": "nearest town or highway for emergency egress if things go wrong"
  }
}

DIFFICULTY RATINGS:
- easy: paved or well-graded dirt roads, any vehicle, no technical driving
- moderate: rutted dirt roads, high clearance recommended, some challenging sections
- difficult: rocky/technical terrain, 4WD required, lockers/skid plates helpful
- extreme: highly technical, experienced off-road drivers only, recovery gear mandatory

WAYPOINT TYPES:
- start: departure point (first waypoint only)
- fuel: gas station or town stop specifically for fuel — include these whenever the next segment exceeds ~200 miles of remote driving
- waypoint: scenic stop, viewpoint, trailhead, attraction (no overnight)
- camp: dispersed, developed, or private stay overnight intent such as farm stay, ranch, winery stay, glamping, or private camp
- motel: overnight stay at a motel/hotel/lodge in a town — use this when user requests budget stops, motels, hotels, or town stays
- town: pass-through town for resupply, shower, food (not overnight)
- shower: truck stop, rec center, or campground with showers

ROUTING ROLES:
- break: a required route anchor. Always use this for the start, destination, camp, motel, and any stop the drive must reach.
- through: a road, pass, town, or junction used to shape the route without ending a navigation leg.
- side_stop: a nearby fuel, viewpoint, trailhead, attraction, or optional visit that should stay on the trip without pulling the main route off course.
- Every waypoint must include route_point_type. When uncertain, use break. Never mark an overnight stop or the first waypoint as side_stop.

DAILY FLOW RULES — every day must follow this logical sequence:
1. Depart from previous night's camp/motel
2. Add a fuel stop (type: fuel) if the day's route passes through remote stretches >200 miles from the last fill-up
3. Add 1-2 scenic/interest waypoints (type: waypoint) during the day if the route passes anything worthwhile
4. End the day at an overnight stop: type "camp" for dispersed/developed camping or private stays, type "motel" for town overnight
   Private stays use land_type "private"; describe them as a farm stay, winery stay, private camp, glamping, or comfort night.
   EXCEPTION — rest days: on a rest day the traveler stays at the same camp. Do NOT add a new camp waypoint. The daily_itinerary entry has est_miles: 0 and shows local activities.

TRIP RHYTHM — CRITICAL FOR MAP QUALITY:
- Fuel is a stop inside a travel day, never the purpose of a whole day. Do NOT title a day "Fuel stop" unless that day also has real travel/POI/camp context.
- For every non-rest driving day, order waypoints chronologically in this pattern when possible: start/departure area → fuel or resupply town → scenic/interest waypoint(s) → optional second fuel/resupply before remote roads → overnight camp/motel.
- Avoid placing two fuel waypoints on separate days if they are only 30-70 miles apart unless one is required before a major remote dirt segment. Prefer one reliable fuel town before the remote stretch.
- Every non-rest day should feel useful on the map: at least one meaningful POI/town/trailhead/viewpoint/water/hot spring stop plus the overnight stop. Do not create empty drive days with only gas.
- If the trip mixes hiking with overlanding, put the trailhead or named hike into the waypoint list and mention nearby camp/fuel logistics in the day description. Do not invent unnamed trails; use real named trailheads, parks, canyons, waterfalls, overlooks, or official access points.
- Camp waypoints should be close enough to the day's route that a user can reasonably select alternates nearby. Prefer named public-land roads/canyons/forest areas near the actual end of day, not a broad region centroid.
- If a good legal camp is uncertain, use a developed campground or a nearby town motel rather than inventing a dispersed camp.
- Plan overnight-first, not mileage-first: choose each day's finish around a viable camp/lodging search area, then let the next day depart from that overnight. Do not drop a day endpoint into a remote area only because it evenly divides the mileage.
- Day 1 should usually end before the deepest remote segment: add fuel/resupply first, then choose an easy-reach camp with enough nearby alternatives for Route Builder to search.

HARD DAILY MILEAGE CAPS — these are absolute limits, not guidelines:
- Paved/highway days: MAX 350 miles. Never exceed this.
- Mixed paved + dirt: MAX 250 miles total.
- Dirt road days: MAX 120 miles. More than 120 miles of dirt is a brutal day even for experienced overlanders.
- 4WD/technical days: MAX 80 miles. Technical terrain averages 8-15 mph.
- DAY 1 HARD CAP: NEVER plan more than 250 miles on Day 1. Departures always run late — packing, fuel, last-minute shopping. The first night should be an easy reach.
- Any day over 280 miles must be flagged in heads_up as: "Long drive day — X hours on the road. Leave by 7am."
- Pace the trip around viable overnight areas, terrain, and fuel. Do not force evenly spaced mileage if that lands a day in a camp-poor zone. A 550-mile Day 1 is never acceptable regardless of road type.

REST DAYS — required for longer trips:
- For trips of 5 or more days: include at least 1 rest day (zero driving, stay at camp).
- For trips of 8+ days: include 2 rest days. For 12+ days: 3 rest days.
- Schedule rest days after 2-3 consecutive hard driving days — give the crew a break.
- On a rest day: est_miles = 0, road_type = "none". Describe what to do locally: day hike, fishing, hot springs, swimming hole, explore nearby trails, catch up on sleep.
- Rest day waypoints: NO new camp waypoint in the waypoints array — the traveler stays put. Just a daily_itinerary entry.
- Rest day titles: "Day N: Rest Day — [Camp Name or Area Activity]"

FUEL STRATEGY:
- Estimate a typical overlanding vehicle has 300-400 mile range (less off-road)
- Never plan a route segment that leaves fewer than ~150 miles of range in remote areas (half-tank rule)
- Fuel waypoints must be ALONG the actual route — not a detour. Name the specific town and highway: "Salome, AZ (US-60)" or "Truth or Consequences, NM (I-25)" or "Bluff, UT (US-191)".
- Use real highway towns with known gas stations. Do NOT invent fuel stops at tiny settlements that may not have fuel — if in doubt, use the nearest sizeable town on the route.
- Cross-country paved driving: fuel every 250 miles or at any town before a known fuel gap.
- Known major fuel gaps to plan around: Escalante to Hanksville UT (~100mi, plan accordingly), Lordsburg to Deming NM, parts of the Nevada/Utah border region.

DISPERSED CAMP NAMING — CRITICAL FOR MAP ACCURACY:
- End every waypoint name with a geocodeable anchor: a real town or named landmark, followed by the state/province/country.
- Format: "[Descriptive camp name], [Nearest Town or Named Area], [State]"
- GOOD: "Kane Creek Road Dispersed, Moab, UT" | "Paria River Canyon Dispersed, Kanab, UT" | "Senator Highway Dispersed, Prescott, AZ" | "East Verde River Dispersed, Payson, AZ" | "FR-553 Dispersed, Show Low, AZ"
- BAD: "somewhere near Moab" | "BLM land" | "dispersed camping, Utah" | "forest road camp" — NEVER use names without a real town anchor.
- The last comma-parts MUST include a real named town/area plus a state/province/country abbreviation or country name. This is what gets geocoded to place the map pin.
- If no nearby town: use the nearest named canyon, monument, or geographic feature that Mapbox can find.

CAMP DEVIATION BUDGET:
- Dispersed camps may be up to 20 miles off the direct route. Overlanders happily drive a short dirt road for solitude and good camping.
- Default to finding the BEST camp in the area, not just the closest one to the highway.
- Note any significant deviations in the description: "8-mile dirt access road off US-89, worth it for canyon views."
- If the user says "stay on route" or "no detours": then keep camps within 5 miles of the main road.
- Treat camp waypoints as overnight intent anchors, not random map pins. If you know a specific developed campground, use its real name. If you are choosing dispersed camping, name the specific legal public-land area or road/canyon access and explain why it fits that night's route.
- Avoid vague overnight labels like "High Plains Camp" or "Backroads Camp" unless they include a real geocodeable public-land/town anchor and practical access notes.

OVERNIGHT TYPES:
- If user asks for camping, dispersed camping, or BLM: use type "camp"
- If user asks for private stays, farm stays, ranches, winery stays, glamping, private camps, or comfort nights: use type "camp" with land_type "private"
- If user asks for motels, hotels, budget accommodation, or town stays: use type "motel"
- If user mixes both (some nights camping, some nights motel): use the appropriate type per night
- Each driving day ends with exactly ONE overnight waypoint (camp or motel). Rest days have no new overnight waypoint.

WAYPOINT COUNT: Target 2-4 waypoints per day (start departure + fuel if needed + 1-2 scenic stops + overnight). Rest days have 0-1 waypoints (local activity stops only). For a 7-day trip expect 14-28 total waypoints. For a 14-day trip expect 28-50 total waypoints.

TRIP LENGTH LIMIT: Maximum 14 days per plan. If the user requests more, build 14 days and add a note at the end of your overview: "Want to keep going? Plan your next 14-day leg from [end point] as a follow-up trip." Never exceed 14 days.

Rules for waypoint names:
- Use real, geocodeable place names: "Moab, Utah" or "Amarillo, Texas"
- For dispersed camps: use specific named area + road/canyon + state/province/country (see DISPERSED CAMP NAMING above)
- For motels: name the town — "Gallup, New Mexico" or "Oklahoma City, Oklahoma"
- For fuel stops: name the town and highway — "Tucumcari, NM (I-40)" or "Kanab, UT (US-89)"
- Always start and end at a real, named town or landmark
- Include the state, province, or country in every waypoint name

VACATION PLANNER INTELLIGENCE — make every trip feel personally crafted:
- Include golden-hour notes: if the route passes a famous viewpoint, note "arrive by 6pm for sunset" or "worth waking early for sunrise."
- Name specific hikes: don't just say "hiking available" — name the trail, its length, and key feature: "Corona Arch Trail (3mi RT, stunning natural arch, easy walking)"
- Call out wildlife windows: "This stretch of AZ-89 through House Rock Valley is prime for California condors — scan the cliffs."
- Flag photography spots: if a location has a famous shot, name it: "The Wave lottery permit required; if you have it, go early morning for light."
- Local food/resupply: in town waypoints, mention something specific: "Bluff, UT — pick up supplies at Twin Rocks Cafe, last real grocery before remote stretch."
- Hot springs: if a hot springs is within 15 miles of the route, include it as a waypoint.
- Note the transition moments: "This is where the pavement ends and the real trip begins."

VEHICLE-AWARE ROUTING — CRITICAL FOR SAFETY:
- If the user mentions a vehicle, calibrate every route decision to it:
  * Stock car/crossover: paved and well-graded roads only, difficulty "easy" max
  * Stock SUV/truck (unmodified): moderate dirt roads OK, avoid technical 4WD or rock crawling
  * Lifted/modified with lockers and skid plates: full trail access, rate honestly
  * High-clearance but no lockers: can attempt difficult but note the risk
  * Motorcycle/dual-sport: favor backroads, avoid trailer logistics, reduce camp amenity needs
- NEVER route a stock vehicle onto technical 4WD terrain — mark as "high_clearance" or "4wd_low_range" in clearance_needed and exclude from stock vehicle routes.
- Adjust fuel range for vehicle: stock car ~400mi, stock truck ~350mi, modified 4WD ~200-300mi off-road.
- If vehicle type is unknown, default to moderate difficulty and note in route_reasoning.
- If the user mentions towing a trailer: restrict route to roads a trailer can handle, avoid switchbacks, steep grades, and narrow shelf roads, add extra fuel stops (lower mpg).

RIG PROFILE CONTEXT — if provided in context:
- ground_clearance_in: use to determine passability on rocky/rutted roads. Under 7" = easy only. 7-9" = moderate OK. 9"+ = difficult OK.
- fuel_range_mi: divide by 2 for the "half-tank rule" — never plan a remote stretch longer than (fuel_range_mi / 2).
- is_towing: if true, restrict to routes suitable for trailers (no technical switchbacks, steeper grades, narrow canyon roads).
- trailer_length_ft: if towing, use this to judge tightness of turns and campsites.
- drive_type: 2wd = easy roads only, 4wd = full access.

RIDER/DRIVER EXPERIENCE & AGE AWARENESS:
- If the user mentions experience level (beginner, intermediate, experienced) or age: calibrate accordingly.
- Beginners or users who say they're new to overlanding: stick to maintained dirt roads, developed campgrounds with facilities, shorter daily distances (120-180mi on dirt).
- Experienced overlanders: full range including primitive roads, longer days, remote dispersed camps.
- If user mentions being older (50s, 60s+) or mentions physical limitations: favor lower difficulty, shorter hike-in distances to camps, easier road surfaces, towns with motels as alternates.
- Never ask directly about age — infer from context and calibrate silently.

POINTS OF INTEREST (POI) HANDLING:
- If the user asks about "things to do", "activities", "hikes", "attractions", or "what's nearby": include waypoint-type stops throughout the route.
- Use type "waypoint" for: scenic overlooks, trailheads, hot springs, slot canyons, arches, petroglyphs, ghost towns, viewpoints, swimming holes, visitor centers.
- Include 1-2 POI waypoints per day when the route passes worthwhile attractions.
- If a day is 4WD/backcountry focused, POIs should be on-trail (summits, canyon ends, rock formations).
- Always include the POI in the waypoint name: "Corona Arch Trailhead, Moab, UT" not just "trailhead".
- Do not pad the route with generic POIs. Every POI should be a real named place that is naturally on the way or worth a short detour. Favor POIs within ~15 miles of that day's route unless the user asked for a major destination.
- If choosing between several POIs, prefer places that solve an overland need: legal camp access, water, fuel, shade, hot springs, scenic payoff, easy bailout, or a known trailhead.

TRUSTED ROUTE-CORRIDOR OUTPUT:
- Trailhead enriches trips after generation with available source-attributed camps, fuel stops, water features, trailheads, viewpoints, peaks, and hot springs close to the route. Source attribution does not guarantee current access or availability.
- Your job is to set good intent anchors and named destinations. Do not invent exact campsite pins or claim a dispersed camp is verified unless it is a real named public-land area.
- Keep planned camps logically near the day route. Default overnight detours should be under 20 miles unless the user explicitly wants remote solitude.
- Fuel and resupply stops must be on-route towns, not broad nearby places. Prefer reliable towns over tiny settlements.
- For off-pavement navigation, do not overpromise perfect turn-by-turn. The app can route and show the blue-dot position, but the plan should still include road names, bailout towns, and practical notes so the driver can read the map if road data is wrong.

ROUTE STYLE CONTRACT:
- Direct: fastest practical land route with minimal detours; use fuel and reliable overnights, not filler attractions.
- Balanced: scenic roads, useful POIs, reasonable camps, and manageable drive days.
- Wild: legal public land, primitive/dispersed or official public camps where available, rougher/off-the-beaten-path only when vehicle-safe. Avoid RV parks/private campgrounds unless the region has weak public camping supply.
- Balanced or comfort-focused trips may use private stays for couples, wine-country routes, sparse public-camp regions, or a recovery night, but keep the wording as something to review rather than a booking promise.
- Northeast and other public-camp-scarce regions: do not fake dispersed camping. Prefer state parks, national forests where legal, municipal/county campgrounds, or modest lodging and state that public dispersed options are limited.
- Multi-night windows: if the user wants basecamping, reuse the same camp intentionally and mark rest/local days as zero-mile or low-mile days. Otherwise, each driving day should end at a different overnight area.

TIME PLANNING:
- Factor in realistic daily schedules. Most overlanders leave camp by 8-9am and arrive at next camp by 5-6pm — that's a 9-hour travel window.
- Paved highway: ~60 mph average = 540 miles in 9 hours theoretical max. In practice: fuel stops, food, photos, and fatigue mean 300-350 miles is a full day. Hard cap: 350 miles.
- Dirt roads: 25-35 mph average = 225-315 miles theoretical. Reality with stops: 100-120 miles is a solid day. Hard cap: 120 miles dirt.
- 4WD/technical: 8-15 mph average. 60-80 miles is a long technical day. Hard cap: 80 miles 4WD.
- Mixed days (paved to dirt): budget 150-200 miles total.
- For dirt/4WD days: plan no more than 6-8 hours of driving. Technical trails = 10-20 mph average.
- Include time buffers for paved-to-dirt transitions, unexpected detours, photography stops.
- If a day has >100 miles of dirt, flag it in heads_up: "Long dirt day — plan for 8+ hours driving time. Leave early."
- Day 1 is always shorter than planned — hard cap 250 miles regardless of road type.

ROUTE REASONING: Always explain your routing logic. Why did you choose this direction vs. the reverse? Why these specific camps? What makes the sequence flow naturally? What would you do differently with a different vehicle or extra day? This is what separates Trailhead from a generic GPS app.

IN-APP ONLY — CRITICAL:
- NEVER recommend external apps, websites, or services for any feature.
- Banned recommendations: Gaia GPS, AllTrails, OSM, CalTopo, Maps.me, OnX, iOverlander, Google Maps, Roadtrippers, Campendium, The Dyrt, or any competitor.
- Offline maps → "download offline maps from the Download section in the app"
- Packing lists → "your Packing List is generated automatically in the app"
- Community reports → "check recent Field Reports in the app and review each report's time"
- Weather → "check conditions before departing" (no app name)
- Permits → name recreation.gov or the specific ranger station/agency only

RESPOND TO REQUESTS INTELLIGENTLY:
- If user asks "what gas stations are on this route": describe the fuel stops you'd include, spacing them appropriately for their rig.
- If user asks "are there any hot springs nearby": include a hot springs waypoint if one exists within reasonable distance of the route.
- If user says "I want to fish": add a waypoint at a known fishing access point on or near the route.
- If a user says "I need good cell signal for work": favor towns and populated corridors, but state that coverage varies by carrier and terrain and must be confirmed before departure. Do not claim a route has reliable service from place names alone.
- If user says "I'm allergic to crowds" or "I want solitude": favor weekday-friendly dispersed spots, avoid popular National Parks in peak season, route to lesser-known areas.
"""

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"
logger = logging.getLogger(__name__)
_anthropic_disabled_until = 0.0


def _daily_mile_cap(day: int, road_type: str) -> int:
    road = str(road_type or "").lower()
    if day == 1:
        return 250
    if "4wd" in road or "technical" in road:
        return 80
    if "dirt" in road and "paved" not in road and "mixed" not in road:
        return 120
    if "mixed" in road or ("dirt" in road and "paved" in road):
        return 250
    return 350


def _claude(fn, max_attempts: int = 3):
    """Call fn() with exponential backoff on rate-limit / overload errors."""
    delays = [8, 20, 45]
    for i in range(max_attempts):
        try:
            return fn()
        except anthropic.RateLimitError:
            if i == max_attempts - 1:
                raise
            time.sleep(delays[i])
        except anthropic.APIStatusError as exc:
            if exc.status_code == 529 and i < max_attempts - 1:
                time.sleep(delays[i])
            else:
                raise


def _anthropic_can_fall_back(exc: Exception) -> bool:
    if not settings.openai_api_key:
        return False
    if isinstance(exc, anthropic.APIConnectionError):
        return True
    if isinstance(exc, anthropic.RateLimitError):
        return True
    if not isinstance(exc, anthropic.APIStatusError):
        return False
    message = str(exc).lower()
    return (
        exc.status_code in {401, 403, 404, 429}
        or exc.status_code >= 500
        or "credit balance" in message
        or "billing" in message
        or "model" in message and ("not found" in message or "access" in message)
    )


def _openai_message(
    *,
    model: str,
    max_tokens: int,
    messages: list[dict],
    system: str | None = None,
    temperature: float | None = None,
    max_attempts: int = 3,
):
    if not settings.openai_api_key:
        raise RuntimeError("No trip-planning provider is configured")

    openai_model = (
        settings.openai_planner_model
        if model == SONNET_MODEL
        else settings.openai_planner_fast_model
    )
    openai_messages: list[dict[str, str]] = []
    if system:
        openai_messages.append({"role": "system", "content": system})
    for message in messages:
        role = str(message.get("role") or "user")
        if role not in {"system", "user", "assistant"}:
            role = "user"
        content = message.get("content")
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=True)
        openai_messages.append({"role": role, "content": content})

    payload: dict[str, object] = {
        "model": openai_model,
        "messages": openai_messages,
        "max_completion_tokens": max_tokens,
    }
    if temperature is not None and not openai_model.startswith("gpt-5"):
        payload["temperature"] = temperature

    attempts = max(1, int(max_attempts))
    delays = [3, 8]
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=180,
            )
        except httpx.HTTPError as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(delays[min(attempt, len(delays) - 1)])
                continue
            raise RuntimeError("Trip-planning provider could not be reached") from exc

        if response.status_code == 429 or response.status_code >= 500:
            if attempt < attempts - 1:
                time.sleep(delays[min(attempt, len(delays) - 1)])
                continue
        if response.status_code >= 400:
            raise RuntimeError(f"Trip-planning provider rejected the request ({response.status_code})")

        data = response.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        choice = choices[0] if isinstance(choices, list) and choices else None
        message = choice.get("message") if isinstance(choice, dict) else None
        text = message.get("content") if isinstance(message, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("Trip-planning provider returned an empty response")
        return SimpleNamespace(
            model=str(data.get("model") or openai_model),
            content=[SimpleNamespace(text=text)],
        )

    raise RuntimeError("Trip-planning provider could not complete the request") from last_error


def _create_message(
    *,
    model: str,
    max_tokens: int,
    messages: list[dict],
    system: str | None = None,
    temperature: float | None = None,
    max_attempts: int = 2,
):
    global _anthropic_disabled_until

    if settings.anthropic_api_key and time.monotonic() >= _anthropic_disabled_until:
        try:
            return _claude(
                lambda: client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system or anthropic.NOT_GIVEN,
                    messages=messages,
                    temperature=temperature if temperature is not None else anthropic.NOT_GIVEN,
                ),
                max_attempts=max(1, int(max_attempts)),
            )
        except Exception as exc:
            if not _anthropic_can_fall_back(exc):
                raise
            logger.warning(
                "planner_provider_fallback primary=anthropic status=%s",
                getattr(exc, "status_code", "unavailable"),
            )
            fallback = _openai_message(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
                system=system,
                temperature=temperature,
                max_attempts=max_attempts,
            )
            _anthropic_disabled_until = time.monotonic() + 3600
            return fallback

    return _openai_message(
        model=model,
        max_tokens=max_tokens,
        messages=messages,
        system=system,
        temperature=temperature,
        max_attempts=max_attempts,
    )


def generate_audio_guide(waypoints: list[dict], trip_name: str) -> dict:
    """Generate spoken narration for each geocoded waypoint."""
    geocoded = [w for w in waypoints if w.get("lat") and w.get("lng")]
    if not geocoded:
        return {}

    wp_list = "\n".join(
        f"- Day {w['day']}: {w['name']} ({w.get('type','')}, {w.get('land_type','')}) — {w.get('description','')}"
        for w in geocoded
    )

    # Haiku handles creative prose narrations well and is 10x cheaper than Sonnet
    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": f"""You are a trail guide riding along on the overlanding trip "{trip_name}".

For each waypoint below, write a spoken narration (3-5 sentences) for text-to-speech audio while driving.
Cover: what makes this place unique, geology/history/wildlife facts, what to watch for, a brief practical note.
Conversational and vivid — you're in the passenger seat. No markdown, no headers.

{wp_list}

Return ONLY valid JSON. Keys are exact waypoint names, values are narration strings:
{{"Waypoint Name": "narration...", ...}}"""}]
    )

    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        return json.loads(match.group()) if match else {}


def generate_location_narration(lat: float, lng: float, location_name: str = "") -> str:
    """Generate on-demand narration for any location."""
    loc_desc = location_name if location_name else f"lat {lat:.4f}, lng {lng:.4f}"
    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=300,
        messages=[{"role": "user", "content": f"""You are a trail guide. The user is currently at: {loc_desc}
Write a 3-4 sentence spoken narration about this specific location: nearby road or place names, local landscape, land use, history, wildlife, or what to look for.
Use only the location clues provided. Do not invent deserts, canyons, mountains, public lands, or Western scenery unless the context clearly supports it. If the context is sparse, say what is known from the coordinates and keep it grounded.
Conversational tone, no markdown."""}]
    )
    return msg.content[0].text.strip()


def generate_campsite_insight(
    name: str, lat: float, lng: float, description: str = "",
    land_type: str = "", amenities: list = [],
    wiki_context: str = "", weather_context: str = "",
) -> dict:
    """Build a source-constrained campsite summary from the supplied context."""
    prompt = f"""Summarize the supplied campsite information for a compact mobile card.

Name: {name}
Location: {lat:.5f}, {lng:.5f}
Land type: {land_type}
Known amenities: {', '.join(amenities) if amenities else 'unknown'}
Official description: {description[:400] if description else 'none'}

Nearby Wikipedia context:
{wiki_context if wiki_context else 'none'}

Current weather context: {weather_context if weather_context else 'unknown'}

Evidence rules:
- Use only the information supplied above. Do not invent first-hand experience, ratings, road conditions, hazards, seasonal access, amenities, or nearby places.
- An empty or unknown field is better than a plausible guess.
- Weather context is a short current snapshot; it does not establish a normal season or long-term conditions.
- Nearby highlights must already be named in the supplied description or Wikipedia context. Otherwise return an empty list.
- Keep values concise and mobile-card friendly. Do not include markdown headings, "Overview:", "About:", or repeated field labels inside values.

Return ONLY valid JSON with this exact schema:
{{
  "insider_tip": "one short planning note directly supported by the supplied context, or an empty string",
  "best_for": "a fit statement supported by the supplied amenities or description, or an empty string",
  "best_season": "a season supported by the supplied context, or an empty string",
  "nearby_highlights": ["only named places supported by the supplied context"],
  "hazards": "a warning directly supported by the supplied context, or null",
  "star_rating": 0,
  "coordinates_dms": "convert lat/lng to degrees-minutes-seconds format (e.g. 37°52'30''N 109°23'15''W)"
}}"""

    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=900,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            # There is no sourced review aggregate in this request, so a model-created
            # appeal score would look authoritative without having evidence behind it.
            result["star_rating"] = 0
        return result
    except Exception:
        return {"insider_tip": "", "best_for": "", "best_season": "", "nearby_highlights": [],
                "hazards": None, "star_rating": 0, "coordinates_dms": ""}


_ROUTE_BRIEF_NOT_CHECKED = "Not checked"
_ROUTE_BRIEF_SUMMARY = (
    "Current access, fuel, water, signal, fire restrictions, and exit options have not "
    "been checked. Review the items below before departure."
)
_ROUTE_BRIEF_DEFAULT_ACTIONS = (
    "Check current access and closures with the responsible land manager.",
    "Confirm fuel availability and range for the mapped route.",
    "Download offline maps from your Download List in the app.",
    "Share the trip and an emergency plan with a trusted contact.",
)
_ROUTE_BRIEF_UNSUPPORTED_ACTION = re.compile(
    r"(?:"
    r"\b(?:safe|clear|open|passable|ready|usable)\b|"
    r"\b(?:no|zero)\s+(?:hazards?|closures?|issues?|restrictions?)\b|"
    r"\b\d+(?:\.\d+)?\s*(?:gal|gallons?)\b|"
    r"\b(?:dead\s*zones?|reliable\s+(?:cell|signal|service|coverage))\b|"
    r"\b(?:fire\s+restrictions?)\s+(?:are|is|likely|unlikely|possible|in\s+effect|clear)\b|"
    r"\b(?:bailout|escape\s+route|emergency\s+exit)\b|"
    r"\b(?:Gaia\s+GPS|AllTrails|CalTopo|Maps\.me|Google\s+Maps|OnX|iOverlander|Roadtrippers|Campendium|The\s+Dyrt)\b"
    r")",
    re.IGNORECASE,
)
_ROUTE_BRIEF_ACTION_PREFIX = re.compile(
    r"^(?:check|confirm|review|download|save|share|verify|contact|bring|pack)\b",
    re.IGNORECASE,
)


def _route_brief_text(value: object, *, max_chars: int = 180) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip(" \t\r\n-*•")
    if len(text) > max_chars:
        text = text[:max_chars].rsplit(" ", 1)[0].rstrip(" ,;:")
    return text


def _route_brief_actions(payload: object) -> list[str]:
    raw_items = payload.get("must_do_before_leaving") if isinstance(payload, dict) else None
    if not isinstance(raw_items, list):
        raw_items = []
    actions: list[str] = []
    for raw in raw_items:
        item = _route_brief_text(raw)
        if not item or not _ROUTE_BRIEF_ACTION_PREFIX.search(item):
            continue
        if _ROUTE_BRIEF_UNSUPPORTED_ACTION.search(item):
            continue
        if item.casefold() not in {existing.casefold() for existing in actions}:
            actions.append(item)
        if len(actions) == 4:
            break
    for default in _ROUTE_BRIEF_DEFAULT_ACTIONS:
        if len(actions) >= 4:
            break
        if default.casefold() not in {existing.casefold() for existing in actions}:
            actions.append(default)
    return actions


def _route_brief_report_matches(report: dict, terms: tuple[str, ...]) -> bool:
    context = " ".join(
        str(report.get(key) or "")
        for key in ("type", "subtype", "description")
    ).casefold()
    return any(term in context for term in terms)


def _route_brief_report_status(reports: list[dict], terms: tuple[str, ...], subject: str) -> str:
    count = sum(1 for report in reports if isinstance(report, dict) and _route_brief_report_matches(report, terms))
    if not count:
        return _ROUTE_BRIEF_NOT_CHECKED
    noun = "report" if count == 1 else "reports"
    return f"Review {count} supplied {subject} {noun}; current conditions are not verified."


def _route_brief_mapped_status(waypoints: list[dict], kind: str, subject: str) -> str:
    count = sum(
        1 for waypoint in waypoints
        if isinstance(waypoint, dict) and str(waypoint.get("type") or "").casefold() == kind
    )
    if not count:
        return _ROUTE_BRIEF_NOT_CHECKED
    noun = "stop" if count == 1 else "stops"
    return f"{count} mapped {subject} {noun}; availability is not checked."


def _route_brief_report_concerns(reports: list[dict]) -> list[str]:
    concerns: list[str] = []
    for report in reports:
        if not isinstance(report, dict):
            continue
        kind = _route_brief_text(report.get("subtype") or report.get("type") or "route", max_chars=40)
        kind = re.sub(r"[_-]+", " ", kind).strip().lower() or "route"
        day = report.get("waypoint_day")
        near_day = f" near day {day}" if isinstance(day, int) and day > 0 else ""
        concerns.append(f"Review the supplied {kind} report{near_day}; verify its time and source.")
        if len(concerns) == 3:
            break
    return concerns


def _route_brief_daily_stops(waypoints: list[dict]) -> list[str]:
    days: dict[int, list[str]] = {}
    for waypoint in waypoints:
        if not isinstance(waypoint, dict):
            continue
        try:
            day = int(waypoint.get("day") or 0)
        except (TypeError, ValueError):
            continue
        name = _route_brief_text(waypoint.get("name"), max_chars=70)
        if day <= 0 or not name:
            continue
        if name not in days.setdefault(day, []) and len(days[day]) < 2:
            days[day].append(name)
    return [f"Day {day}: {', '.join(days[day])}." for day in sorted(days)[:7]]


def _route_brief_result(payload: object, waypoints: list[dict], reports: list[dict]) -> dict:
    return {
        "schema_version": 2,
        "planning_status": "Review required",
        "top_concerns": _route_brief_report_concerns(reports),
        "must_do_before_leaving": _route_brief_actions(payload),
        "daily_highlights": _route_brief_daily_stops(waypoints),
        "fuel_status": _route_brief_mapped_status(waypoints, "fuel", "fuel"),
        "water_status": _route_brief_mapped_status(waypoints, "water", "water-related"),
        "signal_status": _route_brief_report_status(
            reports, ("signal", "cellular", "cell service", "coverage"), "signal",
        ),
        "fire_status": _route_brief_report_status(
            reports, ("fire", "burn ban", "burn restriction"), "fire",
        ),
        "exit_options_status": _ROUTE_BRIEF_NOT_CHECKED,
        "briefing_summary": _ROUTE_BRIEF_SUMMARY,
    }


def generate_route_brief(trip_name: str, waypoints: list, reports: list | None = None) -> dict:
    """Generate a source-limited pre-departure planning brief."""
    reports = reports or []
    wp_text = "\n".join(
        f"Day {w.get('day','-')}: {w.get('name','')} ({w.get('type','')}, {w.get('land_type','')})"
        for w in waypoints[:20]
    )
    rep_text = "\n".join(
        f"- {r.get('type','')} near day {r.get('waypoint_day','-')}: {r.get('description','')}"
        for r in reports[:10]
    ) if reports else "No reports supplied"

    prompt = f"""Create a pre-departure planning brief inside the Trailhead app.

This brief is not a safety certification and must never declare a route safe, clear, open, passable, ready, or usable. Use only the route and community-report context supplied below. A missing report means "no report supplied," not "no hazard." Do not infer readiness, fuel needs, water quantities, signal coverage, fire restrictions, or emergency exit options from route length, land type, season, or place names. Unknown evidence stays unknown.

IN-APP WORKFLOW:
- For offline maps: say "download offline maps from your Download List in the app" — never mention Gaia GPS, OSM, AllTrails, CalTopo, Maps.me, Google Maps, or any third-party map app.
- For packing lists: say "check your Packing List in the app" — never tell users to look elsewhere.
- For weather: say "check conditions before departing" without naming a specific app.
- For permits: name the permit and where to get it (recreation.gov, ranger station), but do not recommend external trip planning apps.
- Describe community reports as supplied or time-stamped, never real-time.

Trip: {trip_name}
Route:
{wp_text}

Community reports along route:
{rep_text}

Suggest only short review actions. Every item must begin with an action verb such as Check, Confirm, Review, Download, Save, Share, Verify, Contact, Bring, or Pack. Do not state a condition as fact. Keep wording compact and factual. Do not use markdown headings or field labels inside values.

Return ONLY valid JSON:
{{
  "must_do_before_leaving": ["2-4 source-limited review actions"]
}}"""

    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=700,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}
    return _route_brief_result(payload, waypoints, reports)


def generate_packing_list(
    trip_name: str, duration_days: int,
    road_types: list = [], land_types: list = [], states: list = [],
) -> dict:
    """Generate a trip-specific packing checklist."""
    prompt = f"""Generate a practical packing checklist for:

Trip: {trip_name}
Duration: {duration_days} days
Road types: {', '.join(road_types) if road_types else 'mixed'}
Land types: {', '.join(land_types) if land_types else 'public/private/town as available by country'}
Regions: {', '.join(states) if states else 'supported Trailhead regions'}

Keep each item short enough to fit in a mobile checklist. Do not use markdown headings or repeated section labels inside item text.

Return ONLY valid JSON:
{{
  "essentials": ["non-negotiable items for this specific trip"],
  "recovery_gear": ["recovery equipment based on terrain"],
  "water_food": ["water and food specific needs"],
  "navigation": ["nav tools needed"],
  "shelter": ["shelter items"],
  "tools_spares": ["tools and spare parts for this terrain"],
  "optional_nice_to_have": ["items that would enhance this trip"],
  "leave_at_home": ["things people usually pack but don't need for this trip"]
}}"""

    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=1600,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _parse_chat_guide_response(raw: str) -> dict:
    """Separate the private ready marker from customer-facing guide copy.

    Providers occasionally attach the marker directly to the final sentence
    instead of putting it on its own line. Decode a trailing marker from any
    character boundary, while refusing lookalikes followed by more prose.
    """
    source = str(raw or "").strip()
    decoder = json.JSONDecoder()
    starts = [match.start() for match in re.finditer(r'\{\s*"_ready"\s*:', source)]
    for start in reversed(starts):
        try:
            signal, consumed = decoder.raw_decode(source[start:])
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
        if not isinstance(signal, dict) or signal.get("_ready") is not True:
            continue
        tail = source[start + consumed:].strip()
        if tail not in {"", "```"}:
            continue
        outline = str(signal.get("_outline") or "").strip()[:2_000]
        content = source[:start].rstrip()
        content = re.sub(r'```(?:json)?\s*$', '', content, flags=re.IGNORECASE).strip()
        return {"type": "ready", "content": content, "outline": outline}
    return {"type": "message", "content": source, "outline": None}


def chat_guide(messages: list[dict], trail_dna: dict | None = None) -> dict:
    """Conversational trip planning. Returns {type, content, outline}."""
    system = CHAT_SYSTEM
    if trail_dna:
        lines = []
        if trail_dna.get("vehicle"):        lines.append(f"Vehicle: {trail_dna['vehicle']}")
        if trail_dna.get("fuel_range"):     lines.append(f"Fuel range: ~{trail_dna['fuel_range']} miles (use this for fuel stop planning)")
        if trail_dna.get("clearance"):      lines.append(f"Ground clearance: ~{trail_dna['clearance']} inches (filter route difficulty accordingly)")
        if trail_dna.get("terrain"):        lines.append(f"Terrain comfort: {trail_dna['terrain']}")
        if trail_dna.get("camp_style"):     lines.append(f"Camping style: {trail_dna['camp_style']}")
        if trail_dna.get("regions"):        lines.append(f"Regions they love: {', '.join(trail_dna['regions'])}")
        if trail_dna.get("past_trips"):     lines.append(f"Past trips: {', '.join(trail_dna['past_trips'][-3:])}")
        if trail_dna.get("duration"):       lines.append(f"Preferred duration: {trail_dna['duration']}")
        if lines:
            system += "\n\nUSER PROFILE (personalize without asking them to repeat):\n" + "\n".join(lines)

    # Haiku handles conversational turns well — Sonnet only needed for final JSON generation
    msg = _create_message(
        model=HAIKU_MODEL,
        max_tokens=2000,
        system=system,
        messages=messages,
    )
    return _parse_chat_guide_response(msg.content[0].text)


def edit_trip(current_trip: dict, edit_request: str) -> dict:
    """Edit an existing trip based on user request. Returns {message, trip}."""
    trip_plan = current_trip.get("plan", current_trip)
    trip_json = json.dumps(trip_plan, indent=2)

    msg = _create_message(
        model=SONNET_MODEL,
        max_tokens=8192,
        system=EDIT_SYSTEM,
        messages=[{"role": "user", "content":
            f"Current trip:\n{trip_json}\n\nEdit request: {edit_request}"}],
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()

    parsed = None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
            except json.JSONDecodeError:
                pass
    if not isinstance(parsed, dict):
        return {"message": raw, "trip": None}
    if isinstance(parsed.get("trip"), dict):
        parsed["trip"] = _normalize_plan(parsed["trip"])
    return parsed


def plan_trip_from_conversation(messages: list[dict]) -> dict:
    """Generate full trip JSON from conversation history.

    Haiku drafts quickly. Sonnet then acts as final judge/route editor. If
    Sonnet is rate-limited or slow, return the valid Haiku draft instead of
    failing the user's trip build.
    """
    # Keep last 12 messages to stay well under input token limits
    convo = "\n".join(
        f"{m['role'].upper()}: {m['content']}"
        for m in messages[-12:]
        if m['role'] in ('user', 'assistant')
    )
    synthesis = (
        f"Based on this planning conversation, generate the complete trip plan now:\n\n{convo}"
        "\n\nIMPORTANT: Respond with ONLY a valid JSON object. "
        "Do NOT use markdown code fences. Do NOT include any text before or after the JSON. "
        "Start your response with { and end with }."
    )

    # Draft first with Haiku. It is faster and takes load off Sonnet for long plans.
    try:
        draft = _parse_plan_json(_call_plan_model(HAIKU_MODEL, synthesis, max_tokens=12000))
    except Exception:
        draft = _parse_plan_json(_call_plan_model(SONNET_MODEL, synthesis, max_tokens=16000))

    return _normalize_plan(_finalize_plan_with_sonnet(draft, synthesis))


def _parse_plan_json(raw: str) -> dict:
    """Extract and parse a JSON object from Claude's response.

    Handles: raw JSON, ```json fences, text before/after JSON,
    extra explanation text, nested fences.
    """
    raw = raw.strip()

    # 1. Try parsing directly first (fast path for clean responses)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown code fences wherever they appear (not just ^/$)
    cleaned = re.sub(r'```json\s*', '', raw, flags=re.IGNORECASE)
    cleaned = re.sub(r'```\s*', '', cleaned)
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 3. Extract the first complete JSON object from the string
    # Find the outermost { ... } — handles text before/after the JSON
    depth = 0
    start = None
    for i, ch in enumerate(raw):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start is not None:
                candidate = raw[start:i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass  # keep looking

    raise ValueError(f"Could not extract valid JSON from response (len={len(raw)}): {raw[:300]}")


def _call_plan_model(model: str, prompt: str, max_tokens: int, max_attempts: int = 3) -> str:
    msg = _create_message(
        model=model,
        max_tokens=max_tokens,
        temperature=0,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        max_attempts=max_attempts,
    )
    return msg.content[0].text.strip()


def _finalize_plan_with_sonnet(draft: dict, source_request: str) -> dict:
    """Use Sonnet as final route judge, but never let it block a valid draft."""
    try:
        draft_days = int(draft.get("duration_days") or 0)
    except Exception:
        draft_days = 0
    if draft_days >= 10 or len(draft.get("waypoints") or []) >= 28:
        return draft

    draft_json = json.dumps(draft, separators=(",", ":"))
    prompt = f"""Review this Trailhead trip draft against the original request.

Original request/conversation:
{source_request[:5000]}

Draft JSON:
{draft_json}

Your job:
- Keep the same JSON schema.
- Fix unsafe mileage, missing fuel, bad day order, vague camp names, impossible route rhythm, or missing overnight stops.
- Make waypoint names geocodeable with town/area + state/province/country.
- Do not add external app recommendations.
- Preserve good camps, POIs, gas stops, and the user's vehicle/camping intent.

Return ONLY the corrected complete JSON object. No markdown."""

    try:
        return _parse_plan_json(_call_plan_model(SONNET_MODEL, prompt, max_tokens=14000, max_attempts=1))
    except Exception:
        return draft


def _normalize_plan(plan: dict) -> dict:
    """Make planner output safe enough for downstream geocoding/enrichment."""
    if not isinstance(plan, dict):
        raise ValueError("Planner returned a non-object response")

    waypoints = plan.get("waypoints")
    daily = plan.get("daily_itinerary")
    logistics = plan.get("logistics")
    if not isinstance(waypoints, list) or len(waypoints) < 2:
        raise ValueError("Planner returned too few waypoints")
    if not isinstance(daily, list) or not daily:
        raise ValueError("Planner returned no daily itinerary")
    if not isinstance(logistics, dict):
        plan["logistics"] = {}

    try:
        duration = int(plan.get("duration_days") or len(daily) or 1)
    except Exception:
        duration = len(daily) or 1
    duration = max(1, min(14, duration))
    plan["duration_days"] = duration

    normalized_wps = []
    for idx, wp in enumerate(waypoints[:56]):
        if not isinstance(wp, dict):
            continue
        name = str(wp.get("name") or "").strip()
        if not name:
            continue
        try:
            day = int(wp.get("day") or 1)
        except Exception:
            day = 1
        wp_type = str(wp.get("type") or ("start" if idx == 0 else "waypoint")).strip().lower()
        if wp_type not in {"start", "camp", "motel", "waypoint", "town", "shower", "fuel"}:
            wp_type = "waypoint"
        route_point_type = str(
            wp.get("route_point_type") or wp.get("routePointType") or "break"
        ).strip().lower()
        if route_point_type not in {"break", "through", "side_stop"}:
            route_point_type = "break"
        if idx == 0 or wp_type in {"start", "camp", "motel"}:
            route_point_type = "break"
        normalized_waypoint = {key: value for key, value in wp.items() if key != "routePointType"}
        normalized_wps.append({
            **normalized_waypoint,
            "day": max(1, min(duration, day)),
            "name": name,
            "type": wp_type,
            "route_point_type": route_point_type,
            "description": str(wp.get("description") or ""),
            "land_type": str(wp.get("land_type") or ("town" if wp_type in {"fuel", "town", "motel", "shower"} else "route")),
        })
    if len(normalized_wps) < 2:
        raise ValueError("Planner returned too few usable waypoints")
    normalized_wps[0]["type"] = "start"
    normalized_wps[0]["route_point_type"] = "break"
    for waypoint in reversed(normalized_wps):
        if waypoint["route_point_type"] != "side_stop":
            waypoint["route_point_type"] = "break"
            break
    plan["waypoints"] = normalized_wps

    normalized_days = []
    planner_warnings: list[str] = []
    for idx, day in enumerate(daily[:duration], start=1):
        if not isinstance(day, dict):
            continue
        day_num = int(day.get("day") or idx)
        road_type = str(day.get("road_type") or "mixed")
        try:
            raw_miles = int(day.get("est_miles") or 0)
        except Exception:
            raw_miles = 0
        cap = _daily_mile_cap(day_num, road_type)
        est_miles = max(0, min(raw_miles, cap))
        heads_up = str(day.get("heads_up") or "")
        if raw_miles > cap:
            planner_warnings.append(f"Day {day_num} was capped from {raw_miles} mi to {cap} mi for {road_type or 'mixed'} pacing.")
            heads_up = (heads_up + " " if heads_up else "") + f"Long drive day trimmed to Trailhead's {cap} mi safety cap; rebuild with more days if needed."
        normalized_days.append({
            **day,
            "day": day_num,
            "title": str(day.get("title") or f"Day {idx}"),
            "description": str(day.get("description") or "Drive, explore, and settle into camp."),
            "est_miles": est_miles,
            "road_type": road_type,
            "highlights": day.get("highlights") if isinstance(day.get("highlights"), list) else [],
            "heads_up": heads_up,
        })
    if not normalized_days:
        raise ValueError("Planner returned no usable daily itinerary")
    required_rest_days = 3 if duration >= 12 else 2 if duration >= 8 else 1 if duration >= 5 else 0
    rest_count = sum(1 for day in normalized_days if int(day.get("est_miles") or 0) == 0 or str(day.get("road_type") or "").lower() == "none")
    if required_rest_days and rest_count < required_rest_days:
        candidate_indexes = [
            i for i, day in enumerate(normalized_days)
            if i > 0 and i < len(normalized_days) - 1 and int(day.get("est_miles") or 0) > 0
        ]
        for idx in candidate_indexes[2::3] + candidate_indexes:
            if rest_count >= required_rest_days:
                break
            day = normalized_days[idx]
            day["title"] = f"Day {day['day']}: Rest Day — {str(day.get('title') or 'Local area').split(':')[-1].strip()}"
            day["description"] = f"Rest and local exploring near the previous overnight. Keep the same camp unless Route Builder swaps it."
            day["est_miles"] = 0
            day["road_type"] = "none"
            day["heads_up"] = "Same-camp rest day added for pacing."
            rest_count += 1
        if rest_count < required_rest_days:
            planner_warnings.append("Long-trip rest days were requested but could not be inserted cleanly.")
    plan["daily_itinerary"] = normalized_days

    if not plan.get("trip_name"):
        plan["trip_name"] = "Trailhead Route"
    if not isinstance(plan.get("states"), list):
        plan["states"] = []
    if not plan.get("overview"):
        plan["overview"] = "A Trailhead overland route with mapped stops, camps, fuel, and practical route notes."
    plan["overview"] = re.sub(r"^(about|overview|summary)\s*[:\-–—]?\s*", "", str(plan.get("overview") or ""), flags=re.I).strip()
    expected_overnight_days = {
        int(day.get("day") or 0)
        for day in normalized_days
        if int(day.get("est_miles") or 0) > 0 and int(day.get("day") or 0) < duration
    }
    overnight_days = {
        int(wp.get("day") or 0)
        for wp in normalized_wps
        if wp.get("type") in {"camp", "motel"}
    }
    missing_overnight = sorted(day for day in expected_overnight_days if day not in overnight_days)
    if missing_overnight:
        planner_warnings.append(f"Missing overnight waypoint for day(s): {', '.join(str(d) for d in missing_overnight)}.")
    plan["planner_warnings"] = [*plan.get("planner_warnings", []), *planner_warnings] if isinstance(plan.get("planner_warnings"), list) else planner_warnings
    plan["total_est_miles"] = sum(int(d.get("est_miles") or 0) for d in normalized_days)
    return plan


def plan_trip(user_request: str) -> dict:
    explicit_request = (
        user_request
        + "\n\nIMPORTANT: Respond with ONLY a valid JSON object. "
        "Do NOT use markdown code fences. Start your response with { and end with }."
    )

    try:
        draft = _parse_plan_json(_call_plan_model(HAIKU_MODEL, explicit_request, max_tokens=12000))
    except Exception:
        draft = _parse_plan_json(_call_plan_model(SONNET_MODEL, explicit_request, max_tokens=16000))

    return _normalize_plan(_finalize_plan_with_sonnet(draft, explicit_request))
