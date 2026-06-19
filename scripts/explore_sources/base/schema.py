from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


QUALITY_LABELS = {
    "basic_map_data",
    "open_community_data",
    "official_source",
    "curated_trailhead",
    "ai_enriched",
    "community_verified",
    "needs_verification",
}


@dataclass
class SourceRef:
    source: str
    source_id: str
    url: str = ""
    license: str = ""
    attribution: str = ""
    quality: str = "basic_map_data"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SourceRecord:
    id: str
    source: str
    source_id: str
    source_url: str = ""
    license: str = ""
    attribution: str = ""
    fetched_at: int = 0
    last_seen_at: int = 0
    raw: dict[str, Any] = field(default_factory=dict)
    name: str = ""
    category: str = ""
    subcategory: str = ""
    lat: float | None = None
    lng: float | None = None
    geometry: dict[str, Any] | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.5

    def source_ref(self, quality: str = "basic_map_data") -> SourceRef:
        return SourceRef(
            source=self.source,
            source_id=self.source_id,
            url=self.source_url,
            license=self.license,
            attribution=self.attribution,
            quality=quality,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TrailGeometry:
    id: str
    source_ids: list[str] = field(default_factory=list)
    name: str = ""
    geometry_line: dict[str, Any] | None = None
    representative_lat: float | None = None
    representative_lng: float | None = None
    distance_mi: float | None = None
    elevation_gain_ft: float | None = None
    elevation_loss_ft: float | None = None
    route_type: str = ""
    activities: list[str] = field(default_factory=list)
    difficulty: str = ""
    surface: str = ""
    access: str = ""
    allowed_uses: list[str] = field(default_factory=list)
    seasonal_notes: str = ""
    land_manager: str = ""
    source_quality: str = "basic_map_data"
    source_confidence: dict[str, Any] = field(default_factory=dict)
    sources: list[dict[str, Any]] = field(default_factory=list)
    linked_place_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ExplorePlaceV3:
    id: str
    source_ids: list[str] = field(default_factory=list)
    name: str = ""
    category: str = ""
    subcategories: list[str] = field(default_factory=list)
    lat: float | None = None
    lng: float | None = None
    geometry: dict[str, Any] | None = None
    country: str = ""
    region: str = ""
    admin: str = ""
    summary: str = ""
    description: str = ""
    tags: list[str] = field(default_factory=list)
    search_aliases: list[str] = field(default_factory=list)
    search_blob: str = ""
    difficulty: str = ""
    best_season: str = ""
    access: str = ""
    safety: str = ""
    amenities: list[str] = field(default_factory=list)
    reservations: dict[str, Any] = field(default_factory=dict)
    media: list[dict[str, Any]] = field(default_factory=list)
    source_pack: dict[str, Any] = field(default_factory=dict)
    card: dict[str, Any] = field(default_factory=dict)
    sources: list[dict[str, Any]] = field(default_factory=list)
    quality: str = "basic_map_data"
    quality_score: float = 0.0
    source_quality: dict[str, Any] = field(default_factory=dict)
    verified: bool = False
    last_seen_at: int = 0
    updated_at: int = 0
    linked_trail_ids: list[str] = field(default_factory=list)
    linked_place_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
