"""Deterministic official-road evidence for long-form Trailhead Originals.

The public NPS road layer may be persisted as source evidence, but it is not a
live closure feed.  This module keeps immutable geometry/provenance separate
from the operational readiness checks performed at Start Tour.
"""

from __future__ import annotations

import copy
import hashlib
import heapq
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Iterable
from urllib.parse import urlsplit


class OriginalRouteSourceError(ValueError):
    """Raised when official road evidence is incomplete or internally unsafe."""


PRODUCT_ID = "great_smoky_mountains_ridges_rivers_living_memory"
NPS_ROAD_SERVICE_URL = (
    "https://mapservices.nps.gov/arcgis/rest/services/"
    "NationalDatasets/NPS_Public_Roads_Geographic/FeatureServer"
)
NPS_ROAD_LAYER_URL = f"{NPS_ROAD_SERVICE_URL}/0"
NPS_ROAD_ITEMINFO_URL = f"{NPS_ROAD_LAYER_URL}/iteminfo"
NPS_ROAD_METADATA_URL = (
    "https://catalog.data.gov/dataset/"
    "great-smoky-mountains-national-park-road-centerlines-e7c29"
)
NPS_ROAD_IRMA_URL = "https://irma.nps.gov/DataStore/Reference/Profile/2219243"
NPS_DISCLAIMER_URL = "https://www.nps.gov/aboutus/disclaimer.htm"
NPS_PUBLIC_DOMAIN_URL = "https://www.usa.gov/publicdomain/label/1.0/"
ENDPOINT_JOIN_TOLERANCE_M = 1.0
SOURCE_OBJECT_COUNT = 1_926
SELECTED_FEATURE_COUNT = 639
SOURCE_SPATIAL_REFERENCE = "NAD83(2011):104145"
OUTPUT_SPATIAL_REFERENCE = "EPSG:4326"
DATUM_TRANSFORMATION = {
    "wkid": 108363,
    "name": "WGS_1984_(ITRF08)_To_NAD_1983_2011",
    "transform_forward": False,
}
NPS_QUERY_FIELDS = (
    "OBJECTID",
    "GEOMETRYID",
    "FEATUREID",
    "FACLOCID",
    "RDMAINTAINER",
    "RDNAME",
    "RDALTNAME",
    "MAPLABEL",
    "RDSTATUS",
    "RDCLASS",
    "RDSURFACE",
    "RDONEWAY",
    "RDLANES",
    "RTENUMBER",
    "SEASONAL",
    "SEASDESC",
    "RDHICLEAR",
    "ISEXTANT",
    "PUBLICDISPLAY",
    "DATAACCESS",
    "ORIGINATOR",
    "UNITCODE",
    "CREATEDATE",
    "EDITDATE",
    "LINETYPE",
    "MAPMETHOD",
    "MAPSOURCE",
    "SOURCEDATE",
    "XYACCURACY",
    "ACCESSNOTES",
    "ROUTEID",
)

# Reviewed stable facility identifiers from the NPS public road layer. The
# completed Foothills Parkway Missing Link is the documented exception: its 28
# FHWA segments have no FACLOCID, so those rows are bound by exact road name,
# maintainer, source identifiers, and the checked snapshot hash instead.
EXPECTED_FACILITY_COUNTS = {
    "55724": 79,
    "55726": 148,
    "57675": 31,
    "57676": 125,
    "57677": 38,
    "57678": 15,
    "57685": 29,
    "57694": 41,
    "57696": 47,
    "57817": 41,
    "57804": 7,
    "57811": 8,
    "foothills_access_fhwa_unassigned": 2,
    "foothills_fhwa_unassigned": 28,
}

EXPECTED_ROAD_COUNTS = {
    "Cades Cove Loop Road": 47,
    "Cades Cove Campground Entrance Road": 7,
    "Fighting Creek Gap Road": 31,
    "Foothills Parkway Access Road": 2,
    "Foothills Parkway West": 69,
    "Kuwohi Access Road": 29,
    "Laurel Creek Road": 38,
    "Little River Gorge Road": 125,
    "Morton Mountain Tunnel": 1,
    "Newfound Gap Road North": 147,
    "Newfound Gap Road South": 79,
    "Roaring Fork Motor Nature Trail": 41,
    "Sugarlands Visitor Center Loop Road": 8,
    "Townsend Entrance Road": 15,
}

EXPECTED_FACILITY_POLICY = {
    "55724": ({"Newfound Gap Road South"}, {"National Park Service"}, {"Primary"}),
    "55726": (
        {"Newfound Gap Road North", "Morton Mountain Tunnel"},
        {"National Park Service"},
        {"Primary"},
    ),
    "57675": ({"Fighting Creek Gap Road"}, {"National Park Service"}, {"Primary"}),
    "57676": ({"Little River Gorge Road"}, {"National Park Service"}, {"Primary"}),
    "57677": ({"Laurel Creek Road"}, {"National Park Service"}, {"Local"}),
    "57678": ({"Townsend Entrance Road"}, {"National Park Service"}, {"Primary"}),
    "57685": ({"Kuwohi Access Road"}, {"National Park Service"}, {"Local"}),
    "57694": ({"Foothills Parkway West"}, {"National Park Service"}, {"Primary"}),
    "57696": ({"Cades Cove Loop Road"}, {"National Park Service"}, {"Local"}),
    "57804": (
        {"Cades Cove Campground Entrance Road"},
        {"National Park Service"},
        {"Local"},
    ),
    "57811": (
        {"Sugarlands Visitor Center Loop Road"},
        {"National Park Service"},
        {"Local"},
    ),
    "57817": (
        {"Roaring Fork Motor Nature Trail"},
        {"National Park Service"},
        {"Local"},
    ),
    "foothills_fhwa_unassigned": (
        {"Foothills Parkway West"},
        {"Federal Highway Administration"},
        {"Primary"},
    ),
    "foothills_access_fhwa_unassigned": (
        {"Foothills Parkway Access Road"},
        {"Federal Highway Administration"},
        {"Primary"},
    ),
}


def reviewed_query_contract() -> dict:
    return {
        "unit_code": "GRSM",
        "object_id_first": True,
        "batch_size": 500,
        "out_fields": list(NPS_QUERY_FIELDS),
        "required_filters": {
            "DATAACCESS": "Unrestricted",
            "ISEXTANT": "True",
            "PUBLICDISPLAY": "Public Map Display",
            "RDSTATUS": "Existing",
        },
        "selected_facility_ids": sorted(
            key for key in EXPECTED_FACILITY_COUNTS if key.isdigit()
        ),
        "unassigned_exceptions": [
            {
                "road_name": "Foothills Parkway Access Road",
                "maintainer": "Federal Highway Administration",
            },
            {
                "road_name": "Foothills Parkway West",
                "maintainer": "Federal Highway Administration",
            },
        ],
        "out_spatial_reference": OUTPUT_SPATIAL_REFERENCE,
        "datum_transformation": copy.deepcopy(DATUM_TRANSFORMATION),
        "return_z": False,
        "return_m": False,
        "return_true_curves": False,
        "coordinate_precision": 7,
        "endpoint_join_tolerance_m": ENDPOINT_JOIN_TOLERANCE_M,
    }

_GUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,199}$")


