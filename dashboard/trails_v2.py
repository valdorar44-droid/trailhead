from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any, Literal

from pydantic import BaseModel, Field


TrailGeometryStatusV2 = Literal["complete", "partial", "point"]


class TrailCenterV2(BaseModel):
    lat: float
    lng: float


class TrailBoundsV2(BaseModel):
    north: float
    south: float
    east: float
    west: float


class TrailFactsV2(BaseModel):
    distance_mi: float | None = None
    elevation_gain_ft: int | None = None
    estimated_time: str | None = None
    difficulty: str | None = None
    route_shape: str | None = None
    surface: str | None = None
    season: str | None = None


class TrailheadReferenceV2(BaseModel):
    name: str | None = None
    lat: float
    lng: float
    source: str | None = None


class TrailMediaV2(BaseModel):
    kind: Literal["image"] = "image"
    url: str
    thumbnail_url: str | None = None
    caption: str | None = None
    attribution: str
    license: str
    source_url: str


class TrailSourceV2(BaseModel):
    label: str
    url: str | None = None
    kind: str | None = None


class TrailFreshnessV2(BaseModel):
    checked_at: int | None = None
    label: str | None = None


class TrailCapabilitiesV2(BaseModel):
    details: bool = True
    save: bool = True
    navigate: bool = False
    highlight: bool = False
    preview: bool = False
    download: bool = False
    build_route: bool = False


class TrailDiscoveryItemV2(BaseModel):
    version: Literal[2] = 2
    id: str
    primary_trail_id: str
    name: str
    kind: str = "trail"
    center: TrailCenterV2
    geometry_status: TrailGeometryStatusV2
    geometry_revision: str | None = None
    activities: list[str] = Field(default_factory=list)
    permitted_uses: list[str] = Field(default_factory=list)
    facts: TrailFactsV2 = Field(default_factory=TrailFactsV2)
    trailheads: list[TrailheadReferenceV2] = Field(default_factory=list)
    media: list[TrailMediaV2] = Field(default_factory=list)
    sources: list[TrailSourceV2] = Field(default_factory=list)
    freshness: TrailFreshnessV2 = Field(default_factory=TrailFreshnessV2)
    capabilities: TrailCapabilitiesV2 = Field(default_factory=TrailCapabilitiesV2)
    summary: str | None = None
    detail_ref: str
    preview_ref: str | None = None


class TrailSystemV2(TrailDiscoveryItemV2):
    member_trail_ids: list[str] = Field(default_factory=list)
    geometry: dict[str, Any] | None = None
    bounds: TrailBoundsV2 | None = None


class TrailDiscoveryResponseV2(BaseModel):
    version: Literal[2] = 2
    mode: Literal["nearby", "view"]
    source: str = "trailhead-canonical"
    offline: bool = False
    trails: list[TrailDiscoveryItemV2] = Field(default_factory=list)


def model_public(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)  # type: ignore[attr-defined]
    return model.dict(exclude_none=True)


def _clean_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _source_fact(value: object, *, generic: set[str] | None = None) -> str | None:
    """Return source-owned trail facts while omitting legacy UI fallbacks."""
    text = _clean_text(value)
    if not text:
        return None
    if text.casefold() in {item.casefold() for item in (generic or set())}:
        return None
    return text


