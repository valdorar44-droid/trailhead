#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.base.dedupe import dedupe_places, disambiguate_duplicate_display_names, link_trailheads_to_trails
from scripts.explore_sources.base.enrichment import enrich_place_dict
from scripts.explore_sources.blm.import_blm import BLM_ATTRIBUTION, BLM_LICENSE, import_blm_fixture
from scripts.explore_sources.usfs.import_usfs import USFS_ATTRIBUTION, USFS_LICENSE, import_usfs_fixture
from scripts.data.build_canonical_serving_indexes import build_explore_index, merge_explore_indexes
from dashboard.trails_v2 import build_trail_systems_v2, model_public


USFS_TRAILS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0"
USFS_SITES = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0"
USFS_LANDS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_NFSLandUnit_01/MapServer/0"
BLM_UT_SITES = "https://gis.blm.gov/utarcgis/rest/services/Recreation/BLM_UT_RECS/FeatureServer"
BLM_NATIONAL = "https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation/MapServer"
USFS_METADATA = "https://data.fs.usda.gov/geodata/edw/datasets.php"
BLM_METADATA = "https://www.blm.gov/services/geospatial/GISData/utah"
MOAB_BBOX = (-110.3, 38.0, -109.0, 39.4)

AGENCY_HUBS: dict[str, dict[str, Any]] = {
    "sierra-national-forest": {
        "id": "place:usfs:9006",
        "name": "Sierra National Forest",
        "category": "forest",
        "subcategories": ["national_forest"],
        "region": "CA",
        "summary": (
            "Sierra National Forest supports camping, hiking, biking, horseback riding, fishing, "
            "winter travel and motorized routes across its mountain landscape."
        ),
        "activities": ["Camping", "Hiking", "Biking", "Horseback riding"],
        "official_url": "https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45636",
        "source_id": "usfs-sierra-boundary:316",
        "source": "usfs",
        "attribution": USFS_ATTRIBUTION,
        "license": USFS_LICENSE,
    },
    "moab-blm": {
        "id": "place:blm:moab-field-office",
        "name": "Moab BLM",
        "category": "public_land",
        "subcategories": ["blm_field_office"],
        "region": "UT",
        "summary": (
            "The BLM Moab Field Office manages 1.8 million acres of Colorado Plateau canyon country, "
            "with routes and sites for riding, biking, climbing, hiking, horseback travel and river trips."
        ),
        "activities": ["OHV", "Mountain biking", "Hiking", "River trips"],
        "official_url": "https://www.blm.gov/office/moab-field-office",
        "source_id": "blm-moab-field-office",
        "source": "blm",
        "attribution": BLM_ATTRIBUTION,
        "license": BLM_LICENSE,
    },
}


@dataclass(frozen=True)
class DatasetSpec:
    id: str
    agency: str
    layer_url: str
    where: str
    destination_id: str
    destination_name: str
    feature_kind: str
    minimum_records: int
    default_activity: str = ""
    bbox: tuple[float, float, float, float] | None = None


