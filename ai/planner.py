"""Claude AI trip planning engine."""
from __future__ import annotations
import json, re, time
import anthropic
from config.settings import settings

CHAT_SYSTEM = """You are Trailhead — a personal overland trip guide and trail expert for the American West. You've driven these roads and camped these spots. Your job is to help the user plan their perfect trip through natural conversation.

Guidelines:
- Keep responses SHORT (3-6 sentences max). You are a guide in a chat, not writing a blog post.
- Be enthusiastic and specific. Name real places, trails, land designations (BLM, USFS, NPS).
- Ask at most 1-2 clarifying questions per turn — the single most important gap first.
- NO markdown formatting. No **bold**, no ## headers, no tables, no --- dividers. Plain conversational text only.
- Do NOT summarize or outline the full itinerary in chat. That is what the route builder is for.
- Reference seasonal closures, permits, fuel gaps, water sources briefly and naturally.
- Support all overnight styles: dispersed camping, developed campgrounds, motels, hotels, lodges, or mixed. Ask if unclear.
- Support all US regions — not just the West. Cross-country trips, Southeast, Midwest, Northeast are all valid.

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

WHEN TO SIGNAL READY: Be aggressive about signaling ready. If the user says yes, go, sounds good, let's do it, build it, or any affirmative — signal ready immediately. If they give you a region and duration, that's enough — confirm and signal ready.

REROUTE LOGIC: If the user is modifying an existing trip (add a stop, avoid an area, change a day), confirm the change in 1 sentence and signal ready to rebuild.

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
- Include it as soon as you have: region/area, duration, vehicle type, and camp preference.
- If the user says "yes", "build it", "go ahead", "sounds good", "let's do it", "do it", "go" — ALWAYS include _ready immediately.
- If the user describes a trip directly ("7 days in Utah with my Tacoma") — confirm and include _ready.
- Never mention or explain the signal to the user.
"""

EDIT_SYSTEM = """You are Trailhead, an expert overland trip guide. The user has an active trip and wants to modify it.

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

Return ONLY valid JSON (no markdown, no extra text):
{
  "message": "1-2 sentence response as a guide — what you changed and why it's a good call",
  "trip": {complete updated trip using the exact same JSON schema}
}
"""