def _normalized_name(value: object) -> str:
    text = _clean_text(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(trailheads?|trails?|routes?)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


_GENERATED_NAMES = {
    "trail",
    "trailhead",
    "mapped trail",
    "mapped trail route",
    "mapped rough track",
    "mapped backroad",
}


def _is_generated_name(value: object) -> bool:
    return _clean_text(value).lower() in _GENERATED_NAMES


def _is_technical_name(value: object) -> bool:
    text = _clean_text(value)
    if not text:
        return True
    if re.fullmatch(r"(?:[A-Z]?\d{1,5}[A-Z]?)(?:[-/. ]\d{1,5}[A-Z]?)?", text, re.I):
        return True
    if re.fullmatch(r"[A-Z]{1,3}\d{1,4}[A-Z]{0,2}", text, re.I):
        return True
    if re.fullmatch(r"\d{1,3}[A-Z]\d{1,4}[A-Z]?", text, re.I):
        return True
    return False


def _valid_coord(value: object) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        lng, lat = float(value[0]), float(value[1])
    except Exception:
        return None
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return None
    return [round(lng, 7), round(lat, 7)]


def _profile_lines(profile: dict[str, Any]) -> list[list[list[float]]]:
    geometry = profile.get("geometry")
    if not isinstance(geometry, dict):
        return []
    lines: list[list[list[float]]] = []

    def add(raw: object) -> None:
        if not isinstance(raw, list):
            return
        coords: list[list[float]] = []
        for value in raw:
            coord = _valid_coord(value)
            if coord and (not coords or coords[-1] != coord):
                coords.append(coord)
        if len(coords) >= 2:
            lines.append(coords)

    def visit(raw: object) -> None:
        if not isinstance(raw, dict):
            return
        geometry_type = raw.get("type")
        coordinates = raw.get("coordinates")
        if geometry_type == "LineString":
            add(coordinates)
        elif geometry_type == "MultiLineString" and isinstance(coordinates, list):
            for line in coordinates:
                add(line)

    if geometry.get("type") == "FeatureCollection":
        for feature in geometry.get("features") or []:
            visit((feature or {}).get("geometry"))
    elif geometry.get("type") == "Feature":
        visit(geometry.get("geometry"))
    else:
        visit(geometry)
    return lines


def _haversine_m(a: list[float], b: list[float]) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    d_lat = lat2 - lat1
    d_lng = lng2 - lng1
    value = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(max(0.0, min(1.0, value))))


def _lines_connected(a: list[list[list[float]]], b: list[list[list[float]]], threshold_m: float = 85.0) -> bool:
    a_ends = [point for line in a for point in (line[0], line[-1])]
    b_ends = [point for line in b for point in (line[0], line[-1])]
    return any(_haversine_m(left, right) <= threshold_m for left in a_ends for right in b_ends)


def _source_family(profile: dict[str, Any]) -> str:
    source = _clean_text(profile.get("source") or profile.get("source_label")).lower()
    if any(value in source for value in ("forest", "usfs")):
        return "usfs"
    if "nps" in source or "national park" in source:
        return "nps"
    if "blm" in source or "land management" in source:
        return "blm"
    if "openstreetmap" in source or source == "osm":
        return "osm"
    return source or "trailhead"


def _source_is_authoritative(profile: dict[str, Any]) -> bool:
    source = _source_family(profile)
    profile_id = _clean_text(profile.get("id"))
    return source in {"usfs", "nps", "blm", "ridb", "official"} or (profile_id.startswith("trail:") and not profile_id.startswith("trail:osm:"))


def _geometry_status(profile: dict[str, Any], lines: list[list[list[float]]]) -> TrailGeometryStatusV2:
    if not lines:
        if _clean_text(profile.get("geometry_status_hint")).lower() == "complete" and _clean_text(profile.get("geometry_revision")):
            return "complete"
        return "point"
    profile_id = _clean_text(profile.get("id"))
    if _source_is_authoritative(profile) or "osm_relation" in profile_id or ":relation:" in profile_id:
        return "complete"
    return "partial"


def _split_uses(value: object) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        raw = re.split(r"[,;/|]", _clean_text(value)) if _clean_text(value) else []
    result: list[str] = []
    for item in raw:
        text = _clean_text(item)
        if not text or text.lower() in {"unknown", "not listed", "none"}:
            continue
        label = text[:1].upper() + text[1:]
        if label not in result:
            result.append(label)
    return result[:8]


def _permitted_uses(profile: dict[str, Any]) -> list[str]:
    explicit = profile.get("permitted_uses") or profile.get("allowed_uses")
    if explicit:
        return _split_uses(explicit)
    provenance = profile.get("provenance") if isinstance(profile.get("provenance"), dict) else {}
    activity_claim = provenance.get("activities") if isinstance(provenance.get("activities"), dict) else {}
    activity_source = _clean_text(activity_claim.get("source")).lower()
    if "inference" in activity_source or "generated" in activity_source:
        return []
    if _source_is_authoritative(profile):
        return _split_uses(profile.get("activities"))
    return []


