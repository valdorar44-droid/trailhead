"""Claude AI trip planning engine."""
from __future__ import annotations
import json, re
import anthropic
from config.settings import settings

SYSTEM_PROMPT = """You are Trailhead AI — an expert overlanding and dispersed camping trip planner for the American West.

You specialize in:
- BLM (Bureau of Land Management) and USFS (US Forest Service) dispersed camping
- Off-road and 4WD routes, jeep trails, forest roads
- Remote western US terrain: Utah, Colorado, Wyoming, Montana, Idaho, Nevada, Arizona, New Mexico, Oregon, Washington
- Overlanding logistics: fuel range, water sourcing, vehicle clearance, seasonal closures
- Finding the balance between remote adventure and necessary resupply stops

When a user describes their trip, respond ONLY with a valid JSON object. No markdown. No extra text. Just the JSON.

Use this exact schema:
{
  "trip_name": "descriptive name for this adventure",
  "overview": "2-3 sentence trip summary",
  "duration_days": number,
  "states": ["UT", "CO"],
  "total_est_miles": number,
  "waypoints": [
    {
      "day": number,
      "name": "Specific Named Location, State (geocodeable — use real town/landmark names)",
      "type": "start|camp|waypoint|town|shower|fuel",
      "description": "1-2 sentences about this stop",
      "land_type": "BLM|USFS|NPS|private|town",
      "notes": "optional practical notes (water available, high clearance needed, etc)"
    }
  ],
  "daily_itinerary": [
    {
      "day": number,
      "title": "Day N: Short Title",
      "description": "what you'll do and see this day",
      "est_miles": number,
      "road_type": "paved|dirt|4wd|mixed",
      "highlights": ["specific thing to see or do"]
    }
  ],
  "logistics": {
    "vehicle_recommendation": "what kind of vehicle/clearance needed",
    "fuel_strategy": "where to fuel up, typical gaps between stations",
    "water_strategy": "where to source water, how many gallons to carry",
    "permits_needed": "any required permits or fire restrictions to check",
    "best_season": "best time of year for this specific route"
  }
}

Rules for waypoint names:
- Use real, geocodeable place names: "Moab, Utah" or "Escalante, Utah" or "Kane Creek Road Dispersed Camping, Moab, UT"
- For dispersed camps, name the area: "Onion Creek Dispersed, Castle Valley, UT" — not just "dispersed camp"
- For towns: "Torrey, Utah" — include the state
- 1-2 waypoints per day max
- Always start with a real town (start point) and end at a real town or known trailhead

Be realistic about distances, road conditions, and what's achievable in a day of overlanding (60-120 miles is typical on dirt roads).
"""

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)


def generate_audio_guide(waypoints: list[dict], trip_name: str) -> dict:
    """Generate spoken narration for each geocoded waypoint."""
    geocoded = [w for w in waypoints if w.get("lat") and w.get("lng")]
    if not geocoded:
        return {}

    wp_list = "\n".join(
        f"- Day {w['day']}: {w['name']} ({w.get('type','')}, {w.get('land_type','')}) — {w.get('description','')}"
        for w in geocoded
    )

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=3000,
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
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": f"""You are a trail guide. The user is currently at: {loc_desc}
Write a 3-4 sentence spoken narration about this location — geology, landscape, history, wildlife, or what to look for.
Be specific to the American West overlanding context. Conversational tone, no markdown."""}]
    )
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

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}]
    )
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
    wp_text = "\n".join(f"Day {w.get('day','-')}: {w.get('name','')} ({w.get('type','')})" for w in waypoints[:15])
    rep_text = "\n".join(f"- {r.get('type','')} near day {r.get('waypoint_day','-')}: {r.get('description','')}" for r in reports[:10]) if reports else "None reported"

    prompt = f"""You are a safety-focused trail guide. Give a pre-departure route briefing for:

Trip: {trip_name}
Route:
{wp_text}

Community reports along route:
{rep_text}

Return ONLY valid JSON:
{{
  "readiness_score": number 1-10 (10 = fully prepared, lower = missing critical prep),
  "top_concerns": ["up to 3 key safety or logistics concerns"],
  "must_do_before_leaving": ["2-4 concrete action items before departure"],
  "daily_highlights": ["1 key thing to watch for each day, max 7"],
  "estimated_fuel_stops": number,
  "water_carry_gallons": number recommended to carry,
  "briefing_summary": "2-3 sentence overall readiness summary"
}}"""

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        return {"readiness_score": 7, "top_concerns": [], "must_do_before_leaving": [],
                "daily_highlights": [], "estimated_fuel_stops": 0,
                "water_carry_gallons": 10, "briefing_summary": ""}


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

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1000,
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


def plan_trip(user_request: str) -> dict:
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_request}]
    )
    raw = msg.content[0].text.strip()

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
