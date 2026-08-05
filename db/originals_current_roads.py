"""Trusted current-road observations for Smokies Originals.

The NPS feed is treated as a list of active closures, not proof that travel is
safe. A clean result therefore means only that the current official feed does
not list a closure on the selected, source-bound route.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import Message
from typing import Callable, Mapping
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from db.originals_operational import operational_candidate_sha256
from db.originals_route_evidence import canonical_sha256


NPS_ROAD_ALERTS_URL = "https://www.nps.gov/grsm/park-alerts-grsm.json"
NPS_ROAD_ALERTS_SOURCE_ID = "grsm-current-cautions"
_MAX_BODY_BYTES = 512 * 1024
_MAX_RECORDS = 500
_CACHE_REFRESH_S = 300
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_DATE_FORMATS = (
    "%B, %d %Y %H:%M:%S",
    "%B %d %Y %H:%M:%S",
)
_REQUIRED_RECORD_FIELDS = {
    "site_code",
    "is_active",
    "category",
    "road_closure_event_type",
    "road_closure_road_segment_id_list",
    "road_closure_start_date",
    "road_closure_end_date",
    "start_date",
    "end_date",
}


class OriginalCurrentRoadsError(ValueError):
    """Raised when the official feed cannot produce a trusted observation."""


@dataclass(frozen=True)
class CurrentRoadFeedSnapshotV1:
    observed_at: datetime
    response_sha256: str
    etag: str | None
    last_modified: str | None
    active_segment_sets: tuple[frozenset[str], ...]
    has_unlocated_active_closure: bool


HttpTransport = Callable[
    [Mapping[str, str]], tuple[int, Mapping[str, str], bytes]
]


class _NoRedirect(urllib_request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise OriginalCurrentRoadsError("NPS road feed redirected unexpectedly")


def _default_transport(headers: Mapping[str, str]) -> tuple[int, Mapping[str, str], bytes]:
    parsed = urlparse(NPS_ROAD_ALERTS_URL)
    if parsed.scheme != "https" or parsed.hostname != "www.nps.gov" or parsed.path != (
        "/grsm/park-alerts-grsm.json"
    ):
        raise OriginalCurrentRoadsError("NPS road feed URL is not allowlisted")
    request = urllib_request.Request(
        NPS_ROAD_ALERTS_URL,
        headers={"Accept": "application/json", "User-Agent": "Trailhead/OriginalsRoadCheck" , **dict(headers)},
    )
    opener = urllib_request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=5) as response:
            body = response.read(_MAX_BODY_BYTES + 1)
            return int(response.status), response.headers, body
    except urllib_error.HTTPError as exc:
        if exc.code == 304:
            return 304, exc.headers, b""
        raise OriginalCurrentRoadsError("NPS road feed request failed") from exc
    except (OSError, urllib_error.URLError) as exc:
        raise OriginalCurrentRoadsError("NPS road feed request failed") from exc


def _header(headers: Mapping[str, str], key: str) -> str | None:
    value = headers.get(key) or headers.get(key.lower())
    return str(value).strip() if value not in (None, "") else None


def _parse_nps_time(value: object) -> datetime | None:
    clean = str(value or "").strip()
    if not clean:
        return None
    for format_string in _DATE_FORMATS:
        try:
            return datetime.strptime(clean, format_string).replace(
                tzinfo=ZoneInfo("America/New_York")
            )
        except ValueError:
            continue
    raise OriginalCurrentRoadsError("NPS road feed contains an invalid date")


def _record_is_current(record: dict, now: datetime) -> bool:
    if record.get("site_code") != "grsm":
        raise OriginalCurrentRoadsError(
            "NPS road feed park identity is not recognized"
        )
    # Do not coerce provider values here.  A new truthy representation such as
    # the string "1" must make readiness unknown rather than silently turning
    # a current closure into an inactive record.
    active = record.get("is_active")
    if active is False or (type(active) is int and active == 0):
        return False
    if active is not True and not (type(active) is int and active == 1):
        raise OriginalCurrentRoadsError(
            "NPS road feed active state is not recognized"
        )
    start = _parse_nps_time(
        record.get("road_closure_start_date") or record.get("start_date")
    )
    end = _parse_nps_time(
        record.get("road_closure_end_date") or record.get("end_date")
    )
    local_now = now.astimezone(ZoneInfo("America/New_York"))
    return (start is None or local_now >= start) and (end is None or local_now <= end)


def _closure_classification(record: dict) -> bool:
    category = str(record.get("category") or "").strip().lower()
    event_type = str(record.get("road_closure_event_type") or "").strip().lower()
    if category == "park closure" or event_type in {"incident", "roadwork"}:
        return True
    if category == "information" and event_type in {"", "no"}:
        return False
    raise OriginalCurrentRoadsError(
        "NPS road feed closure classification is not recognized"
    )


def parse_nps_road_alerts(
    body: bytes,
    *,
    content_type: str,
    observed_at: datetime,
    etag: str | None = None,
    last_modified: str | None = None,
) -> CurrentRoadFeedSnapshotV1:
    media_type = Message()
    media_type["content-type"] = content_type
    if media_type.get_content_type() != "application/json":
        raise OriginalCurrentRoadsError("NPS road feed content type is invalid")
    if len(body) > _MAX_BODY_BYTES:
        raise OriginalCurrentRoadsError("NPS road feed exceeds the size limit")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalCurrentRoadsError("NPS road feed is not valid JSON") from exc
    if not isinstance(payload, list) or len(payload) > _MAX_RECORDS:
        raise OriginalCurrentRoadsError("NPS road feed record count is invalid")

    active_segment_sets: list[frozenset[str]] = []
    unlocated = False
    for raw_record in payload:
        if not isinstance(raw_record, dict) or not _REQUIRED_RECORD_FIELDS.issubset(raw_record):
            raise OriginalCurrentRoadsError("NPS road feed schema is incomplete")
        if not _record_is_current(raw_record, observed_at):
            continue
        raw_ids = str(raw_record.get("road_closure_road_segment_id_list") or "")
        segment_ids = {
            item.strip().lower() for item in raw_ids.split(",") if item.strip()
        }
        if any(not _UUID_RE.fullmatch(item) for item in segment_ids):
            raise OriginalCurrentRoadsError("NPS road feed segment identity is invalid")
        if not _closure_classification(raw_record):
            has_closure_dates = any(
                str(raw_record.get(key) or "").strip()
                for key in (
                    "road_closure_start_date",
                    "road_closure_end_date",
                )
            )
            if segment_ids or has_closure_dates:
                raise OriginalCurrentRoadsError(
                    "NPS road feed information row contains closure data"
                )
            continue
        if not segment_ids:
            unlocated = True
        else:
            active_segment_sets.append(frozenset(segment_ids))
    return CurrentRoadFeedSnapshotV1(
        observed_at=observed_at.astimezone(timezone.utc),
        response_sha256=hashlib.sha256(body).hexdigest(),
        etag=etag,
        last_modified=last_modified,
        active_segment_sets=tuple(active_segment_sets),
        has_unlocated_active_closure=unlocated,
    )


class CurrentRoadFeedReaderV1:
    """Small single-flight cache around the allowlisted NPS JSON feed."""

    def __init__(self, transport: HttpTransport = _default_transport):
        self._transport = transport
        self._lock = threading.Lock()
        self._snapshot: CurrentRoadFeedSnapshotV1 | None = None

    def get(self, *, now: datetime, force_refresh: bool = False) -> CurrentRoadFeedSnapshotV1:
        if now.tzinfo is None:
            raise OriginalCurrentRoadsError("Road observation time must include a timezone")
        now_utc = now.astimezone(timezone.utc)
        with self._lock:
            cached = self._snapshot
            if cached and not force_refresh and (
                now_utc - cached.observed_at
            ).total_seconds() <= _CACHE_REFRESH_S:
                return cached
            conditional: dict[str, str] = {}
            if cached and cached.etag:
                conditional["If-None-Match"] = cached.etag
            if cached and cached.last_modified:
                conditional["If-Modified-Since"] = cached.last_modified
            try:
                status, headers, body = self._transport(conditional)
                if status == 304:
                    if cached is None:
                        raise OriginalCurrentRoadsError(
                            "NPS road feed returned 304 without a cached response"
                        )
                    self._snapshot = CurrentRoadFeedSnapshotV1(
                        observed_at=now_utc,
                        response_sha256=cached.response_sha256,
                        etag=cached.etag,
                        last_modified=cached.last_modified,
                        active_segment_sets=cached.active_segment_sets,
                        has_unlocated_active_closure=cached.has_unlocated_active_closure,
                    )
                    return self._snapshot
                if status != 200:
                    raise OriginalCurrentRoadsError("NPS road feed returned an invalid status")
                content_type = _header(headers, "Content-Type") or ""
                self._snapshot = parse_nps_road_alerts(
                    body,
                    content_type=content_type,
                    observed_at=now_utc,
                    etag=_header(headers, "ETag"),
                    last_modified=_header(headers, "Last-Modified"),
                )
                return self._snapshot
            except OriginalCurrentRoadsError:
                if cached is not None:
                    return cached
                raise


def build_operational_observation(
    *,
    candidate: dict,
    route_evidence: dict,
    route_evidence_sha256: str,
    chapter_id: str,
    variant_id: str,
    feed: CurrentRoadFeedSnapshotV1,
) -> dict:
    if canonical_sha256(route_evidence) != route_evidence_sha256:
        raise OriginalCurrentRoadsError("Route evidence hash is stale")
    variant = next((
        item for item in route_evidence.get("variants") or []
        if isinstance(item, dict)
        and item.get("chapter_id") == chapter_id
        and item.get("variant_id") == variant_id
    ), None)
    if not isinstance(variant, dict):
        raise OriginalCurrentRoadsError("Selected route evidence is unavailable")
    if (
        variant.get("status") != "official_geometry_candidate"
        or variant.get("geometry_ready_for_editorial_cues") is not True
        or variant.get("blocking_issues") != []
    ):
        raise OriginalCurrentRoadsError("Selected route still has source blockers")
    source_ids = variant.get("source_geometry_ids")
    if not isinstance(source_ids, list) or not source_ids:
        raise OriginalCurrentRoadsError("Selected route source identities are unavailable")
    normalized_source_ids = {str(item).strip().lower() for item in source_ids}
    # The NPS closure feed can cover only NPS UUID road identities. A chapter
    # extended by a different agency remains check-required until that agency
    # has its own current operational reader.
    external_source = any(not _UUID_RE.fullmatch(item) for item in normalized_source_ids)
    intersects = any(
        normalized_source_ids.intersection(segment_set)
        for segment_set in feed.active_segment_sets
    )
    chapter = next((
        item for item in candidate.get("chapters") or []
        if isinstance(item, dict) and item.get("chapter_id") == chapter_id
    ), None)
    if not isinstance(chapter, dict):
        raise OriginalCurrentRoadsError("Operational chapter is unavailable")
    required_road_ids = chapter.get("required_road_ids")
    if not isinstance(required_road_ids, list) or not required_road_ids:
        raise OriginalCurrentRoadsError("Operational road identities are unavailable")
    state = (
        "unknown"
        if external_source or feed.has_unlocated_active_closure
        else "closed" if intersects else "open"
    )
    return {
        "candidate_id": candidate["candidate_id"],
        "candidate_sha256": operational_candidate_sha256(candidate),
        "source_id": NPS_ROAD_ALERTS_SOURCE_ID,
        "observed_at": feed.observed_at.isoformat().replace("+00:00", "Z"),
        "road_states": {str(road_id): state for road_id in required_road_ids},
    }


default_current_road_reader = CurrentRoadFeedReaderV1()
