#!/usr/bin/env python3
"""Build token-free candidate route evidence for the Smokies Original.

The committed input contains only reviewed control points and validation rules.
Mapbox Directions is called at authoring time. The generated output is written
under ``output/`` (ignored by Git) and remains candidate evidence until route
licensing and publication validation are complete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SPEC = REPO_ROOT / "originals" / "smokies" / "route_variants_v1.json"
DEFAULT_OUTPUT = REPO_ROOT / "output" / "smokies-original" / "route-candidates-v1.json"
MAPBOX_DIRECTIONS_ROOT = "https://api.mapbox.com/directions/v5/mapbox/driving"
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
EXPECTED_VARIANT_IDS = {
    "mountain-crossing-tn-to-nc",
    "mountain-crossing-nc-to-tn",
    "little-river-cades-cove-loop",
    "roaring-fork-one-way",
    "foothills-parkway-west-to-east",
    "foothills-parkway-east-to-west",
}


class SmokiesRouteBuildError(ValueError):
    """Raised when an authored route or provider response is unsafe to use."""


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SmokiesRouteBuildError(f"{label} must be an object")
    return value


def _require_keys(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise SmokiesRouteBuildError(
            f"{label} contains unsupported fields: {', '.join(unexpected)}"
        )


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SmokiesRouteBuildError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise SmokiesRouteBuildError(f"{label} must be finite")
    return result


def _coordinate(value: Any, label: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 2:
        raise SmokiesRouteBuildError(f"{label} must be [longitude, latitude]")
    longitude = _finite_number(value[0], f"{label} longitude")
    latitude = _finite_number(value[1], f"{label} latitude")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise SmokiesRouteBuildError(f"{label} is outside coordinate limits")
    return [round(longitude, 6), round(latitude, 6)]


def _haversine_m(first: list[float], second: list[float]) -> float:
    longitude_1, latitude_1 = map(math.radians, first)
    longitude_2, latitude_2 = map(math.radians, second)
    delta_latitude = latitude_2 - latitude_1
    delta_longitude = longitude_2 - longitude_1
    haversine = (
        math.sin(delta_latitude / 2) ** 2
        + math.cos(latitude_1)
        * math.cos(latitude_2)
        * math.sin(delta_longitude / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(min(1, math.sqrt(haversine)))


def _geometry_length_m(coordinates: list[list[float]]) -> float:
    return sum(
        _haversine_m(coordinates[index - 1], coordinates[index])
        for index in range(1, len(coordinates))
    )


def _geometry_bounds(coordinates: list[list[float]]) -> dict[str, float]:
    longitudes = [coordinate[0] for coordinate in coordinates]
    latitudes = [coordinate[1] for coordinate in coordinates]
    return {
        "north": max(latitudes),
        "south": min(latitudes),
        "east": max(longitudes),
        "west": min(longitudes),
    }


def _clean_identifier(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,119}", text):
        raise SmokiesRouteBuildError(f"{label} must be a stable identifier")
    return text


def load_route_spec(path: Path = DEFAULT_SPEC) -> dict[str, Any]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SmokiesRouteBuildError("Smokies route specification is unavailable") from exc
    spec = _require_object(raw, "Smokies route specification")
    _require_keys(
        spec,
        {
            "schema_version",
            "kind",
            "product_id",
            "provider_policy",
            "expected_variant_count",
            "variants",
        },
        "Smokies route specification",
    )
    if spec.get("schema_version") != 1 or spec.get("kind") != "trailhead_original_route_spec":
        raise SmokiesRouteBuildError("Smokies route specification version is unsupported")
    policy = _require_object(spec.get("provider_policy"), "Route provider policy")
    _require_keys(
        policy,
        {
            "authoring_engine",
            "profile",
            "map_matching",
            "geometric_operations",
            "output_persistence",
        },
        "Route provider policy",
    )
    if (
        policy.get("authoring_engine") != "mapbox_directions"
        or policy.get("profile") != "mapbox/driving"
        or policy.get("map_matching") != "authoritative_trace_only"
        or policy.get("output_persistence") != "candidate_evidence_only"
    ):
        raise SmokiesRouteBuildError("Smokies route provider policy was weakened")
    if policy.get("geometric_operations") != [
        "bounds",
        "distance_cross_check",
        "corridor_coverage",
    ]:
        raise SmokiesRouteBuildError("Smokies route geometric operations are invalid")
    variants = spec.get("variants")
    if not isinstance(variants, list) or len(variants) != spec.get("expected_variant_count"):
        raise SmokiesRouteBuildError("Smokies route specification must include six variants")
    normalized_variants: list[dict[str, Any]] = []
    for raw_variant in variants:
        variant = _require_object(raw_variant, "Smokies route variant")
        _require_keys(
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
        variant_id = _clean_identifier(variant.get("id"), "Route variant id")
        chapter_id = _clean_identifier(variant.get("chapter_id"), f"{variant_id} chapter id")
        selection_variant_id = _clean_identifier(
            variant.get("variant_id"), f"{variant_id} manifest variant id"
        )
        sequence = variant.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise SmokiesRouteBuildError(f"{variant_id} sequence is invalid")
        if variant.get("route_strategy") != "directions":
            raise SmokiesRouteBuildError(
                f"{variant_id} cannot use map matching without an authoritative trace"
            )
        title = str(variant.get("title") or "").strip()
        direction = _clean_identifier(variant.get("direction"), f"{variant_id} direction")
        if direction not in {"one_way", "loop"}:
            raise SmokiesRouteBuildError(
                f"{variant_id} direction is incompatible with OriginalRouteV1"
            )
        if not title or len(title) > 160:
            raise SmokiesRouteBuildError(f"{variant_id} title is invalid")
        distance_range = _require_object(
            variant.get("expected_distance_m"), f"{variant_id} expected distance"
        )
        _require_keys(distance_range, {"minimum", "maximum"}, f"{variant_id} expected distance")
        minimum_distance = _finite_number(
            distance_range.get("minimum"), f"{variant_id} minimum distance"
        )
        maximum_distance = _finite_number(
            distance_range.get("maximum"), f"{variant_id} maximum distance"
        )
        if minimum_distance <= 0 or maximum_distance <= minimum_distance:
            raise SmokiesRouteBuildError(f"{variant_id} expected distance range is invalid")
        snap_limit = _finite_number(
            variant.get("max_control_snap_m"), f"{variant_id} control snap limit"
        )
        if not 10 <= snap_limit <= 500:
            raise SmokiesRouteBuildError(f"{variant_id} control snap limit is invalid")
        patterns = variant.get("required_road_name_patterns")
        if not isinstance(patterns, list) or not patterns:
            raise SmokiesRouteBuildError(f"{variant_id} requires road-name evidence")
        for pattern in patterns:
            if not isinstance(pattern, str) or not pattern or len(pattern) > 160:
                raise SmokiesRouteBuildError(f"{variant_id} has an invalid road-name pattern")
            try:
                re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                raise SmokiesRouteBuildError(
                    f"{variant_id} has an invalid road-name pattern"
                ) from exc
        raw_anchors = variant.get("anchors")
        if not isinstance(raw_anchors, list) or not 2 <= len(raw_anchors) <= 25:
            raise SmokiesRouteBuildError(f"{variant_id} must contain 2 to 25 anchors")
        anchors: list[dict[str, Any]] = []
        anchor_ids: set[str] = set()
        for raw_anchor in raw_anchors:
            anchor = _require_object(raw_anchor, f"{variant_id} anchor")
            _require_keys(anchor, {"id", "label", "coordinates"}, f"{variant_id} anchor")
            anchor_id = _clean_identifier(anchor.get("id"), f"{variant_id} anchor id")
            label = str(anchor.get("label") or "").strip()
            if anchor_id in anchor_ids or not label or len(label) > 160:
                raise SmokiesRouteBuildError(f"{variant_id} anchor identity is invalid")
            anchor_ids.add(anchor_id)
            anchors.append(
                {
                    "id": anchor_id,
                    "label": label,
                    "coordinates": _coordinate(
                        anchor.get("coordinates"), f"{variant_id} anchor {anchor_id}"
                    ),
                }
            )
        reverse_pair_id = variant.get("reverse_pair_id")
        if reverse_pair_id is not None:
            reverse_pair_id = _clean_identifier(
                reverse_pair_id, f"{variant_id} reverse pair id"
            )
        normalized_variants.append(
            {
                **variant,
                "id": variant_id,
                "chapter_id": chapter_id,
                "variant_id": selection_variant_id,
                "sequence": sequence,
                "title": title,
                "direction": direction,
                "reverse_pair_id": reverse_pair_id,
                "expected_distance_m": {
                    "minimum": minimum_distance,
                    "maximum": maximum_distance,
                },
                "max_control_snap_m": snap_limit,
                "required_road_name_patterns": list(patterns),
                "anchors": anchors,
            }
        )
    ids = {variant["id"] for variant in normalized_variants}
    if ids != EXPECTED_VARIANT_IDS:
        raise SmokiesRouteBuildError("Smokies route variants do not match the approved six")
    by_id = {variant["id"]: variant for variant in normalized_variants}
    selections = {
        (variant["chapter_id"], variant["variant_id"])
        for variant in normalized_variants
    }
    if len(selections) != len(normalized_variants):
        raise SmokiesRouteBuildError("Smokies manifest route selections must be unique")
    for variant in normalized_variants:
        pair_id = variant.get("reverse_pair_id")
        if not pair_id:
            continue
        pair = by_id.get(pair_id)
        if not pair or pair.get("reverse_pair_id") != variant["id"]:
            raise SmokiesRouteBuildError(f"{variant['id']} reverse pair is incomplete")
        anchor_ids = [anchor["id"] for anchor in variant["anchors"]]
        pair_anchor_ids = [anchor["id"] for anchor in pair["anchors"]]
        if anchor_ids != list(reversed(pair_anchor_ids)):
            raise SmokiesRouteBuildError(
                f"{variant['id']} reverse pair must reverse every authored anchor"
            )
    return {**spec, "variants": normalized_variants}


def directions_request_evidence(variant: dict[str, Any]) -> dict[str, Any]:
    """Return the exact token-free request that will be hashed into evidence."""
    return {
        "endpoint": "/directions/v5/mapbox/driving/{coordinates}",
        "profile": "mapbox/driving",
        "parameters": {
            "alternatives": "false",
            "continue_straight": "true",
            "geometries": "geojson",
            "language": "en",
            "overview": "full",
            "radiuses": ";".join(
                str(int(variant["max_control_snap_m"])) for _ in variant["anchors"]
            ),
            "steps": "true",
            "waypoints_per_route": "true",
        },
        "coordinates": [anchor["coordinates"] for anchor in variant["anchors"]],
    }


def _directions_request(variant: dict[str, Any], access_token: str) -> urllib_request.Request:
    evidence = directions_request_evidence(variant)
    coordinates = ";".join(
        f"{coordinate[0]:.6f},{coordinate[1]:.6f}"
        for coordinate in evidence["coordinates"]
    )
    params = {**evidence["parameters"], "access_token": access_token}
    return urllib_request.Request(
        f"{MAPBOX_DIRECTIONS_ROOT}/{coordinates}?{urllib_parse.urlencode(params)}",
        headers={
            "Accept": "application/json",
            "User-Agent": "TrailheadOriginalRouteAuthor/1.0",
        },
        method="GET",
    )


def fetch_directions(
    variant: dict[str, Any],
    access_token: str,
    *,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    if not re.fullmatch(r"(?:pk|sk)\.[A-Za-z0-9._-]{20,}", access_token.strip()):
        raise SmokiesRouteBuildError("MAPBOX_TOKEN is missing or malformed")
    request = _directions_request(variant, access_token.strip())
    try:
        with urllib_request.urlopen(request, timeout=max(5, min(timeout_seconds, 60))) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib_error.HTTPError as exc:
        # Never propagate the request URL because it contains the access token.
        detail = ""
        try:
            payload = json.loads(exc.read(MAX_RESPONSE_BYTES).decode("utf-8"))
            detail = str(payload.get("message") or payload.get("code") or "")[:200]
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            detail = ""
        raise SmokiesRouteBuildError(
            f"Mapbox Directions rejected {variant['id']}"
            + (f": {detail}" if detail else "")
        ) from None
    except (OSError, urllib_error.URLError) as exc:
        raise SmokiesRouteBuildError(
            f"Mapbox Directions is unavailable for {variant['id']}"
        ) from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise SmokiesRouteBuildError(f"Mapbox Directions response is too large for {variant['id']}")
    try:
        result = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SmokiesRouteBuildError(
            f"Mapbox Directions returned malformed JSON for {variant['id']}"
        ) from exc
    if not isinstance(result, dict):
        raise SmokiesRouteBuildError(
            f"Mapbox Directions returned an invalid response for {variant['id']}"
        )
    return result


def compile_route_candidate(
    variant: dict[str, Any],
    response: dict[str, Any],
) -> dict[str, Any]:
    if response.get("code") != "Ok":
        raise SmokiesRouteBuildError(
            f"Mapbox Directions did not route {variant['id']}: "
            f"{str(response.get('code') or 'unknown')[:80]}"
        )
    routes = response.get("routes")
    if not isinstance(routes, list) or len(routes) != 1:
        raise SmokiesRouteBuildError(f"{variant['id']} must resolve to exactly one route")
    route = _require_object(routes[0], f"{variant['id']} route")
    geometry = _require_object(route.get("geometry"), f"{variant['id']} route geometry")
    if geometry.get("type") != "LineString":
        raise SmokiesRouteBuildError(f"{variant['id']} route must be a LineString")
    raw_coordinates = geometry.get("coordinates")
    if not isinstance(raw_coordinates, list) or not 2 <= len(raw_coordinates) <= 20_000:
        raise SmokiesRouteBuildError(f"{variant['id']} route geometry is incomplete")
    coordinates = [
        _coordinate(coordinate, f"{variant['id']} route coordinate {index}")
        for index, coordinate in enumerate(raw_coordinates)
    ]
    distance_m = _finite_number(route.get("distance"), f"{variant['id']} route distance")
    duration_s = _finite_number(route.get("duration"), f"{variant['id']} route duration")
    expected = variant["expected_distance_m"]
    if not expected["minimum"] <= distance_m <= expected["maximum"]:
        raise SmokiesRouteBuildError(
            f"{variant['id']} distance {distance_m:.0f} m is outside its reviewed range"
        )
    if duration_s <= 0:
        raise SmokiesRouteBuildError(f"{variant['id']} route duration is invalid")
    coordinate_length_m = _geometry_length_m(coordinates)
    distance_difference_m = abs(coordinate_length_m - distance_m)
    if distance_difference_m > max(500, distance_m * 0.02):
        raise SmokiesRouteBuildError(
            f"{variant['id']} geometry does not match its routed distance"
        )
    maximum_segment_m = max(
        _haversine_m(coordinates[index - 1], coordinates[index])
        for index in range(1, len(coordinates))
    )
    if maximum_segment_m > 500:
        raise SmokiesRouteBuildError(f"{variant['id']} contains a discontinuous segment")

    route_waypoints = route.get("waypoints")
    if route_waypoints is None:
        route_waypoints = response.get("waypoints")
    if not isinstance(route_waypoints, list) or len(route_waypoints) != len(variant["anchors"]):
        raise SmokiesRouteBuildError(f"{variant['id']} is missing snapped control evidence")
    controls: list[dict[str, Any]] = []
    for anchor, raw_waypoint in zip(variant["anchors"], route_waypoints):
        waypoint = _require_object(raw_waypoint, f"{variant['id']} snapped control")
        snapped = _coordinate(
            waypoint.get("location"), f"{variant['id']} snapped control {anchor['id']}"
        )
        snap_distance_m = _haversine_m(anchor["coordinates"], snapped)
        if snap_distance_m > variant["max_control_snap_m"] + 0.5:
            raise SmokiesRouteBuildError(
                f"{variant['id']} control {anchor['id']} snapped too far from its anchor"
            )
        controls.append(
            {
                "id": anchor["id"],
                "label": anchor["label"],
                "authored_coordinates": anchor["coordinates"],
                "snapped_coordinates": snapped,
                "snap_distance_m": round(snap_distance_m, 3),
                "road_name": str(waypoint.get("name") or "").strip()[:200],
            }
        )

    road_names: list[str] = []
    legs = route.get("legs")
    if not isinstance(legs, list) or len(legs) != len(variant["anchors"]) - 1:
        raise SmokiesRouteBuildError(f"{variant['id']} has an invalid routed leg count")
    for leg in legs:
        if not isinstance(leg, dict) or not isinstance(leg.get("steps"), list):
            raise SmokiesRouteBuildError(f"{variant['id']} is missing routed road evidence")
        for step in leg["steps"]:
            if not isinstance(step, dict):
                continue
            name = str(step.get("name") or "").strip()
            if name and name not in road_names:
                road_names.append(name[:240])
    joined_names = "\n".join(road_names)
    missing_patterns = [
        pattern
        for pattern in variant["required_road_name_patterns"]
        if not re.search(pattern, joined_names, re.IGNORECASE)
    ]
    if missing_patterns:
        raise SmokiesRouteBuildError(
            f"{variant['id']} did not traverse every required named road"
        )

    request_evidence = directions_request_evidence(variant)
    clean_uuid = str(response.get("uuid") or "").strip()
    if clean_uuid and len(clean_uuid) > 240:
        raise SmokiesRouteBuildError(f"{variant['id']} response identifier is invalid")
    bounds = _geometry_bounds(coordinates)
    return {
        "id": variant["id"],
        "chapter_id": variant["chapter_id"],
        "variant_id": variant["variant_id"],
        "sequence": variant["sequence"],
        "title": variant["title"],
        "request_sha256": _sha256(request_evidence),
        "provider_response_id": clean_uuid,
        "controls": controls,
        "road_names": road_names,
        "route": {
            "profile": "driving",
            "direction": variant["direction"],
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "bounds": bounds,
            "distance_m": round(distance_m, 3),
            "duration_s": round(duration_s, 3),
        },
        "diagnostics": {
            "coordinate_count": len(coordinates),
            "geometry_distance_m": round(coordinate_length_m, 3),
            "distance_difference_m": round(distance_difference_m, 3),
            "maximum_segment_m": round(maximum_segment_m, 3),
            "maximum_control_snap_m": round(
                max(control["snap_distance_m"] for control in controls), 3
            ),
        },
        "geometry_sha256": _sha256({"type": "LineString", "coordinates": coordinates}),
    }


def _validate_reverse_pairs(
    spec: dict[str, Any], candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_candidate_id = {candidate["id"]: candidate for candidate in candidates}
    checked: set[tuple[str, str]] = set()
    evidence: list[dict[str, Any]] = []
    for variant in spec["variants"]:
        pair_id = variant.get("reverse_pair_id")
        if not pair_id:
            continue
        pair_key = tuple(sorted((variant["id"], pair_id)))
        if pair_key in checked:
            continue
        checked.add(pair_key)
        first = by_candidate_id[variant["id"]]
        second = by_candidate_id[pair_id]
        first_controls = first["controls"]
        second_controls = second["controls"]
        start_difference_m = _haversine_m(
            first_controls[0]["snapped_coordinates"],
            second_controls[-1]["snapped_coordinates"],
        )
        end_difference_m = _haversine_m(
            first_controls[-1]["snapped_coordinates"],
            second_controls[0]["snapped_coordinates"],
        )
        first_distance = first["route"]["distance_m"]
        second_distance = second["route"]["distance_m"]
        distance_difference_ratio = abs(first_distance - second_distance) / max(
            first_distance, second_distance
        )
        if start_difference_m > 25 or end_difference_m > 25:
            raise SmokiesRouteBuildError(
                f"{variant['id']} and {pair_id} do not share reversed endpoints"
            )
        if distance_difference_ratio > 0.05:
            raise SmokiesRouteBuildError(
                f"{variant['id']} and {pair_id} have inconsistent routed distances"
            )
        evidence.append(
            {
                "variant_ids": list(pair_key),
                "start_difference_m": round(start_difference_m, 3),
                "end_difference_m": round(end_difference_m, 3),
                "distance_difference_ratio": round(distance_difference_ratio, 6),
            }
        )
    return sorted(evidence, key=lambda row: row["variant_ids"])


def build_candidate_artifact(
    spec: dict[str, Any],
    responses: dict[str, dict[str, Any]],
    *,
    generated_at: str,
) -> dict[str, Any]:
    try:
        parsed_generated_at = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SmokiesRouteBuildError("generated_at must be an ISO timestamp") from exc
    if parsed_generated_at.tzinfo is None:
        raise SmokiesRouteBuildError("generated_at must include a timezone")
    expected_ids = {variant["id"] for variant in spec["variants"]}
    if set(responses) != expected_ids:
        raise SmokiesRouteBuildError("Every approved Smokies route variant requires a response")
    candidates = [
        compile_route_candidate(variant, responses[variant["id"]])
        for variant in spec["variants"]
    ]
    candidates.sort(key=lambda item: (item["chapter_id"], item["sequence"], item["id"]))
    route_set_sha256 = _sha256(
        [
            {
                "id": candidate["id"],
                "chapter_id": candidate["chapter_id"],
                "variant_id": candidate["variant_id"],
                "request_sha256": candidate["request_sha256"],
                "geometry_sha256": candidate["geometry_sha256"],
                "distance_m": candidate["route"]["distance_m"],
                "duration_s": candidate["route"]["duration_s"],
            }
            for candidate in candidates
        ]
    )
    artifact = {
        "schema_version": 1,
        "kind": "trailhead_original_route_candidates",
        "product_id": spec["product_id"],
        "generated_at": parsed_generated_at.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "spec_sha256": _sha256(spec),
        "route_set_sha256": route_set_sha256,
        "provider": {
            "name": "mapbox",
            "service": "directions-v5",
            "profile": "mapbox/driving",
            "temporary_use_only": True,
        },
        "publication_status": "candidate_only",
        "variants": candidates,
        "reverse_pair_evidence": _validate_reverse_pairs(spec, candidates),
    }
    encoded = _canonical_json(artifact)
    if b"access_token" in encoded or b"MAPBOX_TOKEN" in encoded or b"pk." in encoded or b"sk." in encoded:
        raise SmokiesRouteBuildError("Candidate artifact contains credential material")
    return artifact


def _write_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build reviewed Great Smoky Mountains Original route candidates."
    )
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--token-env", default="MAPBOX_TOKEN")
    parser.add_argument("--timeout-seconds", type=int, default=45)
    parser.add_argument("--request-spacing-seconds", type=float, default=0.2)
    parser.add_argument("--generated-at")
    args = parser.parse_args()
    spec = load_route_spec(args.spec.resolve())
    access_token = os.getenv(args.token_env, "").strip()
    if not access_token:
        raise SystemExit(f"Set {args.token_env} before building route candidates.")
    responses: dict[str, dict[str, Any]] = {}
    for index, variant in enumerate(spec["variants"]):
        print(f"Routing {variant['id']} ({index + 1}/{len(spec['variants'])})...", flush=True)
        responses[variant["id"]] = fetch_directions(
            variant,
            access_token,
            timeout_seconds=args.timeout_seconds,
        )
        if index + 1 < len(spec["variants"]):
            time.sleep(max(0, min(args.request_spacing_seconds, 2)))
    generated_at = args.generated_at or datetime.now(timezone.utc).isoformat()
    artifact = build_candidate_artifact(spec, responses, generated_at=generated_at)
    output = args.output.resolve()
    _write_atomic(output, artifact)
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(output),
                "variant_count": len(artifact["variants"]),
                "spec_sha256": artifact["spec_sha256"],
                "route_set_sha256": artifact["route_set_sha256"],
                "artifact_sha256": _sha256(artifact),
                "routes": [
                    {
                        "id": candidate["id"],
                        "distance_m": candidate["route"]["distance_m"],
                        "duration_s": candidate["route"]["duration_s"],
                        "coordinate_count": candidate["diagnostics"]["coordinate_count"],
                        "geometry_sha256": candidate["geometry_sha256"],
                    }
                    for candidate in artifact["variants"]
                ],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SmokiesRouteBuildError as exc:
        raise SystemExit(f"Smokies route build failed: {exc}") from None
