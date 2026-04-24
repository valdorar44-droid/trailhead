"""RIDB (Recreation.gov) campsite ingestor.
Fetches federal campsites near a lat/lng. Free API — register at ridb.recreation.gov.
"""
from __future__ import annotations
import asyncio
import httpx
from config.settings import settings
from db.store import get_cached, set_cached

RIDB_BASE = "https://ridb.recreation.gov/api/v1"

def _cache_key(lat: float, lng: float, radius: float) -> str:
    return f"ridb_{lat:.2f}_{lng:.2f}_{radius}"

def _tag_facility(facility: dict) -> list[str]:
    tags: set[str] = set()
    name  = (facility.get("FacilityName") or "").lower()
    desc  = (facility.get("FacilityDescription") or "").lower()
    ftype = (facility.get("FacilityTypeDescription") or "").lower()
    combo = f"{name} {desc} {ftype}"

    # Land type
    if any(k in combo for k in ["national forest", "usfs", "ranger district", "national grassland"]):
        tags.add("usfs")
    if any(k in combo for k in ["national park", "national monument", "national recreation area", "nps", "national seashore", "national lakeshore"]):
        tags.add("nps")
    if "blm" in combo or "bureau of land management" in combo:
        tags.add("blm")
    if any(k in combo for k in ["state park", "state recreation", "state forest", "state campground", "state beach", "state lake"]):
        tags.add("state")

    # Site type
    if any(k in combo for k in ["rv park", "rv hookup", "hookup", "full hookup", "electric hookup", "water and electric"]):
        tags.add("rv")
    if any(k in combo for k in ["dispersed", "boondock", "primitive camping", "backcountry", "dispersed camping"]):
        tags.add("dispersed")
    if any(k in combo for k in ["overnight parking", "trailhead parking", "parking area"]):
        tags.add("parking")

    # Most campgrounds support tent camping
    if not {"dispersed", "parking"}.intersection(tags):
        tags.add("tent")
    if "rv" not in tags and any(k in combo for k in ["rv", "recreational vehicle"]):
        tags.add("rv")

    return list(tags)

def _format_cost(facility: dict) -> str:
    if facility.get("Reservable"):
        return "Reservable · Est. $10-30/night"
    desc = (facility.get("FacilityDescription") or "").lower()
    if any(k in desc for k in ["no fee", "free", "no charge"]):
        return "Free"
    if "dispersed" in desc or not facility.get("Reservable"):
        return "Free / Self-Issued"
    return "See Recreation.gov"

async def get_campsites_near(lat: float, lng: float, radius_miles: float = 30) -> list[dict]:
    key = _cache_key(lat, lng, radius_miles)
    cached = get_cached("campsite_cache", key, ttl_seconds=86400)
    if cached is not None:
        return cached

    headers = {"apikey": settings.ridb_api_key} if settings.ridb_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{RIDB_BASE}/facilities",
                params={"latitude": lat, "longitude": lng, "radius": radius_miles,
                        "activity": "CAMPING", "limit": 20, "offset": 0},
                headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    sites = []
    for facility in data.get("RECDATA", []):
        lat_f = facility.get("FacilityLatitude")
        lng_f = facility.get("FacilityLongitude")
        if not lat_f or not lng_f:
            continue
        sites.append({
            "id": facility.get("FacilityID"),
            "name": facility.get("FacilityName", "Unknown Campsite"),
            "lat": float(lat_f), "lng": float(lng_f),
            "type": "federal_camp",
            "description": facility.get("FacilityDescription", "")[:200],
            "reservable": facility.get("Reservable", False),
            "url": f"https://www.recreation.gov/camping/campgrounds/{facility.get('FacilityID')}",
        })

    set_cached("campsite_cache", key, sites)
    return sites

async def get_campsites_search(lat: float, lng: float, radius_miles: float = 40,
                                type_filters: list[str] | None = None) -> list[dict]:
    """Enhanced search with tagging and optional type filtering."""
    cache_key = f"ridb_search_{lat:.2f}_{lng:.2f}_{radius_miles}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 6)
    if cached is None:
        headers = {"apikey": settings.ridb_api_key} if settings.ridb_api_key else {}
        results = []
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    f"{RIDB_BASE}/facilities",
                    params={"latitude": lat, "longitude": lng, "radius": radius_miles,
                            "activity": "CAMPING", "limit": 50, "offset": 0},
                    headers=headers
                )
                resp.raise_for_status()
                results = resp.json().get("RECDATA", [])
        except Exception:
            pass

        sites = []
        for f in results:
            lat_f = f.get("FacilityLatitude")
            lng_f = f.get("FacilityLongitude")
            if not lat_f or not lng_f:
                continue
            # Extract first photo from MEDIA if present
            media = f.get("MEDIA") or []
            photo_url = next((m.get("URL") for m in media if m.get("MediaType") == "Image"), None)
            tags = _tag_facility(f)
            sites.append({
                "id": str(f.get("FacilityID")),
                "name": f.get("FacilityName", "Campsite"),
                "lat": float(lat_f), "lng": float(lng_f),
                "tags": tags,
                "land_type": _land_label(tags),
                "description": (f.get("FacilityDescription") or "")[:300],
                "photo_url": photo_url,
                "reservable": f.get("Reservable", False),
                "cost": _format_cost(f),
                "url": f"https://www.recreation.gov/camping/campgrounds/{f.get('FacilityID')}",
                "ada": f.get("FacilityAdaAccess") == "Y",
            })
        cached = sites
        set_cached("campsite_cache", cache_key, sites)

    if not type_filters:
        return cached[:50]
    return [s for s in cached if any(t in s.get("tags", []) for t in type_filters)][:50]