def _forbid_keys(value: dict, allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    if extra:
        raise OriginalRouteSourceError(
            f"{label} contains unsupported fields: {', '.join(extra)}"
        )


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise OriginalRouteSourceError(f"{label} must be an object")
    return value


def _list(value: object, label: str, *, minimum: int = 1, maximum: int = 5_000) -> list:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise OriginalRouteSourceError(
            f"{label} must contain between {minimum} and {maximum} entries"
        )
    return value


def _text(value: object, label: str, *, maximum: int = 2_000) -> str:
    if not isinstance(value, str):
        raise OriginalRouteSourceError(f"{label} must be text")
    clean = re.sub(r"\s+", " ", value).strip()
    if not clean or len(clean) > maximum:
        raise OriginalRouteSourceError(f"{label} is missing or too long")
    return clean


def _optional_text(value: object, label: str, *, maximum: int = 2_000) -> str | None:
    if value in (None, ""):
        return None
    return _text(value, label, maximum=maximum)


def _stable_id(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise OriginalRouteSourceError(f"{label} must be text")
    clean = value.strip()
    if not _ID_RE.fullmatch(clean):
        raise OriginalRouteSourceError(f"{label} must be a stable lowercase identifier")
    return clean


def _https_url(value: object, label: str, *, hostname: str | None = None) -> str:
    clean = _text(value, label, maximum=2_048)
    parsed = urlsplit(clean)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise OriginalRouteSourceError(f"{label} must be an absolute HTTPS URL")
    if hostname and parsed.hostname != hostname:
        raise OriginalRouteSourceError(f"{label} must use {hostname}")
    return clean


def _guid(value: object, label: str) -> str:
    clean = str(value or "").strip().strip("{}").lower()
    if not _GUID_RE.fullmatch(clean):
        raise OriginalRouteSourceError(f"{label} must be a GUID")
    return clean


def _iso_date(value: object, label: str) -> str:
    clean = _text(value, label, maximum=10)
    try:
        date.fromisoformat(clean)
    except ValueError as exc:
        raise OriginalRouteSourceError(f"{label} must be an ISO date") from exc
    return clean


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OriginalRouteSourceError(f"{label} must be numeric")
    clean = float(value)
    if not math.isfinite(clean):
        raise OriginalRouteSourceError(f"{label} must be finite")
    return clean


def _coordinate(value: object, label: str) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise OriginalRouteSourceError(f"{label} must be [longitude, latitude]")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        raise OriginalRouteSourceError(f"{label} must contain finite numbers")
    lon, lat = (round(float(value[0]), 7), round(float(value[1]), 7))
    if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise OriginalRouteSourceError(f"{label} is outside valid bounds")
    return [lon, lat]


def _grsm_coordinate(value: object, label: str) -> list[float]:
    coordinate = _coordinate(value, label)
    if not -84.15 <= coordinate[0] <= -83.05 or not 35.30 <= coordinate[1] <= 35.90:
        raise OriginalRouteSourceError(f"{label} is outside the reviewed GRSM envelope")
    return coordinate


def _facility_key(facility_location_id: str | None, road_name: str, maintainer: str) -> str:
    if facility_location_id is not None:
        return facility_location_id
    if road_name == "Foothills Parkway West" and maintainer == "Federal Highway Administration":
        return "foothills_fhwa_unassigned"
    if road_name == "Foothills Parkway Access Road" and maintainer == "Federal Highway Administration":
        return "foothills_access_fhwa_unassigned"
    raise OriginalRouteSourceError("NPS road feature has an unreviewed facility identity")


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _sha256_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise OriginalRouteSourceError(f"{label} must be a lowercase SHA-256")
    return value


def _date_range(values: Iterable[str | None]) -> dict[str, str] | None:
    present = sorted(value for value in values if value is not None)
    if not present:
        return None
    return {"minimum": present[0], "maximum": present[-1]}


def normalize_nps_road_snapshot(payload: dict) -> dict:
    raw = copy.deepcopy(_object(payload, "NPS road snapshot"))
    _forbid_keys(
        raw,
        {
            "schema_version",
            "kind",
            "product_id",
            "retrieved_at",
            "source",
            "query",
            "counts",
            "road_counts",
            "facility_counts",
            "features",
        },
        "NPS road snapshot",
    )
    if raw.get("schema_version") != 1 or raw.get("kind") != "nps_public_road_snapshot":
        raise OriginalRouteSourceError("NPS road snapshot identity is invalid")
    if raw.get("product_id") != PRODUCT_ID:
        raise OriginalRouteSourceError("NPS road snapshot product is invalid")
    raw["retrieved_at"] = _iso_date(raw.get("retrieved_at"), "NPS road snapshot retrieved_at")

    source = copy.deepcopy(_object(raw.get("source"), "NPS road snapshot source"))
    _forbid_keys(
        source,
        {
            "agency",
            "title",
            "service_url",
            "layer_url",
            "iteminfo_url",
            "metadata_url",
            "irma_url",
            "license",
            "license_url",
            "license_basis_urls",
            "metadata_updated_at",
            "service_version",
            "source_spatial_reference",
            "output_spatial_reference",
            "datum_transformation",
            "layer_definition_sha256",
            "iteminfo_sha256",
            "field_schema_sha256",
            "domain_schema_sha256",
            "query_contract_sha256",
            "raw_selected_features_sha256",
            "normalized_geometry_sha256",
            "source_created_date_range",
            "source_edit_date_range",
            "source_date_range",
            "normalizer",
            "coordinate_precision",
            "join_tolerance_m",
            "simplification",
            "excluded_counts_by_reason",
            "use_constraints",
            "reviewed_at",
            "reviewed_by",
        },
        "NPS road snapshot source",
    )
    if source.get("agency") != "National Park Service":
        raise OriginalRouteSourceError("NPS road snapshot agency is invalid")
    source["title"] = _text(source.get("title"), "NPS road snapshot title", maximum=200)
    source["service_url"] = _https_url(
        source.get("service_url"), "NPS road service", hostname="mapservices.nps.gov"
    )
    if source["service_url"] != NPS_ROAD_SERVICE_URL:
        raise OriginalRouteSourceError("NPS road snapshot service is not reviewed")
    source["layer_url"] = _https_url(
        source.get("layer_url"), "NPS road layer", hostname="mapservices.nps.gov"
    )
    if source["layer_url"] != NPS_ROAD_LAYER_URL:
        raise OriginalRouteSourceError("NPS road snapshot layer is not the reviewed layer")
    source["iteminfo_url"] = _https_url(
        source.get("iteminfo_url"), "NPS road item info", hostname="mapservices.nps.gov"
    )
    if source["iteminfo_url"] != NPS_ROAD_ITEMINFO_URL:
        raise OriginalRouteSourceError("NPS road item info is not reviewed")
    source["metadata_url"] = _https_url(
        source.get("metadata_url"), "NPS road metadata", hostname="catalog.data.gov"
    )
    if source["metadata_url"] != NPS_ROAD_METADATA_URL:
        raise OriginalRouteSourceError("NPS road snapshot metadata is not the reviewed record")
    source["irma_url"] = _https_url(
        source.get("irma_url"), "NPS road IRMA record", hostname="irma.nps.gov"
    )
    if source["irma_url"] != NPS_ROAD_IRMA_URL:
        raise OriginalRouteSourceError("NPS road snapshot IRMA record is not reviewed")
    if source.get("license") != "us-pd":
        raise OriginalRouteSourceError("NPS road snapshot must retain the public-domain license")
    source["license_url"] = _https_url(
        source.get("license_url"), "NPS road license", hostname="www.usa.gov"
    )
    if source["license_url"] != NPS_PUBLIC_DOMAIN_URL:
        raise OriginalRouteSourceError("NPS road snapshot license URL changed")
    license_basis_urls = [
        _https_url(value, "NPS license basis")
        for value in _list(source.get("license_basis_urls"), "NPS license basis URLs", maximum=10)
    ]
    if license_basis_urls != [NPS_ROAD_IRMA_URL, NPS_DISCLAIMER_URL]:
        raise OriginalRouteSourceError("NPS road license basis changed without review")
    source["license_basis_urls"] = license_basis_urls
    source["metadata_updated_at"] = _iso_date(
        source.get("metadata_updated_at"), "NPS road metadata updated_at"
    )
    service_version = _finite_number(source.get("service_version"), "NPS service version")
    if service_version != 11.5:
        raise OriginalRouteSourceError("NPS road service version changed without review")
    source["service_version"] = service_version
    if source.get("source_spatial_reference") != SOURCE_SPATIAL_REFERENCE:
        raise OriginalRouteSourceError("NPS source spatial reference changed")
    if source.get("output_spatial_reference") != OUTPUT_SPATIAL_REFERENCE:
        raise OriginalRouteSourceError("NPS output spatial reference changed")
    if source.get("datum_transformation") != DATUM_TRANSFORMATION:
        raise OriginalRouteSourceError("NPS datum transformation changed without review")
    for key in (
        "layer_definition_sha256",
        "iteminfo_sha256",
        "field_schema_sha256",
        "domain_schema_sha256",
        "query_contract_sha256",
        "raw_selected_features_sha256",
        "normalized_geometry_sha256",
    ):
        source[key] = _sha256_text(source.get(key), f"NPS road {key}")
    if source["query_contract_sha256"] != canonical_sha256(reviewed_query_contract()):
        raise OriginalRouteSourceError("NPS road query contract hash is invalid")
    if source.get("normalizer") != "trailhead_nps_public_roads_v1":
        raise OriginalRouteSourceError("NPS road normalizer changed")
    if source.get("coordinate_precision") != 7:
        raise OriginalRouteSourceError("NPS road coordinate precision changed")
    if _finite_number(source.get("join_tolerance_m"), "NPS join tolerance") != ENDPOINT_JOIN_TOLERANCE_M:
        raise OriginalRouteSourceError("NPS road join tolerance changed")
    if source.get("simplification") != "none":
        raise OriginalRouteSourceError("NPS road geometry must not be simplified")
    if source.get("excluded_counts_by_reason") != {
        "not_reviewed_for_selected_chapters": SOURCE_OBJECT_COUNT - SELECTED_FEATURE_COUNT
    }:
        raise OriginalRouteSourceError("NPS road exclusion accounting is incomplete")
    if source.get("use_constraints") != [
        "reference_geometry_not_live_closure_feed",
        "navigation_requires_routable_engine_and_current_readiness",
        "no_nps_endorsement",
    ]:
        raise OriginalRouteSourceError("NPS road use constraints changed")
    source["reviewed_at"] = _iso_date(source.get("reviewed_at"), "NPS road review date")
    source["reviewed_by"] = _text(
        source.get("reviewed_by"), "NPS road reviewer", maximum=120
    )

    query = copy.deepcopy(_object(raw.get("query"), "NPS road snapshot query"))
    if query != reviewed_query_contract():
        raise OriginalRouteSourceError("NPS road snapshot query contract changed without review")

    counts = copy.deepcopy(_object(raw.get("counts"), "NPS road snapshot counts"))
    _forbid_keys(counts, {"source_object_count", "selected_feature_count"}, "NPS road counts")
    if counts != {
        "source_object_count": SOURCE_OBJECT_COUNT,
        "selected_feature_count": SELECTED_FEATURE_COUNT,
    }:
        raise OriginalRouteSourceError("NPS road source counts changed without review")

    features: list[dict] = []
    for index, item in enumerate(_list(raw.get("features"), "NPS road features")):
        feature = copy.deepcopy(_object(item, f"NPS road feature {index}"))
        _forbid_keys(
            feature,
            {
                "object_id",
                "geometry_id",
                "feature_id",
                "facility_location_id",
                "maintainer",
                "road_name",
                "road_alt_name",
                "map_label",
                "road_status",
                "road_class",
                "surface",
                "one_way",
                "lanes",
                "route_number",
                "seasonal",
                "season_description",
                "high_clearance",
                "is_extant",
                "public_display",
                "data_access",
                "originator",
                "unit_code",
                "created_date",
                "route_id",
                "edit_date",
                "line_type",
                "map_method",
                "map_source",
                "source_date",
                "xy_accuracy",
                "access_notes",
                "geometry",
            },
            f"NPS road feature {index}",
        )
        object_id = feature.get("object_id")
        if isinstance(object_id, bool) or not isinstance(object_id, int) or object_id < 1:
            raise OriginalRouteSourceError("NPS road object_id is invalid")
        feature["geometry_id"] = _guid(feature.get("geometry_id"), "NPS road geometry_id")
        feature["feature_id"] = _guid(feature.get("feature_id"), "NPS road feature_id")
        feature["facility_location_id"] = _optional_text(
            feature.get("facility_location_id"), "NPS road facility_location_id", maximum=40
        )
        feature["maintainer"] = _text(feature.get("maintainer"), "NPS road maintainer", maximum=160)
        feature["road_name"] = _text(feature.get("road_name"), "NPS road name", maximum=254)
        if feature["road_name"] not in EXPECTED_ROAD_COUNTS:
            raise OriginalRouteSourceError("NPS road snapshot contains an unreviewed road")
        if feature.get("road_status") != "Existing":
            raise OriginalRouteSourceError("NPS road feature is not an existing road")
        if feature.get("is_extant") != "True":
            raise OriginalRouteSourceError("NPS road feature is not extant")
        if feature.get("public_display") != "Public Map Display":
            raise OriginalRouteSourceError("NPS road feature is not approved for public display")
        if feature.get("data_access") != "Unrestricted":
            raise OriginalRouteSourceError("NPS road feature is not unrestricted")
        if feature.get("unit_code") != "GRSM":
            raise OriginalRouteSourceError("NPS road feature is outside Great Smoky Mountains")
        if feature.get("xy_accuracy") != ">=1m and <5m":
            raise OriginalRouteSourceError("NPS road feature accuracy changed without review")
        facility_key = _facility_key(
            feature["facility_location_id"], feature["road_name"], feature["maintainer"]
        )
        policy = EXPECTED_FACILITY_POLICY.get(facility_key)
        if policy is None:
            raise OriginalRouteSourceError("NPS road facility is not reviewed")
        if (
            feature["road_name"] not in policy[0]
            or feature["maintainer"] not in policy[1]
            or feature.get("road_class") not in policy[2]
        ):
            raise OriginalRouteSourceError("NPS road facility traits changed without review")
        for key in (
            "road_alt_name",
            "map_label",
            "surface",
            "route_number",
            "season_description",
            "high_clearance",
            "route_id",
            "originator",
            "line_type",
            "map_method",
            "map_source",
            "access_notes",
        ):
            feature[key] = _optional_text(feature.get(key), f"NPS road {key}")
        feature["road_class"] = _text(feature.get("road_class"), "NPS road class", maximum=80)
        feature["one_way"] = _optional_text(feature.get("one_way"), "NPS road one_way", maximum=80)
        if feature["one_way"] not in {None, "With Digitized", "Against Digitized"}:
            raise OriginalRouteSourceError("NPS road one-way value is unsupported")
        if feature.get("seasonal") not in {"Yes", "No", None}:
            raise OriginalRouteSourceError("NPS road seasonal value is invalid")
        lanes = feature.get("lanes")
        if lanes is not None and (isinstance(lanes, bool) or not isinstance(lanes, int) or lanes < 0):
            raise OriginalRouteSourceError("NPS road lane count is invalid")
        for key in ("created_date", "edit_date", "source_date"):
            if feature.get(key) is not None:
                feature[key] = _iso_date(feature[key], f"NPS road {key}")
        geometry = copy.deepcopy(_object(feature.get("geometry"), "NPS road geometry"))
        _forbid_keys(geometry, {"type", "coordinates"}, "NPS road geometry")
        if geometry.get("type") != "LineString":
            raise OriginalRouteSourceError("NPS road geometry must be a LineString")
        coordinates = [
            _grsm_coordinate(value, f"NPS road {feature['geometry_id']} coordinate")
            for value in _list(geometry.get("coordinates"), "NPS road coordinates", minimum=2, maximum=20_000)
        ]
        if any(first == second for first, second in zip(coordinates, coordinates[1:])):
            raise OriginalRouteSourceError("NPS road geometry contains duplicate adjacent points")
        if any(distance_m(first, second) > 2_000 for first, second in zip(coordinates, coordinates[1:])):
            raise OriginalRouteSourceError("NPS road geometry contains an implausible internal jump")
        feature["geometry"] = {"type": "LineString", "coordinates": coordinates}
        features.append(feature)
    features.sort(key=lambda item: (item["road_name"], item["geometry_id"], item["object_id"]))
    geometry_ids = [item["geometry_id"] for item in features]
    if len(geometry_ids) != len(set(geometry_ids)):
        raise OriginalRouteSourceError("NPS road geometry IDs must be unique")
    feature_ids = [item["feature_id"] for item in features]
    object_ids = [item["object_id"] for item in features]
    if len(feature_ids) != len(set(feature_ids)) or len(object_ids) != len(set(object_ids)):
        raise OriginalRouteSourceError("NPS road source identities must be unique")
    counts = dict(sorted(Counter(item["road_name"] for item in features).items()))
    if counts != EXPECTED_ROAD_COUNTS or raw.get("road_counts") != EXPECTED_ROAD_COUNTS:
        raise OriginalRouteSourceError("NPS road feature counts changed without review")
    facility_counts = dict(
        sorted(
            Counter(
                _facility_key(item["facility_location_id"], item["road_name"], item["maintainer"])
                for item in features
            ).items()
        )
    )
    if facility_counts != EXPECTED_FACILITY_COUNTS or raw.get("facility_counts") != EXPECTED_FACILITY_COUNTS:
        raise OriginalRouteSourceError("NPS road facility counts changed without review")
    if len(features) != SELECTED_FEATURE_COUNT:
        raise OriginalRouteSourceError("NPS road selected feature count changed")
    normalized_geometry_sha256 = canonical_sha256(
        [
            {"geometry_id": item["geometry_id"], "geometry": item["geometry"]}
            for item in features
        ]
    )
    if source["normalized_geometry_sha256"] != normalized_geometry_sha256:
        raise OriginalRouteSourceError("NPS normalized geometry hash is invalid")
    for field, values in (
        ("source_created_date_range", (item.get("created_date") for item in features)),
        ("source_edit_date_range", (item.get("edit_date") for item in features)),
        ("source_date_range", (item.get("source_date") for item in features)),
    ):
        if source.get(field) != _date_range(values):
            raise OriginalRouteSourceError(f"NPS road {field} is inconsistent")

    return {
        "schema_version": 1,
        "kind": "nps_public_road_snapshot",
        "product_id": PRODUCT_ID,
        "retrieved_at": raw["retrieved_at"],
        "source": source,
        "query": query,
        "counts": {
            "source_object_count": SOURCE_OBJECT_COUNT,
            "selected_feature_count": SELECTED_FEATURE_COUNT,
        },
        "road_counts": dict(sorted(EXPECTED_ROAD_COUNTS.items())),
        "facility_counts": dict(sorted(EXPECTED_FACILITY_COUNTS.items())),
        "features": features,
    }


def nps_road_snapshot_sha256(payload: dict) -> str:
    return canonical_sha256(normalize_nps_road_snapshot(payload))


def distance_m(first: list[float], second: list[float]) -> float:
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_008.8 * 2 * math.asin(min(1.0, math.sqrt(value)))


def line_length_m(coordinates: list[list[float]]) -> float:
    return sum(distance_m(first, second) for first, second in zip(coordinates, coordinates[1:]))


def _append_geometry(target: list[list[float]], addition: Iterable[list[float]]) -> float:
    clean_addition = [
        [round(float(coordinate[0]), 7), round(float(coordinate[1]), 7)]
        for coordinate in addition
    ]
    if not clean_addition:
        return 0.0
    boundary_gap = 0.0
    if target:
        boundary_gap = distance_m(target[-1], clean_addition[0])
        if boundary_gap > ENDPOINT_JOIN_TOLERANCE_M + 1e-6:
            raise OriginalRouteSourceError(
                f"Official road geometry has an unreviewed {boundary_gap:.3f} m seam"
            )
        if boundary_gap < 0.02:
            clean_addition = clean_addition[1:]
    target.extend(clean_addition)
    return boundary_gap


@dataclass(frozen=True)
class Projection:
    feature_id: str
    point: list[float]
    measure_m: float
    lateral_m: float


def _project_to_segment(point: list[float], first: list[float], second: list[float]) -> tuple[float, float, list[float]]:
    latitude = math.radians(point[1])
    x_scale = 111_320.0 * math.cos(latitude)
    y_scale = 110_540.0
    ax = (first[0] - point[0]) * x_scale
    ay = (first[1] - point[1]) * y_scale
    bx = (second[0] - point[0]) * x_scale
    by = (second[1] - point[1]) * y_scale
    dx = bx - ax
    dy = by - ay
    denominator = dx * dx + dy * dy
    fraction = 0.0 if denominator == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / denominator))
    projected = [
        first[0] + fraction * (second[0] - first[0]),
        first[1] + fraction * (second[1] - first[1]),
    ]
    return math.hypot(ax + fraction * dx, ay + fraction * dy), fraction, projected