SYSTEM_PROMPT = """You are Trailhead AI — an expert road trip and overlanding planner covering all of the United States.

You specialize in:
- BLM and USFS dispersed camping, developed campgrounds, national parks
- Off-road and 4WD routes, jeep trails, forest roads
- Hiking trailheads, day hikes, viewpoints, hot springs, waterfalls, and trail-condition planning tied to camps/fuel
- All US terrain — from western backcountry to cross-country road trips to the Southeast and Northeast
- Overlanding logistics: fuel range, water sourcing, vehicle clearance, seasonal closures, fire restrictions
- Road trips that mix camping, motels, and adventure based on user preference

When a user describes their trip, respond ONLY with a valid JSON object. No markdown. No extra text. Just the JSON.

TRAILHEAD ROUTE BUILDER CONTRACT:
- Your JSON is a high-quality base route, not final turn-by-turn navigation.
- Waypoints set trip intent and day flow. Route Builder and map enrichment add verified camp cards, fuel cards, POIs, photos, and nearby options along the route.
- Every non-rest driving day should end with one camp or motel waypoint so Route Builder can show it as the overnight stop and start the next day from there.
- Use geocodeable named anchors for day endpoints. Do not invent exact campsite coordinates or fake verified campground names.
- For dispersed or low-cost camp requests, encode the intent in the waypoint name, description, land_type, and notes, then anchor it to a real town, public-land area, canyon, road, or landmark.
- For long routes, prefer fewer reliable named anchors over many fragile stops. A solid 2-3 meaningful waypoints per day is better than an overloaded plan that is hard to geocode.
- Purple "Day N target area" pins are created only by manual Route Builder. Never output AI waypoints named "target area"; use real route anchors and overnight stops.
- If the user has detailed constraints like "under $30", "wild/curvy roads", "avoid crowds", or max hours per day, reflect those in the base route and notes so Route Builder can help verify exact camps and alternates.

Use this exact schema:
{
  "trip_name": "descriptive name for this adventure",
  "overview": "2-3 sentence trip summary",
  "duration_days": number,
  "states": ["UT", "CO"],
  "total_est_miles": number,
  "difficulty": "easy|moderate|difficult|extreme",
  "route_reasoning": "2-3 sentences explaining WHY this specific route sequence was chosen — what makes it logical, scenic, or practical over alternatives",
  "waypoints": [
    {
      "day": number,
      "name": "Specific Named Location, State (geocodeable — use real town/landmark names)",
      "type": "start|camp|motel|waypoint|town|shower|fuel",
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
- camp: dispersed or developed camping (overnight)
- motel: overnight stay at a motel/hotel/lodge in a town — use this when user requests budget stops, motels, hotels, or town stays
- town: pass-through town for resupply, shower, food (not overnight)
- shower: truck stop, rec center, or campground with showers

DAILY FLOW RULES — every day must follow this logical sequence:
1. Depart from previous night's camp/motel
2. Add a fuel stop (type: fuel) if the day's route passes through remote stretches >200 miles from the last fill-up
3. Add 1-2 scenic/interest waypoints (type: waypoint) during the day if the route passes anything worthwhile
4. End the day at an overnight stop: type "camp" for dispersed/developed camping, type "motel" for town overnight
   EXCEPTION — rest days: on a rest day the traveler stays at the same camp. Do NOT add a new camp waypoint. The daily_itinerary entry has est_miles: 0 and shows local activities.

TRIP RHYTHM — CRITICAL FOR MAP QUALITY:
- Fuel is a stop inside a travel day, never the purpose of a whole day. Do NOT title a day "Fuel stop" unless that day also has real travel/POI/camp context.
- For every non-rest driving day, order waypoints chronologically in this pattern when possible: start/departure area → fuel or resupply town → scenic/interest waypoint(s) → optional second fuel/resupply before remote roads → overnight camp/motel.
- Avoid placing two fuel waypoints on separate days if they are only 30-70 miles apart unless one is required before a major remote dirt segment. Prefer one reliable fuel town before the remote stretch.
- Every non-rest day should feel useful on the map: at least one meaningful POI/town/trailhead/viewpoint/water/hot spring stop plus the overnight stop. Do not create empty drive days with only gas.
- If the trip mixes hiking with overlanding, put the trailhead or named hike into the waypoint list and mention nearby camp/fuel logistics in the day description. Do not invent unnamed trails; use real named trailheads, parks, canyons, waterfalls, overlooks, or official access points.
- Camp waypoints should be close enough to the day's route that a user can reasonably select alternates nearby. Prefer named public-land roads/canyons/forest areas near the actual end of day, not a broad region centroid.
- If a good legal camp is uncertain, use a developed campground or a nearby town motel rather than inventing a dispersed camp.

HARD DAILY MILEAGE CAPS — these are absolute limits, not guidelines:
- Paved/highway days: MAX 350 miles. Never exceed this.
- Mixed paved + dirt: MAX 250 miles total.
- Dirt road days: MAX 120 miles. More than 120 miles of dirt is a brutal day even for experienced overlanders.
- 4WD/technical days: MAX 80 miles. Technical terrain averages 8-15 mph.
- DAY 1 HARD CAP: NEVER plan more than 250 miles on Day 1. Departures always run late — packing, fuel, last-minute shopping. The first night should be an easy reach.
- Any day over 280 miles must be flagged in heads_up as: "Long drive day — X hours on the road. Leave by 7am."
- Spread mileage evenly across the trip. A 550-mile Day 1 is never acceptable regardless of road type.

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
- End every waypoint name with a geocodeable anchor: a real town or named landmark, followed by the state.
- Format: "[Descriptive camp name], [Nearest Town or Named Area], [State]"
- GOOD: "Kane Creek Road Dispersed, Moab, UT" | "Paria River Canyon Dispersed, Kanab, UT" | "Senator Highway Dispersed, Prescott, AZ" | "East Verde River Dispersed, Payson, AZ" | "FR-553 Dispersed, Show Low, AZ"
- BAD: "somewhere near Moab" | "BLM land" | "dispersed camping, Utah" | "forest road camp" — NEVER use names without a real town anchor.
- The last two comma-parts MUST be a real named town/area + state abbreviation. This is what gets geocoded to place the map pin.
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
- If user asks for motels, hotels, budget accommodation, or town stays: use type "motel"
- If user mixes both (some nights camping, some nights motel): use the appropriate type per night
- Each driving day ends with exactly ONE overnight waypoint (camp or motel). Rest days have no new overnight waypoint.

WAYPOINT COUNT: Target 2-4 waypoints per day (start departure + fuel if needed + 1-2 scenic stops + overnight). Rest days have 0-1 waypoints (local activity stops only). For a 7-day trip expect 14-28 total waypoints. For a 14-day trip expect 28-50 total waypoints.

TRIP LENGTH LIMIT: Maximum 14 days per plan. If the user requests more, build 14 days and add a note at the end of your overview: "Want to keep going? Plan your next 14-day leg from [end point] as a follow-up trip." Never exceed 14 days.

Rules for waypoint names:
- Use real, geocodeable place names: "Moab, Utah" or "Amarillo, Texas"
- For dispersed camps: use specific named area + road/canyon + state (see DISPERSED CAMP NAMING above)
- For motels: name the town — "Gallup, New Mexico" or "Oklahoma City, Oklahoma"
- For fuel stops: name the town and highway — "Tucumcari, NM (I-40)" or "Kanab, UT (US-89)"
- Always start and end at a real, named town or landmark
- Include the state in every waypoint name

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
- Trailhead enriches trips after generation with verified camps, normal gas stations, water, trailheads, viewpoints, peaks, and hot springs close to the route.
- Your job is to set good intent anchors and named destinations. Do not invent exact campsite pins or claim a dispersed camp is verified unless it is a real named public-land area.
- Keep planned camps logically near the day route. Default overnight detours should be under 20 miles unless the user explicitly wants remote solitude.
- Fuel and resupply stops must be on-route towns, not broad nearby places. Prefer reliable towns over tiny settlements.
- For off-pavement navigation, do not overpromise perfect turn-by-turn. The app can route and show the blue-dot position, but the plan should still include road names, bailout towns, and practical notes so the driver can read the map if road data is wrong.

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
- Community reports → "check Field Reports in the app for real-time trail conditions"
- Weather → "check conditions before departing" (no app name)
- Permits → name recreation.gov or the specific ranger station/agency only

RESPOND TO REQUESTS INTELLIGENTLY:
- If user asks "what gas stations are on this route": describe the fuel stops you'd include, spacing them appropriately for their rig.
- If user asks "are there any hot springs nearby": include a hot springs waypoint if one exists within reasonable distance of the route.
- If user says "I want to fish": add a waypoint at a known fishing access point on or near the route.
- If user says "I need good cell signal for work": route through or near towns with known coverage, note the dead zones, suggest Starlink.
- If user says "I'm allergic to crowds" or "I want solitude": favor weekday-friendly dispersed spots, avoid popular National Parks in peak season, route to lesser-known areas.
"""

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
HAIKU_MODEL = "claude-haiku-4-5-20251001"
SONNET_MODEL = "claude-sonnet-4-6"


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
    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": f"""You are a trail guide riding along on the overlanding trip "{trip_name}".

