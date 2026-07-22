"""Deterministic, compact search contracts and an in-memory serving index.

The index is deliberately derived from the canonical serving artifacts at
runtime.  It never writes to the source database, which keeps tests and
preview deployments from mutating production catalog data.
"""
from __future__ import annotations

import asyncio
import base64
import difflib
import hashlib
import json
import math
import re
import sqlite3
import threading
import time
import unicodedata
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


SearchSurfaceV2 = Literal[
    "map", "explore", "route_editor", "trail_hub", "downloads", "unknown",
]
SearchIntentV2 = Literal[
    "any", "destination", "place", "trail", "camp", "service",
]
SearchScopeV2 = Literal["global", "viewport", "nearby", "route", "offline"]
PersistencePolicyV2 = Literal["canonical", "temporary"]

_MAX_QUERY_CHARS = 160
_MAX_CURSOR_OFFSET = 300
_DEFAULT_NEARBY_RADIUS_METERS = 50_000
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "a", "an", "and", "around", "at", "best", "find", "for", "in",
    "me", "near", "nearby", "of", "on", "show", "the", "to",
}
_TERM_ALIASES: dict[str, tuple[str, ...]] = {
    "camp": ("camp", "camping", "campground", "campsite"),
    "camps": ("camp", "camping", "campground", "campsite"),
    "camping": ("camp", "camping", "campground", "campsite"),
    "campground": ("camp", "camping", "campground", "campsite"),
    "campsite": ("camp", "camping", "campground", "campsite"),
    "gas": ("gas", "fuel", "station"),
    "fuel": ("fuel", "gas", "station"),
    "hike": ("hike", "hiking", "trail"),
    "hikes": ("hike", "hiking", "trail"),
    "hiking": ("hike", "hiking", "trail"),
    "park": ("park", "parks"),
    "parks": ("park", "parks"),
    "rv": ("rv", "campground", "camping"),
    "trail": ("trail", "trails", "hike", "hiking"),
    "trails": ("trail", "trails", "hike", "hiking"),
    "water": ("water", "hydration", "drinking"),
}
_COMMON_TYPOS = {
    "campgroud": "campground",
    "campng": "camping",
    "moba": "moab",
    "moabb": "moab",
    "trailhed": "trailhead",
    "traill": "trail",
    "yosemti": "yosemite",
}


def normalize_search_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(_TOKEN_RE.findall(text.lower()))


def _clean_label(value: object, max_chars: int) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())[:max_chars]


