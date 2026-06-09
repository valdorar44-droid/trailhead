"""RIDB (Recreation.gov) campsite ingestor.
Fetches federal campsites near a lat/lng. Free API — register at ridb.recreation.gov.
"""
from __future__ import annotations
import asyncio, re, time
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

    # ── Managing agency / land type ──────────────────────────────────────────
    if any(k in combo for k in ["national forest", "usfs", "ranger district", "national grassland", "u.s. forest", "us forest"]):
        tags.add("usfs")
    if any(k in combo for k in ["national park", "national monument", "national recreation area", "nps", "national seashore", "national lakeshore", "national parkway", "national battlefield"]):
        tags.add("nps")
    if "blm" in combo or "bureau of land management" in combo:
        tags.add("blm")
    if any(k in combo for k in ["state park", "state recreation", "state forest", "state campground", "state beach", "state lake", "state game", "dnr camp", "state wildlife"]):
        tags.add("state")
    if any(k in combo for k in ["army corps", "corps of engineers", "usace", "corps district"]):
        tags.add("corps")

    # ── Site / facility type ─────────────────────────────────────────────────
    if any(k in combo for k in ["rv park", "rv hookup", "hookup", "full hookup", "electric hookup", "water and electric", "electrical site", "full service", "water/electric"]):
        tags.add("rv")
    if any(k in combo for k in ["dispersed", "boondock", "primitive camping", "primitive site", "roadside camp", "dispersed camping"]):
        tags.add("dispersed")
    if any(k in combo for k in ["overnight parking", "trailhead parking", "parking area"]):
        tags.add("parking")
    if any(k in combo for k in ["group camp", "group site", "group area", "group picnic", "organized group", "large group", "group use"]):
        tags.add("group")
    if any(k in combo for k in ["walk-in", "walk in only", "hike-in", "hike in", "backpack camp", "backpacking", "backcountry tent", "primitive hike"]):
        tags.add("walk_in")
    if any(k in combo for k in ["equestrian", "horse camp", "horse site", "horseback", "stock camp", "corral", "horse trailer", "stock use"]):
        tags.add("equestrian")
    if any(k in combo for k in ["lakefront", "lake front", "lakeside", "waterfront", "water front", "riverside", "beachside", "beach camp", "water access"]):
        tags.add("waterfront")

    # ── ADA accessibility ────────────────────────────────────────────────────
    if facility.get("FacilityAdaAccess") == "Y":
        tags.add("ada")

    # ── Most developed campgrounds support tent camping ──────────────────────
    if not {"dispersed", "parking"}.intersection(tags):
        tags.add("tent")
    if "rv" not in tags and any(k in combo for k in ["rv", "recreational vehicle"]):
        tags.add("rv")

    # ── Free / no-fee ────────────────────────────────────────────────────────
    if any(k in combo for k in ["no fee", "no charge", "fee free", "free camp", "no cost"]) and not facility.get("Reservable"):
        tags.add("free")

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

def _feature_lists_from_text(*values: str) -> tuple[list[str], list[str]]:
    combo = " ".join(v.lower() for v in values if v)
    amenities: list[str] = []
    site_types: list[str] = []
    checks = [
        (("electric", "electrical"), "Electric"),
        (("hookup", "full service", "water/electric"), "Hookups"),
        (("water", "potable"), "Water"),
        (("sewer",), "Sewer"),
        (("dump",), "Dump station"),
        (("shower",), "Showers"),
        (("toilet", "restroom", "vault"), "Restrooms"),
        (("picnic",), "Picnic tables"),
        (("fire ring", "campfire", "fire pit"), "Fire rings"),
        (("shade",), "Shade"),
        (("pet", "dogs"), "Pets OK"),
        (("wifi", "internet"), "WiFi"),
        (("ada", "accessible", "wheelchair"), "ADA"),
    ]
    for needles, label in checks:
        if any(needle in combo for needle in needles) and label not in amenities:
            amenities.append(label)
    type_checks = [
        (("rv", "recreational vehicle", "trailer"), "RV"),
        (("tent",), "Tent"),
        (("cabin",), "Cabin"),
        (("group",), "Group"),
        (("walk-in", "hike-in", "backcountry"), "Walk-in"),
        (("dispersed", "primitive"), "Primitive"),
        (("equestrian", "horse"), "Equestrian"),
    ]
    for needles, label in type_checks:
        if any(needle in combo for needle in needles) and label not in site_types:
            site_types.append(label)
    return amenities, site_types