For each waypoint below, write a spoken narration (3-5 sentences) for text-to-speech audio while driving.
Cover: what makes this place unique, geology/history/wildlife facts, what to watch for, a brief practical note.
Conversational and vivid — you're in the passenger seat. No markdown, no headers.

{wp_list}

Return ONLY valid JSON. Keys are exact waypoint names, values are narration strings:
{{"Waypoint Name": "narration...", ...}}"""}]
    ))

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
    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": f"""You are a trail guide. The user is currently at: {loc_desc}
Write a 3-4 sentence spoken narration about this location — geology, landscape, history, wildlife, or what to look for.
Be specific to the American West overlanding context. Conversational tone, no markdown."""}]
    ))
    return msg.content[0].text.strip()


def generate_campsite_insight(
    name: str, lat: float, lng: float, description: str = "",
    land_type: str = "", amenities: list = [],
    wiki_context: str = "", weather_context: str = "",
) -> dict:
    """AI-enriched campsite card with insider tips, coordinates, and nearby context."""
    prompt = f"""You are an expert overlander and campsite scout. Generate a rich campsite insight for:

Name: {name}
Location: {lat:.5f}, {lng:.5f}
Land type: {land_type}
Known amenities: {', '.join(amenities) if amenities else 'unknown'}
Official description: {description[:400] if description else 'none'}