class SearchCenterV2(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class SearchBoundsV2(BaseModel):
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def validate_area(self) -> "SearchBoundsV2":
        if self.north <= self.south:
            raise ValueError("north must be greater than south")
        if self.east == self.west:
            raise ValueError("east and west must describe a non-empty area")
        return self


class SearchProvenanceV2(BaseModel):
    provider: str = Field(min_length=1, max_length=40)
    source_label: str = Field(min_length=1, max_length=80)
    provider_result_id: str | None = Field(default=None, max_length=180)
    temporary_use_only: bool = False


class SearchRequestV2(BaseModel):
    query: str = Field(min_length=2, max_length=_MAX_QUERY_CHARS)
    surface: SearchSurfaceV2 = "map"
    intent: SearchIntentV2 = "any"
    scope: SearchScopeV2 = "global"
    center: SearchCenterV2 | None = None
    bounds: SearchBoundsV2 | None = None
    route_ref: str | None = Field(default=None, max_length=128)
    radius_meters: int | None = Field(default=None, ge=100, le=250_000)
    categories: list[str] = Field(default_factory=list, max_length=12)
    filters: dict[str, Any] = Field(default_factory=dict)
    cursor: str | None = Field(default=None, max_length=512)
    limit: int = Field(default=20, ge=1, le=30)
    session_id: str | None = Field(default=None, min_length=8, max_length=128)
    include_external: bool = False

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        clean = re.sub(r"\s+", " ", value.strip())
        if _CONTROL_RE.search(clean):
            raise ValueError("query contains unsupported control characters")
        if len(normalize_search_text(clean)) < 2:
            raise ValueError("query must contain at least two searchable characters")
        return clean

    @field_validator("categories")
    @classmethod
    def clean_categories(cls, values: list[str]) -> list[str]:
        clean: list[str] = []
        for value in values:
            item = normalize_search_text(value).replace(" ", "_")[:40]
            if item and item not in clean:
                clean.append(item)
        return clean

    @field_validator("filters")
    @classmethod
    def validate_filters(cls, filters: dict[str, Any]) -> dict[str, Any]:
        if len(filters) > 16 or len(json.dumps(filters, separators=(",", ":"), default=str)) > 2048:
            raise ValueError("filters are too large")
        for key, value in filters.items():
            if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,48}", str(key)):
                raise ValueError("filter names must be short identifiers")
            if isinstance(value, list):
                if len(value) > 20 or any(not isinstance(item, (str, int, float, bool)) for item in value):
                    raise ValueError("filter lists must contain at most 20 scalar values")
            elif value is not None and not isinstance(value, (str, int, float, bool)):
                raise ValueError("filter values must be scalar values or scalar lists")
        return filters

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}", value):
            raise ValueError("session_id must be an opaque identifier")
        return value

    @model_validator(mode="after")
    def validate_scope(self) -> "SearchRequestV2":
        if self.scope == "viewport" and not self.bounds:
            raise ValueError("viewport scope requires bounds")
        if self.scope == "nearby" and not self.center:
            raise ValueError("nearby scope requires center")
        if self.scope == "route":
            if not self.route_ref:
                raise ValueError("route scope requires route_ref")
            raise ValueError("route scope is not supported by this Search V2 rollout")
        if self.route_ref:
            raise ValueError("route_ref is only valid with route scope")
        if self.bounds and self.scope not in {"viewport", "offline"}:
            raise ValueError("bounds are only valid with viewport or offline scope")
        if self.radius_meters is not None:
            if self.scope not in {"nearby", "offline"}:
                raise ValueError("radius_meters is only valid with nearby or offline scope")
            if not self.center:
                raise ValueError("radius_meters requires center")
        if self.filters:
            raise ValueError("filters are not supported by this Search V2 rollout")
        if self.scope == "offline" and self.include_external:
            raise ValueError("offline scope cannot include external providers")
        if self.include_external and not self.session_id:
            raise ValueError("external provider search requires session_id")
        return self

    @property
    def effective_radius_meters(self) -> int | None:
        if self.radius_meters is not None:
            return self.radius_meters
        if self.scope == "nearby":
            return _DEFAULT_NEARBY_RADIUS_METERS
        return None


class SearchResultV2(BaseModel):
    result_id: str = Field(min_length=1, max_length=220)
    canonical_place_id: str | None = Field(default=None, max_length=220)
    title: str = Field(min_length=1, max_length=140)
    subtitle: str | None = Field(default=None, max_length=180)
    kind: str = Field(min_length=1, max_length=48)
    categories: list[str] = Field(default_factory=list, max_length=12)
    coordinates: SearchCenterV2 | None = None
    parent: str | None = Field(default=None, max_length=100)
    distance_meters: float | None = Field(default=None, ge=0)
    provenance: SearchProvenanceV2
    persistence_policy: PersistencePolicyV2
    detail_ref: str | None = Field(default=None, max_length=260)
    score: float = 0.0
    match_reason: str = Field(default="search_match", max_length=48)


class SearchPageV2(BaseModel):
    query: str
    results: list[SearchResultV2]
    next_cursor: str | None = None
    has_more: bool = False
    source_counts: dict[str, int] = Field(default_factory=dict)
    revision: str
    elapsed_ms: int = Field(ge=0)


class SearchResolveResponseV2(BaseModel):
    query: str
    status: Literal["resolved", "ambiguous", "not_found"]
    selected: SearchResultV2 | None = None
    alternatives: list[SearchResultV2] = Field(default_factory=list)
    reason: str
    revision: str


@dataclass(frozen=True)
class SearchDocumentV2:
    result_id: str
    canonical_place_id: str
    title: str
    subtitle: str
    kind: str
    categories: tuple[str, ...]
    lat: float | None
    lng: float | None
    parent: str
    aliases: tuple[str, ...]
    provider: str
    source_label: str
    detail_ref: str
    quality_score: float = 0.0


def _valid_coordinates(lat: object, lng: object) -> tuple[float | None, float | None]:
    try:
        parsed_lat, parsed_lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None
    if not (math.isfinite(parsed_lat) and math.isfinite(parsed_lng)):
        return None, None
    if not (-90 <= parsed_lat <= 90 and -180 <= parsed_lng <= 180):
        return None, None
    return parsed_lat, parsed_lng