def project_to_line(point: list[float], coordinates: list[list[float]]) -> tuple[float, float, list[float]]:
    traversed = 0.0
    best: tuple[float, float, list[float]] | None = None
    for first, second in zip(coordinates, coordinates[1:]):
        segment_length = distance_m(first, second)
        lateral, fraction, projected = _project_to_segment(point, first, second)
        candidate = (lateral, traversed + fraction * segment_length, projected)
        if best is None or (candidate[0], candidate[1]) < (best[0], best[1]):
            best = candidate
        traversed += segment_length
    if best is None:
        raise OriginalRouteSourceError("Cannot project onto an empty road line")
    return best


def _point_at_measure(coordinates: list[list[float]], measure_m: float) -> list[float]:
    total = line_length_m(coordinates)
    target = max(0.0, min(total, measure_m))
    traversed = 0.0
    for first, second in zip(coordinates, coordinates[1:]):
        segment = distance_m(first, second)
        if traversed + segment >= target and segment > 0:
            fraction = (target - traversed) / segment
            return [
                first[0] + fraction * (second[0] - first[0]),
                first[1] + fraction * (second[1] - first[1]),
            ]
        traversed += segment
    return list(coordinates[-1])


def _slice_line(coordinates: list[list[float]], start_m: float, end_m: float) -> list[list[float]]:
    reverse = start_m > end_m
    low, high = sorted((start_m, end_m))
    total = line_length_m(coordinates)
    low = max(0.0, min(total, low))
    high = max(0.0, min(total, high))
    output = [_point_at_measure(coordinates, low)]
    traversed = 0.0
    for first, second in zip(coordinates, coordinates[1:]):
        traversed += distance_m(first, second)
        if low < traversed < high:
            output.append(list(second))
    output.append(_point_at_measure(coordinates, high))
    if reverse:
        output.reverse()
    return output


