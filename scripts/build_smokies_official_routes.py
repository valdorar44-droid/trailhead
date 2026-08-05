#!/usr/bin/env python3
"""Build immutable official-road evidence for the Smokies Original.

The network refresh is explicit. Ordinary checks rebuild only from the checked
snapshot, so tests never spend provider quota or silently accept source drift.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import parse as urllib_parse
from urllib import request as urllib_request

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from db.originals_route_sources import (
    DATUM_TRANSFORMATION,
    EXPECTED_FACILITY_COUNTS,
    EXPECTED_FACILITY_POLICY,
    EXPECTED_ROAD_COUNTS,
    NPS_DISCLAIMER_URL,
    NPS_PUBLIC_DOMAIN_URL,
    NPS_QUERY_FIELDS,
    NPS_ROAD_IRMA_URL,
    NPS_ROAD_ITEMINFO_URL,
    NPS_ROAD_LAYER_URL,
    NPS_ROAD_METADATA_URL,
    NPS_ROAD_SERVICE_URL,
    OUTPUT_SPATIAL_REFERENCE,
    PRODUCT_ID,
    SELECTED_FEATURE_COUNT,
    SOURCE_OBJECT_COUNT,
    SOURCE_SPATIAL_REFERENCE,
    OriginalRouteSourceError,
    build_official_route_evidence,
    canonical_sha256,
    normalize_nps_road_snapshot,
    reviewed_query_contract,
)
from scripts.build_smokies_original_routes import load_route_spec


DEFAULT_SNAPSHOT = REPO_ROOT / "originals" / "smokies" / "nps_public_roads_snapshot_v1.json"
DEFAULT_ROUTE_SPEC = REPO_ROOT / "originals" / "smokies" / "route_variants_v1.json"
DEFAULT_EVIDENCE = REPO_ROOT / "originals" / "smokies" / "official_route_evidence_v1.json"
DEFAULT_AUDIT_DIRECTORY = REPO_ROOT / "output" / "smokies-original" / "official-road-audit"
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
USER_AGENT = "Trailhead-Originals-Authoring/1.0"


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def _request_json(url: str, *, data: dict[str, str] | None = None) -> dict:
    encoded = None if data is None else urllib_parse.urlencode(data).encode("utf-8")
    request = urllib_request.Request(
        url,
        data=encoded,
        method="GET" if encoded is None else "POST",
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib_request.urlopen(request, timeout=120) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except OSError as exc:
        raise OriginalRouteSourceError("Official NPS road source is unavailable") from exc
    if len(payload) > MAX_RESPONSE_BYTES:
        raise OriginalRouteSourceError("Official NPS road response exceeded the safety cap")
    try:
        result = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise OriginalRouteSourceError("Official NPS road source returned invalid JSON") from exc
    if not isinstance(result, dict) or result.get("error"):
        raise OriginalRouteSourceError("Official NPS road source returned an error")
    return result


def _post_query(parameters: dict[str, str]) -> dict:
    return _request_json(f"{NPS_ROAD_LAYER_URL}/query", data=parameters)


def _date_from_epoch_milliseconds(value: object) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OriginalRouteSourceError("NPS road date is malformed")
    return datetime.fromtimestamp(float(value) / 1_000, tz=timezone.utc).date().isoformat()


def _optional_text(value: object) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise OriginalRouteSourceError("NPS road text value is malformed")
    clean = " ".join(value.split())
    return clean or None


def _guid(value: object) -> str:
    if not isinstance(value, str):
        raise OriginalRouteSourceError("NPS road source identity is missing")
    return value.strip().strip("{}").lower()


def _facility_key(attributes: dict[str, Any]) -> str | None:
    facility = _optional_text(attributes.get("FACLOCID"))
    if facility in EXPECTED_FACILITY_POLICY:
        return facility
    road_name = _optional_text(attributes.get("RDNAME"))
    maintainer = _optional_text(attributes.get("RDMAINTAINER"))
    if road_name == "Foothills Parkway West" and maintainer == "Federal Highway Administration":
        return "foothills_fhwa_unassigned"
    if road_name == "Foothills Parkway Access Road" and maintainer == "Federal Highway Administration":
        return "foothills_access_fhwa_unassigned"
    return None


def _selected(raw_feature: dict) -> bool:
    attributes = raw_feature.get("attributes")
    return isinstance(attributes, dict) and _facility_key(attributes) is not None


def _normalize_raw_feature(raw_feature: dict) -> dict:
    attributes = raw_feature.get("attributes")
    geometry = raw_feature.get("geometry")
    if not isinstance(attributes, dict) or not isinstance(geometry, dict):
        raise OriginalRouteSourceError("NPS road feature is malformed")
    paths = geometry.get("paths")
    if not isinstance(paths, list) or len(paths) != 1 or not isinstance(paths[0], list):
        raise OriginalRouteSourceError("Reviewed NPS road feature must be a single path")
    lanes = attributes.get("RDLANES")
    if isinstance(lanes, float) and lanes.is_integer():
        lanes = int(lanes)
    return {
        "object_id": attributes.get("OBJECTID"),
        "geometry_id": _guid(attributes.get("GEOMETRYID")),
        "feature_id": _guid(attributes.get("FEATUREID")),
        "facility_location_id": _optional_text(attributes.get("FACLOCID")),
        "maintainer": _optional_text(attributes.get("RDMAINTAINER")),
        "road_name": _optional_text(attributes.get("RDNAME")),
        "road_alt_name": _optional_text(attributes.get("RDALTNAME")),
        "map_label": _optional_text(attributes.get("MAPLABEL")),
        "road_status": _optional_text(attributes.get("RDSTATUS")),
        "road_class": _optional_text(attributes.get("RDCLASS")),
        "surface": _optional_text(attributes.get("RDSURFACE")),
        "one_way": _optional_text(attributes.get("RDONEWAY")),
        "lanes": lanes,
        "route_number": _optional_text(attributes.get("RTENUMBER")),
        "seasonal": _optional_text(attributes.get("SEASONAL")),
        "season_description": _optional_text(attributes.get("SEASDESC")),
        "high_clearance": _optional_text(attributes.get("RDHICLEAR")),
        "is_extant": _optional_text(attributes.get("ISEXTANT")),
        "public_display": _optional_text(attributes.get("PUBLICDISPLAY")),
        "data_access": _optional_text(attributes.get("DATAACCESS")),
        "originator": _optional_text(attributes.get("ORIGINATOR")),
        "unit_code": _optional_text(attributes.get("UNITCODE")),
        "created_date": _date_from_epoch_milliseconds(attributes.get("CREATEDATE")),
        "edit_date": _date_from_epoch_milliseconds(attributes.get("EDITDATE")),
        "line_type": _optional_text(attributes.get("LINETYPE")),
        "map_method": _optional_text(attributes.get("MAPMETHOD")),
        "map_source": _optional_text(attributes.get("MAPSOURCE")),
        "source_date": _date_from_epoch_milliseconds(attributes.get("SOURCEDATE")),
        "xy_accuracy": _optional_text(attributes.get("XYACCURACY")),
        "access_notes": _optional_text(attributes.get("ACCESSNOTES")),
        "route_id": _optional_text(attributes.get("ROUTEID")),
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [round(float(coordinate[0]), 7), round(float(coordinate[1]), 7)]
                for coordinate in paths[0]
            ],
        },
    }


def _date_range(features: list[dict], key: str) -> dict[str, str] | None:
    values = sorted(item[key] for item in features if item.get(key))
    if not values:
        return None
    return {"minimum": values[0], "maximum": values[-1]}


def _field_schema(layer_definition: dict) -> list[dict]:
    fields = layer_definition.get("fields")
    if not isinstance(fields, list):
        raise OriginalRouteSourceError("NPS road field schema is unavailable")
    by_name = {item.get("name"): item for item in fields if isinstance(item, dict)}
    missing = [name for name in NPS_QUERY_FIELDS if name not in by_name]
    if missing:
        raise OriginalRouteSourceError("NPS road field schema changed without review")
    return [
        {
            key: by_name[name].get(key)
            for key in ("name", "alias", "type", "length", "nullable", "editable")
            if key in by_name[name]
        }
        for name in NPS_QUERY_FIELDS
    ]


def _domain_schema(layer_definition: dict) -> list[dict]:
    fields = layer_definition.get("fields")
    if not isinstance(fields, list):
        raise OriginalRouteSourceError("NPS road domain schema is unavailable")
    return [
        {"name": item.get("name"), "domain": item.get("domain")}
        for item in fields
        if isinstance(item, dict) and item.get("name") in NPS_QUERY_FIELDS
    ]


def fetch_snapshot(*, retrieved_at: str, reviewed_by: str) -> tuple[dict, dict]:
    layer_before = _request_json(f"{NPS_ROAD_LAYER_URL}?f=json")
    iteminfo = _request_json(f"{NPS_ROAD_ITEMINFO_URL}?f=json")
    ids_response = _post_query(
        {"where": "UNITCODE='GRSM'", "returnIdsOnly": "true", "f": "json"}
    )
    object_ids = ids_response.get("objectIds")
    if not isinstance(object_ids, list) or len(object_ids) != SOURCE_OBJECT_COUNT:
        raise OriginalRouteSourceError("NPS GRSM road object count changed without review")
    if any(isinstance(value, bool) or not isinstance(value, int) for value in object_ids):
        raise OriginalRouteSourceError("NPS GRSM object identifiers are invalid")
    ordered_ids = sorted(object_ids)
    transform = json.dumps(
        {
            "geoTransforms": [
                {
                    "wkid": DATUM_TRANSFORMATION["wkid"],
                    "transformForward": DATUM_TRANSFORMATION["transform_forward"],
                }
            ]
        },
        separators=(",", ":"),
    )
    raw_features: list[dict] = []
    for offset in range(0, len(ordered_ids), 500):
        response = _post_query(
            {
                "objectIds": ",".join(str(value) for value in ordered_ids[offset : offset + 500]),
                "outFields": ",".join(NPS_QUERY_FIELDS),
                "returnGeometry": "true",
                "outSR": "4326",
                "datumTransformation": transform,
                "returnZ": "false",
                "returnM": "false",
                "returnTrueCurves": "false",
                "f": "json",
            }
        )
        features = response.get("features")
        if not isinstance(features, list):
            raise OriginalRouteSourceError("NPS road batch did not contain features")
        raw_features.extend(features)
    if len(raw_features) != SOURCE_OBJECT_COUNT:
        raise OriginalRouteSourceError("NPS road batch retrieval was incomplete")
    layer_after = _request_json(f"{NPS_ROAD_LAYER_URL}?f=json")
    if canonical_sha256(layer_before) != canonical_sha256(layer_after):
        raise OriginalRouteSourceError("NPS road layer changed during the snapshot")

    selected_raw = [feature for feature in raw_features if _selected(feature)]
    selected_raw.sort(
        key=lambda item: (
            _guid(item["attributes"].get("GEOMETRYID")),
            int(item["attributes"].get("OBJECTID") or 0),
        )
    )
    if len(selected_raw) != SELECTED_FEATURE_COUNT:
        raise OriginalRouteSourceError("NPS selected road count changed without review")
    features = [_normalize_raw_feature(item) for item in selected_raw]
    features.sort(key=lambda item: (item["road_name"], item["geometry_id"], item["object_id"]))
    normalized_geometry_sha256 = canonical_sha256(
        [{"geometry_id": item["geometry_id"], "geometry": item["geometry"]} for item in features]
    )
    field_schema = _field_schema(layer_before)
    domain_schema = _domain_schema(layer_before)
    source = {
        "agency": "National Park Service",
        "title": "NPS Public Roads Geographic",
        "service_url": NPS_ROAD_SERVICE_URL,
        "layer_url": NPS_ROAD_LAYER_URL,
        "iteminfo_url": NPS_ROAD_ITEMINFO_URL,
        "metadata_url": NPS_ROAD_METADATA_URL,
        "irma_url": NPS_ROAD_IRMA_URL,
        "license": "us-pd",
        "license_url": NPS_PUBLIC_DOMAIN_URL,
        "license_basis_urls": [NPS_ROAD_IRMA_URL, NPS_DISCLAIMER_URL],
        "metadata_updated_at": "2026-03-04",
        "service_version": layer_before.get("currentVersion"),
        "source_spatial_reference": SOURCE_SPATIAL_REFERENCE,
        "output_spatial_reference": OUTPUT_SPATIAL_REFERENCE,
        "datum_transformation": DATUM_TRANSFORMATION,
        "layer_definition_sha256": canonical_sha256(layer_before),
        "iteminfo_sha256": canonical_sha256(iteminfo),
        "field_schema_sha256": canonical_sha256(field_schema),
        "domain_schema_sha256": canonical_sha256(domain_schema),
        "query_contract_sha256": canonical_sha256(reviewed_query_contract()),
        "raw_selected_features_sha256": canonical_sha256(selected_raw),
        "normalized_geometry_sha256": normalized_geometry_sha256,
        "source_created_date_range": _date_range(features, "created_date"),
        "source_edit_date_range": _date_range(features, "edit_date"),
        "source_date_range": _date_range(features, "source_date"),
        "normalizer": "trailhead_nps_public_roads_v1",
        "coordinate_precision": 7,
        "join_tolerance_m": 1.0,
        "simplification": "none",
        "excluded_counts_by_reason": {
            "not_reviewed_for_selected_chapters": SOURCE_OBJECT_COUNT - SELECTED_FEATURE_COUNT
        },
        "use_constraints": [
            "reference_geometry_not_live_closure_feed",
            "navigation_requires_routable_engine_and_current_readiness",
            "no_nps_endorsement",
        ],
        "reviewed_at": retrieved_at,
        "reviewed_by": reviewed_by,
    }
    snapshot = {
        "schema_version": 1,
        "kind": "nps_public_road_snapshot",
        "product_id": PRODUCT_ID,
        "retrieved_at": retrieved_at,
        "source": source,
        "query": reviewed_query_contract(),
        "counts": {
            "source_object_count": SOURCE_OBJECT_COUNT,
            "selected_feature_count": SELECTED_FEATURE_COUNT,
        },
        "road_counts": EXPECTED_ROAD_COUNTS,
        "facility_counts": EXPECTED_FACILITY_COUNTS,
        "features": features,
    }
    audit = {
        "schema_version": 1,
        "kind": "nps_public_road_raw_audit",
        "retrieved_at": retrieved_at,
        "source_layer_sha256": canonical_sha256(layer_before),
        "iteminfo_sha256": canonical_sha256(iteminfo),
        "query_contract": reviewed_query_contract(),
        "selected_features": selected_raw,
    }
    return normalize_nps_road_snapshot(snapshot), audit


def _load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OriginalRouteSourceError(f"{label} is unavailable") from exc
    if not isinstance(value, dict):
        raise OriginalRouteSourceError(f"{label} must be an object")
    return value


def _atomic_write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def build_from_snapshot(snapshot: dict, route_spec_path: Path) -> dict:
    strict_spec = load_route_spec(route_spec_path)
    return build_official_route_evidence(snapshot, strict_spec)


def refresh(args: argparse.Namespace) -> int:
    snapshot, audit = fetch_snapshot(
        retrieved_at=args.retrieved_at,
        reviewed_by=args.reviewed_by,
    )
    evidence = build_from_snapshot(snapshot, args.route_spec)
    _atomic_write(args.snapshot, snapshot)
    _atomic_write(args.evidence, evidence)
    raw_hash = snapshot["source"]["raw_selected_features_sha256"]
    _atomic_write(args.audit_directory / f"nps-public-roads-{raw_hash}.json", audit)
    print(
        json.dumps(
            {
                "snapshot": str(args.snapshot),
                "snapshot_sha256": canonical_sha256(snapshot),
                "selected_feature_count": len(snapshot["features"]),
                "evidence": str(args.evidence),
                "evidence_sha256": canonical_sha256(evidence),
                "publication_status": evidence["publication_status"],
            },
            sort_keys=True,
        )
    )
    return 0


def check(args: argparse.Namespace) -> int:
    snapshot_raw = _load_json(args.snapshot, "NPS public-road snapshot")
    snapshot = normalize_nps_road_snapshot(snapshot_raw)
    if snapshot != snapshot_raw:
        raise OriginalRouteSourceError("Checked NPS snapshot is not canonical")
    expected_evidence = build_from_snapshot(snapshot, args.route_spec)
    checked_evidence = _load_json(args.evidence, "official route evidence")
    if checked_evidence != expected_evidence:
        raise OriginalRouteSourceError("Checked official route evidence is stale")
    print(
        json.dumps(
            {
                "snapshot_sha256": canonical_sha256(snapshot),
                "evidence_sha256": canonical_sha256(expected_evidence),
                "selected_feature_count": len(snapshot["features"]),
                "publication_status": expected_evidence["publication_status"],
            },
            sort_keys=True,
        )
    )
    return 0


def rebuild(args: argparse.Namespace) -> int:
    snapshot = normalize_nps_road_snapshot(
        _load_json(args.snapshot, "NPS public-road snapshot")
    )
    evidence = build_from_snapshot(snapshot, args.route_spec)
    _atomic_write(args.evidence, evidence)
    print(
        json.dumps(
            {
                "snapshot_sha256": canonical_sha256(snapshot),
                "evidence_sha256": canonical_sha256(evidence),
                "publication_status": evidence["publication_status"],
            },
            sort_keys=True,
        )
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--refresh-source", action="store_true")
    action.add_argument("--build", action="store_true")
    action.add_argument("--check", action="store_true")
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--route-spec", type=Path, default=DEFAULT_ROUTE_SPEC)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--audit-directory", type=Path, default=DEFAULT_AUDIT_DIRECTORY)
    parser.add_argument("--retrieved-at", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--reviewed-by", default="Trailhead product engineering")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.refresh_source:
        return refresh(args)
    if args.build:
        return rebuild(args)
    return check(args)


if __name__ == "__main__":
    raise SystemExit(main())