def _unique_labels(values: list[object], max_items: int = 12) -> tuple[str, ...]:
    result: list[str] = []
    for value in values:
        clean = normalize_search_text(value).replace(" ", "_")[:40]
        if clean and clean not in result:
            result.append(clean)
        if len(result) >= max_items:
            break
    return tuple(result)


def documents_from_canonical(
    explore_items: list[dict], trail_items: list[dict],
) -> list[SearchDocumentV2]:
    """Normalize existing generated serving artifacts into compact documents."""
    documents: list[SearchDocumentV2] = []
    seen: set[str] = set()
    for item in explore_items:
        if not isinstance(item, dict) or item.get("review_only") is True:
            continue
        result_id = _clean_label(item.get("id"), 220)
        title = _clean_label(item.get("title") or item.get("name"), 140)
        if not result_id or not title or result_id in seen:
            continue
        lat, lng = _valid_coordinates(item.get("lat"), item.get("lng"))
        raw_category = normalize_search_text(item.get("category") or "place").replace(" ", "_") or "place"
        group = normalize_search_text(item.get("group") or item.get("explore_group") or "").replace(" ", "_")
        kind = _canonical_kind(raw_category, group)
        categories = _unique_labels([raw_category, group, *(item.get("tags") or [])])
        provenance = item.get("provenance") if isinstance(item.get("provenance"), dict) else {}
        primary = provenance.get("primary") if isinstance(provenance.get("primary"), dict) else {}
        source_label = _clean_label(
            primary.get("attribution") or item.get("source_label") or item.get("source_title") or "Trailhead",
            80,
        ) or "Trailhead"
        aliases = tuple(
            _clean_label(value, 120)
            for value in [*(item.get("search_aliases") or []), item.get("region"), item.get("state")]
            if _clean_label(value, 120)
        )
        subtitle = _clean_label(item.get("description") or item.get("summary") or item.get("region"), 180)
        try:
            quality = float(item.get("quality_score") or item.get("enrichment_score") or (100 if item.get("verified") else 0))
        except (TypeError, ValueError):
            quality = 0.0
        documents.append(SearchDocumentV2(
            result_id=result_id,
            canonical_place_id=result_id,
            title=title,
            subtitle=subtitle,
            kind=kind,
            categories=categories or (kind,),
            lat=lat,
            lng=lng,
            parent=_clean_label(item.get("region") or item.get("state"), 100),
            aliases=aliases,
            provider="trailhead",
            source_label=source_label,
            detail_ref=result_id,
            quality_score=max(0.0, min(100.0, quality)),
        ))
        seen.add(result_id)

    for item in trail_items:
        if not isinstance(item, dict) or item.get("review_only") is True:
            continue
        result_id = _clean_label(item.get("id"), 220)
        title = _clean_label(item.get("name") or item.get("title"), 140)
        if not result_id or not title or result_id in seen:
            continue
        lat, lng = _valid_coordinates(item.get("lat"), item.get("lng"))
        facts = item.get("fact_labels") if isinstance(item.get("fact_labels"), list) else []
        subtitle = _clean_label(" · ".join(str(value) for value in facts[:3] if str(value or "").strip()) or item.get("summary"), 180)
        categories = _unique_labels([
            "trail", item.get("activity"), item.get("allowed_uses"), item.get("difficulty"), item.get("surface"),
        ])
        aliases = tuple(
            value for value in (
                _clean_label(item.get("activity"), 120),
                _clean_label(item.get("allowed_uses"), 120),
                _clean_label(item.get("geometry_ref"), 120),
            ) if value
        )
        try:
            quality = float(item.get("quality_score") or (100 if item.get("verified") else 0))
        except (TypeError, ValueError):
            quality = 0.0
        documents.append(SearchDocumentV2(
            result_id=result_id,
            canonical_place_id=result_id,
            title=title,
            subtitle=subtitle,
            kind="trail",
            categories=categories or ("trail",),
            lat=lat,
            lng=lng,
            parent="",
            aliases=aliases,
            provider="trailhead",
            source_label=_clean_label(item.get("source_label"), 80) or "Trailhead",
            detail_ref=result_id,
            quality_score=max(0.0, min(100.0, quality)),
        ))
        seen.add(result_id)
    return documents


def _canonical_kind(category: str, group: str) -> str:
    values = {category, group}
    if values.intersection({"trail", "trails", "hike", "hiking"}):
        return "trail"
    if values.intersection({"trailhead"}):
        return "trailhead"
    if values.intersection({"camp", "camping", "campground", "campsite", "rv", "rv_park", "private_stay"}):
        return "camp"
    if values.intersection({"destination", "city", "locality", "region", "country"}):
        return "destination"
    if values.intersection({"fuel", "gas_station", "grocery", "mechanic", "service", "water"}):
        return "service"
    return category or "place"