class RoadGraph:
    def __init__(self, features: list[dict], *, join_tolerance_m: float = ENDPOINT_JOIN_TOLERANCE_M):
        if not features:
            raise OriginalRouteSourceError("Road graph requires official features")
        self.features = {item["geometry_id"]: item for item in features}
        self.node_coordinates: dict[str, list[float]] = {}
        self.feature_nodes: dict[str, tuple[str, str]] = {}
        self.adjacency: dict[
            str, list[tuple[str, float, str, list[list[float]], bool]]
        ] = defaultdict(list)
        self.route_adjacency: dict[
            str, list[tuple[str, float, str, list[list[float]], bool]]
        ] = defaultdict(list)
        endpoints: list[tuple[str, int, list[float]]] = []
        for feature in sorted(features, key=lambda item: item["geometry_id"]):
            coordinates = feature["geometry"]["coordinates"]
            endpoints.extend(
                [
                    (feature["geometry_id"], 0, coordinates[0]),
                    (feature["geometry_id"], 1, coordinates[-1]),
                ]
            )
        endpoint_nodes: dict[tuple[str, int], str] = {}
        for feature_id, endpoint_index, coordinate in endpoints:
            matches = sorted(
                (
                    (distance_m(coordinate, candidate), node_id)
                    for node_id, candidate in self.node_coordinates.items()
                    if distance_m(coordinate, candidate) <= join_tolerance_m
                ),
                key=lambda item: (item[0], item[1]),
            )
            if matches:
                node_id = matches[0][1]
            else:
                node_id = f"node_{len(self.node_coordinates) + 1:05d}"
                self.node_coordinates[node_id] = list(coordinate)
            endpoint_nodes[(feature_id, endpoint_index)] = node_id
        for feature in sorted(features, key=lambda item: item["geometry_id"]):
            feature_id = feature["geometry_id"]
            start = endpoint_nodes[(feature_id, 0)]
            end = endpoint_nodes[(feature_id, 1)]
            coordinates = copy.deepcopy(feature["geometry"]["coordinates"])
            weight = line_length_m(coordinates)
            self.feature_nodes[feature_id] = (start, end)
            forward = (end, weight, feature_id, coordinates, False)
            reverse = (start, weight, feature_id, list(reversed(coordinates)), True)
            self.adjacency[start].append(forward)
            self.adjacency[end].append(reverse)
            one_way = feature.get("one_way")
            if one_way in {None, "With Digitized"}:
                self.route_adjacency[start].append(forward)
            if one_way in {None, "Against Digitized"}:
                self.route_adjacency[end].append(reverse)
        for adjacency in (self.adjacency, self.route_adjacency):
            for node_id in adjacency:
                adjacency[node_id].sort(key=lambda item: (item[2], item[0], item[4]))

    def project(self, point: list[float]) -> Projection:
        candidates = self.project_candidates(point, max_lateral_m=math.inf, limit=1)
        if not candidates:
            raise OriginalRouteSourceError("Road graph projection failed")
        return candidates[0]

    def project_candidates(
        self, point: list[float], *, max_lateral_m: float, limit: int = 16
    ) -> list[Projection]:
        candidates: list[tuple[float, str, float, list[float]]] = []
        for feature_id, feature in self.features.items():
            lateral, measure, projected = project_to_line(point, feature["geometry"]["coordinates"])
            if lateral <= max_lateral_m:
                candidates.append((lateral, feature_id, measure, projected))
        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        return [
            Projection(feature_id=item[1], point=item[3], measure_m=item[2], lateral_m=item[0])
            for item in candidates[:limit]
        ]

    def shortest_path(
        self, start: str, end: str
    ) -> tuple[float, list[list[float]], list[dict], float]:
        if start == end:
            return 0.0, [self.node_coordinates[start]], [], 0.0
        queue: list[tuple[float, str]] = [(0.0, start)]
        distances = {start: 0.0}
        previous: dict[str, tuple[str, str, list[list[float]], bool]] = {}
        while queue:
            current_distance, node = heapq.heappop(queue)
            if current_distance > distances.get(node, math.inf) + 1e-6:
                continue
            if node == end:
                break
            for neighbor, weight, feature_id, coordinates, reversed_from_source in self.route_adjacency.get(node, []):
                candidate = current_distance + weight
                if candidate + 1e-6 < distances.get(neighbor, math.inf):
                    distances[neighbor] = candidate
                    previous[neighbor] = (node, feature_id, coordinates, reversed_from_source)
                    heapq.heappush(queue, (candidate, neighbor))
        if end not in distances:
            raise OriginalRouteSourceError("Official road controls are disconnected")
        steps: list[tuple[str, list[list[float]], bool]] = []
        node = end
        while node != start:
            parent, feature_id, coordinates, reversed_from_source = previous[node]
            steps.append((feature_id, coordinates, reversed_from_source))
            node = parent
        steps.reverse()
        output: list[list[float]] = []
        maximum_gap = 0.0
        for _, coordinates, _ in steps:
            maximum_gap = max(maximum_gap, _append_geometry(output, coordinates))
        return (
            distances[end],
            output,
            [
                {
                    "geometry_id": item[0],
                    "direction": "reverse" if item[2] else "forward",
                    "partial": False,
                }
                for item in steps
            ],
            maximum_gap,
        )

    def path_between(
        self, first: Projection, second: Projection
    ) -> tuple[float, list[list[float]], list[dict], float]:
        candidates: list[tuple[float, str, list[list[float]], list[dict], float]] = []
        first_feature = self.features[first.feature_id]
        second_feature = self.features[second.feature_id]
        first_one_way = first_feature.get("one_way")
        second_one_way = second_feature.get("one_way")
        direct_reversed = second.measure_m < first.measure_m
        direct_allowed = (
            first_one_way is None
            or (first_one_way == "With Digitized" and not direct_reversed)
            or (first_one_way == "Against Digitized" and direct_reversed)
        )
        if first.feature_id == second.feature_id and direct_allowed:
            geometry = _slice_line(
                first_feature["geometry"]["coordinates"], first.measure_m, second.measure_m
            )
            candidates.append(
                (
                    line_length_m(geometry),
                    f"direct:{first.feature_id}",
                    geometry,
                    [
                        {
                            "geometry_id": first.feature_id,
                            "direction": "reverse" if direct_reversed else "forward",
                            "partial": True,
                        }
                    ],
                    0.0,
                )
            )
        first_length = line_length_m(first_feature["geometry"]["coordinates"])
        second_length = line_length_m(second_feature["geometry"]["coordinates"])
        first_endpoints = []
        if first_one_way in {None, "Against Digitized"}:
            first_endpoints.append((0, self.feature_nodes[first.feature_id][0], _slice_line(first_feature["geometry"]["coordinates"], first.measure_m, 0.0), True))
        if first_one_way in {None, "With Digitized"}:
            first_endpoints.append((1, self.feature_nodes[first.feature_id][1], _slice_line(first_feature["geometry"]["coordinates"], first.measure_m, first_length), False))
        second_endpoints = []
        if second_one_way in {None, "With Digitized"}:
            second_endpoints.append((0, self.feature_nodes[second.feature_id][0], _slice_line(second_feature["geometry"]["coordinates"], 0.0, second.measure_m), False))
        if second_one_way in {None, "Against Digitized"}:
            second_endpoints.append((1, self.feature_nodes[second.feature_id][1], _slice_line(second_feature["geometry"]["coordinates"], second_length, second.measure_m), True))
        for first_index, first_node, first_geometry, first_reversed in first_endpoints:
            for second_index, second_node, second_geometry, second_reversed in second_endpoints:
                try:
                    middle_length, middle_geometry, middle_ids, middle_gap = self.shortest_path(
                        first_node, second_node
                    )
                except OriginalRouteSourceError:
                    continue
                output: list[list[float]] = []
                gap = _append_geometry(output, first_geometry)
                gap = max(gap, _append_geometry(output, middle_geometry))
                gap = max(gap, _append_geometry(output, second_geometry), middle_gap)
                traversal = [
                    {
                        "geometry_id": first.feature_id,
                        "direction": "reverse" if first_reversed else "forward",
                        "partial": True,
                    },
                    *middle_ids,
                    {
                        "geometry_id": second.feature_id,
                        "direction": "reverse" if second_reversed else "forward",
                        "partial": True,
                    },
                ]
                candidates.append(
                    (
                        line_length_m(first_geometry) + middle_length + line_length_m(second_geometry),
                        "endpoints:"
                        f"{first_index}:{second_index}:"
                        + ":".join(item["geometry_id"] for item in middle_ids),
                        output,
                        traversal,
                        gap,
                    )
                )
        if not candidates:
            raise OriginalRouteSourceError("No official road path connects the requested controls")
        distance, _, geometry, traversal, maximum_gap = min(
            candidates, key=lambda item: (round(item[0], 6), item[1])
        )
        return distance, geometry, traversal, maximum_gap