def _source_list(profile: dict[str, Any]) -> list[TrailSourceV2]:
    result: list[TrailSourceV2] = []
    source_pack = profile.get("source_pack") if isinstance(profile.get("source_pack"), dict) else {}
    for item in source_pack.get("sources") or []:
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("title") or item.get("publisher"))
        if label:
            result.append(TrailSourceV2(label=label, url=_clean_text(item.get("url")) or None, kind=_clean_text(item.get("kind")) or None))
    label = _clean_text(profile.get("source_label") or profile.get("source"))
    official_url = _clean_text(profile.get("official_url"))
    if label and not any(item.label.lower() == label.lower() for item in result):
        result.insert(0, TrailSourceV2(label=label, url=official_url or None, kind="official" if _source_is_authoritative(profile) else "open"))
    return result[:8]


def _verified_media(profile: dict[str, Any]) -> list[TrailMediaV2]:
    trail_tokens = {token for token in _normalized_name(profile.get("name")).split() if len(token) >= 3}
    result: list[TrailMediaV2] = []
    for photo in profile.get("photos") or []:
        if not isinstance(photo, dict):
            continue
        url = _clean_text(photo.get("url"))
        license_name = _clean_text(photo.get("license"))
        source_url = _clean_text(photo.get("source_url"))
        attribution = _clean_text(photo.get("credit") or photo.get("source"))
        caption = _clean_text(photo.get("caption"))
        caption_tokens = set(_normalized_name(caption).split())
        exact_match = not trail_tokens or bool(trail_tokens & caption_tokens) or _normalized_name(profile.get("name")) in _normalized_name(source_url)
        if not (url and license_name and source_url and attribution and exact_match):
            continue
        result.append(TrailMediaV2(
            url=url,
            thumbnail_url=_clean_text(photo.get("thumbnail_url")) or None,
            caption=caption or None,
            attribution=attribution,
            license=license_name,
            source_url=source_url,
        ))
        if len(result) >= 3:
            break
    return result


def _geometry_feature_collection(member_profiles: list[dict[str, Any]]) -> dict[str, Any] | None:
    features: list[dict[str, Any]] = []
    for profile in member_profiles:
        for index, line in enumerate(_profile_lines(profile)):
            features.append({
                "type": "Feature",
                "id": f"{_clean_text(profile.get('id'))}:{index}",
                "properties": {
                    "trail_id": _clean_text(profile.get("id")),
                    "name": _clean_text(profile.get("name")),
                    "source": _clean_text(profile.get("source_label") or profile.get("source")),
                },
                "geometry": {"type": "LineString", "coordinates": line},
            })
    return {"type": "FeatureCollection", "features": features} if features else None


def _geometry_revision(geometry: dict[str, Any] | None) -> str | None:
    if not geometry:
        return None
    payload = json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _bounds(geometry: dict[str, Any] | None) -> TrailBoundsV2 | None:
    if not geometry:
        return None
    coords = [coord for feature in geometry.get("features") or [] for coord in ((feature.get("geometry") or {}).get("coordinates") or []) if _valid_coord(coord)]
    if not coords:
        return None
    return TrailBoundsV2(
        north=max(coord[1] for coord in coords),
        south=min(coord[1] for coord in coords),
        east=max(coord[0] for coord in coords),
        west=min(coord[0] for coord in coords),
    )


def _number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except Exception:
        return None
    return number if math.isfinite(number) else None


def _integer(value: object) -> int | None:
    number = _number(value)
    return int(round(number)) if number is not None else None


def _summary(profile: dict[str, Any]) -> str | None:
    value = _clean_text(profile.get("summary"))
    if not value:
        return None
    blocked = re.compile(r"mapped trail|nearby support context|check (?:current )?access|local rules|scouting lead|trailhead generated", re.I)
    return None if blocked.search(value) else value[:320]


def _system_id(member_ids: list[str], primary_id: str) -> str:
    if len(member_ids) <= 1:
        return primary_id
    digest = hashlib.sha256("|".join(sorted(member_ids)).encode()).hexdigest()[:16]
    return f"trail-system:{primary_id}:{digest}"