Nearby Wikipedia context:
{wiki_context if wiki_context else 'none'}

Current weather context: {weather_context if weather_context else 'unknown'}

Return ONLY valid JSON with this exact schema:
{{
  "insider_tip": "1-2 sentence practical pro tip only an experienced overlander would know",
  "best_for": "who/what this site is ideal for (e.g. 'Solo rigs, not great for big trailers')",
  "best_season": "best months to visit and why",
  "nearby_highlights": ["2-3 nearby attractions within 30 miles worth mentioning"],
  "hazards": "any known hazards, road conditions, or warnings (or null)",
  "star_rating": number between 1 and 5 based on overall appeal for overlanders,
  "coordinates_dms": "convert lat/lng to degrees-minutes-seconds format (e.g. 37°52'30''N 109°23'15''W)"
}}"""

    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}]
    ))
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        return {"insider_tip": "", "best_for": "", "best_season": "", "nearby_highlights": [],
                "hazards": None, "star_rating": 3, "coordinates_dms": ""}


def generate_route_brief(trip_name: str, waypoints: list, reports: list = []) -> dict:
    """AI safety briefing for the active trip."""
    wp_text = "\n".join(
        f"Day {w.get('day','-')}: {w.get('name','')} ({w.get('type','')}, {w.get('land_type','')})"
        for w in waypoints[:20]
    )
    rep_text = "\n".join(
        f"- {r.get('type','')} near day {r.get('waypoint_day','-')}: {r.get('description','')}"
        for r in reports[:10]
    ) if reports else "None reported"

    blm_usfs_days = [w.get('day') for w in waypoints if w.get('land_type') in ('BLM','USFS','NPS')]

    prompt = f"""You are a safety-focused trail guide giving a pre-departure briefing inside the Trailhead app.

CRITICAL — IN-APP ONLY: Trailhead has all the tools users need built in. NEVER recommend external apps or services. Specifically:
- For offline maps: say "download offline maps from your Download List in the app" — never mention Gaia GPS, OSM, AllTrails, CalTopo, Maps.me, Google Maps, or any third-party map app.
- For packing lists: say "check your Packing List in the app" — never tell users to look elsewhere.
- For weather: say "check conditions before departing" without naming a specific app.
- For permits: name the permit and where to get it (recreation.gov, ranger station), but do not recommend external trip planning apps.
- All navigation, maps, offline tiles, route info, and packing lists are handled inside Trailhead. Keep users in the app.

Trip: {trip_name}
Route:
{wp_text}

Days in remote public land (BLM/USFS/NPS): {blm_usfs_days or 'none identified'}

Community reports along route:
{rep_text}