def _features_for(snapshot: dict, names: set[str]) -> list[dict]:
    features = [item for item in snapshot["features"] if item["road_name"] in names]
    if not features:
        raise OriginalRouteSourceError("Official road selection is empty")
    return features


def _derive_via(graph: RoadGraph, controls: list[dict], *, max_control_snap_m: float) -> dict:
    projection_sets: list[tuple[dict, list[Projection]]] = []
    for control in controls:
        projections = graph.project_candidates(
            control["coordinates"], max_lateral_m=max_control_snap_m
        )
        required_road_names = control.get("required_road_names")
        if required_road_names is not None:
            if not isinstance(required_road_names, set) or not required_road_names:
                raise OriginalRouteSourceError("Official route-control road scope is invalid")
            projections = [
                projection
                for projection in projections
                if graph.features[projection.feature_id]["road_name"] in required_road_names
            ]
        if not projections:
            nearest = graph.project(control["coordinates"])
            raise OriginalRouteSourceError(
                f"Official road control {control['id']} is {nearest.lateral_m:.1f} m from the reviewed roads"
            )
        projection_sets.append((control, projections))

    # Dynamic programming across candidate projections avoids choosing the
    # visually nearest carriageway when it cannot be traversed in the authored
    # direction. The score prefers shorter official paths, then smaller snaps.
    states: dict[int, dict] = {
        index: {
            "score": projection.lateral_m * 10,
            "geometry": [projection.point],
            "traversal": [],
            "maximum_gap_m": 0.0,
            "control_progress": {
                projection_sets[0][0]["id"]: {
                    "route_progress_m": 0.0,
                    "lateral_distance_m": round(projection.lateral_m, 1),
                    "projected_coordinates": [round(value, 7) for value in projection.point],
                }
            },
            "projection": projection,
        }
        for index, projection in enumerate(projection_sets[0][1])
    }
    for control, next_projections in projection_sets[1:]:
        next_states: dict[int, dict] = {}
        for next_index, second in enumerate(next_projections):
            best: tuple[tuple[float, str], dict] | None = None
            for previous_index, state in states.items():
                try:
                    segment_distance, segment_geometry, segment_traversal, segment_gap = graph.path_between(
                        state["projection"], second
                    )
                except OriginalRouteSourceError:
                    continue
                geometry = copy.deepcopy(state["geometry"])
                join_gap = _append_geometry(geometry, segment_geometry)
                score = state["score"] + segment_distance + second.lateral_m * 10
                tie = (
                    round(score, 6),
                    f"{previous_index}:{second.feature_id}:{second.measure_m:.6f}",
                )
                candidate = {
                    "score": score,
                    "geometry": geometry,
                    "traversal": [*state["traversal"], *segment_traversal],
                    "maximum_gap_m": max(
                        state["maximum_gap_m"], segment_gap, join_gap
                    ),
                    "control_progress": {
                        **state["control_progress"],
                        control["id"]: {
                            "route_progress_m": round(line_length_m(geometry), 1),
                            "lateral_distance_m": round(second.lateral_m, 1),
                            "projected_coordinates": [round(value, 7) for value in second.point],
                        },
                    },
                    "projection": second,
                }
                if best is None or tie < best[0]:
                    best = (tie, candidate)
            if best is not None:
                next_states[next_index] = best[1]
        if not next_states:
            raise OriginalRouteSourceError(
                f"No direction-compatible official path reaches {control['id']}"
            )
        states = next_states
    winner = min(
        states.values(),
        key=lambda item: (
            round(item["score"], 6),
            item["projection"].feature_id,
            round(item["projection"].measure_m, 6),
        ),
    )
    traversal = winner["traversal"]
    return {
        "geometry": winner["geometry"],
        "feature_ids": sorted({item["geometry_id"] for item in traversal}),
        "source_traversal": traversal,
        "control_progress": winner["control_progress"],
        "maximum_join_gap_m": round(winner["maximum_gap_m"], 3),
    }