def _haversine_m(a: SearchCenterV2, lat: float, lng: float) -> float:
    radius = 6_371_008.8
    phi1, phi2 = math.radians(a.lat), math.radians(lat)
    dphi = phi2 - phi1
    dlambda = math.radians(lng - a.lng)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


class SearchCursorError(ValueError):
    pass


class SearchIndexV2:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._connection: sqlite3.Connection | None = None
        self._revision = "empty"
        self._vocabulary: set[str] = set()
        self._vocabulary_buckets: dict[tuple[str, int], list[str]] = {}
        self._correction_cache: dict[str, str] = {}

    @property
    def revision(self) -> str:
        with self._lock:
            return self._revision

    def ensure(self, documents: list[SearchDocumentV2], revision: str) -> None:
        clean_revision = _clean_label(revision, 80) or "unknown"
        with self._lock:
            if self._connection is not None and self._revision == clean_revision:
                return
            connection = sqlite3.connect(":memory:", check_same_thread=False)
            connection.row_factory = sqlite3.Row
            connection.executescript(
                """
                PRAGMA temp_store=MEMORY;
                CREATE TABLE docs (
                    row_id INTEGER PRIMARY KEY,
                    result_id TEXT NOT NULL UNIQUE,
                    canonical_place_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    title_norm TEXT NOT NULL,
                    subtitle TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    categories_json TEXT NOT NULL,
                    parent TEXT NOT NULL,
                    lat REAL,
                    lng REAL,
                    aliases_norm TEXT NOT NULL,
                    aliases_json TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    source_label TEXT NOT NULL,
                    detail_ref TEXT NOT NULL,
                    quality_score REAL NOT NULL
                );
                CREATE VIRTUAL TABLE docs_fts USING fts5(
                    title, aliases, subtitle, categories, parent,
                    tokenize='unicode61 remove_diacritics 2'
                );
                CREATE VIRTUAL TABLE docs_geo USING rtree(
                    row_id, min_lng, max_lng, min_lat, max_lat
                );
                """
            )
            vocabulary: set[str] = set()
            for document in documents:
                title_norm = normalize_search_text(document.title)
                aliases_norm = " ".join(normalize_search_text(value) for value in document.aliases if value)
                categories_text = " ".join(document.categories)
                cursor = connection.execute(
                    """
                    INSERT INTO docs (
                        result_id, canonical_place_id, title, title_norm, subtitle, kind,
                        categories_json, parent, lat, lng, aliases_norm, aliases_json, provider,
                        source_label, detail_ref, quality_score
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document.result_id, document.canonical_place_id, document.title,
                        title_norm, document.subtitle, document.kind,
                        json.dumps(document.categories, separators=(",", ":")), document.parent,
                        document.lat, document.lng, aliases_norm,
                        json.dumps([normalize_search_text(value) for value in document.aliases if value], separators=(",", ":")),
                        document.provider,
                        document.source_label, document.detail_ref, document.quality_score,
                    ),
                )
                row_id = int(cursor.lastrowid)
                connection.execute(
                    "INSERT INTO docs_fts(rowid, title, aliases, subtitle, categories, parent) VALUES (?, ?, ?, ?, ?, ?)",
                    (row_id, title_norm, aliases_norm, normalize_search_text(document.subtitle), categories_text, normalize_search_text(document.parent)),
                )
                if document.lat is not None and document.lng is not None:
                    connection.execute(
                        "INSERT INTO docs_geo(row_id, min_lng, max_lng, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)",
                        (row_id, document.lng, document.lng, document.lat, document.lat),
                    )
                vocabulary.update(_TOKEN_RE.findall(" ".join([
                    title_norm, aliases_norm, normalize_search_text(document.subtitle),
                    categories_text, normalize_search_text(document.parent),
                ])))
            connection.commit()
            buckets: dict[tuple[str, int], list[str]] = {}
            for token in sorted(vocabulary):
                if token:
                    buckets.setdefault((token[0], len(token)), []).append(token)
            previous = self._connection
            self._connection = connection
            self._revision = clean_revision
            self._vocabulary = vocabulary
            self._vocabulary_buckets = buckets
            self._correction_cache = {}
            if previous is not None:
                previous.close()

    def search(self, request: SearchRequestV2, limit: int) -> list[SearchResultV2]:
        with self._lock:
            if self._connection is None:
                return []
            expression, corrected_tokens = self._fts_expression(request.query)
            if not expression:
                return []
            query_norm = " ".join(corrected_tokens)
            sql = (
                "SELECT d.*, bm25(docs_fts, 8.0, 4.0, 1.0, 2.0, 1.0) AS fts_rank "
                "FROM docs_fts JOIN docs d ON d.row_id = docs_fts.rowid "
            )
            params: list[Any] = []
            where = ["docs_fts MATCH ?"]
            params.append(expression)
            if request.bounds:
                sql += "JOIN docs_geo g ON g.row_id = d.row_id "
                where.append("g.min_lat >= ? AND g.max_lat <= ?")
                params.extend([request.bounds.south, request.bounds.north])
                if request.bounds.west < request.bounds.east:
                    where.append("g.min_lng >= ? AND g.max_lng <= ?")
                    params.extend([request.bounds.west, request.bounds.east])
                else:
                    where.append("(g.min_lng >= ? OR g.max_lng <= ?)")
                    params.extend([request.bounds.west, request.bounds.east])
            # FTS rank alone is noisy for very short prefixes because a query
            # such as `mo` also matches thousands of subtitle/category words
            # like `mountain`. Put exact and title-prefix candidates into the
            # bounded candidate set first; final ordering below remains fully
            # server-owned and applies intent, quality, distance and stable IDs.
            sql += (
                "WHERE " + " AND ".join(where)
                + " ORDER BY CASE WHEN d.title_norm = ? THEN 0 "
                "WHEN d.title_norm LIKE ? THEN 1 ELSE 2 END, "
                "CASE WHEN d.title_norm LIKE ? THEN length(d.title_norm) ELSE 9999 END, "
                "fts_rank, d.title_norm, d.result_id LIMIT ?"
            )
            params.extend([query_norm, f"{query_norm}%", f"{query_norm}%"])
            params.append(max(100, min(int(limit) * 20, 2000)))
            rows = self._connection.execute(sql, params).fetchall()
            results: list[tuple[tuple[Any, ...], SearchResultV2]] = []
            query_terms = set(corrected_tokens)
            requested_categories = set(request.categories)
            for row in rows:
                categories = tuple(json.loads(row["categories_json"]))
                if requested_categories and not requested_categories.intersection(categories):
                    continue
                if not _intent_accepts(request.intent, row["kind"], categories):
                    continue
                title_norm = row["title_norm"]
                aliases = set(json.loads(row["aliases_json"]))
                title_terms = set(_TOKEN_RE.findall(title_norm))
                if title_norm == query_norm:
                    tier, reason = 0, "exact_title"
                elif query_norm in aliases:
                    tier, reason = 1, "exact_alias"
                elif title_norm.startswith(query_norm):
                    tier, reason = 2, "title_prefix"
                elif query_terms and query_terms.issubset(title_terms):
                    tier, reason = 3, "title_terms"
                else:
                    tier, reason = 4, "search_match"
                distance = None
                if request.center and row["lat"] is not None and row["lng"] is not None:
                    distance = _haversine_m(request.center, float(row["lat"]), float(row["lng"]))
                radius_meters = request.effective_radius_meters
                if radius_meters is not None and (
                    distance is None or distance > radius_meters
                ):
                    continue
                fts_rank = float(row["fts_rank"] or 0.0)
                quality = float(row["quality_score"] or 0.0)
                score = tier * 1000.0 + max(0.0, fts_rank + 20.0) * 10.0 - quality / 10.0
                prefix_delta = max(0, len(title_norm) - len(query_norm)) if tier == 2 else 0
                prefix_distance = (
                    distance if tier == 2 and distance is not None else float("inf")
                )
                prefix_title = title_norm if tier == 2 else ""
                sort_key = (
                    tier,
                    prefix_delta,
                    prefix_distance,
                    prefix_title,
                    score,
                    distance if distance is not None else float("inf"),
                    title_norm,
                    row["result_id"],
                )
                results.append((sort_key, SearchResultV2(
                    result_id=row["result_id"],
                    canonical_place_id=row["canonical_place_id"],
                    title=row["title"],
                    subtitle=row["subtitle"] or None,
                    kind=row["kind"],
                    categories=list(categories),
                    coordinates=SearchCenterV2(lat=row["lat"], lng=row["lng"]) if row["lat"] is not None and row["lng"] is not None else None,
                    parent=row["parent"] or None,
                    distance_meters=round(distance, 1) if distance is not None else None,
                    provenance=SearchProvenanceV2(
                        provider=row["provider"], source_label=row["source_label"], temporary_use_only=False,
                    ),
                    persistence_policy="canonical",
                    detail_ref=row["detail_ref"],
                    score=round(score, 4),
                    match_reason=reason,
                )))
            results.sort(key=lambda item: item[0])
            return [result for _, result in results[:max(1, min(limit, _MAX_CURSOR_OFFSET + 31))]]

    def _fts_expression(self, query: str) -> tuple[str, list[str]]:
        raw_tokens = [token for token in _TOKEN_RE.findall(normalize_search_text(query)) if token not in _STOPWORDS]
        corrected_tokens: list[str] = []
        groups: list[list[str]] = []
        for token in raw_tokens:
            corrected = self._correct_token(token)
            corrected_tokens.append(corrected)
            values = list(dict.fromkeys(_TERM_ALIASES.get(corrected, (corrected,))))[:6]
            groups.append(values)
        expression = " AND ".join(
            "(" + " OR ".join(f"{value}*" for value in group if value) + ")"
            for group in groups if group
        )
        return expression, corrected_tokens

    def _correct_token(self, token: str) -> str:
        if token in _COMMON_TYPOS:
            return _COMMON_TYPOS[token]
        if token in self._vocabulary or len(token) < 4:
            return token
        cached = self._correction_cache.get(token)
        if cached:
            return cached
        candidates: list[str] = []
        for length in range(max(3, len(token) - 2), len(token) + 3):
            candidates.extend(self._vocabulary_buckets.get((token[0], length), []))
        match = difflib.get_close_matches(token, candidates, n=1, cutoff=0.72)
        corrected = match[0] if match else token
        self._correction_cache[token] = corrected
        return corrected


def _intent_accepts(intent: SearchIntentV2, kind: str, categories: tuple[str, ...]) -> bool:
    values = {kind, *categories}
    if intent == "any":
        return True
    if intent == "destination":
        return bool(values.intersection({
            "destination", "address", "street", "postcode", "city",
            "locality", "neighborhood", "district", "region", "country",
            "park", "public_land",
        }))
    if intent == "trail":
        return bool(values.intersection({"trail", "trails", "trailhead", "hike", "hiking"}))
    if intent == "camp":
        return bool(values.intersection({"camp", "camping", "campground", "campsite", "rv", "rv_park", "private_stay"}))
    if intent == "service":
        return bool(values.intersection({"service", "fuel", "gas_station", "grocery", "mechanic", "water"}))
    return kind not in {"destination", "city", "locality", "region", "country"}


ExternalSearchProviderV2 = Callable[[SearchRequestV2, int, str], Awaitable[list[SearchResultV2]]]
SearchSourceLoaderV2 = Callable[[], tuple[list[SearchDocumentV2], str]]


class SearchV2Service:
    def __init__(
        self,
        source_loader: SearchSourceLoaderV2,
        external_provider: ExternalSearchProviderV2 | None = None,
        *,
        external_timeout_seconds: float = 0.9,
        external_cache_ttl_seconds: float = 45.0,
        external_cache_max_entries: int = 256,
        external_rate_window_seconds: float = 60.0,
        external_rate_limit: int = 300,
        external_session_rate_limit: int = 60,
    ) -> None:
        self._source_loader = source_loader
        self._external_provider = external_provider
        self._external_timeout_seconds = max(0.05, min(float(external_timeout_seconds), 2.5))
        self._external_cache_ttl_seconds = max(1.0, min(float(external_cache_ttl_seconds), 300.0))
        self._external_cache_max_entries = max(1, min(int(external_cache_max_entries), 4096))
        self._external_rate_window_seconds = max(1.0, min(float(external_rate_window_seconds), 300.0))
        self._external_rate_limit = max(1, min(int(external_rate_limit), 10_000))
        self._external_session_rate_limit = max(1, min(int(external_session_rate_limit), 1_000))
        self._external_state_lock = threading.RLock()
        self._external_cache: OrderedDict[
            str, tuple[float, tuple[SearchResultV2, ...]]
        ] = OrderedDict()
        self._external_global_calls: deque[float] = deque()
        self._external_session_calls: dict[str, deque[float]] = {}
        self._index = SearchIndexV2()

    async def prewarm(self) -> tuple[int, str]:
        documents, revision = await asyncio.to_thread(self._source_loader)
        await asyncio.to_thread(self._index.ensure, documents, revision)
        return len(documents), self._index.revision

    async def page(self, request: SearchRequestV2, *, mode: str = "results") -> SearchPageV2:
        started = time.perf_counter()
        documents, revision = await asyncio.to_thread(self._source_loader)
        await asyncio.to_thread(self._index.ensure, documents, revision)
        fingerprint = _request_fingerprint(request, mode)
        offset = _decode_cursor(request.cursor, fingerprint, self._index.revision)
        target = min(_MAX_CURSOR_OFFSET + 31, offset + request.limit + 1)
        internal = await asyncio.to_thread(self._index.search, request, target)
        combined = list(internal)
        external_count = 0
        if (
            self._external_provider is not None
            and request.include_external
            and request.scope != "offline"
            and len(combined) < target
        ):
            provider_limit = max(1, min(10, target - len(combined)))
            external = await self._external_results(
                request, provider_limit=provider_limit, mode=mode,
            )
            combined = _merge_results_internal_first(combined, external)
            external_count = max(0, len(combined) - len(internal))
        page_results = combined[offset:offset + request.limit]
        has_more = len(combined) > offset + request.limit
        next_cursor = _encode_cursor(offset + request.limit, fingerprint, self._index.revision) if has_more else None
        source_counts = {
            "trailhead": sum(1 for result in page_results if result.persistence_policy == "canonical"),
            "external": sum(1 for result in page_results if result.persistence_policy == "temporary"),
        }
        if external_count == 0:
            source_counts["external"] = 0
        return SearchPageV2(
            query=request.query,
            results=page_results,
            next_cursor=next_cursor,
            has_more=has_more,
            source_counts=source_counts,
            revision=self._index.revision,
            elapsed_ms=max(0, round((time.perf_counter() - started) * 1000)),
        )

    async def _external_results(
        self,
        request: SearchRequestV2,
        *,
        provider_limit: int,
        mode: str,
    ) -> list[SearchResultV2]:
        """Return bounded temporary provider results without retaining query text.

        Cache and quota keys are one-way digests. The query still has to be sent
        to the selected provider to perform the search, but Trailhead does not
        add it to analytics, logs, or long-lived cache keys here.
        """
        if self._external_provider is None or request.scope == "offline":
            return []
        cache_key = _external_request_cache_key(request, mode, provider_limit)
        cached = self._external_cache_get(cache_key)
        if cached is not None:
            return cached
        if not self._consume_external_budget(request.session_id or ""):
            return []
        try:
            external = await asyncio.wait_for(
                self._external_provider(request, provider_limit, mode),
                timeout=self._external_timeout_seconds,
            )
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            external = []
        except Exception:
            external = []
        safe_results: list[SearchResultV2] = []
        for item in external:
            if (
                item.persistence_policy != "temporary"
                or not item.provenance.temporary_use_only
            ):
                continue
            normalized = _external_result_for_request(item, request)
            if normalized is not None:
                safe_results.append(normalized)
            if len(safe_results) >= provider_limit:
                break
        self._external_cache_put(cache_key, safe_results)
        return list(safe_results)

    def _external_cache_get(self, key: str) -> list[SearchResultV2] | None:
        now = time.monotonic()
        with self._external_state_lock:
            cached = self._external_cache.get(key)
            if not cached:
                return None
            expires_at, values = cached
            if expires_at <= now:
                self._external_cache.pop(key, None)
                return None
            self._external_cache.move_to_end(key)
            return list(values)

    def _external_cache_put(self, key: str, values: list[SearchResultV2]) -> None:
        with self._external_state_lock:
            self._external_cache[key] = (
                time.monotonic() + self._external_cache_ttl_seconds,
                tuple(values),
            )
            self._external_cache.move_to_end(key)
            while len(self._external_cache) > self._external_cache_max_entries:
                self._external_cache.popitem(last=False)

    def _consume_external_budget(self, session_id: str) -> bool:
        now = time.monotonic()
        cutoff = now - self._external_rate_window_seconds
        subject = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:24]
        with self._external_state_lock:
            while self._external_global_calls and self._external_global_calls[0] <= cutoff:
                self._external_global_calls.popleft()
            calls = self._external_session_calls.setdefault(subject, deque())
            while calls and calls[0] <= cutoff:
                calls.popleft()
            if (
                len(self._external_global_calls) >= self._external_rate_limit
                or len(calls) >= self._external_session_rate_limit
            ):
                return False
            self._external_global_calls.append(now)
            calls.append(now)
            if len(self._external_session_calls) > 4096:
                stale_subjects = [
                    key for key, values in self._external_session_calls.items()
                    if not values or values[-1] <= cutoff
                ]
                for key in stale_subjects[:2048]:
                    self._external_session_calls.pop(key, None)
            return True

    async def resolve(self, request: SearchRequestV2) -> SearchResolveResponseV2:
        request = request.model_copy(update={"cursor": None, "limit": min(8, request.limit)})
        page = await self.page(request, mode="resolve")
        if not page.results:
            return SearchResolveResponseV2(
                query=request.query, status="not_found", selected=None,
                alternatives=[], reason="no_candidates", revision=page.revision,
            )
        selected = page.results[0]
        alternatives = page.results[1:6]
        exact = selected.match_reason in {"exact_title", "exact_alias"}
        ambiguous = bool(
            not exact and alternatives
            and abs(float(alternatives[0].score) - float(selected.score)) < 1.0
        )
        return SearchResolveResponseV2(
            query=request.query,
            status="ambiguous" if ambiguous else "resolved",
            selected=selected,
            alternatives=alternatives,
            reason="close_candidates" if ambiguous else "server_ranked_candidate",
            revision=page.revision,
        )


def _merge_results_internal_first(
    internal: list[SearchResultV2], external: list[SearchResultV2],
) -> list[SearchResultV2]:
    result = list(internal)
    seen_ids = {item.result_id.lower() for item in result}
    seen_canonical = {item.canonical_place_id.lower() for item in result if item.canonical_place_id}
    seen_places = {
        (normalize_search_text(item.title), round(item.coordinates.lat, 3), round(item.coordinates.lng, 3))
        for item in result if item.coordinates
    }
    for item in external:
        if item.result_id.lower() in seen_ids:
            continue
        if item.canonical_place_id and item.canonical_place_id.lower() in seen_canonical:
            continue
        place_key = (
            normalize_search_text(item.title),
            round(item.coordinates.lat, 3) if item.coordinates else None,
            round(item.coordinates.lng, 3) if item.coordinates else None,
        )
        if item.coordinates and place_key in seen_places:
            continue
        result.append(item)
        seen_ids.add(item.result_id.lower())
        if item.canonical_place_id:
            seen_canonical.add(item.canonical_place_id.lower())
        if item.coordinates:
            seen_places.add(place_key)
    return result


def _external_result_for_request(
    result: SearchResultV2, request: SearchRequestV2,
) -> SearchResultV2 | None:
    if request.categories and not set(request.categories).intersection(result.categories):
        return None
    if not _intent_accepts(request.intent, result.kind, tuple(result.categories)):
        return None
    radius_meters = request.effective_radius_meters
    if radius_meters is None:
        return result
    distance = result.distance_meters
    if distance is None and request.center and result.coordinates:
        distance = _haversine_m(
            request.center, result.coordinates.lat, result.coordinates.lng,
        )
    if distance is None or distance > radius_meters:
        return None
    if result.distance_meters is None:
        return result.model_copy(update={"distance_meters": round(distance, 1)})
    return result


def _request_fingerprint(request: SearchRequestV2, mode: str) -> str:
    payload = request.model_dump(exclude={"cursor"}, mode="json")
    payload["mode"] = mode
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]


def _external_request_cache_key(
    request: SearchRequestV2, mode: str, provider_limit: int,
) -> str:
    payload = request.model_dump(
        exclude={"cursor"}, mode="json", exclude_none=True,
    )
    payload.update({"mode": mode, "provider_limit": int(provider_limit)})
    return "external:" + hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _encode_cursor(offset: int, fingerprint: str, revision: str) -> str:
    payload = json.dumps(
        {"v": 1, "o": offset, "q": fingerprint, "r": revision},
        sort_keys=True, separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str | None, fingerprint: str, revision: str) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
        offset = int(payload["o"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        raise SearchCursorError("invalid search cursor") from None
    if payload.get("v") != 1 or payload.get("q") != fingerprint:
        raise SearchCursorError("search cursor does not match this request")
    if payload.get("r") != revision:
        raise SearchCursorError("search cursor is stale")
    if offset < 1 or offset > _MAX_CURSOR_OFFSET:
        raise SearchCursorError("search cursor is outside the supported range")
    return offset