DATASETS = (
    DatasetSpec("usfs_sierra_boundary", "usfs", USFS_LANDS, "nffid='0069'", "sierra-national-forest", "Sierra National Forest", "national forest", 1),
    DatasetSpec("usfs_sierra_trails", "usfs", USFS_TRAILS, "security_id='0515'", "sierra-national-forest", "Sierra National Forest", "trail", 600),
    DatasetSpec("usfs_sierra_sites", "usfs", USFS_SITES, "security_id='0515'", "sierra-national-forest", "Sierra National Forest", "recreation site", 180),
    DatasetSpec("blm_moab_sites_point", "blm", f"{BLM_UT_SITES}/0", "ADM_UNIT_CD='UTY01000'", "moab-blm", "Moab BLM", "recreation site", 90),
    DatasetSpec("blm_moab_sites_polygon", "blm", f"{BLM_UT_SITES}/1", "ADM_UNIT_CD='UTY01000'", "moab-blm", "Moab BLM", "recreation site", 0),
    DatasetSpec("blm_moab_mtb_opportunities", "blm", f"{BLM_NATIONAL}/4", "1=1", "moab-blm", "Moab BLM", "mountain bike opportunity", 3, "bike", MOAB_BBOX),
    DatasetSpec("blm_moab_mtb_routes", "blm", f"{BLM_NATIONAL}/5", "1=1", "moab-blm", "Moab BLM", "mountain bike trail", 40, "bike", MOAB_BBOX),
    DatasetSpec("blm_moab_managed_trails", "blm", f"{BLM_NATIONAL}/7", "ADMIN_ST='UT'", "moab-blm", "Moab BLM", "managed public trail", 200, "", MOAB_BBOX),
    DatasetSpec("blm_moab_recreation_areas", "blm", f"{BLM_NATIONAL}/9", "1=1", "moab-blm", "Moab BLM", "recreation area", 1, "", MOAB_BBOX),
    DatasetSpec("blm_moab_featured_sites", "blm", f"{BLM_NATIONAL}/12", "1=1", "moab-blm", "Moab BLM", "featured recreation site", 5, "", MOAB_BBOX),
)