def _ordered_chain(features: list[dict], start_anchor: list[float]) -> dict:
    graph = RoadGraph(features)
    degrees = {node: len(edges) for node, edges in graph.adjacency.items()}
    terminals = sorted(node for node, degree in degrees.items() if degree == 1)
    if len(terminals) != 2 or any(degree not in {1, 2} for degree in degrees.values()):
        raise OriginalRouteSourceError("Reviewed official road is not a simple chain")
    start = min(terminals, key=lambda node: (distance_m(start_anchor, graph.node_coordinates[node]), node))
    end = terminals[1] if start == terminals[0] else terminals[0]
    current = start
    previous_edge: str | None = None
    geometry: list[list[float]] = []
    feature_ids: list[str] = []
    source_traversal: list[dict] = []
    direction_conflicts: list[str] = []
    maximum_gap = 0.0
    while current != end:
        choices = [edge for edge in graph.adjacency[current] if edge[2] != previous_edge]
        if len(choices) != 1:
            raise OriginalRouteSourceError("Reviewed official road chain is ambiguous")
        neighbor, _, feature_id, edge_geometry, reversed_from_source = choices[0]
        one_way = graph.features[feature_id].get("one_way")
        if (
            (one_way == "With Digitized" and reversed_from_source)
            or (one_way == "Against Digitized" and not reversed_from_source)
        ):
            direction_conflicts.append(feature_id)
        maximum_gap = max(maximum_gap, _append_geometry(geometry, edge_geometry))
        feature_ids.append(feature_id)
        source_traversal.append(
            {
                "geometry_id": feature_id,
                "direction": "reverse" if reversed_from_source else "forward",
                "partial": False,
            }
        )
        previous_edge = feature_id
        current = neighbor
        if len(feature_ids) > len(features):
            raise OriginalRouteSourceError("Reviewed official road chain contains a cycle")
    if len(set(feature_ids)) != len(features):
        raise OriginalRouteSourceError("Reviewed official road chain omitted source segments")
    return {
        "geometry": geometry,
        "feature_ids": feature_ids,
        "source_traversal": source_traversal,
        "direction_conflict_geometry_ids": sorted(direction_conflicts),
        "maximum_join_gap_m": round(maximum_gap, 3),
    }


def _landmark_projection(
    anchor: dict,
    geometry: list[list[float]],
    *,
    forced_progress_m: float | None = None,
) -> dict:
    lateral, progress, point = project_to_line(anchor["coordinates"], geometry)
    if forced_progress_m is not None:
        progress = forced_progress_m
        point = _point_at_measure(geometry, forced_progress_m)
        lateral = distance_m(anchor["coordinates"], point)
    if lateral <= 75:
        status = "on_route"
    elif lateral <= 1_000:
        status = "projected_landmark"
    else:
        status = "outside_official_coverage"
    return {
        "anchor_id": anchor["id"],
        "label": anchor["label"],
        "status": status,
        "route_progress_m": round(progress, 1),
        "lateral_distance_m": round(lateral, 1),
        "projected_coordinates": [round(value, 7) for value in point],
    }


def _road_names(snapshot: dict, feature_ids: set[str]) -> list[str]:
    return sorted(
        {
            item["road_name"]
            for item in snapshot["features"]
            if item["geometry_id"] in feature_ids
        }
    )


EXPECTED_VARIANT_ORDER = [
    "mountain-crossing-tn-to-nc",
    "mountain-crossing-nc-to-tn",
    "little-river-cades-cove-loop",
    "roaring-fork-one-way",
    "foothills-parkway-west-to-east",
    "foothills-parkway-east-to-west",
]


