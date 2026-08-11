"""Source-owned operational readiness for multi-chapter Originals.

Immutable narration must not carry road closures, seasonal schedules, fees, or
vehicle restrictions.  This module validates a versioned official-source
candidate and evaluates a fresh, server-owned road observation at Start Tour.
It deliberately does not fetch or scrape sources; a trusted backend job owns
that boundary and must supply an observation bound to this candidate.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_SMOKIES_OPERATIONAL_CANDIDATE = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "originals"
    / "smokies-operational-readiness-v1.json"
)

# Publication may bind only to candidates shipped with the backend.  Do not
# accept an arbitrary path or a manifest-supplied operational document here.
_CHECKED_IN_OPERATIONAL_CANDIDATES = (DEFAULT_SMOKIES_OPERATIONAL_CANDIDATE,)

_STABLE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$")
_ROOT_KEYS = {
    "schema_version",
    "candidate_id",
    "pack_slug",
    "park_code",
    "timezone",
    "reviewed_at",
    "valid_through",
    "live_observation_max_age_s",
    "sources",
    "shared_rules",
    "chapters",
}
_SOURCE_KEYS = {
    "id",
    "title",
    "url",
    "publisher",
    "reviewed_at",
    "source_last_updated_at",
    "role",
    "authority",
    "scope",
}
_CHAPTER_KEYS = {
    "chapter_id",
    "source_ids",
    "source_scopes",
    "alternate_chapter_ids",
    "required_road_ids",
    "season_windows",
    "vehicle_free_windows",
    "blocked_vehicle_classes",
    "unavailable_message",
}
_SHARED_KEYS = {"current_conditions_source_id", "commercial_vehicle_rule", "parking"}
_COMMERCIAL_RULE_KEYS = {"source_id", "blocked_vehicle_classes"}
_PARKING_KEYS = {
    "source_id",
    "tag_required_after_minutes",
    "tag_is_entrance_fee",
    "fees_usd",
}
_FEE_KEYS = {"daily", "weekly", "annual"}
_SEASON_WINDOW_KEYS = {"road_id", "start_date", "end_date", "source_id"}
_VEHICLE_FREE_WINDOW_KEYS = {"start_date", "end_date", "weekday", "source_id"}
_OBSERVATION_KEYS = {
    "candidate_id",
    "candidate_sha256",
    "source_id",
    "observed_at",
    "road_states",
}
_ROAD_STATES = {"open", "closed", "restricted", "unknown"}
_VEHICLE_CLASSES = {
    "passenger",
    "motorcycle",
    "commercial_service",
    "bus",
    "motorhome",
    "towing_trailer",
    "van_over_25_ft",
}
_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}
_SMOKIES_CHAPTER_IDS = {
    "mountain_crossing",
    "little_river_cades_cove",
    "roaring_fork",
    "foothills_parkway",
}


class OriginalOperationalReadinessError(ValueError):
    """Raised when a source candidate or live observation is not trustworthy."""


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OriginalOperationalReadinessError(f"{label} must be an object")
    return value


def _array(value: object, label: str, *, allow_empty: bool = False) -> list[Any]:
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "an array" if allow_empty else "a non-empty array"
        raise OriginalOperationalReadinessError(f"{label} must be {qualifier}")
    return value


def _strict_keys(value: dict[str, Any], allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    missing = sorted(allowed - set(value))
    if extra:
        raise OriginalOperationalReadinessError(
            f"{label} contains unsupported fields: {', '.join(extra)}"
        )
    if missing:
        raise OriginalOperationalReadinessError(
            f"{label} is missing fields: {', '.join(missing)}"
        )


def _stable_id(value: object, label: str) -> str:
    clean = str(value or "").strip()
    if not _STABLE_ID.fullmatch(clean):
        raise OriginalOperationalReadinessError(f"{label} must be a stable identifier")
    return clean


def _text(value: object, label: str, maximum: int = 500) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    if not clean or len(clean) > maximum:
        raise OriginalOperationalReadinessError(
            f"{label} must be between 1 and {maximum} characters"
        )
    return clean


def _iso_date(value: object, label: str) -> date:
    clean = _text(value, label, 10)
    try:
        return date.fromisoformat(clean)
    except ValueError as exc:
        raise OriginalOperationalReadinessError(
            f"{label} must be an ISO calendar date"
        ) from exc


def _timestamp(value: object, label: str) -> datetime:
    clean = _text(value, label, 40)
    try:
        parsed = datetime.fromisoformat(clean.replace("Z", "+00:00"))
    except ValueError as exc:
        raise OriginalOperationalReadinessError(
            f"{label} must be an ISO timestamp"
        ) from exc
    if parsed.tzinfo is None:
        raise OriginalOperationalReadinessError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _unique_ids(value: object, label: str, *, allow_empty: bool = False) -> list[str]:
    result = [
        _stable_id(item, f"{label} item")
        for item in _array(value, label, allow_empty=allow_empty)
    ]
    if len(result) != len(set(result)):
        raise OriginalOperationalReadinessError(f"{label} must be unique")
    return result


def _positive_int(value: object, label: str, *, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise OriginalOperationalReadinessError(
            f"{label} must be an integer greater than or equal to {minimum}"
        )
    return value


def load_operational_candidate(
    path: str | Path = DEFAULT_SMOKIES_OPERATIONAL_CANDIDATE,
) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return normalize_operational_candidate(raw)


def normalize_operational_candidate(raw: object) -> dict[str, Any]:
    candidate = copy.deepcopy(_object(raw, "Operational candidate"))
    _strict_keys(candidate, _ROOT_KEYS, "Operational candidate")
    if candidate.get("schema_version") != 1:
        raise OriginalOperationalReadinessError(
            "Operational candidate schema_version must be 1"
        )
    candidate["candidate_id"] = _stable_id(
        candidate.get("candidate_id"), "Operational candidate id"
    )
    candidate["pack_slug"] = _stable_id(
        candidate.get("pack_slug"), "Operational candidate pack slug"
    )
    if _stable_id(candidate.get("park_code"), "Operational candidate park code") != "grsm":
        raise OriginalOperationalReadinessError(
            "Smokies operational candidate park_code must be grsm"
        )
    try:
        ZoneInfo(_text(candidate.get("timezone"), "Operational candidate timezone", 80))
    except ZoneInfoNotFoundError as exc:
        raise OriginalOperationalReadinessError(
            "Operational candidate timezone is unknown"
        ) from exc
    reviewed_at = _timestamp(candidate.get("reviewed_at"), "Operational candidate reviewed_at")
    valid_through = _timestamp(
        candidate.get("valid_through"), "Operational candidate valid_through"
    )
    if reviewed_at > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise OriginalOperationalReadinessError(
            "Operational candidate reviewed_at cannot be in the future"
        )
    if valid_through <= reviewed_at:
        raise OriginalOperationalReadinessError(
            "Operational candidate valid_through must follow reviewed_at"
        )
    if (valid_through - reviewed_at).total_seconds() > 31 * 24 * 60 * 60:
        raise OriginalOperationalReadinessError(
            "Operational candidate review window cannot exceed 31 days"
        )
    candidate["live_observation_max_age_s"] = _positive_int(
        candidate.get("live_observation_max_age_s"),
        "Operational candidate live observation age",
        minimum=60,
    )
    if candidate["live_observation_max_age_s"] > 3600:
        raise OriginalOperationalReadinessError(
            "Operational candidate live observation age cannot exceed one hour"
        )

    sources = _array(candidate.get("sources"), "Operational sources")
    sources_by_id: dict[str, dict[str, Any]] = {}
    for index, raw_source in enumerate(sources):
        source = _object(raw_source, f"Operational source {index}")
        _strict_keys(source, _SOURCE_KEYS, f"Operational source {index}")
        source_id = _stable_id(source.get("id"), f"Operational source {index} id")
        if source_id in sources_by_id:
            raise OriginalOperationalReadinessError("Operational source ids must be unique")
        if source.get("role") != "operational" or source.get("authority") != "official":
            raise OriginalOperationalReadinessError(
                f"Operational source {source_id} must be an official operational source"
            )
        source["title"] = _text(source.get("title"), f"Operational source {source_id} title", 200)
        source["publisher"] = _text(
            source.get("publisher"), f"Operational source {source_id} publisher", 200
        )
        if source["publisher"] != "National Park Service":
            raise OriginalOperationalReadinessError(
                f"Operational source {source_id} publisher is not official NPS"
            )
        parsed_url = urlparse(_text(source.get("url"), f"Operational source {source_id} URL", 500))
        if parsed_url.scheme != "https" or parsed_url.hostname not in {
            "www.nps.gov",
            "home.nps.gov",
        }:
            raise OriginalOperationalReadinessError(
                f"Operational source {source_id} must use an official HTTPS NPS URL"
            )
        source_reviewed_at = _iso_date(
            source.get("reviewed_at"), f"Operational source {source_id} reviewed_at"
        )
        source_updated_at = _iso_date(
            source.get("source_last_updated_at"),
            f"Operational source {source_id} source_last_updated_at",
        )
        if source_reviewed_at > reviewed_at.date():
            raise OriginalOperationalReadinessError(
                f"Operational source {source_id} review cannot follow the candidate review"
            )
        if source_updated_at > source_reviewed_at:
            raise OriginalOperationalReadinessError(
                f"Operational source {source_id} update cannot follow its review"
            )
        source["scope"] = _unique_ids(
            source.get("scope"), f"Operational source {source_id} scopes"
        )
        sources_by_id[source_id] = source

    shared = _object(candidate.get("shared_rules"), "Operational shared rules")
    _strict_keys(shared, _SHARED_KEYS, "Operational shared rules")
    current_source_id = _stable_id(
        shared.get("current_conditions_source_id"), "Current conditions source id"
    )
    if current_source_id not in sources_by_id or "closures" not in sources_by_id[current_source_id]["scope"]:
        raise OriginalOperationalReadinessError(
            "Current conditions source must be an official closure source"
        )
    commercial = _object(shared.get("commercial_vehicle_rule"), "Commercial vehicle rule")
    _strict_keys(commercial, _COMMERCIAL_RULE_KEYS, "Commercial vehicle rule")
    _require_source_scope(
        sources_by_id,
        commercial.get("source_id"),
        "vehicle-restrictions",
        "Commercial vehicle rule",
    )
    commercial["blocked_vehicle_classes"] = _vehicle_classes(
        commercial.get("blocked_vehicle_classes"), "Commercial vehicle rule classes"
    )
    parking = _object(shared.get("parking"), "Parking rule")
    _strict_keys(parking, _PARKING_KEYS, "Parking rule")
    _require_source_scope(sources_by_id, parking.get("source_id"), "fees", "Parking rule")
    _require_source_scope(sources_by_id, parking.get("source_id"), "parking", "Parking rule")
    parking["tag_required_after_minutes"] = _positive_int(
        parking.get("tag_required_after_minutes"), "Parking tag threshold"
    )
    if not isinstance(parking.get("tag_is_entrance_fee"), bool):
        raise OriginalOperationalReadinessError(
            "Parking tag entrance-fee classification must be boolean"
        )
    fees = _object(parking.get("fees_usd"), "Parking fees")
    _strict_keys(fees, _FEE_KEYS, "Parking fees")
    for key in sorted(_FEE_KEYS):
        fees[key] = _positive_int(fees.get(key), f"Parking fee {key}")

    chapters = _array(candidate.get("chapters"), "Operational chapters")
    chapter_ids = {
        _stable_id(chapter.get("chapter_id"), "Operational chapter id")
        for chapter in chapters
        if isinstance(chapter, dict)
    }
    if chapter_ids != _SMOKIES_CHAPTER_IDS or len(chapters) != len(_SMOKIES_CHAPTER_IDS):
        raise OriginalOperationalReadinessError(
            "Smokies operational candidate must define each planned chapter exactly once"
        )
    for index, raw_chapter in enumerate(chapters):
        chapter = _object(raw_chapter, f"Operational chapter {index}")
        allowed = set(_CHAPTER_KEYS)
        if "vehicle_free_windows" not in chapter:
            allowed.remove("vehicle_free_windows")
        _strict_keys(chapter, allowed, f"Operational chapter {index}")
        chapter_id = _stable_id(chapter.get("chapter_id"), f"Operational chapter {index} id")
        source_ids = _unique_ids(
            chapter.get("source_ids"), f"Operational chapter {chapter_id} sources"
        )
        missing_sources = sorted(set(source_ids) - set(sources_by_id))
        if missing_sources:
            raise OriginalOperationalReadinessError(
                f"Operational chapter {chapter_id} has unknown sources: {', '.join(missing_sources)}"
            )
        source_scopes = _unique_ids(
            chapter.get("source_scopes"), f"Operational chapter {chapter_id} scopes"
        )
        available_scopes = {
            scope for source_id in source_ids for scope in sources_by_id[source_id]["scope"]
        }
        if not set(source_scopes).issubset(available_scopes):
            raise OriginalOperationalReadinessError(
                f"Operational chapter {chapter_id} has an unbacked source scope"
            )
        if current_source_id not in source_ids:
            raise OriginalOperationalReadinessError(
                f"Operational chapter {chapter_id} must require current conditions"
            )
        alternate_ids = _unique_ids(
            chapter.get("alternate_chapter_ids"),
            f"Operational chapter {chapter_id} alternates",
            allow_empty=True,
        )
        if chapter_id in alternate_ids or not set(alternate_ids).issubset(chapter_ids):
            raise OriginalOperationalReadinessError(
                f"Operational chapter {chapter_id} has invalid alternates"
            )
        required_road_ids = _unique_ids(
            chapter.get("required_road_ids"), f"Operational chapter {chapter_id} roads"
        )
        season_windows = _array(
            chapter.get("season_windows"),
            f"Operational chapter {chapter_id} season windows",
            allow_empty=True,
        )
        _normalize_windows(
            season_windows,
            chapter_id=chapter_id,
            required_road_ids=required_road_ids,
            source_ids=source_ids,
            sources_by_id=sources_by_id,
        )
        vehicle_free_windows = _array(
            chapter.get("vehicle_free_windows", []),
            f"Operational chapter {chapter_id} vehicle-free windows",
            allow_empty=True,
        )
        _normalize_vehicle_free_windows(
            vehicle_free_windows,
            chapter_id=chapter_id,
            source_ids=source_ids,
            sources_by_id=sources_by_id,
        )
        chapter["blocked_vehicle_classes"] = _vehicle_classes(
            chapter.get("blocked_vehicle_classes"),
            f"Operational chapter {chapter_id} blocked vehicle classes",
            allow_empty=True,
        )
        message = _text(
            chapter.get("unavailable_message"),
            f"Operational chapter {chapter_id} unavailable message",
            240,
        )
        if re.search(r"\b(?:safe|guaranteed|guarantee|artificial intelligence|AI)\b", message, re.I):
            raise OriginalOperationalReadinessError(
                f"Operational chapter {chapter_id} unavailable message overstates readiness"
            )

    return candidate


def _require_source_scope(
    sources_by_id: dict[str, dict[str, Any]],
    value: object,
    scope: str,
    label: str,
) -> str:
    source_id = _stable_id(value, f"{label} source id")
    source = sources_by_id.get(source_id)
    if source is None or scope not in source["scope"]:
        raise OriginalOperationalReadinessError(
            f"{label} requires an official {scope} source"
        )
    return source_id


def _vehicle_classes(
    value: object,
    label: str,
    *,
    allow_empty: bool = False,
) -> list[str]:
    classes = _unique_ids(value, label, allow_empty=allow_empty)
    if not set(classes).issubset(_VEHICLE_CLASSES):
        raise OriginalOperationalReadinessError(f"{label} contains an unknown vehicle class")
    return classes


def _normalize_windows(
    windows: list[Any],
    *,
    chapter_id: str,
    required_road_ids: list[str],
    source_ids: list[str],
    sources_by_id: dict[str, dict[str, Any]],
) -> None:
    roads_seen: set[str] = set()
    for index, raw_window in enumerate(windows):
        label = f"Operational chapter {chapter_id} season window {index}"
        window = _object(raw_window, label)
        _strict_keys(window, _SEASON_WINDOW_KEYS, label)
        road_id = _stable_id(window.get("road_id"), f"{label} road id")
        if road_id not in required_road_ids or road_id in roads_seen:
            raise OriginalOperationalReadinessError(f"{label} road is invalid")
        roads_seen.add(road_id)
        start = _iso_date(window.get("start_date"), f"{label} start date")
        end = _iso_date(window.get("end_date"), f"{label} end date")
        if end < start or start.year != end.year:
            raise OriginalOperationalReadinessError(f"{label} date range is invalid")
        source_id = _require_source_scope(
            sources_by_id, window.get("source_id"), "season", label
        )
        if source_id not in source_ids:
            raise OriginalOperationalReadinessError(f"{label} source is not in the chapter")


def _normalize_vehicle_free_windows(
    windows: list[Any],
    *,
    chapter_id: str,
    source_ids: list[str],
    sources_by_id: dict[str, dict[str, Any]],
) -> None:
    for index, raw_window in enumerate(windows):
        label = f"Operational chapter {chapter_id} vehicle-free window {index}"
        window = _object(raw_window, label)
        _strict_keys(window, _VEHICLE_FREE_WINDOW_KEYS, label)
        start = _iso_date(window.get("start_date"), f"{label} start date")
        end = _iso_date(window.get("end_date"), f"{label} end date")
        if end < start or start.year != end.year:
            raise OriginalOperationalReadinessError(f"{label} date range is invalid")
        weekday = _text(window.get("weekday"), f"{label} weekday", 10).lower()
        if weekday not in _WEEKDAYS:
            raise OriginalOperationalReadinessError(f"{label} weekday is invalid")
        source_id = _require_source_scope(
            sources_by_id, window.get("source_id"), "vehicle-free-days", label
        )
        if source_id not in source_ids:
            raise OriginalOperationalReadinessError(f"{label} source is not in the chapter")


def operational_candidate_sha256(candidate: object) -> str:
    normalized = normalize_operational_candidate(candidate)
    encoded = json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def manifest_operational_fields(
    candidate: object,
    chapter_id: str,
) -> dict[str, Any]:
    """Project one candidate chapter into strict OriginalManifestV2 fields."""

    normalized = normalize_operational_candidate(candidate)
    chapter = _chapter(normalized, chapter_id)
    sources_by_id = {source["id"]: source for source in normalized["sources"]}
    operational_sources = []
    for source_id in chapter["source_ids"]:
        source = sources_by_id[source_id]
        operational_sources.append(
            {
                "title": source["title"],
                "url": source["url"],
                "publisher": source["publisher"],
                "reviewed_at": source["reviewed_at"],
                "role": "operational",
                "authority": "official",
                "scope": [
                    scope for scope in source["scope"] if scope in chapter["source_scopes"]
                ],
            }
        )
    operational_sources = [source for source in operational_sources if source["scope"]]
    return {
        "operational_sources": operational_sources,
        "operational_readiness": {
            "policy": "required_before_start",
            "candidate_id": normalized["candidate_id"],
            "candidate_sha256": operational_candidate_sha256(normalized),
            "source_scopes": list(chapter["source_scopes"]),
            "alternate_chapter_ids": list(chapter["alternate_chapter_ids"]),
        },
    }


def load_checked_in_operational_candidate(
    *,
    candidate_id: str,
    candidate_sha256: str,
    chapter_id: str | None = None,
    now: datetime | None = None,
    require_current: bool = False,
) -> dict[str, Any]:
    """Resolve an exact checked-in candidate and optionally enforce freshness.

    Candidate identity and hash both have to match.  This prevents a mutable
    draft, an arbitrary file path, or a later candidate revision from
    inheriting a prior publication or validation decision.
    """

    clean_id = _stable_id(candidate_id, "Operational candidate id")
    clean_sha256 = str(candidate_sha256 or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", clean_sha256):
        raise OriginalOperationalReadinessError(
            "Operational candidate SHA-256 is invalid"
        )
    matched: dict[str, Any] | None = None
    for path in _CHECKED_IN_OPERATIONAL_CANDIDATES:
        try:
            candidate = load_operational_candidate(path)
        except (OSError, json.JSONDecodeError, OriginalOperationalReadinessError):
            continue
        if candidate["candidate_id"] != clean_id:
            continue
        if operational_candidate_sha256(candidate) != clean_sha256:
            raise OriginalOperationalReadinessError(
                "Checked-in operational candidate hash does not match the manifest"
            )
        matched = candidate
        break
    if matched is None:
        raise OriginalOperationalReadinessError(
            "Operational candidate is not present in the trusted backend source set"
        )
    if chapter_id is not None:
        _chapter(matched, chapter_id)
    if require_current:
        effective_now = now or datetime.now(timezone.utc)
        if effective_now.tzinfo is None:
            raise OriginalOperationalReadinessError(
                "Operational publication time must include a timezone"
            )
        valid_through = _timestamp(
            matched["valid_through"], "Operational candidate valid_through"
        )
        if effective_now.astimezone(timezone.utc) > valid_through:
            raise OriginalOperationalReadinessError(
                "Operational candidate review expired before publication"
            )
    return matched


def validate_manifest_operational_binding(
    *,
    chapter_id: str,
    operational_sources: object,
    operational_readiness: object,
    now: datetime | None = None,
    require_current: bool = False,
) -> dict[str, Any]:
    """Require manifest operations data to equal its checked-in projection."""

    readiness = _object(operational_readiness, "Manifest operational readiness")
    candidate = load_checked_in_operational_candidate(
        candidate_id=str(readiness.get("candidate_id") or ""),
        candidate_sha256=str(readiness.get("candidate_sha256") or ""),
        chapter_id=chapter_id,
        now=now,
        require_current=require_current,
    )
    projected = manifest_operational_fields(candidate, chapter_id)
    if operational_sources != projected["operational_sources"]:
        raise OriginalOperationalReadinessError(
            "Manifest operational sources do not match the checked-in candidate"
        )
    if operational_readiness != projected["operational_readiness"]:
        raise OriginalOperationalReadinessError(
            "Manifest operational readiness does not match the checked-in candidate"
        )
    return candidate


def validate_manifest_operational_validation_projection(
    *,
    chapter_id: str,
    manifest_chapter_ids: object,
    operational_sources: object,
    operational_readiness: object,
    now: datetime | None = None,
    require_current: bool = False,
) -> dict[str, Any]:
    """Validate an exact manifest-local projection for trusted draft validation.

    A private draft may intentionally omit an alternate chapter that exists in
    the checked operational candidate.  Validation may project the candidate's
    alternates onto the chapters actually present in that draft, but every
    other candidate field and source must still match exactly.  Publication and
    start readiness must continue to use :func:`validate_manifest_operational_binding`.
    """

    clean_chapter_id = _stable_id(
        chapter_id, "Manifest validation operational chapter id"
    )
    clean_manifest_chapter_ids = _unique_ids(
        manifest_chapter_ids,
        "Manifest validation operational chapter ids",
    )
    if clean_chapter_id not in clean_manifest_chapter_ids:
        raise OriginalOperationalReadinessError(
            "Manifest validation operational chapter is not present in the manifest"
        )

    readiness = _object(
        operational_readiness, "Manifest validation operational readiness"
    )
    candidate = load_checked_in_operational_candidate(
        candidate_id=str(readiness.get("candidate_id") or ""),
        candidate_sha256=str(readiness.get("candidate_sha256") or ""),
        chapter_id=clean_chapter_id,
        now=now,
        require_current=require_current,
    )
    projected = manifest_operational_fields(candidate, clean_chapter_id)
    if operational_sources != projected["operational_sources"]:
        raise OriginalOperationalReadinessError(
            "Manifest validation operational sources do not match the checked-in candidate"
        )

    checked_alternates = list(
        projected["operational_readiness"]["alternate_chapter_ids"]
    )
    manifest_chapter_id_set = set(clean_manifest_chapter_ids)
    manifest_local_alternates = [
        alternate_id
        for alternate_id in checked_alternates
        if alternate_id in manifest_chapter_id_set
    ]
    expected_readiness = copy.deepcopy(projected["operational_readiness"])
    expected_readiness["alternate_chapter_ids"] = manifest_local_alternates
    if operational_readiness != expected_readiness:
        raise OriginalOperationalReadinessError(
            "Manifest validation operational readiness does not match the "
            "checked-in candidate's manifest-local projection"
        )

    return {
        "schema_version": 1,
        "kind": "original_operational_validation_projection",
        "projection_mode": "validation_only_manifest_local_alternates_v1",
        "chapter_id": clean_chapter_id,
        "candidate_id": candidate["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(candidate),
        "manifest_chapter_ids": sorted(clean_manifest_chapter_ids),
        "checked_alternate_chapter_ids": checked_alternates,
        "manifest_local_alternate_chapter_ids": manifest_local_alternates,
        "omitted_external_alternate_chapter_ids": [
            alternate_id
            for alternate_id in checked_alternates
            if alternate_id not in manifest_chapter_id_set
        ],
    }


def evaluate_chapter_readiness(
    candidate: object,
    *,
    chapter_id: str,
    now: datetime,
    vehicle_class: str = "passenger",
    planned_stop_minutes: int | None = None,
    observation: object | None,
) -> dict[str, Any]:
    """Evaluate a chapter without claiming safety or inferring missing facts.

    `observation` is expected to be issued by a trusted server-side NPS source
    reader.  Missing, stale, restricted, or unknown road states fail closed.
    """

    normalized = normalize_operational_candidate(candidate)
    if now.tzinfo is None:
        raise OriginalOperationalReadinessError("Readiness time must include a timezone")
    now_utc = now.astimezone(timezone.utc)
    chapter = _chapter(normalized, chapter_id)
    vehicle_class = _stable_id(vehicle_class, "Vehicle class")
    if vehicle_class not in _VEHICLE_CLASSES:
        raise OriginalOperationalReadinessError("Vehicle class is unknown")
    parking_notice = _parking_notice(normalized, planned_stop_minutes)
    base = {
        "schema_version": 1,
        "candidate_id": normalized["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(normalized),
        "chapter_id": chapter["chapter_id"],
        "source_ids": list(chapter["source_ids"]),
        "alternate_chapter_ids": list(chapter["alternate_chapter_ids"]),
        "notices": [parking_notice] if parking_notice else [],
    }

    valid_through = _timestamp(normalized["valid_through"], "Operational candidate valid_through")
    if now_utc > valid_through:
        return _result(
            base,
            "check_required",
            "source_review_expired",
            "Operating information needs a fresh NPS review before this chapter can start.",
        )

    blocked_classes = set(
        normalized["shared_rules"]["commercial_vehicle_rule"]["blocked_vehicle_classes"]
    ) | set(chapter["blocked_vehicle_classes"])
    if vehicle_class in blocked_classes:
        return _result(
            base,
            "unavailable",
            "vehicle_not_supported",
            chapter["unavailable_message"],
        )

    local_date = now_utc.astimezone(ZoneInfo(normalized["timezone"])).date()
    for window in chapter["season_windows"]:
        if not _iso_date(window["start_date"], "Season start") <= local_date <= _iso_date(
            window["end_date"], "Season end"
        ):
            return _result(
                base,
                "unavailable",
                "outside_published_motor_vehicle_season",
                chapter["unavailable_message"],
            )
    for window in chapter.get("vehicle_free_windows", []):
        start = _iso_date(window["start_date"], "Vehicle-free start")
        end = _iso_date(window["end_date"], "Vehicle-free end")
        weekday = _WEEKDAYS[str(window["weekday"]).lower()]
        if start <= local_date <= end and local_date.weekday() == weekday:
            return _result(
                base,
                "unavailable",
                "scheduled_vehicle_free_day",
                chapter["unavailable_message"],
            )

    observation_error = _observation_error(
        normalized,
        chapter,
        observation,
        now_utc=now_utc,
    )
    if observation_error:
        return _result(base, "check_required", observation_error, _check_again_copy(observation_error))
    road_states = _object(observation, "Live observation")["road_states"]
    if any(road_states[road_id] == "closed" for road_id in chapter["required_road_ids"]):
        return _result(
            base,
            "unavailable",
            "current_road_closure",
            chapter["unavailable_message"],
        )
    if any(road_states[road_id] != "open" for road_id in chapter["required_road_ids"]):
        return _result(
            base,
            "check_required",
            "current_road_restriction",
            "Current access is restricted or unclear. Check again before starting.",
        )
    return _result(
        base,
        "available",
        "official_road_check_available",
        "The current NPS road check does not list a closure for this chapter.",
    )


def _chapter(candidate: dict[str, Any], chapter_id: str) -> dict[str, Any]:
    stable_id = _stable_id(chapter_id, "Operational chapter id")
    for chapter in candidate["chapters"]:
        if chapter["chapter_id"] == stable_id:
            return chapter
    raise OriginalOperationalReadinessError("Operational chapter is unknown")


def _parking_notice(
    candidate: dict[str, Any], planned_stop_minutes: int | None
) -> dict[str, Any] | None:
    parking = candidate["shared_rules"]["parking"]
    if planned_stop_minutes is not None:
        if isinstance(planned_stop_minutes, bool) or not isinstance(planned_stop_minutes, int):
            raise OriginalOperationalReadinessError(
                "Planned stop minutes must be a non-negative integer"
            )
        if planned_stop_minutes < 0:
            raise OriginalOperationalReadinessError(
                "Planned stop minutes must be a non-negative integer"
            )
        if planned_stop_minutes <= parking["tag_required_after_minutes"]:
            return None
    return {
        "code": "parking_tag",
        "message": "Parking for more than 15 minutes requires a valid parking tag.",
        "source_id": parking["source_id"],
        "fees_usd": copy.deepcopy(parking["fees_usd"]),
    }


def _observation_error(
    candidate: dict[str, Any],
    chapter: dict[str, Any],
    observation: object | None,
    *,
    now_utc: datetime,
) -> str | None:
    if observation is None:
        return "current_conditions_unavailable"
    raw = _object(observation, "Live observation")
    try:
        _strict_keys(raw, _OBSERVATION_KEYS, "Live observation")
        if raw.get("candidate_id") != candidate["candidate_id"]:
            return "stale_candidate_observation"
        if raw.get("candidate_sha256") != operational_candidate_sha256(candidate):
            return "stale_candidate_observation"
        if raw.get("source_id") != candidate["shared_rules"]["current_conditions_source_id"]:
            return "untrusted_conditions_source"
        observed_at = _timestamp(raw.get("observed_at"), "Live observation observed_at")
        age_s = (now_utc - observed_at).total_seconds()
        if age_s < -300:
            return "future_conditions_observation"
        if age_s > candidate["live_observation_max_age_s"]:
            return "stale_conditions_observation"
        road_states = _object(raw.get("road_states"), "Live observation road states")
        for road_id in chapter["required_road_ids"]:
            if road_states.get(road_id) not in _ROAD_STATES:
                return "incomplete_conditions_observation"
    except OriginalOperationalReadinessError:
        return "invalid_conditions_observation"
    return None


def _check_again_copy(reason_code: str) -> str:
    if reason_code == "source_review_expired":
        return "Operating information needs a fresh NPS review before this chapter can start."
    return "Current road conditions could not be verified. Check again before starting."


def _result(
    base: dict[str, Any],
    status: str,
    reason_code: str,
    message: str,
) -> dict[str, Any]:
    return {**base, "status": status, "reason_code": reason_code, "message": message}