class RequestBudget:
    def __init__(self, maximum: int) -> None:
        if maximum < 1 or maximum > 60:
            raise ValueError("request budget must be between 1 and 60")
        self.maximum = maximum
        self.used = 0

    def fetch_json(self, url: str, timeout: float) -> dict[str, Any]:
        if self.used >= self.maximum:
            raise RuntimeError(f"agency request budget exhausted at {self.maximum}")
        self.used += 1
        request = urllib.request.Request(url, headers={"User-Agent": "Trailhead Explore data audit/1.0"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError(f"unexpected ArcGIS response from {url}")
        if payload.get("error"):
            raise RuntimeError(f"ArcGIS error from {url}: {payload['error']}")
        return payload


def source_metadata(spec: DatasetSpec) -> dict[str, str]:
    if spec.agency == "usfs":
        return {
            "source_url": spec.layer_url,
            "metadata_url": USFS_METADATA,
            "license": USFS_LICENSE,
            "attribution": USFS_ATTRIBUTION,
        }
    return {
        "source_url": spec.layer_url,
        "metadata_url": BLM_METADATA,
        "license": BLM_LICENSE,
        "attribution": BLM_ATTRIBUTION,
    }


def fetch_dataset(spec: DatasetSpec, budget: RequestBudget, timeout: float, page_size: int = 2000) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    seen: set[str] = set()
    offset = 0
    while True:
        params: dict[str, str | int] = {
            "where": spec.where,
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "orderByFields": "OBJECTID",
        }
        if spec.bbox:
            params.update({
                "geometry": ",".join(str(value) for value in spec.bbox),
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
            })
        url = f"{spec.layer_url}/query?{urllib.parse.urlencode(params)}"
        payload = budget.fetch_json(url, timeout)
        page = list(payload.get("features") or [])
        metadata = source_metadata(spec)
        new_count = 0
        for feature in page:
            if not isinstance(feature, dict):
                continue
            props = dict(feature.get("properties") or {})
            raw_id = str(props.get("OBJECTID") or props.get("objectid") or props.get("GlobalID") or props.get("globalid") or "")
            stable = f"{spec.id}:{raw_id or len(features)}"
            if stable in seen:
                continue
            seen.add(stable)
            props.update({
                "_trailhead_dataset_id": spec.id,
                "_trailhead_source_url": metadata["source_url"],
                "_trailhead_metadata_url": metadata["metadata_url"],
                "_trailhead_license": metadata["license"],
                "_trailhead_attribution": metadata["attribution"],
                "_trailhead_destination_id": spec.destination_id,
                "_trailhead_destination_name": spec.destination_name,
                "_trailhead_feature_kind": spec.feature_kind,
                "_trailhead_default_activity": spec.default_activity,
            })
            feature["properties"] = props
            features.append(feature)
            new_count += 1
        if len(page) < page_size or not new_count:
            break
        offset += len(page)
    return {"type": "FeatureCollection", "features": features}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def write_jsonl(path: Path, payloads: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in payloads) + ("\n" if payloads else ""))


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def is_technical_route_name(value: str) -> bool:
    text = re.sub(r"\s+", " ", value).strip()
    return bool(
        re.fullmatch(r"(?:[A-Z]?\d{1,5}[A-Z]?)(?:[-/. ]\d{1,5}[A-Z]?)?", text, re.I)
        or re.fullmatch(r"[A-Z]{1,3}\d{1,4}[A-Z]{0,2}", text, re.I)
        or re.fullmatch(r"\d{1,3}[A-Z]\d{1,4}[A-Z]?", text, re.I)
        or re.fullmatch(r"(?:forest|fs)\s+road\s+[A-Z0-9./-]+", text, re.I)
    )


def merge_colocated_agency_amenities(places: list[Any]) -> list[Any]:
    amenity_labels = {
        "parking": "parking",
        "restroom": "toilets",
    }
    groups: dict[tuple[str, float, float], list[Any]] = {}
    for place in places:
        key = (normalize_name(place.name), round(float(place.lat or 0), 5), round(float(place.lng or 0), 5))
        groups.setdefault(key, []).append(place)
    removed: set[str] = set()
    for group in groups.values():
        primary = next((item for item in group if item.category != "place"), None)
        if not primary:
            continue
        for item in group:
            if item is primary or item.category != "place":
                continue
            mapped = [amenity_labels[value] for value in item.subcategories if value in amenity_labels]
            if not mapped:
                continue
            primary.source_ids = list(dict.fromkeys([*primary.source_ids, *item.source_ids]))
            primary.amenities = list(dict.fromkeys([*primary.amenities, *mapped]))
            primary.sources = list({
                (source.get("source"), source.get("source_id")): source
                for source in [*primary.sources, *item.sources]
            }.values())
            removed.add(item.id)
    return [place for place in places if place.id not in removed]


def visible_text(place: dict[str, Any]) -> str:
    card = place.get("card") if isinstance(place.get("card"), dict) else {}
    return " ".join(str(value or "") for value in (
        place.get("name"),
        place.get("summary"),
        place.get("description"),
        place.get("access"),
        place.get("safety"),
        card.get("summary"),
        " ".join(card.get("warnings") or []),
    ))


def audit_candidate(
    specs: tuple[DatasetSpec, ...],
    feature_counts: dict[str, int],
    records: list[dict[str, Any]],
    places: list[dict[str, Any]],
    trails: list[dict[str, Any]],
) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    def finding(target: list[dict[str, Any]], code: str, count: int, samples: list[str], why: str) -> None:
        if count:
            target.append({"code": code, "count": count, "samples": samples[:12], "why_it_matters": why})

    datasets = Counter(
        str((item.get("properties") or {}).get("_trailhead_dataset_id") or "missing")
        for item in records
    )
    for spec in specs:
        count = feature_counts.get(spec.id, 0)
        if count < spec.minimum_records:
            errors.append({
                "code": "dataset_below_minimum",
                "dataset": spec.id,
                "count": count,
                "minimum": spec.minimum_records,
                "why_it_matters": "The pilot would silently omit a material part of an official source layer.",
            })
        imported = datasets.get(spec.id, 0)
        if imported < spec.minimum_records:
            errors.append({
                "code": "imported_dataset_below_minimum",
                "dataset": spec.id,
                "count": imported,
                "minimum": spec.minimum_records,
                "why_it_matters": "The source downloaded, but too many records were lost during normalization.",
            })

    record_ids = [str(item.get("id") or "") for item in records]
    place_ids = [str(item.get("id") or "") for item in places]
    trail_ids = [str(item.get("id") or "") for item in trails]
    finding(errors, "duplicate_source_record_id", len(record_ids) - len(set(record_ids)), [], "Duplicate source grain can produce unstable joins and repeated cards.")
    finding(errors, "duplicate_place_id", len(place_ids) - len(set(place_ids)), [], "Duplicate place IDs break deterministic selection and updates.")
    finding(errors, "duplicate_trail_id", len(trail_ids) - len(set(trail_ids)), [], "Duplicate trail IDs break route identity and offline revision binding.")

    invalid_sources = [item.get("id", "") for item in records if not str(item.get("source_url") or "").startswith("https://")]
    placeholder_licenses = [
        item.get("id", "") for item in records
        if re.search(r"verify current|tbd|unknown|placeholder", str(item.get("license") or ""), re.I)
    ]
    missing_core = [
        item.get("id", "") for item in records
        if not item.get("id") or not item.get("name") or item.get("lat") is None or item.get("lng") is None
    ]
    finding(errors, "invalid_source_url", len(invalid_sources), invalid_sources, "Official provenance must resolve through HTTPS.")
    finding(errors, "placeholder_license", len(placeholder_licenses), placeholder_licenses, "Candidate records need reviewed source terms before promotion.")
    finding(errors, "missing_record_identity", len(missing_core), missing_core, "Records without identity or location cannot be reconciled safely.")

    unsupported = [
        item.get("id", "") for item in places
        if re.search(r"verify (?:access|current|local)|check local rules|artificial intelligence|\bAI\b|provider slug", visible_text(item), re.I)
    ]
    finding(errors, "unsupported_or_filler_copy", len(unsupported), unsupported, "Generic instructions obscure what the agency actually supplied.")

    technical_names = [item.get("name", "") for item in trails if is_technical_route_name(str(item.get("name") or ""))]
    finding(warnings, "technical_route_names", len(technical_names), technical_names, "Raw route identifiers should not dominate discovery without a public name.")

    missing_activities = [item.get("id", "") for item in trails if not item.get("activities")]
    finding(warnings, "activity_not_listed", len(missing_activities), missing_activities, "Unknown permitted use must remain omitted rather than being guessed.")

    near_keys = Counter(
        (normalize_name(str(item.get("name") or "")), round(float(item.get("lat") or 0), 4), round(float(item.get("lng") or 0), 4))
        for item in places
    )
    near_duplicates = [name for (name, _lat, _lng), count in near_keys.items() if name and count > 1]
    finding(warnings, "near_duplicate_places", len(near_duplicates), near_duplicates, "Cross-layer duplicate candidates need deterministic review before serving.")

    categories = Counter(str(item.get("category") or "missing") for item in places)
    return {
        "schema_version": 1,
        "intended_grain": {
            "source_records": "one official ArcGIS feature per dataset-qualified stable source ID",
            "places": "one deterministic place card after exact-source deduplication",
            "trails": "one named source route segment before TrailSystem V2 connected-route grouping",
        },
        "counts": {"source_records": len(records), "places": len(places), "trails": len(trails)},
        "dataset_counts": dict(sorted(datasets.items())),
        "place_categories": dict(sorted(categories.items())),
        "errors": errors,
        "warnings": warnings,
        "promotion_ready": not errors,
        "assumptions": [
            "Empty editorial fields are acceptable and are not backfilled with generated copy.",
            "Missing permitted use is retained as unknown and does not imply hiking access.",
            "BLM Moab scope is the fixed pilot envelope plus Moab Field Office recreation sites.",
        ],
    }


def source_item(place: dict[str, Any]) -> dict[str, Any]:
    source = (place.get("sources") or [{}])[0]
    item = {
        "source_id": place.get("id"),
        "title": place.get("name"),
        "kind": (place.get("subcategories") or [place.get("category")])[0],
        "category": place.get("category"),
        "lat": place.get("lat"),
        "lng": place.get("lng"),
        "url": source.get("url", ""),
        "source": source.get("source", ""),
        "source_label": source.get("attribution", ""),
    }
    description = str(place.get("summary") or place.get("description") or "").strip()
    if description:
        item["description"] = description
    amenities = [str(value) for value in place.get("amenities") or [] if str(value).strip()]
    if amenities:
        item["amenities"] = amenities
    return item


def trail_profile(segment: dict[str, Any]) -> dict[str, Any]:
    source = (segment.get("sources") or [{}])[0]
    return {
        "id": segment.get("id"),
        "name": segment.get("name"),
        "lat": segment.get("representative_lat"),
        "lng": segment.get("representative_lng"),
        "length_mi": segment.get("distance_mi"),
        "elevation_gain_ft": segment.get("elevation_gain_ft"),
        "difficulty": segment.get("difficulty"),
        "activities": segment.get("activities") or [],
        "allowed_uses": segment.get("allowed_uses") or [],
        "surface": segment.get("surface"),
        "route_type": segment.get("route_type"),
        "geometry": segment.get("geometry_line"),
        "feature_type": "trail",
        "land_manager": segment.get("land_manager"),
        "source": source.get("source"),
        "source_label": source.get("attribution"),
        "official_url": source.get("url"),
        "provenance": {
            "catalog": {
                "feature_type": "trail",
                "route_type": segment.get("route_type"),
                "surface": segment.get("surface"),
            },
        },
    }


def build_destination_pack(destination_id: str, name: str, places: list[dict[str, Any]], trails: list[dict[str, Any]]) -> dict[str, Any]:
    scoped_places = [
        item for item in places
        if any(destination_id in str(source_id) for source_id in item.get("source_ids") or [])
        or destination_id in str(item.get("admin") or "").casefold().replace(" ", "-")
    ]
    # Dataset metadata is a more reliable scope than display text after deduplication.
    if not scoped_places:
        scoped_places = places
    by_category: dict[str, list[dict[str, Any]]] = {}
    for item in scoped_places:
        by_category.setdefault(str(item.get("category") or "place"), []).append(source_item(item))
    trail_items = []
    for item in trails:
        center = item.get("center") if isinstance(item.get("center"), dict) else {}
        source = (item.get("sources") or [{}])[0]
        trail_items.append({
            "source_id": item.get("id"),
            "title": item.get("name"),
            "kind": "trail",
            "lat": center.get("lat", item.get("representative_lat")),
            "lng": center.get("lng", item.get("representative_lng")),
            "source": source.get("kind", source.get("source", "")),
            "source_label": source.get("label", source.get("attribution", "")),
        })
    things_to_see = by_category.get("viewpoint", []) + by_category.get("historic_site", []) + by_category.get("public_land", [])
    source_backed_place_activities = [
        item for item in by_category.get("place", [])
        if item.get("kind") in {"picnic_site", "boat_access", "fishing_access", "day_use_area"}
    ]
    things_to_do = (
        by_category.get("activity", [])
        + by_category.get("offroad_route", [])
        + by_category.get("scenic_drive", [])
        + source_backed_place_activities
    )
    return {
        "id": destination_id,
        "name": name,
        "source_pack": {
            "primary": "usfs" if destination_id.startswith("sierra") else "blm",
            "things_to_see": things_to_see,
            "things_to_do": things_to_do,
            "visitor_centers": by_category.get("visitor_center", []),
            "campgrounds": by_category.get("campground", []) + by_category.get("dispersed_camp", []),
            "parking_lots": [item for item in by_category.get("place", []) if item.get("kind") == "parking"],
            "trails": trail_items,
            "official_sources": sorted({
                source.get("url", "")
                for place in scoped_places
                for source in place.get("sources") or []
                if source.get("url")
            }),
        },
    }


def median_center(places: list[dict[str, Any]]) -> tuple[float, float]:
    points = sorted(
        (float(item["lat"]), float(item["lng"]))
        for item in places
        if item.get("lat") is not None and item.get("lng") is not None
    )
    if not points:
        raise ValueError("agency destination has no valid center")
    middle = len(points) // 2
    if len(points) % 2:
        return points[middle]
    return (
        (points[middle - 1][0] + points[middle][0]) / 2,
        (points[middle - 1][1] + points[middle][1]) / 2,
    )


def build_destination_hub(
    destination_id: str,
    places: list[dict[str, Any]],
    trails: list[dict[str, Any]],
    fetched_at: int,
) -> dict[str, Any]:
    definition = AGENCY_HUBS[destination_id]
    pack = build_destination_pack(destination_id, definition["name"], places, trails)["source_pack"]
    pack.update({
        "primary": definition["attribution"],
        "official_url": definition["official_url"],
        "license": definition["license"],
        "extract": definition["summary"],
        "activities": definition["activities"],
        "sources": [{
            "title": definition["attribution"],
            "publisher": definition["attribution"],
            "url": definition["official_url"],
            "kind": "official_source",
        }],
    })
    boundary = next((item for item in places if item.get("geometry") and item.get("category") in {"forest", "public_land"}), None)
    lat, lng = (
        (float(boundary["lat"]), float(boundary["lng"]))
        if boundary and boundary.get("lat") is not None and boundary.get("lng") is not None
        else median_center(places)
    )
    hub = {
        "id": definition["id"],
        "source_ids": [f'{definition["source"]}:{definition["source_id"]}'],
        "name": definition["name"],
        "category": definition["category"],
        "subcategories": definition["subcategories"],
        "lat": lat,
        "lng": lng,
        "geometry": boundary.get("geometry") if boundary else None,
        "country": "US",
        "region": definition["region"],
        "admin": definition["name"],
        "summary": definition["summary"],
        "description": definition["summary"],
        "tags": [definition["source"], "public lands", "destination guide"],
        "search_aliases": [definition["name"], destination_id.replace("-", " ")],
        "source_pack": pack,
        "card": {
            "title": definition["name"],
            "headline": definition["name"],
            "summary": definition["summary"],
            "source_badge": definition["attribution"],
        },
        "sources": [{
            "source": definition["source"],
            "source_id": definition["source_id"],
            "url": definition["official_url"],
            "license": definition["license"],
            "attribution": definition["attribution"],
            "quality": "official_source",
        }],
        "quality": "official_source",
        "verified": True,
        "last_seen_at": fetched_at,
        "updated_at": fetched_at,
        "linked_trail_ids": [str(item.get("id")) for item in trails if item.get("id")],
    }
    return enrich_place_dict(hub)


def build_pilot_catalog(
    place_dicts: list[dict[str, Any]],
    trail_system_dicts: list[dict[str, Any]],
    fetched_at: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    enriched = [enrich_place_dict(item) for item in place_dicts]
    reviewable = [item for item in enriched if item.get("reviewable")]
    usfs_places = [item for item in place_dicts if item.get("sources", [{}])[0].get("source") == "usfs"]
    blm_places = [item for item in place_dicts if item.get("sources", [{}])[0].get("source") == "blm"]
    usfs_trails = [item for item in trail_system_dicts if any(source.get("label") == USFS_ATTRIBUTION for source in item.get("sources") or [])]
    blm_trails = [item for item in trail_system_dicts if any(source.get("label") == BLM_ATTRIBUTION for source in item.get("sources") or [])]
    hubs = [
        build_destination_hub("sierra-national-forest", usfs_places, usfs_trails, fetched_at),
        build_destination_hub("moab-blm", blm_places, blm_trails, fetched_at),
    ]
    if any(not hub.get("reviewable") for hub in hubs):
        blocked = {hub["id"]: hub.get("rejection_reasons") for hub in hubs if not hub.get("reviewable")}
        raise ValueError(f"agency destination hub failed enrichment gate: {blocked}")
    items = [*reviewable, *hubs]
    return ({
        "schema_version": 3,
        "catalog_id": "trailhead-explore-agency-pilots-v1",
        "generated_at": fetched_at,
        "source": "Trailhead Explore agency pilots",
        "count": len(items),
        "places": items,
    }, hubs)


def build_serving_review(
    out_dir: Path,
    pilot_index: dict[str, Any],
    current_index_path: Path,
) -> dict[str, Any]:
    if not current_index_path.is_file():
        return {
            "current_index": str(current_index_path),
            "current_index_available": False,
            "candidate_count": len(pilot_index.get("items") or []),
        }
    current = json.loads(current_index_path.read_text())
    minimum = int((current.get("gate") or {}).get("minimum_reviewable") or 1)
    merged = merge_explore_indexes([current, pilot_index], minimum_reviewable=minimum)
    write_json(out_dir / "serving_index_merged_review.json", merged)

    current_by_id = {
        str(item.get("id") or ""): item
        for item in current.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }
    pilot_by_id = {
        str(item.get("id") or ""): item
        for item in pilot_index.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }
    replaced = sorted(item_id for item_id in pilot_by_id if item_id in current_by_id)
    added = sorted(item_id for item_id in pilot_by_id if item_id not in current_by_id)
    return {
        "current_index": str(current_index_path),
        "current_index_available": True,
        "current_count": len(current.get("items") or []),
        "candidate_count": len(pilot_by_id),
        "merged_count": len(merged.get("items") or []),
        "replaced_count": len(replaced),
        "added_count": len(added),
        "replaced_ids": replaced,
        "added_ids": added,
        "gate": merged.get("gate"),
        "live_serving_index_modified": False,
    }


def build_candidate(out_dir: Path, max_requests: int, timeout: float, reuse_source_dir: Path | None = None) -> dict[str, Any]:
    budget = RequestBudget(max_requests)
    source_dir = out_dir / "source"
    feature_counts: dict[str, int] = {}
    agency_features: dict[str, list[dict[str, Any]]] = {"usfs": [], "blm": []}
    for spec in DATASETS:
        reused_path = reuse_source_dir / f"{spec.id}.geojson" if reuse_source_dir else None
        if reused_path:
            if not reused_path.is_file():
                raise FileNotFoundError(f"missing reusable source fixture: {reused_path}")
            payload = json.loads(reused_path.read_text())
        else:
            payload = fetch_dataset(spec, budget, timeout)
        feature_counts[spec.id] = len(payload["features"])
        agency_features[spec.agency].extend(payload["features"])
        write_json(source_dir / f"{spec.id}.geojson", payload)

    usfs_bundle = {"type": "FeatureCollection", "features": agency_features["usfs"]}
    blm_bundle = {"type": "FeatureCollection", "features": agency_features["blm"]}
    usfs_path = source_dir / "usfs_sierra.geojson"
    blm_path = source_dir / "blm_moab.geojson"
    write_json(usfs_path, usfs_bundle)
    write_json(blm_path, blm_bundle)

    fetched_at = int(time.time())
    usfs_records, usfs_places, usfs_trails = import_usfs_fixture(usfs_path, fetched_at=fetched_at)
    blm_records, blm_places, blm_trails = import_blm_fixture(blm_path, fetched_at=fetched_at)
    records = usfs_records + blm_records
    places = merge_colocated_agency_amenities(dedupe_places(usfs_places + blm_places))
    trails = usfs_trails + blm_trails
    disambiguate_duplicate_display_names(places)
    link_trailheads_to_trails(places, trails)

    record_dicts = []
    for record in records:
        item = record.to_dict()
        item.pop("raw", None)
        record_dicts.append(item)
    place_dicts = [place.to_dict() for place in places]
    trail_segment_dicts = [trail.to_dict() for trail in trails]
    trail_system_dicts = [
        model_public(system)
        for system in build_trail_systems_v2([trail_profile(segment) for segment in trail_segment_dicts], limit=5000)
    ]
    audit = audit_candidate(DATASETS, feature_counts, record_dicts, place_dicts, trail_segment_dicts)
    audit["counts"]["trail_systems"] = len(trail_system_dicts)

    write_jsonl(out_dir / "source_records.jsonl", record_dicts)
    write_json(out_dir / "places.json", {"schema_version": 3, "count": len(place_dicts), "places": place_dicts})
    write_json(out_dir / "trail_segments.json", {"schema_version": 1, "count": len(trail_segment_dicts), "trails": trail_segment_dicts})
    write_json(out_dir / "trails.json", {"schema_version": 2, "count": len(trail_system_dicts), "trails": trail_system_dicts})
    destinations = [
        build_destination_pack("sierra-national-forest", "Sierra National Forest", [item for item in place_dicts if item.get("sources", [{}])[0].get("source") == "usfs"], [item for item in trail_system_dicts if any(source.get("label") == USFS_ATTRIBUTION for source in item.get("sources") or [])]),
        build_destination_pack("moab-blm", "Moab BLM", [item for item in place_dicts if item.get("sources", [{}])[0].get("source") == "blm"], [item for item in trail_system_dicts if any(source.get("label") == BLM_ATTRIBUTION for source in item.get("sources") or [])]),
    ]
    write_json(out_dir / "destinations.json", {
        "schema_version": 1,
        "destinations": destinations,
    })
    pilot_catalog, hubs = build_pilot_catalog(place_dicts, trail_system_dicts, fetched_at)
    write_json(out_dir / "explore_catalog_v3.json", pilot_catalog)
    pilot_index = build_explore_index(out_dir / "explore_catalog_v3.json", minimum_reviewable=1, enforce_enrichment_gate=True)
    accepted_ids = {
        str(item.get("id") or "")
        for item in pilot_index.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }
    # The canonical serving gate is stricter than the reusable enrichment
    # score. Keep records that fail it inside source-backed destination modules,
    # but do not publish them as standalone organic cards.
    pilot_catalog["places"] = [
        item for item in pilot_catalog["places"]
        if str(item.get("id") or "") in accepted_ids
    ]
    pilot_catalog["count"] = len(pilot_catalog["places"])
    write_json(out_dir / "explore_catalog_v3.json", pilot_catalog)
    pilot_index = build_explore_index(out_dir / "explore_catalog_v3.json", minimum_reviewable=1, enforce_enrichment_gate=True)
    if pilot_index.get("rejections"):
        raise ValueError("agency pilot serving catalog contains rejected standalone records")
    pilot_index["catalogs"] = [{
        "catalog_id": pilot_catalog["catalog_id"],
        "generated_at": fetched_at,
        "source_count": pilot_index["source_count"],
    }]
    write_json(out_dir / "serving_index_review.json", pilot_index)
    promotion_review = build_serving_review(
        out_dir,
        pilot_index,
        ROOT / "dashboard" / "explore_serving_index_v2.json",
    )
    write_json(out_dir / "promotion_review.json", promotion_review)
    audit["counts"].update({
        "reviewable_places": len(pilot_catalog["places"]) - len(hubs),
        "destination_hubs": len(hubs),
    })
    write_json(out_dir / "audit.json", audit)

    artifact_names = [
        "source_records.jsonl",
        "places.json",
        "trail_segments.json",
        "trails.json",
        "destinations.json",
        "explore_catalog_v3.json",
        "serving_index_review.json",
        "promotion_review.json",
        "audit.json",
    ]
    if (out_dir / "serving_index_merged_review.json").is_file():
        artifact_names.append("serving_index_merged_review.json")
    manifest = {
        "schema_version": 1,
        "generated_at": fetched_at,
        "request_budget": max_requests,
        "requests_used": budget.used,
        "feature_counts": feature_counts,
        "promotion_ready": audit["promotion_ready"],
        "artifacts": [
            {"path": name, "bytes": (out_dir / name).stat().st_size, "sha256": sha256_file(out_dir / name)}
            for name in artifact_names
        ],
        "live_serving_index_modified": False,
    }
    write_json(out_dir / "manifest.json", manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build isolated Sierra USFS and Moab BLM Explore pilot candidates.")
    parser.add_argument("--out-dir", required=True, help="Isolated audit candidate directory; never the live dashboard directory.")
    parser.add_argument("--max-requests", type=int, default=40, help="Hard ArcGIS request cap (1-60).")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--reuse-source-dir", help="Rebuild from a prior candidate's source directory without network calls.")
    args = parser.parse_args()
    out_dir = Path(args.out_dir).resolve()
    if "audit_candidates" not in out_dir.parts:
        raise SystemExit("refusing to write outside an audit_candidates directory")
    reuse_source_dir = Path(args.reuse_source_dir).resolve() if args.reuse_source_dir else None
    manifest = build_candidate(out_dir, args.max_requests, args.timeout, reuse_source_dir=reuse_source_dir)
    print(json.dumps(manifest, indent=2))
    return 0 if manifest["promotion_ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