def _land_label(tags: list[str]) -> str:
    if "nps" in tags: return "National Park"
    if "usfs" in tags: return "National Forest"
    if "blm" in tags: return "BLM Land"
    if "state" in tags: return "State Park"
    return "Federal Campground"

async def get_facility_detail(facility_id: str) -> dict | None:
    cache_key = f"ridb_detail_{facility_id}"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=86400 * 7)
    if cached is not None:
        return cached

    headers = {"apikey": settings.ridb_api_key} if settings.ridb_api_key else {}
    async with httpx.AsyncClient(timeout=20) as client:
        async def _get(path: str, **params):
            try:
                r = await client.get(f"{RIDB_BASE}/{path}", params={"limit": 50, **params}, headers=headers)
                r.raise_for_status()
                return r.json()
            except Exception:
                return {}

        facility_data, media_data, sites_data, attrs_data, acts_data = await asyncio.gather(
            _get(f"facilities/{facility_id}"),
            _get(f"facilities/{facility_id}/media"),
            _get(f"facilities/{facility_id}/campsites"),
            _get(f"facilities/{facility_id}/facilityattributes"),
            _get(f"facilities/{facility_id}/activities"),
        )

    f = facility_data if isinstance(facility_data, dict) and "FacilityID" in facility_data else {}
    if not f:
        return None

    # Photos
    photos = [m["URL"] for m in (media_data.get("RECDATA") or [])
              if m.get("MediaType") == "Image" and m.get("URL")][:8]

    # Site types
    site_type_set: set[str] = set()
    for s in (sites_data.get("RECDATA") or []):
        ct = s.get("CampsiteType") or ""
        if ct:
            site_type_set.add(ct.title())
    site_types = sorted(site_type_set)[:8]

    # Amenities from attributes
    amenities: list[str] = []
    attr_map = {
        "Shade": "🌳 Shade",
        "Fire": "🔥 Fire Ring",
        "Picnic": "🪑 Picnic Table",
        "Water": "🚰 Water",
        "Electric": "⚡ Electric",
        "Sewer": "🚿 Sewer",
        "Dump": "🗑️ Dump Station",
        "Shower": "🚿 Showers",
        "Toilet": "🚽 Restrooms",
        "Pet": "🐕 Pets OK",
        "ADA": "♿ ADA",
        "Hookup": "⚡ Hookups",
        "Internet": "📶 WiFi",
        "Horse": "🐴 Horse OK",
    }
    for attr in (attrs_data.get("RECDATA") or []):
        aname = attr.get("AttributeName") or ""
        aval  = str(attr.get("AttributeValue") or "").lower()
        if aval in ("false", "0", "n", "no", "none", "na"):
            continue
        for kw, label in attr_map.items():
            if kw.lower() in aname.lower() and label not in amenities:
                amenities.append(label)
    # Supplement from description
    desc = (f.get("FacilityDescription") or "").lower()
    for kw, label in attr_map.items():
        if kw.lower() in desc and label not in amenities:
            amenities.append(label)
    if f.get("FacilityAdaAccess") == "Y" and "♿ ADA" not in amenities:
        amenities.append("♿ ADA")

    # Activities
    activities = [a.get("ActivityName", "") for a in (acts_data.get("RECDATA") or [])
                  if a.get("ActivityName")][:12]

    tags = _tag_facility(f)
    lat_f = f.get("FacilityLatitude")
    lng_f = f.get("FacilityLongitude")

    result = {
        "id": str(facility_id),
        "name": f.get("FacilityName", ""),
        "lat": float(lat_f) if lat_f else 0,
        "lng": float(lng_f) if lng_f else 0,
        "tags": tags,
        "land_type": _land_label(tags),
        "description": (f.get("FacilityDescription") or "")[:1000],
        "photos": photos,
        "photo_url": photos[0] if photos else None,
        "amenities": amenities[:12],
        "site_types": site_types,
        "activities": activities,
        "reservable": f.get("Reservable", False),
        "cost": _format_cost(f),
        "ada": f.get("FacilityAdaAccess") == "Y",
        "phone": f.get("FacilityPhone"),
        "url": f"https://www.recreation.gov/camping/campgrounds/{facility_id}",
        "campsites_count": len(sites_data.get("RECDATA") or []),
    }
    set_cached("campsite_cache", cache_key, result)
    return result
