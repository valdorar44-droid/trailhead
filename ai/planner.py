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

POINTS OF INTEREST: If the user asks about activities, hikes, hot springs, fishing, attractions, or "what's nearby" — answer specifically with real named places. When building the route, include them as waypoints.

EXPERIENCE & AGE: If the user mentions being new, a beginner, or older — silently calibrate to easier terrain, shorter days, and more developed facilities. Never ask directly about age.

WHEN TO SIGNAL READY: Be aggressive about signaling ready. If the user says yes, go, sounds good, let's do it, build it, or any affirmative — signal ready immediately. If they give you a region and duration, that's enough — confirm and signal ready.

REROUTE LOGIC: If the user is modifying an existing trip (add a stop, avoid an area, change a day), confirm the change in 1 sentence and signal ready to rebuild.

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
- All US terrain — from western backcountry to cross-country road trips to the Southeast and Northeast
- Overlanding logistics: fuel range, water sourcing, vehicle clearance, seasonal closures, fire restrictions
- Road trips that mix camping, motels, and adventure based on user preference

When a user describes their trip, respond ONLY with a valid JSON object. No markdown. No extra text. Just the JSON.

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

FUEL STRATEGY:
- Estimate a typical overlanding vehicle has 300-400 mile range (less off-road)
- Never plan a route segment that leaves fewer than ~150 miles of range in remote areas (half-tank rule)
- If the day's route passes through a town with fuel before a long remote stretch, include a fuel stop waypoint
- Cross-country paved driving: fuel every 250 miles or at any town before a known fuel gap

OVERNIGHT TYPES:
- If user asks for camping, dispersed camping, or BLM: use type "camp"
- If user asks for motels, hotels, budget accommodation, or town stays: use type "motel"
- If user mixes both (some nights camping, some nights motel): use the appropriate type per night
- Each trip day should end with exactly ONE overnight waypoint (camp or motel)

WAYPOINT COUNT: Target 2-4 waypoints per day (start departure + fuel if needed + 1-2 scenic stops + overnight). For a 7-day trip expect 14-28 total waypoints. For a 14-day trip expect 28-50 total waypoints.

TRIP LENGTH LIMIT: Maximum 14 days per plan. If the user requests more, build 14 days and add a note at the end of your overview: "Want to keep going? Plan your next 14-day leg from [end point] as a follow-up trip." Never exceed 14 days.

Rules for waypoint names:
- Use real, geocodeable place names: "Moab, Utah" or "Amarillo, Texas" or "Onion Creek Dispersed, Castle Valley, UT"
- For dispersed camps: name the area specifically — "Kane Creek Road Dispersed, Moab, UT"
- For motels: name the town — "Gallup, New Mexico" or "Oklahoma City, Oklahoma"
- For fuel stops: name the town — "Tucumcari, New Mexico" (fuel)
- Always start and end at a real, named town or landmark
- Include the state in every waypoint name

Be realistic about daily mileage: 200-400 miles/day on paved roads, 60-150 miles/day on dirt/4WD.

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

TIME PLANNING:
- Factor in realistic daily schedules when estimating. Most overlanders leave camp by 8-9am and arrive at next camp by 5-6pm.
- For dirt/4WD days: plan no more than 6-8 hours of driving. Technical trails = 10-20 mph average.
- Include time buffers for paved-to-dirt transitions, unexpected detours, photography stops.
- If a day has >200 miles of dirt, flag it in heads_up: "Long dirt day — plan for 8-10 hours driving time."
- For cross-country trips with long paved legs: 400-500 miles paved is achievable in a day but note "highway day, minimal stops."

ROUTE REASONING: Always explain your routing logic. Why did you choose this direction vs. the reverse? Why these specific camps? What makes the sequence flow naturally? What would you do differently with a different vehicle or extra day? This is what separates Trailhead from a generic GPS app.

RESPOND TO REQUESTS INTELLIGENTLY:
- If user asks "what gas stations are on this route": describe the fuel stops you'd include, spacing them appropriately for their rig.
- If user asks "are there any hot springs nearby": include a hot springs waypoint if one exists within reasonable distance of the route.
- If user says "I want to fish": add a waypoint at a known fishing access point on or near the route.
- If user says "I need good cell signal for work": route through or near towns with known coverage, note the dead zones, suggest Starlink.
- If user says "I'm allergic to crowds" or "I want solitude": favor weekday-friendly dispersed spots, avoid popular National Parks in peak season, route to lesser-known areas.
"""

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


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

    prompt = f"""You are a safety-focused trail guide. Give a thorough pre-departure briefing for:

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
  "must_do_before_leaving": ["2-4 concrete action items — permits to get, gear to check, calls to make"],
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
    """Generate full trip JSON from conversation history."""
    # Keep last 12 messages to stay well under input token limits
    convo = "\n".join(
        f"{m['role'].upper()}: {m['content']}"
        for m in messages[-12:]
        if m['role'] in ('user', 'assistant')
    )
    synthesis = (
        f"Based on this planning conversation, generate the complete trip plan now:\n\n{convo}"
        "\n\nReturn only the trip JSON."
    )
    msg = _claude(lambda: client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": synthesis}],
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
            return json.loads(match.group())
        raise ValueError(f"Claude returned non-JSON: {raw[:200]}")


def _parse_plan_json(raw: str) -> dict:
    raw = re.sub(r'^```json\s*', '', raw.strip())
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Non-JSON response: {raw[:200]}")


def plan_trip(user_request: str) -> dict:
    # Short trips (≤3 days) use Haiku — simpler JSON, reliable output, 10x cheaper.
    # Longer trips go straight to Sonnet for richer detail and reliability.
    import re as _re
    day_hint = int((_re.search(r'\b(\d+)\s*-?\s*day', user_request, _re.I) or [None, 5])[1])
    use_haiku = day_hint <= 3

    def _call(model: str) -> str:
        msg = _claude(lambda: client.messages.create(
            model=model,
            max_tokens=16000 if model.startswith("claude-sonnet") else 4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_request}]
        ))
        return msg.content[0].text.strip()

    if use_haiku:
        try:
            return _parse_plan_json(_call("claude-haiku-4-5-20251001"))
        except Exception:
            pass  # fall through to Sonnet

    raw = _call("claude-sonnet-4-6")
    # Strip markdown code fences if Claude wraps it anyway
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # Try to extract JSON from the response
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Claude returned non-JSON: {raw[:200]}") from e