def _normalize_route_spec_for_evidence(route_spec: dict) -> dict:
    spec = copy.deepcopy(_object(route_spec, "Smokies route spec"))
    _forbid_keys(
        spec,
        {
            "schema_version",
            "kind",
            "product_id",
            "provider_policy",
            "expected_variant_count",
            "variants",
        },
        "Smokies route spec",
    )
    if (
        spec.get("schema_version") != 1
        or spec.get("kind") != "trailhead_original_route_spec"
        or spec.get("product_id") != PRODUCT_ID
        or spec.get("expected_variant_count") != 6
    ):
        raise OriginalRouteSourceError("Smokies route spec identity is invalid")
    if spec.get("provider_policy") != {
        "authoring_engine": "mapbox_directions",
        "profile": "mapbox/driving",
        "map_matching": "authoritative_trace_only",
        "geometric_operations": [
            "bounds",
            "distance_cross_check",
            "corridor_coverage",
        ],
        "output_persistence": "candidate_evidence_only",
    }:
        raise OriginalRouteSourceError("Smokies route provider policy changed")
    variants = _list(spec.get("variants"), "Smokies route variants", minimum=6, maximum=6)
    if [item.get("id") for item in variants] != EXPECTED_VARIANT_ORDER:
        raise OriginalRouteSourceError("Smokies route variant order or identity changed")
    normalized = []
    for index, variant_raw in enumerate(variants):
        variant = copy.deepcopy(_object(variant_raw, "Smokies route variant"))
        _forbid_keys(
            variant,
            {
                "id",
                "chapter_id",
                "variant_id",
                "sequence",
                "title",
                "direction",
                "route_strategy",
                "reverse_pair_id",
                "expected_distance_m",
                "max_control_snap_m",
                "required_road_name_patterns",
                "anchors",
            },
            "Smokies route variant",
        )
        if variant.get("id") != EXPECTED_VARIANT_ORDER[index]:
            raise OriginalRouteSourceError("Smokies route variant identity is invalid")
        for key in ("chapter_id", "variant_id"):
            variant[key] = _stable_id(variant.get(key), f"Smokies route {key}")
        if variant.get("direction") != "one_way" or variant.get("route_strategy") != "directions":
            raise OriginalRouteSourceError("Smokies route direction contract changed")
        expected_distance = _object(
            variant.get("expected_distance_m"), "Smokies expected distance"
        )
        _forbid_keys(expected_distance, {"minimum", "maximum"}, "Smokies expected distance")
        minimum = _finite_number(expected_distance.get("minimum"), "Smokies minimum distance")
        maximum = _finite_number(expected_distance.get("maximum"), "Smokies maximum distance")
        if minimum <= 0 or maximum <= minimum:
            raise OriginalRouteSourceError("Smokies expected distance is invalid")
        snap = _finite_number(variant.get("max_control_snap_m"), "Smokies route snap limit")
        if not 10 <= snap <= 500:
            raise OriginalRouteSourceError("Smokies route snap limit is invalid")
        patterns = _list(
            variant.get("required_road_name_patterns"), "Smokies road patterns", maximum=20
        )
        for pattern in patterns:
            if not isinstance(pattern, str) or not pattern or len(pattern) > 160:
                raise OriginalRouteSourceError("Smokies route road pattern is invalid")
            try:
                re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                raise OriginalRouteSourceError("Smokies route road pattern is invalid") from exc
        anchors = []
        anchor_ids: set[str] = set()
        for anchor_raw in _list(variant.get("anchors"), "Smokies route anchors", minimum=2, maximum=25):
            anchor = copy.deepcopy(_object(anchor_raw, "Smokies route anchor"))
            _forbid_keys(anchor, {"id", "label", "coordinates"}, "Smokies route anchor")
            anchor_id = _stable_id(anchor.get("id"), "Smokies route anchor id")
            if anchor_id in anchor_ids:
                raise OriginalRouteSourceError("Smokies route anchor identity is duplicated")
            anchor_ids.add(anchor_id)
            anchors.append(
                {
                    "id": anchor_id,
                    "label": _text(anchor.get("label"), "Smokies route anchor label", maximum=160),
                    "coordinates": _grsm_coordinate(
                        anchor.get("coordinates"), "Smokies route anchor coordinate"
                    ),
                }
            )
        normalized.append(
            {
                **variant,
                "expected_distance_m": {"minimum": minimum, "maximum": maximum},
                "max_control_snap_m": snap,
                "required_road_name_patterns": list(patterns),
                "anchors": anchors,
            }
        )
    by_id = {item["id"]: item for item in normalized}
    for variant in normalized:
        pair_id = variant.get("reverse_pair_id")
        if pair_id is None:
            continue
        if not isinstance(pair_id, str) or pair_id not in by_id:
            raise OriginalRouteSourceError("Smokies reverse route pair is invalid")
        pair = by_id[pair_id]
        if pair.get("reverse_pair_id") != variant["id"]:
            raise OriginalRouteSourceError("Smokies reverse route pair is incomplete")
        if [item["id"] for item in variant["anchors"]] != list(
            reversed([item["id"] for item in pair["anchors"]])
        ):
            raise OriginalRouteSourceError("Smokies reverse route anchors changed")
    return {**spec, "variants": normalized}


def _reverse_traversal(traversal: list[dict]) -> list[dict]:
    return [
        {
            **item,
            "direction": "reverse" if item["direction"] == "forward" else "forward",
        }
        for item in reversed(traversal)
    ]


def _route_output(
    *,
    snapshot: dict,
    variant: dict,
    geometry: list[list[float]],
    source_traversal: list[dict],
    landmarks: list[dict],
    maximum_join_gap_m: float,
    blockers: list[str] | None = None,
    direction_conflict_geometry_ids: list[str] | None = None,
) -> dict:
    blockers = list(blockers or [])
    distance = line_length_m(geometry)
    expected = variant["expected_distance_m"]
    if not expected["minimum"] <= distance <= expected["maximum"]:
        blockers.append("distance_outside_reviewed_range")
    feature_ids = {item["geometry_id"] for item in source_traversal}
    road_names = _road_names(snapshot, feature_ids)
    road_evidence = " | ".join(road_names)
    missing_patterns = [
        pattern
        for pattern in variant["required_road_name_patterns"]
        if not re.search(pattern, road_evidence, re.IGNORECASE)
    ]
    if missing_patterns:
        blockers.append("required_road_evidence_missing")
    if maximum_join_gap_m > ENDPOINT_JOIN_TOLERANCE_M + 1e-6:
        blockers.append("unreviewed_geometry_seam")
    progress = [item["route_progress_m"] for item in landmarks]
    if any(second + 0.1 < first for first, second in zip(progress, progress[1:])):
        blockers.append("landmark_order_is_ambiguous")
    blockers = sorted(set(blockers))
    return {
        "id": variant["id"],
        "chapter_id": variant["chapter_id"],
        "variant_id": variant["variant_id"],
        "status": "official_geometry_candidate" if not blockers else "blocked_source_review",
        "geometry_ready_for_editorial_cues": not blockers,
        "blocking_issues": blockers,
        "geometry": {"type": "LineString", "coordinates": geometry},
        "geometry_sha256": canonical_sha256(
            {"type": "LineString", "coordinates": geometry}
        ),
        "distance_m": round(distance, 1),
        "expected_distance_m": expected,
        "road_names": road_names,
        "required_road_name_patterns": variant["required_road_name_patterns"],
        "source_geometry_ids": sorted(feature_ids),
        "source_traversal": source_traversal,
        "source_direction_conflict_geometry_ids": sorted(
            direction_conflict_geometry_ids or []
        ),
        "maximum_join_gap_m": round(maximum_join_gap_m, 3),
        "landmarks": landmarks,
    }