def _profile_quality(profile: dict[str, Any]) -> tuple[int, int, int]:
    lines = _profile_lines(profile)
    status = _geometry_status(profile, lines)
    return (
        2 if _source_is_authoritative(profile) else 1,
        2 if status == "complete" else 1 if status == "partial" else 0,
        len([point for line in lines for point in line]),
    )


def _primary_profile(profiles: list[dict[str, Any]]) -> dict[str, Any]:
    return sorted(
        profiles,
        key=lambda profile: (
            -_profile_quality(profile)[0],
            -_profile_quality(profile)[1],
            -_profile_quality(profile)[2],
            _clean_text(profile.get("id")),
        ),
    )[0]


def _components(profiles: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if len(profiles) <= 1:
        return [profiles]
    parents = list(range(len(profiles)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    profile_lines = [_profile_lines(profile) for profile in profiles]
    for left in range(len(profiles)):
        for right in range(left + 1, len(profiles)):
            if profile_lines[left] and profile_lines[right] and _lines_connected(profile_lines[left], profile_lines[right]):
                union(left, right)
    groups: dict[int, list[dict[str, Any]]] = {}
    for index, profile in enumerate(profiles):
        groups.setdefault(find(index), []).append(profile)
    return list(groups.values())


def build_trail_systems_v2(profiles: list[dict[str, Any]], *, limit: int = 80) -> list[TrailSystemV2]:
    unique: dict[str, dict[str, Any]] = {}
    for raw_profile in profiles:
        profile = dict(raw_profile or {})
        profile_id = _clean_text(profile.get("id"))
        name = _clean_text(profile.get("name"))
        lines = _profile_lines(profile)
        kind = _clean_text(((profile.get("provenance") or {}).get("catalog") or {}).get("feature_type") or profile.get("feature_type") or ("trail" if lines else "trailhead")).lower()
        if not profile_id or not name:
            continue
        if _is_technical_name(name) or (_is_generated_name(name) and kind == "trail"):
            continue
        previous = unique.get(profile_id)
        if not previous or _profile_quality(profile) > _profile_quality(previous):
            unique[profile_id] = profile

    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for profile in unique.values():
        lines = _profile_lines(profile)
        kind = _clean_text(((profile.get("provenance") or {}).get("catalog") or {}).get("feature_type") or profile.get("feature_type") or ("trail" if lines else "trailhead")).lower()
        buckets.setdefault((_normalized_name(profile.get("name")), kind), []).append(profile)

    systems: list[TrailSystemV2] = []
    for bucket in buckets.values():
        # A name is not an identity: many parks have their own "Rim Trail" or
        # "Nature Trail". Resolve connected geometry first, then let a complete
        # authoritative route suppress only the fragments that belong to that
        # same spatial component.
        for spatial_members in _components(bucket):
            complete = [
                profile
                for profile in spatial_members
                if _geometry_status(profile, _profile_lines(profile)) == "complete"
            ]
            members = [_primary_profile(complete)] if complete else spatial_members
            primary = _primary_profile(members)
            member_ids = sorted({_clean_text(profile.get("id")) for profile in members})
            geometry = _geometry_feature_collection(members)
            base_status = _geometry_status(primary, _profile_lines(primary))
            geometry_status: TrailGeometryStatusV2 = "complete" if base_status == "complete" else "partial" if geometry else "point"
            primary_id = _clean_text(primary.get("id"))
            system_id = _system_id(member_ids, primary_id)
            kind = _clean_text(((primary.get("provenance") or {}).get("catalog") or {}).get("feature_type") or primary.get("feature_type") or ("trail" if geometry else "trailhead")).lower() or "trail"
            # Some agency catalogs label the access record as a trailhead even
            # when that record carries the resolved route geometry. A routed
            # system must open the trail experience; point semantics are only
            # appropriate when there is no route to present.
            if geometry_status != "point" and kind == "trailhead":
                kind = "trail"
            trailheads: list[TrailheadReferenceV2] = []
            for member in members:
                for trailhead in member.get("trailheads") or []:
                    if not isinstance(trailhead, dict):
                        continue
                    lat, lng = _number(trailhead.get("lat")), _number(trailhead.get("lng"))
                    if lat is None or lng is None:
                        continue
                    ref = TrailheadReferenceV2(name=_clean_text(trailhead.get("name")) or None, lat=lat, lng=lng, source=_clean_text(trailhead.get("source")) or None)
                    if not any(abs(existing.lat - ref.lat) < 0.00002 and abs(existing.lng - ref.lng) < 0.00002 for existing in trailheads):
                        trailheads.append(ref)
            lat = _number(primary.get("lat"))
            lng = _number(primary.get("lng"))
            bounds = _bounds(geometry)
            if bounds:
                lat = (bounds.north + bounds.south) / 2
                lng = (bounds.east + bounds.west) / 2
            if lat is None or lng is None:
                continue
            distance = _number(primary.get("length_mi") if primary.get("length_mi") is not None else primary.get("distance_mi"))
            uses = _permitted_uses(primary)
            activities = uses or (_split_uses(primary.get("activities")) if _source_is_authoritative(primary) else [])
            source_records: list[TrailSourceV2] = []
            for member in members:
                for source in _source_list(member):
                    if not any(existing.label == source.label and existing.url == source.url for existing in source_records):
                        source_records.append(source)
            media = _verified_media(primary)
            geometry_revision = _clean_text(primary.get("geometry_revision")) or _geometry_revision(geometry)
            capabilities = TrailCapabilitiesV2(
                navigate=bool(trailheads) or kind == "trailhead",
                highlight=geometry_status == "complete",
                preview=geometry_status == "complete",
                download=geometry_status == "complete",
                build_route=geometry_status == "complete",
            )
            detail_ref = f"/api/trails/v2/{system_id}"
            systems.append(TrailSystemV2(
                id=system_id,
                primary_trail_id=primary_id,
                name=_clean_text(primary.get("name")),
                kind=kind,
                center=TrailCenterV2(lat=round(lat, 7), lng=round(lng, 7)),
                geometry_status=geometry_status,
                geometry_revision=geometry_revision,
                activities=activities,
                permitted_uses=uses,
                facts=TrailFactsV2(
                    distance_mi=distance,
                    elevation_gain_ft=_integer(primary.get("elevation_gain_ft")),
                    estimated_time=_clean_text(primary.get("typical_time")) or None,
                    difficulty=_source_fact(primary.get("difficulty"), generic={"Scout first", "Check access", "Unrated", "Unknown"}),
                    route_shape=_source_fact(
                        primary.get("route_type") or ((primary.get("provenance") or {}).get("catalog") or {}).get("route_type"),
                        generic={"Mapped route", "Trail route", "Point or route", "Unknown"},
                    ),
                    surface=_clean_text(primary.get("surface") or ((primary.get("provenance") or {}).get("catalog") or {}).get("surface")) or None,
                    season=_clean_text(primary.get("season_window") or primary.get("best_season")) or None,
                ),
                trailheads=trailheads[:12],
                media=media,
                sources=source_records[:8],
                freshness=TrailFreshnessV2(checked_at=_integer(primary.get("last_checked")), label="Source checked" if primary.get("last_checked") else None),
                capabilities=capabilities,
                summary=_summary(primary),
                detail_ref=detail_ref,
                preview_ref=f"{detail_ref}/preview" if capabilities.preview else None,
                member_trail_ids=member_ids,
                geometry=geometry,
                bounds=bounds,
            ))

    systems.sort(key=lambda item: (
        0 if item.geometry_status == "complete" else 1 if item.geometry_status == "partial" else 2,
        0 if item.sources and item.sources[0].kind == "official" else 1,
        item.name.lower(),
    ))
    return systems[: max(1, limit)]


def discovery_item_v2(system: TrailSystemV2) -> TrailDiscoveryItemV2:
    values = model_public(system)
    values.pop("member_trail_ids", None)
    values.pop("geometry", None)
    values.pop("bounds", None)
    return TrailDiscoveryItemV2(**values)