_FALSEY_ATTR_VALUES = {"", "false", "0", "n", "no", "none", "na", "n/a", "not applicable"}

def _as_records(data: dict | list | None) -> list[dict]:
    if isinstance(data, dict):
        records = data.get("RECDATA")
        if isinstance(records, list):
            return [r for r in records if isinstance(r, dict)]
        return [data] if data else []
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    return []

def _image_urls(records: list[dict], limit: int = 12) -> list[str]:
    urls: list[str] = []
    for media in records:
        url = media.get("URL") or media.get("URLFull") or media.get("MediaURL")
        media_type = str(media.get("MediaType") or media.get("EntityMediaType") or "").lower()
        if url and (not media_type or "image" in media_type or "photo" in media_type):
            if url not in urls:
                urls.append(str(url))
        if len(urls) >= limit:
            break
    return urls

def _clean_text(value: object, limit: int = 600) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = re.sub(r"&nbsp;|&amp;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]

def _attr_pairs(attrs: list[dict]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for attr in attrs:
        name = str(attr.get("AttributeName") or attr.get("Name") or attr.get("Attribute") or "").strip()
        value = str(attr.get("AttributeValue") or attr.get("Value") or "").strip()
        if name or value:
            pairs.append((name, value))
    return pairs

def _attr_value(attrs: list[dict], *needles: str) -> str:
    lowered = [needle.lower() for needle in needles]
    for name, value in _attr_pairs(attrs):
        haystack = name.lower()
        if all(needle in haystack for needle in lowered) and value.lower() not in _FALSEY_ATTR_VALUES:
            return value
    return ""

def _attr_truthy(attrs: list[dict], *needles: str) -> bool:
    value = _attr_value(attrs, *needles)
    if not value:
        return False
    return value.lower() not in _FALSEY_ATTR_VALUES

def _record_value(record: dict, *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", []):
            return str(value).strip()
    return ""

def _record_float(record: dict, *keys: str) -> float | None:
    for key in keys:
        value = record.get(key)
        if value in (None, "", []):
            continue
        try:
            return float(value)
        except Exception:
            pass
    geo = record.get("GEOJSON")
    if isinstance(geo, dict):
        coords = geo.get("COORDINATES") or geo.get("coordinates")
        if isinstance(coords, list) and len(coords) >= 2:
            try:
                if any("lat" in key.lower() for key in keys):
                    return float(coords[1])
                if any("lng" in key.lower() or "lon" in key.lower() for key in keys):
                    return float(coords[0])
            except Exception:
                return None
    return None

def _money_values(text: str) -> list[float]:
    values: list[float] = []
    for match in re.finditer(r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)", text or ""):
        try:
            values.append(float(match.group(1)))
        except Exception:
            pass
    return values

def _fmt_money(value: float) -> str:
    return f"${int(value)}" if float(value).is_integer() else f"${value:.2f}"

def build_price_summary(facility: dict, reservation_records: list[dict] | None = None) -> dict:
    """Summarize price signals without implying live Recreation.gov availability."""
    reservation_records = reservation_records or []
    fee_text = _clean_text(
        " ".join(str(facility.get(key) or "") for key in (
            "FacilityUseFeeDescription",
            "RecAreaFeeDescription",
            "FacilityDescription",
        )),
        1200,
    )
    text_prices = _money_values(fee_text)
    paid: list[float] = []
    years: list[int] = []
    for record in reservation_records:
        if str(record.get("FacilityID") or "") != str(facility.get("FacilityID") or ""):
            continue
        for key in ("UseFee", "TotalBeforeTax", "TotalPaid"):
            raw = str(record.get(key) or "").replace("$", "").replace(",", "").strip()
            try:
                value = float(raw)
            except Exception:
                continue
            nights = 1
            try:
                nights = max(1, int(float(record.get("Nights") or 1)))
            except Exception:
                pass
            if value > 0:
                paid.append(round(value / nights, 2))
                break
        for key in ("StartDate", "OrderDate", "EndDate"):
            match = re.search(r"(20[0-9]{2}|19[0-9]{2})", str(record.get(key) or ""))
            if match:
                years.append(int(match.group(1)))
                break
    if paid:
        ordered = sorted(paid)
        mid = ordered[len(ordered) // 2]
        return {
            "label": f"Typical paid stays: {_fmt_money(ordered[0])}-{_fmt_money(ordered[-1])}/night",
            "min": ordered[0],
            "median": mid,
            "max": ordered[-1],
            "sample_count": len(ordered),
            "last_year": max(years) if years else None,
            "source": "RIDB historical reservations",
            "freshness": "Historical Recreation.gov reservation records; verify current price and availability on Recreation.gov.",
        }
    if text_prices:
        low, high = min(text_prices), max(text_prices)
        label = f"Listed fee text: {_fmt_money(low)}" if low == high else f"Listed fee text: {_fmt_money(low)}-{_fmt_money(high)}"
        return {
            "label": label,
            "min": low,
            "median": None,
            "max": high,
            "sample_count": 0,
            "source": "RIDB facility fee text",
            "freshness": "Official RIDB fee text; verify current price and availability on Recreation.gov.",
        }
    if facility.get("Reservable"):
        return {
            "label": "Reservable; verify current price on Recreation.gov",
            "sample_count": 0,
            "source": "RIDB facility metadata",
            "freshness": "RIDB does not expose live checkout pricing for this card.",
        }
    return {
        "label": "No fee listed",
        "sample_count": 0,
        "source": "RIDB facility metadata",
        "freshness": "Verify current fees, passes, and local rules with the source.",
    }

def _normalize_link(record: dict) -> dict:
    return {
        "id": _record_value(record, "EntityLinkID", "LinkID", "id"),
        "title": _record_value(record, "Title", "LinkType") or "Official link",
        "type": _record_value(record, "LinkType", "Type"),
        "description": _clean_text(record.get("Description"), 240),
        "url": _record_value(record, "URL", "ResourceLink"),
        "source": "ridb",
        "source_badge": "Official Recreation.gov",
    }

def _normalize_adventure(record: dict, kind: str, facility_id: str = "") -> dict:
    if kind == "permit":
        item_id = _record_value(record, "PermitEntranceID", "id")
        name = _record_value(record, "PermitEntranceName", "Name") or "Permit entrance"
        desc = _record_value(record, "PermitEntranceDescription", "Description")
        lat = _record_float(record, "Latitude", "PermitEntranceLatitude")
        lng = _record_float(record, "Longitude", "PermitEntranceLongitude")
        accessible = bool(record.get("PermitEntranceAccessible"))
        zones = [
            _record_value(zone, "Zone", "PermitEntranceZone")
            for zone in _as_records(record.get("ZONES"))
        ]
        attrs = _as_records(record.get("ATTRIBUTES"))
        url = _record_value(record, "ResourceLink", "URL") or f"https://www.recreation.gov/permits/{facility_id or record.get('FacilityID') or item_id}"
    elif kind == "tour":
        item_id = _record_value(record, "TourID", "id")
        name = _record_value(record, "TourName", "Name") or "Tour"
        desc = _record_value(record, "TourDescription", "Description")
        lat = _record_float(record, "Latitude", "TourLatitude")
        lng = _record_float(record, "Longitude", "TourLongitude")
        accessible = bool(record.get("TourAccessible"))
        zones = []
        attrs = _as_records(record.get("ATTRIBUTES"))
        url = _record_value(record, "ResourceLink", "URL") or f"https://www.recreation.gov/ticket/facility/{facility_id or record.get('FacilityID') or item_id}"
    else:
        item_id = _record_value(record, "EventID", "id")
        name = _record_value(record, "EventName", "Name") or "Event"
        desc = _record_value(record, "EventDescription", "Description")
        lat = _record_float(record, "Latitude", "EventLatitude")
        lng = _record_float(record, "Longitude", "EventLongitude")
        accessible = bool(record.get("EventAdaAccess") or record.get("AdaAccess"))
        zones = []
        attrs = _as_records(record.get("ATTRIBUTES"))
        url = _record_value(record, "ResourceLink", "URL")
    photos = _image_urls(_as_records(record.get("ENTITYMEDIA") or record.get("MEDIA")))
    fee_text = _attr_value(attrs, "fee") or _record_value(record, "FeeDescription", "UseFeeDescription", "EventFeeDescription")
    return {
        "id": f"ridb_{kind}:{item_id}" if item_id else f"ridb_{kind}:{facility_id}:{name[:40]}",
        "ridb_id": item_id,
        "facility_id": str(facility_id or record.get("FacilityID") or ""),
        "name": name,
        "type": kind,
        "subtype": _record_value(record, "PermitEntranceType", "TourType", "EventTypeDescription"),
        "description": _clean_text(desc, 500),
        "lat": lat,
        "lng": lng,
        "duration_minutes": record.get("TourDuration"),
        "accessible": accessible,
        "zones": [z for z in zones if z][:12],
        "fee_text": _clean_text(fee_text, 240),
        "photos": photos,
        "photo_url": photos[0] if photos else None,
        "official_url": url,
        "booking_url": url,
        "source": "ridb",
        "verified_source": "Recreation.gov",
        "source_badge": "Official Recreation.gov",
        "reservation_notes": "Trailhead helps you plan and links to the official source. Checkout, tickets, permits, and lotteries stay on Recreation.gov.",
    }

def _normalize_campsite_record(campsite: dict, attrs: list[dict] | None = None, media: list[dict] | None = None) -> dict:
    attrs = attrs or []
    media = media or []
    campsite_id = _record_value(campsite, "CampsiteID", "CampsiteId", "FacilityID", "id")
    name = _record_value(campsite, "CampsiteName", "Site", "Name") or f"Site {campsite_id}".strip()
    campsite_type = _record_value(campsite, "CampsiteType", "TypeOfUse", "SiteType")
    max_people = (
        _record_value(campsite, "MaxNumPeople", "CapacityRating", "Capacity")
        or _attr_value(attrs, "max", "people")
        or _attr_value(attrs, "capacity")
    )
    equipment_length = (
        _record_value(campsite, "MaxVehicleLength", "MaxEquipmentLength")
        or _attr_value(attrs, "max", "vehicle")
        or _attr_value(attrs, "max", "equipment")
        or _attr_value(attrs, "driveway", "length")
    )
    driveway = (
        _record_value(campsite, "DrivewayLength", "DrivewayEntry")
        or _attr_value(attrs, "driveway")
    )
    surface = _attr_value(attrs, "surface") or _record_value(campsite, "DrivewaySurface")
    reserve_type = _record_value(campsite, "TypeOfUse", "Reservable", "AvailabilityStatus") or _attr_value(attrs, "reserve")
    check_in = _record_value(campsite, "CheckinTime", "CheckInTime") or _attr_value(attrs, "check", "in")
    check_out = _record_value(campsite, "CheckoutTime", "CheckOutTime") or _attr_value(attrs, "check", "out")
    photos = _image_urls(media)
    accessible = (
        _record_value(campsite, "CampsiteAccessible", "Accessible", "AdaAccess").upper() == "Y"
        or _attr_truthy(attrs, "accessible")
        or _attr_truthy(attrs, "ada")
    )
    flags = {
        "shade": _attr_truthy(attrs, "shade"),
        "fire": _attr_truthy(attrs, "fire") or _attr_truthy(attrs, "campfire"),
        "pets": _attr_truthy(attrs, "pet"),
        "hookups": _attr_truthy(attrs, "hookup") or _attr_truthy(attrs, "electric") or _attr_truthy(attrs, "water", "hookup"),
    }
    amenities: list[str] = []
    for enabled, label in (
        (accessible, "ADA"),
        (flags["shade"], "Shade"),
        (flags["fire"], "Fire rings"),
        (flags["pets"], "Pets OK"),
        (flags["hookups"], "Hookups"),
        (_attr_truthy(attrs, "water"), "Water"),
        (_attr_truthy(attrs, "sewer"), "Sewer"),
    ):
        if enabled and label not in amenities:
            amenities.append(label)
    lat = _record_float(campsite, "CampsiteLatitude", "Latitude", "lat")
    lng = _record_float(campsite, "CampsiteLongitude", "Longitude", "lng", "lon")
    facility_id = _record_value(campsite, "FacilityID", "ParentFacilityID")
    result = {
        "id": campsite_id,
        "map_card_id": f"ridb_site:{facility_id}:{campsite_id}" if facility_id and campsite_id else "",
        "facility_id": facility_id,
        "name": name,
        "lat": lat,
        "lng": lng,
        "type": campsite_type,
        "loop": _record_value(campsite, "Loop", "LoopName"),
        "max_people": max_people,
        "equipment_length": equipment_length,
        "driveway": driveway,
        "surface": surface,
        "accessible": accessible,
        "shade": flags["shade"],
        "fire": flags["fire"],
        "pets": flags["pets"],
        "hookups": flags["hookups"],
        "check_in": check_in,
        "check_out": check_out,
        "reserve_type": reserve_type,
        "amenities": amenities,
        "photos": photos,
        "photo_url": photos[0] if photos else None,
        "photo_status": "campsite" if photos else "placeholder",
        "source": "ridb",
        "verified_source": "Recreation.gov",
        "source_badge": "Official Recreation.gov",
    }
    return result

def _dedupe(values: list[str], limit: int = 16) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
        if len(result) >= limit:
            break
    return result

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
            "official_url": f"https://www.recreation.gov/camping/campgrounds/{facility.get('FacilityID')}",
            "booking_url": f"https://www.recreation.gov/camping/campgrounds/{facility.get('FacilityID')}",
            "source": "ridb",
            "verified_source": "Recreation.gov",
            "source_badge": "Official Recreation.gov",
            "last_checked": int(time.time()),
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
            amenities, site_types = _feature_lists_from_text(
                f.get("FacilityName", ""),
                f.get("FacilityDescription", ""),
                f.get("FacilityTypeDescription", ""),
            )
            sites.append({
                "id": str(f.get("FacilityID")),
                "name": f.get("FacilityName", "Campsite"),
                "lat": float(lat_f), "lng": float(lng_f),
                "tags": tags,
                "land_type": _land_label(tags),
                "description": (f.get("FacilityDescription") or "")[:300],
                "photo_url": photo_url,
                "photo_status": "facility" if photo_url else "placeholder",
                "reservable": f.get("Reservable", False),
                "cost": _format_cost(f),
                "amenities": amenities,
                "site_types": site_types or (["RV"] if "rv" in tags else ["Tent"] if "tent" in tags else []),
                "url": f"https://www.recreation.gov/camping/campgrounds/{f.get('FacilityID')}",
                "official_url": f"https://www.recreation.gov/camping/campgrounds/{f.get('FacilityID')}",
                "booking_url": f"https://www.recreation.gov/camping/campgrounds/{f.get('FacilityID')}",
                "ada": f.get("FacilityAdaAccess") == "Y",
                "source": "ridb",
                "verified_source": "Recreation.gov",
                "source_badge": "Official Recreation.gov",
                "source_freshness": "Official RIDB source data cached by Trailhead; verify current availability on Recreation.gov.",
                "reservation_notes": "Use Check availability or Reserve on Recreation.gov. Trailhead does not handle checkout.",
                "last_checked": int(time.time()),
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

async def get_campsite_detail(facility_id: str, campsite_id: str) -> dict | None:
    """Fetch a single RIDB campsite directly, independent of facility-site caps."""
    facility_id = str(facility_id or "").strip()
    campsite_id = str(campsite_id or "").strip()
    if not facility_id or not campsite_id:
        return None
    cache_key = f"ridb_site_detail_v2_{facility_id}_{campsite_id}"
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

        detail_data, attrs_data, site_media_data, facility_data, facility_media_data = await asyncio.gather(
            _get(f"campsites/{campsite_id}"),
            _get(f"campsites/{campsite_id}/attributes"),
            _get(f"campsites/{campsite_id}/media"),
            _get(f"facilities/{facility_id}"),
            _get(f"facilities/{facility_id}/media"),
        )

    detail_records = _as_records(detail_data)
    site_raw = detail_records[0] if detail_records else (detail_data if isinstance(detail_data, dict) else {})
    if not isinstance(site_raw, dict) or not site_raw:
        return None
    site_raw = {**site_raw, "FacilityID": facility_id, "CampsiteID": campsite_id}
    site = _normalize_campsite_record(site_raw, _as_records(attrs_data), _as_records(site_media_data))
    facility = facility_data if isinstance(facility_data, dict) and facility_data.get("FacilityID") else {}
    facility_photos = _image_urls(_as_records(facility_media_data), limit=12)
    site_photos = site.get("photos") or []
    photos = _dedupe([*site_photos, *facility_photos], limit=16)
    lat = site.get("lat") if site.get("lat") is not None else _record_float(facility, "FacilityLatitude", "Latitude")
    lng = site.get("lng") if site.get("lng") is not None else _record_float(facility, "FacilityLongitude", "Longitude", "lng")
    facility_url = (
        _record_value(facility, "FacilityReservationURL", "ReservationURL")
        or f"https://www.recreation.gov/camping/campgrounds/{facility_id}"
    )
    result = {
        **site,
        "id": f"ridb_site:{facility_id}:{campsite_id}",
        "map_card_id": f"ridb_site:{facility_id}:{campsite_id}",
        "facility_id": facility_id,
        "campsite_id": campsite_id,
        "parent_campground": {
            "id": facility_id,
            "name": facility.get("FacilityName") or "",
            "lat": _record_float(facility, "FacilityLatitude", "Latitude"),
            "lng": _record_float(facility, "FacilityLongitude", "Longitude", "lng"),
            "official_url": facility_url,
            "booking_url": facility_url,
        },
        "name": site.get("name") or f"Site {campsite_id}",
        "lat": lat,
        "lng": lng,
        "type": "camp",
        "subtype": site.get("type") or "campsite",
        "land_type": site.get("type") or _land_label(_tag_facility(facility)) if facility else "Recreation.gov site",
        "description": f"{site.get('name') or f'Site {campsite_id}'} at {facility.get('FacilityName') or 'Recreation.gov campground'}.",
        "photos": photos,
        "photo_url": site.get("photo_url") or (photos[0] if photos else None),
        "photo_status": "campsite" if site_photos else ("facility" if facility_photos else "placeholder"),
        "media_source": "ridb_campsite" if site_photos else ("ridb" if facility_photos else ""),
        "photo_fallback_chain": ["campsite_media", "facility_media", "open_photo", "trailhead_placeholder"],
        "source": "ridb",
        "verified_source": "Recreation.gov",
        "source_badge": "Official Recreation.gov",
        "source_freshness": "Official RIDB source data cached by Trailhead; verify current availability on Recreation.gov.",
        "reservation_notes": "Trailhead links to the official Recreation.gov campground page. Checkout stays on Recreation.gov.",
        "booking_url": facility_url,
        "official_url": facility_url,
        "url": facility_url,
        "last_checked": int(time.time()),
    }
    set_cached("campsite_cache", cache_key, result)
    return result

async def get_facility_detail(facility_id: str) -> dict | None:
    cache_key = f"ridb_detail_v3_{facility_id}"
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

        facility_data, media_data, sites_data, attrs_data, acts_data, addresses_data, links_data, permits_data, tours_data, events_data = await asyncio.gather(
            _get(f"facilities/{facility_id}"),
            _get(f"facilities/{facility_id}/media"),
            _get(f"facilities/{facility_id}/campsites"),
            _get(f"facilities/{facility_id}/facilityattributes"),
            _get(f"facilities/{facility_id}/activities"),
            _get(f"facilities/{facility_id}/facilityaddresses"),
            _get(f"facilities/{facility_id}/links"),
            _get(f"facilities/{facility_id}/permitentrances"),
            _get(f"facilities/{facility_id}/tours"),
            _get(f"facilities/{facility_id}/events"),
        )
        base_campsites = _as_records(sites_data)

        async def _enrich_site(site: dict) -> dict:
            campsite_id = _record_value(site, "CampsiteID", "CampsiteId", "id")
            if not campsite_id:
                return _normalize_campsite_record(site)
            detail_data, site_attrs_data, site_media_data = await asyncio.gather(
                _get(f"campsites/{campsite_id}"),
                _get(f"campsites/{campsite_id}/attributes"),
                _get(f"campsites/{campsite_id}/media"),
            )
            detail_records = _as_records(detail_data)
            detail = detail_records[0] if detail_records else (detail_data if isinstance(detail_data, dict) else {})
            if not isinstance(detail, dict) or not detail:
                detail = site
            else:
                detail = {**site, **detail}
            detail.setdefault("FacilityID", str(facility_id))
            return _normalize_campsite_record(detail, _as_records(site_attrs_data), _as_records(site_media_data))

        campsite_details = await asyncio.gather(*[_enrich_site(site) for site in base_campsites[:24]]) if base_campsites else []

        async def _enrich_permit(record: dict) -> dict:
            permit_id = _record_value(record, "PermitEntranceID", "id")
            if not permit_id:
                return _normalize_adventure(record, "permit", str(facility_id))
            detail_data, attrs_data2, zones_data = await asyncio.gather(
                _get(f"permitentrances/{permit_id}"),
                _get(f"permitentrances/{permit_id}/attributes"),
                _get(f"permitentrances/{permit_id}/zones"),
            )
            detail_records = _as_records(detail_data)
            detail = detail_records[0] if detail_records else (detail_data if isinstance(detail_data, dict) else {})
            merged = {**record, **(detail if isinstance(detail, dict) else {})}
            merged["ATTRIBUTES"] = _as_records(attrs_data2) or _as_records(merged.get("ATTRIBUTES"))
            merged["ZONES"] = _as_records(zones_data) or _as_records(merged.get("ZONES"))
            return _normalize_adventure(merged, "permit", str(facility_id))

        async def _enrich_tour(record: dict) -> dict:
            tour_id = _record_value(record, "TourID", "id")
            if not tour_id:
                return _normalize_adventure(record, "tour", str(facility_id))
            detail_data, attrs_data2 = await asyncio.gather(
                _get(f"tours/{tour_id}"),
                _get(f"tours/{tour_id}/attributes"),
            )
            detail_records = _as_records(detail_data)
            detail = detail_records[0] if detail_records else (detail_data if isinstance(detail_data, dict) else {})
            merged = {**record, **(detail if isinstance(detail, dict) else {})}
            merged["ATTRIBUTES"] = _as_records(attrs_data2) or _as_records(merged.get("ATTRIBUTES"))
            return _normalize_adventure(merged, "tour", str(facility_id))

        async def _enrich_event(record: dict) -> dict:
            event_id = _record_value(record, "EventID", "id")
            if not event_id:
                return _normalize_adventure(record, "event", str(facility_id))
            detail_data = await _get(f"events/{event_id}")
            detail_records = _as_records(detail_data)
            detail = detail_records[0] if detail_records else (detail_data if isinstance(detail_data, dict) else {})
            return _normalize_adventure({**record, **(detail if isinstance(detail, dict) else {})}, "event", str(facility_id))

        permit_cards, tour_cards, event_cards = await asyncio.gather(
            asyncio.gather(*[_enrich_permit(record) for record in _as_records(permits_data)[:12]]) if _as_records(permits_data) else asyncio.sleep(0, result=[]),
            asyncio.gather(*[_enrich_tour(record) for record in _as_records(tours_data)[:12]]) if _as_records(tours_data) else asyncio.sleep(0, result=[]),
            asyncio.gather(*[_enrich_event(record) for record in _as_records(events_data)[:12]]) if _as_records(events_data) else asyncio.sleep(0, result=[]),
        )

    f = facility_data if isinstance(facility_data, dict) and "FacilityID" in facility_data else {}
    if not f:
        return None

    # Photos
    facility_photos = _image_urls(_as_records(media_data), limit=12)
    site_photo_urls: list[str] = []
    for site in sorted(
        campsite_details,
        key=lambda item: (
            0 if "group" in f"{item.get('name', '')} {item.get('type', '')}".lower() else 1,
            0 if item.get("photos") else 1,
        ),
    ):
        site_photo_urls.extend(site.get("photos") or [])
    photos = _dedupe([*site_photo_urls, *facility_photos], limit=16)

    # Site types
    site_type_set: set[str] = set()
    for s in (sites_data.get("RECDATA") or []):
        ct = s.get("CampsiteType") or ""
        if ct:
            site_type_set.add(ct.title())
    for site in campsite_details:
        ct = site.get("type") or ""
        if ct:
            site_type_set.add(str(ct).title())
    site_types = sorted(site_type_set)[:8]
    text_amenities, text_site_types = _feature_lists_from_text(
        f.get("FacilityName", ""),
        f.get("FacilityDescription", ""),
        f.get("FacilityTypeDescription", ""),
    )
    for site_type in text_site_types:
        if site_type not in site_types:
            site_types.append(site_type)

    # Amenities from attributes
    amenities: list[str] = []
    attr_map = {
        "Shade": "Shade",
        "Fire": "Fire rings",
        "Picnic": "Picnic tables",
        "Water": "Water",
        "Electric": "Electric",
        "Sewer": "Sewer",
        "Dump": "Dump station",
        "Shower": "Showers",
        "Toilet": "Restrooms",
        "Pet": "Pets OK",
        "ADA": "ADA",
        "Hookup": "Hookups",
        "Internet": "WiFi",
        "Horse": "Horse OK",
    }
    for label in text_amenities:
        if label not in amenities:
            amenities.append(label)
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
    if f.get("FacilityAdaAccess") == "Y" and "ADA" not in amenities:
        amenities.append("ADA")
    for site in campsite_details:
        for label in site.get("amenities") or []:
            if label not in amenities:
                amenities.append(label)

    # Activities
    activities = [a.get("ActivityName", "") for a in (acts_data.get("RECDATA") or [])
                  if a.get("ActivityName")][:12]
    links = [_normalize_link(link) for link in _as_records(links_data) if _normalize_link(link).get("url")][:12]
    addresses = _as_records(addresses_data)
    address = next(
        (
            ", ".join(
                part for part in [
                    _record_value(addr, "FacilityStreetAddress1"),
                    _record_value(addr, "City"),
                    _record_value(addr, "AddressStateCode"),
                    _record_value(addr, "PostalCode"),
                ]
                if part
            )
            for addr in addresses
            if _record_value(addr, "FacilityStreetAddress1", "City", "AddressStateCode")
        ),
        "",
    )
    price_summary = build_price_summary(f)

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
        "photo_status": "campsite" if site_photo_urls else ("facility" if facility_photos else "placeholder"),
        "media_source": "ridb_campsite" if site_photo_urls else ("ridb" if facility_photos else ""),
        "photo_fallback_chain": ["campsite_media", "facility_media", "trailhead_placeholder"],
        "amenities": amenities[:12],
        "site_types": site_types,
        "campsites": campsite_details,
        "activities": activities,
        "things_to_do": [*tour_cards, *permit_cards, *event_cards][:16],
        "permits": permit_cards,
        "tours": tour_cards,
        "events": event_cards,
        "reservable": f.get("Reservable", False),
        "cost": _format_cost(f),
        "price_summary": price_summary,
        "ada": f.get("FacilityAdaAccess") == "Y",
        "phone": f.get("FacilityPhone"),
        "address": address,
        "links": links,
        "url": f"https://www.recreation.gov/camping/campgrounds/{facility_id}",
        "official_url": f.get("FacilityReservationURL") or f"https://www.recreation.gov/camping/campgrounds/{facility_id}",
        "booking_url": f.get("FacilityReservationURL") or f"https://www.recreation.gov/camping/campgrounds/{facility_id}",
        "campsites_count": len(sites_data.get("RECDATA") or []),
        "site_media_count": len(_dedupe(site_photo_urls, limit=999)),
        "source": "ridb",
        "verified_source": "Recreation.gov",
        "source_badge": "Official Recreation.gov",
        "source_freshness": "Official RIDB source data cached by Trailhead; verify current availability on Recreation.gov.",
        "reservation_notes": "Trailhead links to official Recreation.gov booking and availability. Checkout stays on Recreation.gov.",
        "last_checked": int(time.time()),
    }
    set_cached("campsite_cache", cache_key, result)
    return result