def build_official_route_evidence(snapshot_payload: dict, route_spec: dict) -> dict:
    snapshot = normalize_nps_road_snapshot(snapshot_payload)
    spec = _normalize_route_spec_for_evidence(route_spec)
    variants = spec["variants"]
    variants_by_id = {item["id"]: item for item in variants}
    output_variants: list[dict] = []

    mountain_names = {
        "Fighting Creek Gap Road",
        "Newfound Gap Road North",
        "Newfound Gap Road South",
        "Kuwohi Access Road",
        "Morton Mountain Tunnel",
        "Sugarlands Visitor Center Loop Road",
    }
    mountain_forward = variants_by_id["mountain-crossing-tn-to-nc"]
    mountain_anchors = {item["id"]: item for item in mountain_forward["anchors"]}
    kuwohi_chain = _ordered_chain(
        _features_for(snapshot, {"Kuwohi Access Road"}),
        mountain_anchors["kuwohi"]["coordinates"],
    )
    kuwohi_control = {
        "id": "kuwohi_route_control",
        "label": "Kuwohi road terminus",
        "coordinates": kuwohi_chain["geometry"][0],
    }
    mountain_controls = [
        {
            **mountain_anchors["sugarlands"],
            "required_road_names": {"Sugarlands Visitor Center Loop Road"},
        },
        {
            **mountain_anchors["newfound_gap_return"],
            "required_road_names": {"Newfound Gap Road North"},
        },
        {**kuwohi_control, "required_road_names": {"Kuwohi Access Road"}},
        {
            **mountain_anchors["newfound_gap_outbound"],
            "required_road_names": {"Newfound Gap Road North"},
        },
        {
            **mountain_anchors["oconaluftee"],
            "required_road_names": {"Newfound Gap Road South"},
        },
    ]
    mountain = _derive_via(
        RoadGraph(_features_for(snapshot, mountain_names)),
        mountain_controls,
        max_control_snap_m=mountain_forward["max_control_snap_m"],
    )
    mountain_geometry = mountain["geometry"]
    mountain_progress = mountain["control_progress"]
    mountain_landmarks = []
    for anchor in mountain_forward["anchors"]:
        progress_key = "kuwohi_route_control" if anchor["id"] == "kuwohi" else anchor["id"]
        forced = (
            mountain_progress[progress_key]["route_progress_m"]
            if progress_key in mountain_progress
            else None
        )
        mountain_landmarks.append(
            _landmark_projection(anchor, mountain_geometry, forced_progress_m=forced)
        )
    mountain_blockers = [
        "cherokee_extension_requires_separate_authoritative_public_road_source"
    ]
    output_variants.append(
        _route_output(
            snapshot=snapshot,
            variant=mountain_forward,
            geometry=mountain_geometry,
            source_traversal=mountain["source_traversal"],
            landmarks=mountain_landmarks,
            maximum_join_gap_m=mountain["maximum_join_gap_m"],
            blockers=mountain_blockers,
        )
    )
    mountain_reverse = variants_by_id["mountain-crossing-nc-to-tn"]
    mountain_reverse_anchors = {
        item["id"]: item for item in mountain_reverse["anchors"]
    }
    mountain_reverse_controls = [
        {
            **mountain_reverse_anchors["oconaluftee"],
            "required_road_names": {"Newfound Gap Road South"},
        },
        {
            **mountain_reverse_anchors["newfound_gap_outbound"],
            "required_road_names": {"Newfound Gap Road North"},
        },
        {**kuwohi_control, "required_road_names": {"Kuwohi Access Road"}},
        {
            **mountain_reverse_anchors["newfound_gap_return"],
            "required_road_names": {"Newfound Gap Road North"},
        },
        {
            **mountain_reverse_anchors["sugarlands"],
            "required_road_names": {"Sugarlands Visitor Center Loop Road"},
        },
    ]
    mountain_reverse_derived = _derive_via(
        RoadGraph(_features_for(snapshot, mountain_names)),
        mountain_reverse_controls,
        max_control_snap_m=mountain_reverse["max_control_snap_m"],
    )
    mountain_reverse_geometry = mountain_reverse_derived["geometry"]
    mountain_reverse_progress = mountain_reverse_derived["control_progress"]
    mountain_reverse_landmarks = []
    for anchor in mountain_reverse["anchors"]:
        progress_key = "kuwohi_route_control" if anchor["id"] == "kuwohi" else anchor["id"]
        forced = (
            0.0
            if anchor["id"] == "cherokee"
            else mountain_reverse_progress[progress_key]["route_progress_m"]
        )
        mountain_reverse_landmarks.append(
            _landmark_projection(
                anchor,
                mountain_reverse_geometry,
                forced_progress_m=forced,
            )
        )
    output_variants.append(
        _route_output(
            snapshot=snapshot,
            variant=mountain_reverse,
            geometry=mountain_reverse_geometry,
            source_traversal=mountain_reverse_derived["source_traversal"],
            landmarks=mountain_reverse_landmarks,
            maximum_join_gap_m=mountain_reverse_derived["maximum_join_gap_m"],
            blockers=mountain_blockers,
        )
    )

    cades = variants_by_id["little-river-cades-cove-loop"]
    cades_anchors = {item["id"]: item for item in cades["anchors"]}
    loop = _ordered_chain(
        _features_for(snapshot, {"Cades Cove Loop Road"}),
        cades_anchors["cades_cove_entrance"]["coordinates"],
    )
    approach_graph = RoadGraph(
        _features_for(
            snapshot,
            {
                "Fighting Creek Gap Road",
                "Little River Gorge Road",
                "Townsend Entrance Road",
                "Laurel Creek Road",
            },
        )
    )
    approach_controls = [
        cades_anchors["sugarlands"],
        cades_anchors["townsend_wye"],
        {
            "id": "cades_cove_entrance",
            "label": cades_anchors["cades_cove_entrance"]["label"],
            "coordinates": loop["geometry"][0],
        },
    ]
    approach = _derive_via(
        approach_graph,
        approach_controls,
        max_control_snap_m=cades["max_control_snap_m"],
    )
    cades_geometry: list[list[float]] = []
    cades_gap = _append_geometry(cades_geometry, approach["geometry"])
    cades_gap = max(cades_gap, _append_geometry(cades_geometry, loop["geometry"]))
    connector_graph = RoadGraph(
        _features_for(snapshot, {"Cades Cove Campground Entrance Road"})
    )
    connector = _derive_via(
        connector_graph,
        [
            {"id": "loop_terminal", "label": "Loop terminal", "coordinates": loop["geometry"][-1]},
            cades_anchors["cades_cove_exit"],
        ],
        max_control_snap_m=cades["max_control_snap_m"],
    )
    cades_gap = max(cades_gap, _append_geometry(cades_geometry, connector["geometry"]))
    cades_landmarks = []
    for anchor in cades["anchors"]:
        forced = None
        if anchor["id"] == "sugarlands":
            forced = 0.0
        elif anchor["id"] == "townsend_wye":
            forced = approach["control_progress"]["townsend_wye"]["route_progress_m"]
        elif anchor["id"] == "cades_cove_entrance":
            forced = line_length_m(approach["geometry"])
        elif anchor["id"] == "cades_cove_exit":
            forced = line_length_m(cades_geometry)
        cades_landmarks.append(_landmark_projection(anchor, cades_geometry, forced_progress_m=forced))
    cades_traversal = [
        *approach["source_traversal"],
        *loop["source_traversal"],
        *connector["source_traversal"],
    ]
    output_variants.append(
        _route_output(
            snapshot=snapshot,
            variant=cades,
            geometry=cades_geometry,
            source_traversal=cades_traversal,
            landmarks=cades_landmarks,
            maximum_join_gap_m=max(
                cades_gap,
                approach["maximum_join_gap_m"],
                loop["maximum_join_gap_m"],
                connector["maximum_join_gap_m"],
            ),
            blockers=(
                ["nps_one_way_digitization_conflict"]
                if loop["direction_conflict_geometry_ids"]
                else []
            ),
            direction_conflict_geometry_ids=loop["direction_conflict_geometry_ids"],
        )
    )

    roaring = variants_by_id["roaring-fork-one-way"]
    roaring_chain = _ordered_chain(
        _features_for(snapshot, {"Roaring Fork Motor Nature Trail"}),
        roaring["anchors"][0]["coordinates"],
    )
    roaring_geometry = roaring_chain["geometry"]
    roaring_ids = set(roaring_chain["feature_ids"])
    output_variants.append(
        _route_output(
            snapshot=snapshot,
            variant=roaring,
            geometry=roaring_geometry,
            source_traversal=roaring_chain["source_traversal"],
            landmarks=[_landmark_projection(item, roaring_geometry) for item in roaring["anchors"]],
            maximum_join_gap_m=roaring_chain["maximum_join_gap_m"],
            blockers=(
                ["nps_one_way_digitization_conflict"]
                if roaring_chain["direction_conflict_geometry_ids"]
                else []
            ),
            direction_conflict_geometry_ids=roaring_chain[
                "direction_conflict_geometry_ids"
            ],
        )
    )

    foothills_west = variants_by_id["foothills-parkway-west-to-east"]
    foothills = _derive_via(
        RoadGraph(
            _features_for(
                snapshot, {"Foothills Parkway West", "Foothills Parkway Access Road"}
            )
        ),
        [foothills_west["anchors"][0], foothills_west["anchors"][-1]],
        max_control_snap_m=foothills_west["max_control_snap_m"],
    )
    for variant_id, reverse in (
        ("foothills-parkway-west-to-east", False),
        ("foothills-parkway-east-to-west", True),
    ):
        variant = variants_by_id[variant_id]
        geometry = list(reversed(foothills["geometry"])) if reverse else foothills["geometry"]
        traversal = (
            _reverse_traversal(foothills["source_traversal"])
            if reverse
            else foothills["source_traversal"]
        )
        output_variants.append(
            _route_output(
                snapshot=snapshot,
                variant=variant,
                geometry=geometry,
                source_traversal=traversal,
                landmarks=[_landmark_projection(item, geometry) for item in variant["anchors"]],
                maximum_join_gap_m=foothills["maximum_join_gap_m"],
            )
        )

    output_variants.sort(key=lambda item: EXPECTED_VARIANT_ORDER.index(item["id"]))
    return {
        "schema_version": 1,
        "kind": "trailhead_original_official_route_evidence",
        "product_id": PRODUCT_ID,
        "source_snapshot_sha256": nps_road_snapshot_sha256(snapshot),
        "source_policy": {
            "geometry_authority": "nps_public_roads",
            "license": "us-pd",
            "operational_readiness_separate": True,
            "mapbox_candidate_geometry_persisted": False,
            "endpoint_join_tolerance_m": ENDPOINT_JOIN_TOLERANCE_M,
        },
        "publication_status": "blocked",
        "publication_blockers": [
            "mountain_crossing_cherokee_extension",
            "trusted_current_road_observation",
            "server_owned_vehicle_class",
            "editorial_and_cultural_review",
        ],
        "variants": output_variants,
    }


def official_route_evidence_sha256(snapshot_payload: dict, route_spec: dict) -> str:
    return canonical_sha256(build_official_route_evidence(snapshot_payload, route_spec))