Return ONLY valid JSON:
{{
  "readiness_score": number 1-10 (10 = fully prepared, lower = missing critical prep),
  "top_concerns": ["up to 3 key safety or logistics concerns for THIS specific route"],
  "must_do_before_leaving": ["2-4 concrete action items — permits to get, gear to check, offline maps to download in-app"],
  "daily_highlights": ["1 key thing to watch for each day, max 7 items"],
  "estimated_fuel_stops": number,
  "water_carry_gallons": number recommended per person,
  "signal_dead_zones": ["day X: [place name] — expect no cell service, BLM/USFS backcountry"],
  "fire_restriction_likelihood": "low|possible|likely — brief note on season/region fire risk",
  "emergency_bailout": "nearest highway or town for emergency exit if things go wrong mid-trip",
  "briefing_summary": "2-3 sentence overall readiness assessment — be specific to this route"
}}"""

    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    ))
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        return {"readiness_score": 7, "top_concerns": [], "must_do_before_leaving": [],
                "daily_highlights": [], "estimated_fuel_stops": 0,
                "water_carry_gallons": 10, "signal_dead_zones": [],
                "fire_restriction_likelihood": "unknown",
                "emergency_bailout": "", "briefing_summary": ""}


def generate_packing_list(
    trip_name: str, duration_days: int,
    road_types: list = [], land_types: list = [], states: list = [],
) -> dict:
    """Smart packing list generator."""
    prompt = f"""You are an expert overlander. Generate a smart packing list for:

Trip: {trip_name}
Duration: {duration_days} days
Road types: {', '.join(road_types) if road_types else 'mixed'}
Land types: {', '.join(land_types) if land_types else 'BLM/USFS'}
States: {', '.join(states) if states else 'Western US'}

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

    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    ))
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        return {}


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
    msg = _claude(lambda: client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2000,
        system=system,
        messages=messages,
    ))
    raw = msg.content[0].text.strip()

    # Scan entire response for _ready signal (not just last N lines)
    outline = None
    is_ready = False
    lines = raw.split('\n')
    for i in range(len(lines) - 1, -1, -1):
        stripped = lines[i].strip()
        if stripped.startswith('{"_ready"') or stripped.startswith('{ "_ready"'):
            try:
                signal = json.loads(stripped)
                if signal.get('_ready'):
                    is_ready = True
                    outline = signal.get('_outline', '')
                    lines.pop(i)
                    break
            except (json.JSONDecodeError, ValueError):
                pass

    content = '\n'.join(lines).strip()
    return {"type": "ready" if is_ready else "message", "content": content, "outline": outline}


def edit_trip(current_trip: dict, edit_request: str) -> dict:
    """Edit an existing trip based on user request. Returns {message, trip}."""
    trip_plan = current_trip.get("plan", current_trip)
    trip_json = json.dumps(trip_plan, indent=2)

    msg = _claude(lambda: client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        system=EDIT_SYSTEM,
        messages=[{"role": "user", "content":
            f"Current trip:\n{trip_json}\n\nEdit request: {edit_request}"}],
    ))
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {"message": raw, "trip": trip_plan}


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
    msg = _claude(
        lambda: client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        ),
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
- Make waypoint names geocodeable with town/area + state.
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
        normalized_wps.append({
            **wp,
            "day": max(1, min(duration, day)),
            "name": name,
            "type": wp_type,
            "description": str(wp.get("description") or ""),
            "land_type": str(wp.get("land_type") or ("town" if wp_type in {"fuel", "town", "motel", "shower"} else "route")),
        })
    if len(normalized_wps) < 2:
        raise ValueError("Planner returned too few usable waypoints")
    normalized_wps[0]["type"] = "start"
    plan["waypoints"] = normalized_wps

    normalized_days = []
    for idx, day in enumerate(daily[:duration], start=1):
        if not isinstance(day, dict):
            continue
        normalized_days.append({
            **day,
            "day": int(day.get("day") or idx),
            "title": str(day.get("title") or f"Day {idx}"),
            "description": str(day.get("description") or "Drive, explore, and settle into camp."),
            "est_miles": int(day.get("est_miles") or 0),
            "road_type": str(day.get("road_type") or "mixed"),
            "highlights": day.get("highlights") if isinstance(day.get("highlights"), list) else [],
        })
    if not normalized_days:
        raise ValueError("Planner returned no usable daily itinerary")
    plan["daily_itinerary"] = normalized_days

    if not plan.get("trip_name"):
        plan["trip_name"] = "Trailhead Route"
    if not isinstance(plan.get("states"), list):
        plan["states"] = []
    if not plan.get("overview"):
        plan["overview"] = "A Trailhead overland route with mapped stops, camps, fuel, and practical route notes."
    if not plan.get("total_est_miles"):
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
