"""Trusted bridge to the headless Trailhead Originals trigger validator."""
from __future__ import annotations

import json
import hashlib
import math
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import subprocess
from typing import Any, Iterable
from urllib import error as urllib_error, request as urllib_request


class OriginalValidationRunnerError(RuntimeError):
    """The trusted validator could not produce a valid deterministic report."""


REPO_ROOT = Path(__file__).resolve().parents[1]
MOBILE_ROOT = REPO_ROOT / "mobile"
RUNNER_PATH = MOBILE_ROOT / "scripts" / "validate-original-route.ts"
MAX_OUTPUT_BYTES = 2 * 1024 * 1024
MAX_ROUTE_NETWORK_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_ROUTE_NETWORK_CHUNK_POINTS = 50
ROUTE_NETWORK_CHUNK_OVERLAP_POINTS = 2
MAX_AUTHORED_ROUTE_SEGMENT_M = 2_000.0
MAX_MATCHED_POINT_OFFSET_M = 50.0
MAX_LOCATE_EDGE_DISTANCE_M = 25.0
MAX_NETWORK_DISTANCE_DELTA_RATIO = 0.15
MAX_NETWORK_DISTANCE_DELTA_M = 300.0
ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS = 30
TRUSTED_VALIDATOR_SOURCE_PATHS = (
    Path("db/originals_validation.py"),
    Path("mobile/lib/routeProjection.ts"),
    Path("mobile/lib/originals/manifest.ts"),
    Path("mobile/lib/originals/routeProjection.ts"),
    Path("mobile/lib/originals/routeValidation.ts"),
    Path("mobile/lib/originals/session.ts"),
    Path("mobile/lib/originals/triggerEngine.ts"),
    Path("mobile/lib/originals/triggerSimulation.ts"),
    Path("mobile/scripts/validate-original-route.ts"),
)


def trusted_originals_validator_source_sha256() -> str:
    """Hash the executable validator source set so friendly-version drift cannot pass."""
    digest = hashlib.sha256()
    for relative_path in TRUSTED_VALIDATOR_SOURCE_PATHS:
        path = REPO_ROOT / relative_path
        if not path.is_file():
            raise OriginalValidationRunnerError(
                f"Trusted validator source is unavailable at {relative_path.as_posix()}"
            )
        content = path.read_bytes()
        digest.update(relative_path.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(content)).encode("ascii"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def original_route_geometry_sha256(coordinates: list) -> str:
    canonical = ";".join(
        f"{float(point[0]):.7f},{float(point[1]):.7f}"
        for point in coordinates
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _bounded_json(value: Any, label: str, maximum_bytes: int) -> Any:
    try:
        encoded = json.dumps(value, separators=(",", ":"), sort_keys=True)
    except (TypeError, ValueError) as exc:
        raise OriginalValidationRunnerError(f"Validator {label} is not JSON serializable") from exc
    if len(encoded.encode("utf-8")) > maximum_bytes:
        raise OriginalValidationRunnerError(f"Validator {label} is too large")
    return value


def normalize_original_validation_output(
    raw: Any,
    *,
    manifest: dict,
    required_scenario_ids: Iterable[str],
    expected_engine_version: str,
    expected_validator_source_sha256: str,
) -> dict:
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise OriginalValidationRunnerError("Validator returned an unsupported schema")
    if raw.get("engine_version") != expected_engine_version:
        raise OriginalValidationRunnerError("Validator engine version does not match the publication gate")
    if raw.get("validator_source_sha256") != expected_validator_source_sha256:
        raise OriginalValidationRunnerError("Validator source hash does not match the publication gate")
    identity = raw.get("manifest")
    expected_identity = {
        "pack_id": manifest.get("pack_id"),
        "version": manifest.get("version"),
        "manifest_id": manifest.get("manifest_id"),
    }
    if not isinstance(identity, dict) or any(identity.get(key) != value for key, value in expected_identity.items()):
        raise OriginalValidationRunnerError("Validator report is for a different manifest")

    required_ids = tuple(str(value) for value in required_scenario_ids)
    scenarios = raw.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) > 100:
        raise OriginalValidationRunnerError("Validator scenarios are missing or invalid")
    normalized_scenarios: list[dict] = []
    seen: set[str] = set()
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            raise OriginalValidationRunnerError("Validator scenarios must be objects")
        scenario_id = str(scenario.get("id") or "").strip()
        if not scenario_id or len(scenario_id) > 120 or scenario_id in seen:
            raise OriginalValidationRunnerError("Validator scenario ids must be unique identifiers")
        seen.add(scenario_id)
        issues = scenario.get("issues") or []
        if not isinstance(issues, list) or len(issues) > 100:
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid issues")
        clean_issues: list[str] = []
        for issue in issues:
            clean = str(issue or "").strip()
            if not clean or len(clean) > 1000:
                raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has an invalid issue")
            clean_issues.append(clean)
        stops = scenario.get("stops") or []
        if not isinstance(stops, list) or len(stops) > 500:
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid stop results")
        metrics = scenario.get("metrics") or {}
        if not isinstance(metrics, dict):
            raise OriginalValidationRunnerError(f"Validator scenario {scenario_id} has invalid metrics")
        normalized_scenarios.append({
            "id": scenario_id,
            "required": scenario_id in required_ids,
            "passed": scenario.get("passed") is True,
            "issues": clean_issues,
            "metrics": _bounded_json(metrics, f"scenario {scenario_id} metrics", 128 * 1024),
            "stops": _bounded_json(stops, f"scenario {scenario_id} stops", 512 * 1024),
        })

    missing = [scenario_id for scenario_id in required_ids if scenario_id not in seen]
    if missing:
        raise OriginalValidationRunnerError(
            "Validator omitted required scenarios: " + ", ".join(missing)
        )
    required_results = [item for item in normalized_scenarios if item["required"]]
    passed = bool(required_results) and all(item["passed"] for item in required_results)
    if bool(raw.get("passed")) != passed:
        raise OriginalValidationRunnerError("Validator pass summary disagrees with required scenarios")
    route_summary = raw.get("route_summary")
    if not isinstance(route_summary, dict):
        raise OriginalValidationRunnerError("Validator route summary is missing")
    expected_geometry_hash = original_route_geometry_sha256(
        manifest.get("route", {}).get("geometry", {}).get("coordinates") or [],
    )
    if route_summary.get("geometry_sha256") != expected_geometry_hash:
        raise OriginalValidationRunnerError("Validator route summary is for different geometry")
    clean_route_summary = {"geometry_sha256": expected_geometry_hash}
    for key in (
        "coordinate_count", "distance_m", "maximum_segment_m",
        "discontinuity_count", "self_intersection_count", "stop_projection_failures",
    ):
        value = route_summary.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise OriginalValidationRunnerError(f"Validator route summary has invalid {key}")
        clean_route_summary[key] = value
    failed_ids = [item["id"] for item in required_results if not item["passed"]]
    return {
        "schema_version": 1,
        "engine_version": expected_engine_version,
        "validator_source_sha256": expected_validator_source_sha256,
        "manifest": expected_identity,
        "passed": passed,
        "summary": {
            "required": len(required_results),
            "passed": len(required_results) - len(failed_ids),
            "failed": len(failed_ids),
            "stop_count": len(manifest.get("stops") or []),
        },
        "route_summary": clean_route_summary,
        "scenarios": normalized_scenarios,
        "issues": [f"Scenario failed: {scenario_id}" for scenario_id in failed_ids],
    }


def run_originals_validation_cli(
    manifest: dict,
    *,
    required_scenario_ids: Iterable[str],
    expected_engine_version: str,
    expected_validator_source_sha256: str | None = None,
    timeout_seconds: int = 45,
) -> dict:
    if not RUNNER_PATH.is_file():
        raise OriginalValidationRunnerError(f"Trusted validator is unavailable at {RUNNER_PATH}")
    source_sha256 = (
        str(expected_validator_source_sha256 or "").strip().lower()
        or trusted_originals_validator_source_sha256()
    )
    if len(source_sha256) != 64 or any(character not in "0123456789abcdef" for character in source_sha256):
        raise OriginalValidationRunnerError("Trusted validator source hash is invalid")
    payload = {
        "schema_version": 1,
        "manifest": manifest,
        "options": {
            "scenario_ids": list(required_scenario_ids),
            "validator_source_sha256": source_sha256,
        },
    }
    tsx_import = "tsx"
    if not (REPO_ROOT / "node_modules" / "tsx").is_dir():
        local_loader = MOBILE_ROOT / "node_modules" / "tsx" / "dist" / "loader.mjs"
        if local_loader.is_file():
            # Developer/test fallback only. Production installs the root
            # dependency declared by the deployable service package.
            tsx_import = local_loader.as_uri()
    command = [
        os.getenv("TRAILHEAD_ORIGINALS_NODE_BINARY", "node"),
        "--import",
        tsx_import,
        str(RUNNER_PATH.relative_to(REPO_ROOT)),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            input=json.dumps(payload, separators=(",", ":")),
            text=True,
            capture_output=True,
            timeout=max(5, min(int(timeout_seconds), 120)),
            check=False,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OriginalValidationRunnerError("Trusted validator could not complete") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()[-1:] or [""]
        raise OriginalValidationRunnerError(
            "Trusted validator failed" + (f": {detail[0][:500]}" if detail[0] else "")
        )
    output = completed.stdout.encode("utf-8")
    if not output or len(output) > MAX_OUTPUT_BYTES:
        raise OriginalValidationRunnerError("Trusted validator returned an invalid output size")
    try:
        raw = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise OriginalValidationRunnerError("Trusted validator returned malformed JSON") from exc
    return normalize_original_validation_output(
        raw,
        manifest=manifest,
        required_scenario_ids=required_scenario_ids,
        expected_engine_version=expected_engine_version,
        expected_validator_source_sha256=source_sha256,
    )


def _route_haversine_m(a: list[float], b: list[float]) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    delta_lat = lat2 - lat1
    delta_lng = lng2 - lng1
    hav = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(hav)))


def _route_coordinate_chunks(coordinates: list[list[float]]) -> list[tuple[int, list[list[float]]]]:
    """Cover every authored segment with small, overlapping map-match requests."""
    if len(coordinates) <= MAX_ROUTE_NETWORK_CHUNK_POINTS:
        return [(0, coordinates)]
    chunks: list[tuple[int, list[list[float]]]] = []
    start = 0
    while start < len(coordinates) - 1:
        end = min(len(coordinates), start + MAX_ROUTE_NETWORK_CHUNK_POINTS)
        chunk = coordinates[start:end]
        if len(chunk) < 2:
            break
        chunks.append((start, chunk))
        if end == len(coordinates):
            break
        start = end - ROUTE_NETWORK_CHUNK_OVERLAP_POINTS
    return chunks


def _request_valhalla_json(
    request: urllib_request.Request,
    *,
    timeout_seconds: int,
    label: str,
) -> Any:
    try:
        with urllib_request.urlopen(
            request,
            timeout=max(5, min(int(timeout_seconds), 60)),
        ) as response:
            raw = response.read(MAX_ROUTE_NETWORK_RESPONSE_BYTES + 1)
    except (OSError, urllib_error.URLError, urllib_error.HTTPError) as exc:
        raise OriginalValidationRunnerError(
            f"Valhalla {label} is unavailable"
        ) from exc
    if len(raw) > MAX_ROUTE_NETWORK_RESPONSE_BYTES:
        raise OriginalValidationRunnerError(f"Valhalla {label} response is too large")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OriginalValidationRunnerError(f"Valhalla returned malformed {label}") from exc


def _valhalla_status(base_url: str, timeout_seconds: int) -> dict[str, str]:
    request = urllib_request.Request(
        base_url + "/status",
        headers={"Accept": "application/json"},
        method="GET",
    )
    result = _request_valhalla_json(
        request,
        timeout_seconds=timeout_seconds,
        label="status",
    )
    if not isinstance(result, dict):
        raise OriginalValidationRunnerError("Valhalla status metadata is unusable")
    provider_version = str(result.get("version") or "").strip()
    graph_version_value = result.get("tileset_last_modified")
    if (
        not provider_version
        or isinstance(graph_version_value, (bool, dict, list))
        or graph_version_value is None
        or graph_version_value == ""
    ):
        raise OriginalValidationRunnerError(
            "Valhalla status must identify both provider and graph versions"
        )
    return {
        "provider_version": provider_version[:120],
        "graph_version": str(graph_version_value)[:120],
    }


def _canonical_edge_id(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("value", "id"):
            if value.get(key) not in {None, ""}:
                value = value[key]
                break
    if isinstance(value, (bool, dict, list)) or value is None or value == "":
        return ""
    return str(value)


def _matched_coordinate(point: dict) -> list[float] | None:
    candidate = point.get("point") if isinstance(point.get("point"), dict) else point
    try:
        lat = float(candidate.get("lat"))
        lng = float(candidate.get("lon", candidate.get("lng")))
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None
    return [lng, lat]


def _decode_valhalla_polyline6(value: Any) -> list[list[float]]:
    """Decode Valhalla's encoded route shape into [longitude, latitude] points."""
    encoded = str(value or "")
    if not encoded:
        raise OriginalValidationRunnerError("Valhalla matched route shape is missing")
    coordinates: list[list[float]] = []
    index = 0
    latitude = 0
    longitude = 0
    factor = 1_000_000.0
    while index < len(encoded):
        deltas = []
        for _axis in range(2):
            result = 0
            shift = 0
            while True:
                if index >= len(encoded):
                    raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
                byte = ord(encoded[index]) - 63
                index += 1
                if byte < 0 or byte > 0x3F or shift > 60:
                    raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        latitude += deltas[0]
        longitude += deltas[1]
        lng = longitude / factor
        lat = latitude / factor
        if not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise OriginalValidationRunnerError("Valhalla matched route shape is invalid")
        coordinates.append([lng, lat])
    if len(coordinates) < 2:
        raise OriginalValidationRunnerError("Valhalla matched route shape is incomplete")
    return coordinates


def _surface_class(value: Any) -> str:
    surface = str(value or "").strip().lower().replace("-", "_")
    if surface in {"paved", "paved_smooth", "paved_rough"}:
        return "paved"
    if surface in {
        "unpaved", "compacted", "dirt", "earth", "gravel", "fine_gravel",
        "ground", "mud", "path", "sand", "wood", "impassable",
    }:
        return "unpaved"
    return "unknown"


def _parse_override_datetime(value: Any, label: str) -> datetime:
    raw = str(value or "").strip()
    if "T" not in raw or (
        not raw.endswith("Z") and raw[-6:-5] not in {"+", "-"}
    ):
        raise OriginalValidationRunnerError(f"{label} must be a timezone-aware ISO date-time")
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
    except ValueError as exc:
        raise OriginalValidationRunnerError(f"{label} is invalid") from exc
    if parsed.tzinfo is None:
        raise OriginalValidationRunnerError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _parse_citation_date(value: Any) -> date:
    raw = str(value or "").strip()
    try:
        if "T" in raw:
            return _parse_override_datetime(raw, "Override source reviewed_at").date()
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise OriginalValidationRunnerError("Override source reviewed_at is invalid") from exc


_OVERRIDABLE_NETWORK_FINDINGS = {
    "private_or_restricted_access",
    "destination_only",
    "not_through",
    "seasonal_access",
    "restricted_road_use",
    "unpaved_surface",
}


def _validated_route_network_override(
    manifest: dict,
    finding_codes: set[str],
    finding_evidence: list[dict] | None = None,
) -> dict:
    review = manifest.get("review") if isinstance(manifest.get("review"), dict) else {}
    override = review.get("route_network_override")
    if not isinstance(override, dict):
        message = (
            "Route-network restrictions require an approved official-source-backed override: "
            + ", ".join(sorted(finding_codes))
        )
        evidence_samples = []
        for code in sorted(finding_codes):
            sample = next((
                item for item in (finding_evidence or [])
                if isinstance(item, dict) and item.get("code") == code
            ), None)
            coordinate = sample.get("coordinate") if isinstance(sample, dict) else None
            if (
                isinstance(coordinate, list) and len(coordinate) == 2
                and all(isinstance(value, (int, float)) for value in coordinate)
            ):
                evidence_samples.append(
                    f"{code} at {float(coordinate[1]):.6f},{float(coordinate[0]):.6f}"
                )
        if evidence_samples:
            message += ". Evidence: " + "; ".join(evidence_samples)
        raise OriginalValidationRunnerError(message)
    expected_keys = {
        "schema_version", "status", "finding_codes", "reason",
        "official_source_url", "approved_at", "approved_by_admin_user_id",
    }
    if set(override) != expected_keys or override.get("schema_version") != 1 or override.get("status") != "approved":
        raise OriginalValidationRunnerError("Route-network override structure is invalid")
    raw_codes = override.get("finding_codes")
    if (
        not isinstance(raw_codes, list)
        or any(not isinstance(code, str) for code in raw_codes)
        or len(raw_codes) != len(set(raw_codes))
        or set(raw_codes) != finding_codes
        or not set(raw_codes) <= _OVERRIDABLE_NETWORK_FINDINGS
    ):
        raise OriginalValidationRunnerError(
            "Route-network override findings must exactly match the current restrictions"
        )
    reason = str(override.get("reason") or "").strip()
    source_url = str(override.get("official_source_url") or "").strip()
    admin_id = override.get("approved_by_admin_user_id")
    if not 20 <= len(reason) <= 2000:
        raise OriginalValidationRunnerError("Route-network override needs a specific reason")
    if not source_url.startswith("https://") or len(source_url) > 2000:
        raise OriginalValidationRunnerError("Route-network override needs an HTTPS official source")
    if isinstance(admin_id, bool) or not isinstance(admin_id, int) or admin_id < 1:
        raise OriginalValidationRunnerError("Route-network override needs an approving admin")
    now = datetime.now(timezone.utc)
    approved_at = _parse_override_datetime(override.get("approved_at"), "Override approved_at")
    if approved_at > now + timedelta(minutes=5) or approved_at < now - timedelta(days=ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS):
        raise OriginalValidationRunnerError("Route-network override approval is not current")

    matching_citation: dict | None = None
    for stop in manifest.get("stops") or []:
        for citation in stop.get("citations") or []:
            if (
                isinstance(citation, dict)
                and citation.get("url") == source_url
                and citation.get("role") == "operational"
                and citation.get("authority") == "official"
            ):
                matching_citation = citation
                break
        if matching_citation:
            break
    if not matching_citation:
        raise OriginalValidationRunnerError(
            "Route-network override source must match an official operational citation"
        )
    reviewed_on = _parse_citation_date(matching_citation.get("reviewed_at"))
    if reviewed_on > now.date() or reviewed_on < now.date() - timedelta(days=ROUTE_NETWORK_OVERRIDE_MAX_AGE_DAYS):
        raise OriginalValidationRunnerError("Route-network override source review is not current")
    required_scopes = {"route"}
    if finding_codes & {"private_or_restricted_access", "destination_only", "not_through", "restricted_road_use"}:
        required_scopes.add("access")
    if "seasonal_access" in finding_codes:
        required_scopes.add("closures")
    if "unpaved_surface" in finding_codes:
        required_scopes.add("surface")
    scopes = set(matching_citation.get("scope") or [])
    if not required_scopes <= scopes:
        raise OriginalValidationRunnerError(
            "Route-network override citation is missing required scopes: "
            + ", ".join(sorted(required_scopes - scopes))
        )
    return {
        "schema_version": 1,
        "finding_codes": sorted(finding_codes),
        "reason": reason,
        "official_source_url": source_url,
        "official_source_title": str(matching_citation.get("title") or "")[:300],
        "source_reviewed_at": str(matching_citation.get("reviewed_at")),
        "approved_at": approved_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "approved_by_admin_user_id": admin_id,
    }


def validate_original_route_network(
    manifest: dict,
    *,
    valhalla_url: str,
    timeout_seconds: int = 25,
) -> dict:
    """Map-match every authored segment and fail closed on incomplete road evidence."""
    raw_coordinates = manifest.get("route", {}).get("geometry", {}).get("coordinates") or []
    if not isinstance(raw_coordinates, list) or len(raw_coordinates) < 2:
        raise OriginalValidationRunnerError("Authored route has no map-matchable geometry")
    coordinates: list[list[float]] = []
    for index, point in enumerate(raw_coordinates):
        try:
            lng, lat = float(point[0]), float(point[1])
        except (IndexError, TypeError, ValueError) as exc:
            raise OriginalValidationRunnerError(
                f"Authored route coordinate {index + 1} is invalid"
            ) from exc
        if not math.isfinite(lng) or not math.isfinite(lat) or not -180 <= lng <= 180 or not -90 <= lat <= 90:
            raise OriginalValidationRunnerError(f"Authored route coordinate {index + 1} is invalid")
        coordinates.append([lng, lat])
    segment_lengths = [
        _route_haversine_m(start, end)
        for start, end in zip(coordinates, coordinates[1:])
    ]
    maximum_segment = max(segment_lengths, default=0.0)
    if maximum_segment > MAX_AUTHORED_ROUTE_SEGMENT_M:
        raise OriginalValidationRunnerError(
            "Authored route geometry is too sparse for whole-route validation "
            f"({maximum_segment:.0f} m maximum segment)"
        )

    base_url = str(valhalla_url or "").strip().rstrip("/")
    if not base_url.startswith(("https://", "http://")):
        raise OriginalValidationRunnerError("Configured Valhalla URL is invalid")
    status_before = _valhalla_status(base_url, timeout_seconds)
    chunks = _route_coordinate_chunks(coordinates)
    authored_surface = str(manifest.get("access", {}).get("surface") or "").strip().lower()
    total_matched = 0
    total_edges = 0
    total_network_distance_m = 0.0
    total_authored_chunk_distance_m = 0.0
    maximum_offset_m = 0.0
    discontinuities = 0
    unique_trace_edge_ids: set[str] = set()
    unpaved_edge_ids: set[str] = set()
    restricted_edge_ids: set[str] = set()
    findings: set[str] = set()
    finding_evidence: list[dict] = []
    finding_evidence_keys: set[tuple] = set()
    osm_changesets: set[str] = set()
    located_edge_ids: set[str] = set()
    access_evidence_count = 0
    provider_seasonal_field_seen = False

    def record_finding_evidence(
        code: str,
        *,
        source: str,
        edge_id: str,
        coordinate: list[float] | None,
        use: str,
        surface: str,
    ) -> None:
        restricted_edge_ids.add(edge_id)
        rounded_coordinate = (
            [round(float(coordinate[0]), 6), round(float(coordinate[1]), 6)]
            if isinstance(coordinate, list) and len(coordinate) == 2 else None
        )
        key = (
            code,
            source,
            edge_id,
            tuple(rounded_coordinate) if rounded_coordinate else None,
        )
        if key in finding_evidence_keys or len(finding_evidence) >= 200:
            return
        finding_evidence_keys.add(key)
        finding_evidence.append({
            "code": code,
            "source": source,
            "edge_id": edge_id,
            "coordinate": rounded_coordinate,
            "use": use,
            "surface": surface,
        })

    trace_attributes = [
        "edge.id", "edge.length", "edge.surface", "edge.unpaved", "edge.use",
        "edge.begin_shape_index", "edge.end_shape_index",
        "edge.traversability", "edge.travel_mode", "edge.vehicle_type",
        "matched.point", "matched.type", "matched.edge_index",
        "matched.begin_route_discontinuity", "matched.end_route_discontinuity",
        "matched.distance_along_edge", "shape",
    ]
    restricted_uses = {
        "construction", "impassable", "steps", "ferry", "rail_ferry",
        "rail-ferry", "track", "driveway", "parking_aisle",
    }
    for chunk_number, (start_index, chunk) in enumerate(chunks, start=1):
        trace_payload = {
            "shape": [{"lat": point[1], "lon": point[0]} for point in chunk],
            "costing": "auto",
            # Valhalla only returns the point-for-point ``matched_points``
            # evidence used below when trace matching is explicitly map_snap.
            "shape_match": "map_snap",
            "directions_options": {"units": "kilometers"},
            "trace_options": {
                "gps_accuracy": 20,
                "search_radius": 75,
                "breakage_distance": 2_000,
                # This is authored geometry, not a noisy GPS trace. Disable
                # Meili interpolation so each coordinate is edge-bound.
                "interpolation_distance": 0,
            },
            "filters": {"action": "include", "attributes": trace_attributes},
        }
        trace_request = urllib_request.Request(
            base_url + "/trace_attributes",
            data=json.dumps(trace_payload, separators=(",", ":")).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        result = _request_valhalla_json(
            trace_request,
            timeout_seconds=timeout_seconds,
            label=f"trace_attributes chunk {chunk_number}",
        )
        edges = result.get("edges") if isinstance(result, dict) else None
        matched = result.get("matched_points") if isinstance(result, dict) else None
        units = str(result.get("units") or "").strip().lower() if isinstance(result, dict) else ""
        if not isinstance(edges, list) or not edges or not isinstance(matched, list):
            raise OriginalValidationRunnerError(
                f"Valhalla could not map-match authored route chunk {chunk_number}"
            )
        if units not in {"kilometers", "kilometres", "km"}:
            raise OriginalValidationRunnerError("Valhalla edge-length units are missing or unusable")
        if len(matched) != len(chunk):
            raise OriginalValidationRunnerError(
                f"Valhalla did not return one matched point per authored point in chunk {chunk_number}"
            )
        matched_shape = _decode_valhalla_polyline6(result.get("shape"))
        osm_changeset = result.get("osm_changeset")
        if not isinstance(osm_changeset, (dict, list)) and osm_changeset is not None and osm_changeset != "":
            osm_changesets.add(str(osm_changeset))

        network_distance_m = 0.0
        edge_ids: list[str] = []
        edge_surfaces: list[str] = []
        edge_uses: list[str] = []
        edge_finding_codes: list[set[str]] = []
        edge_coordinates: list[list[float]] = []
        for edge_index, edge in enumerate(edges):
            if not isinstance(edge, dict):
                raise OriginalValidationRunnerError("Valhalla returned an unusable edge record")
            edge_id = _canonical_edge_id(edge.get("id"))
            surface = str(edge.get("surface") or "").strip().lower()
            surface_class = _surface_class(surface)
            use = str(edge.get("use") or "").strip().lower()
            traversability = str(edge.get("traversability") or "").strip().lower()
            travel_mode = str(edge.get("travel_mode") or "").strip().lower()
            vehicle_type = str(edge.get("vehicle_type") or "").strip().lower()
            unpaved_flag = edge.get("unpaved")
            length = edge.get("length")
            begin_shape_index = edge.get("begin_shape_index")
            end_shape_index = edge.get("end_shape_index")
            if (
                not edge_id or surface_class == "unknown" or not use or not traversability
                or travel_mode not in {"drive", "driving"}
                or vehicle_type not in {"car", "auto"}
                or not isinstance(unpaved_flag, bool)
                or isinstance(length, bool) or not isinstance(length, (int, float))
                or not math.isfinite(float(length)) or float(length) < 0
                or isinstance(begin_shape_index, bool) or not isinstance(begin_shape_index, int)
                or isinstance(end_shape_index, bool) or not isinstance(end_shape_index, int)
                or not 0 <= begin_shape_index < end_shape_index < len(matched_shape)
            ):
                raise OriginalValidationRunnerError(
                    f"Valhalla edge {edge_index} is missing usable driving, surface, or length attributes"
                )
            if traversability in {"none", "unreachable"}:
                raise OriginalValidationRunnerError("Valhalla matched a non-drivable edge")
            if bool(unpaved_flag) != (surface_class == "unpaved"):
                raise OriginalValidationRunnerError("Valhalla surface attributes disagree")
            current_edge_findings: set[str] = set()
            if use in restricted_uses:
                findings.add("restricted_road_use")
                current_edge_findings.add("restricted_road_use")
            if surface_class == "unpaved":
                unpaved_edge_ids.add(edge_id)
                if authored_surface == "paved":
                    findings.add("unpaved_surface")
                    current_edge_findings.add("unpaved_surface")
            network_distance_m += float(length) * 1000.0
            edge_ids.append(edge_id)
            unique_trace_edge_ids.add(edge_id)
            edge_surfaces.append(surface_class)
            edge_uses.append(use)
            edge_finding_codes.append(current_edge_findings)
            representative_segment_index = begin_shape_index + (
                end_shape_index - begin_shape_index - 1
            ) // 2
            segment_start = matched_shape[representative_segment_index]
            segment_end = matched_shape[representative_segment_index + 1]
            edge_coordinates.append([
                (segment_start[0] + segment_end[0]) / 2.0,
                (segment_start[1] + segment_end[1]) / 2.0,
            ])

        representatives: list[dict] = []
        for edge_index, edge_id in enumerate(edge_ids):
            if (
                edge_id not in located_edge_ids
                and all(item["edge_id"] != edge_id for item in representatives)
            ):
                coordinate = edge_coordinates[edge_index]
                representatives.append({
                    "edge_id": edge_id,
                    "edge_index": edge_index,
                    "lat": coordinate[1],
                    "lon": coordinate[0],
                })
        for chunk_point_index, (authored_point, matched_point) in enumerate(zip(chunk, matched)):
            if not isinstance(matched_point, dict):
                raise OriginalValidationRunnerError("Valhalla returned an unusable matched point")
            edge_index = matched_point.get("edge_index")
            if (
                isinstance(edge_index, bool) or not isinstance(edge_index, int)
                or not 0 <= edge_index < len(edges)
            ):
                route_point_number = start_index + chunk_point_index + 1
                matched_type = str(matched_point.get("type") or "unknown")
                raise OriginalValidationRunnerError(
                    "Valhalla returned an unmatched authored point at "
                    f"route coordinate {route_point_number} "
                    f"(chunk {chunk_number}, edge_index={edge_index!r}, type={matched_type})"
                )
            if (
                matched_point.get("begin_route_discontinuity") is True
                or matched_point.get("end_route_discontinuity") is True
            ):
                discontinuities += 1
            coordinate = _matched_coordinate(matched_point)
            if coordinate is None:
                raise OriginalValidationRunnerError("Valhalla matched-point geometry is missing")
            offset = _route_haversine_m(authored_point, coordinate)
            maximum_offset_m = max(maximum_offset_m, offset)
            if offset > MAX_MATCHED_POINT_OFFSET_M:
                raise OriginalValidationRunnerError(
                    f"Valhalla matched geometry deviates {offset:.0f} m from the authored route"
                )
        for edge_index, codes in enumerate(edge_finding_codes):
            for code in sorted(codes):
                record_finding_evidence(
                    code,
                    source="trace",
                    edge_id=edge_ids[edge_index],
                    coordinate=edge_coordinates[edge_index],
                    use=edge_uses[edge_index],
                    surface=edge_surfaces[edge_index],
                )
        if discontinuities:
            raise OriginalValidationRunnerError("Valhalla found a route discontinuity")

        authored_chunk_distance_m = sum(
            _route_haversine_m(start, end) for start, end in zip(chunk, chunk[1:])
        )
        distance_delta_m = abs(network_distance_m - authored_chunk_distance_m)
        allowed_delta_m = max(
            MAX_NETWORK_DISTANCE_DELTA_M,
            authored_chunk_distance_m * MAX_NETWORK_DISTANCE_DELTA_RATIO,
        )
        if distance_delta_m > allowed_delta_m:
            raise OriginalValidationRunnerError(
                "Valhalla matched distance does not follow authored route segments "
                f"in chunk {chunk_number} ({network_distance_m:.0f} m vs {authored_chunk_distance_m:.0f} m)"
            )

        if representatives:
            locate_payload = {
                "verbose": True,
                "locations": [
                    {"lat": item["lat"], "lon": item["lon"]}
                    for item in representatives
                ],
                "costing": "auto",
                "directions_options": {"units": "kilometers"},
            }
            locate_request = urllib_request.Request(
                base_url + "/locate",
                data=json.dumps(locate_payload, separators=(",", ":")).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method="POST",
            )
            locate_result = _request_valhalla_json(
                locate_request,
                timeout_seconds=timeout_seconds,
                label=f"locate access evidence chunk {chunk_number}",
            )
            if not isinstance(locate_result, list) or len(locate_result) != len(representatives):
                raise OriginalValidationRunnerError("Valhalla driving-access evidence is incomplete")
            for representative, located in zip(representatives, locate_result):
                candidates = located.get("edges") if isinstance(located, dict) else None
                if not isinstance(candidates, list):
                    raise OriginalValidationRunnerError("Valhalla driving-access evidence is unusable")
                candidate = next((
                    value for value in candidates
                    if isinstance(value, dict)
                    and _canonical_edge_id(value.get("edge_id")) == representative["edge_id"]
                ), None)
                if not candidate:
                    raise OriginalValidationRunnerError(
                        "Valhalla could not bind driving-access evidence to matched edge "
                        f"{representative['edge_id']} in chunk {chunk_number} at "
                        f"{representative['lat']:.6f},{representative['lon']:.6f}"
                    )
                edge_detail = candidate.get("edge")
                if not isinstance(edge_detail, dict):
                    raise OriginalValidationRunnerError("Valhalla driving-access evidence is missing")
                access = edge_detail.get("access")
                car_access = access.get("car") if isinstance(access, dict) else None
                restriction_flag = edge_detail.get("access_restriction")
                access_restrictions = candidate.get("access_restrictions")
                classification = edge_detail.get("classification")
                located_surface = (
                    classification.get("surface") if isinstance(classification, dict) else None
                )
                located_use = str(
                    classification.get("use") if isinstance(classification, dict) else ""
                ).strip().lower()
                located_surface_class = _surface_class(located_surface)
                candidate_distance = candidate.get("distance")
                if (
                    not isinstance(car_access, bool)
                    or not isinstance(restriction_flag, bool)
                    or not isinstance(access_restrictions, list)
                    or not located_use
                    or located_surface_class == "unknown"
                    or isinstance(candidate_distance, bool)
                    or not isinstance(candidate_distance, (int, float))
                    or not math.isfinite(float(candidate_distance))
                    or not 0 <= float(candidate_distance) <= MAX_LOCATE_EDGE_DISTANCE_M
                ):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response lacks nearby car access, private/restriction, use, or surface evidence"
                    )
                for key in ("start_restriction", "end_restriction"):
                    restriction = edge_detail.get(key)
                    car_restricted = restriction.get("car") if isinstance(restriction, dict) else None
                    if not isinstance(car_restricted, bool):
                        raise OriginalValidationRunnerError(
                            f"Valhalla locate response lacks {key} car-access evidence"
                        )
                if not isinstance(edge_detail.get("part_of_complex_restriction"), bool):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response lacks complex-turn-restriction evidence"
                    )
                trace_surface_class = edge_surfaces[representative["edge_index"]]
                if located_surface_class != trace_surface_class:
                    raise OriginalValidationRunnerError(
                        "Valhalla trace and locate surface evidence disagree"
                    )
                trace_use = edge_uses[representative["edge_index"]]
                if located_use != trace_use:
                    raise OriginalValidationRunnerError(
                        "Valhalla trace and locate road-use evidence disagree"
                    )
                if car_access is not True or edge_detail.get("unreachable") is True:
                    raise OriginalValidationRunnerError("Valhalla matched an edge without car access")
                car_access_restriction = False
                for restriction_index, restriction in enumerate(access_restrictions):
                    restriction_type = (
                        str(restriction.get("type") or "").strip()
                        if isinstance(restriction, dict) else ""
                    )
                    restricted_for_car = (
                        restriction.get("car") if isinstance(restriction, dict) else None
                    )
                    if not restriction_type or not isinstance(restricted_for_car, bool):
                        raise OriginalValidationRunnerError(
                            "Valhalla locate response returned unusable access restriction "
                            f"{restriction_index + 1}"
                        )
                    car_access_restriction = car_access_restriction or restricted_for_car
                if restriction_flag is True and not access_restrictions:
                    raise OriginalValidationRunnerError(
                        "Valhalla reports restricted access without restriction details"
                    )
                if car_access_restriction:
                    findings.add("private_or_restricted_access")
                    record_finding_evidence(
                        "private_or_restricted_access",
                        source="locate",
                        edge_id=representative["edge_id"],
                        coordinate=[representative["lon"], representative["lat"]],
                        use=located_use,
                        surface=located_surface_class,
                    )
                for key, finding in (
                    ("destination_only", "destination_only"),
                    ("not_thru", "not_through"),
                ):
                    flag = edge_detail.get(key)
                    if not isinstance(flag, bool):
                        raise OriginalValidationRunnerError(
                            f"Valhalla locate response lacks {key} access evidence"
                        )
                    if flag:
                        findings.add(finding)
                        record_finding_evidence(
                            finding,
                            source="locate",
                            edge_id=representative["edge_id"],
                            coordinate=[representative["lon"], representative["lat"]],
                            use=located_use,
                            surface=located_surface_class,
                        )
                # Valhalla 3.5.x does not expose a seasonal flag in verbose
                # locate responses. Treat it as evidence when a provider does
                # expose it, while operational-source freshness remains the
                # authoritative seasonal-access gate.
                seasonal_flag = edge_detail.get("seasonal")
                provider_seasonal_field_seen = provider_seasonal_field_seen or "seasonal" in edge_detail
                if seasonal_flag is not None and not isinstance(seasonal_flag, bool):
                    raise OriginalValidationRunnerError(
                        "Valhalla locate response returned unusable seasonal access evidence"
                    )
                if seasonal_flag is True:
                    findings.add("seasonal_access")
                    record_finding_evidence(
                        "seasonal_access",
                        source="locate",
                        edge_id=representative["edge_id"],
                        coordinate=[representative["lon"], representative["lat"]],
                        use=located_use,
                        surface=located_surface_class,
                    )
                end_node_id = _canonical_edge_id(edge_detail.get("end_node"))
                nodes = located.get("nodes") if isinstance(located, dict) else None
                if end_node_id and isinstance(nodes, list):
                    bound_node = next((
                        node for node in nodes
                        if isinstance(node, dict)
                        and _canonical_edge_id(node.get("node_id")) == end_node_id
                    ), None)
                    if bound_node is not None:
                        private_access = bound_node.get("private_access")
                        if not isinstance(private_access, bool):
                            raise OriginalValidationRunnerError(
                                "Valhalla locate response returned unusable private-node evidence"
                            )
                        if private_access:
                            findings.add("private_or_restricted_access")
                            record_finding_evidence(
                                "private_or_restricted_access",
                                source="locate_node",
                                edge_id=representative["edge_id"],
                                coordinate=[representative["lon"], representative["lat"]],
                                use=located_use,
                                surface=located_surface_class,
                            )
                located_edge_ids.add(representative["edge_id"])
                access_evidence_count += 1

        total_matched += len(matched)
        total_edges += len(edges)
        total_network_distance_m += network_distance_m
        total_authored_chunk_distance_m += authored_chunk_distance_m

    missing_access_edge_ids = unique_trace_edge_ids - located_edge_ids
    if missing_access_edge_ids:
        raise OriginalValidationRunnerError(
            "Valhalla driving-access evidence does not cover every matched route edge "
            f"({len(missing_access_edge_ids)} missing)"
        )
    status_after = _valhalla_status(base_url, timeout_seconds)
    if status_after != status_before:
        raise OriginalValidationRunnerError("Valhalla provider or graph changed during validation")
    override_summary = (
        _validated_route_network_override(manifest, findings, finding_evidence)
        if findings else None
    )
    return {
        "provider": "valhalla",
        "provider_version": status_before["provider_version"],
        "graph_version": status_before["graph_version"],
        "osm_changesets": sorted(osm_changesets),
        "geometry_sha256": original_route_geometry_sha256(coordinates),
        "authored_point_count": len(coordinates),
        "sampled_point_count": len(coordinates),
        "chunk_count": len(chunks),
        "matched_point_count": total_matched,
        "edge_count": total_edges,
        "unique_edge_count": len(unique_trace_edge_ids),
        "access_evidence_edge_count": access_evidence_count,
        "provider_seasonal_field_available": provider_seasonal_field_seen,
        "seasonal_access_evidence": (
            "valhalla_and_official_operational_sources"
            if provider_seasonal_field_seen
            else "official_operational_sources"
        ),
        "maximum_authored_segment_m": maximum_segment,
        "maximum_matched_offset_m": maximum_offset_m,
        "matched_network_distance_m_with_chunk_overlap": total_network_distance_m,
        "authored_distance_m_with_chunk_overlap": total_authored_chunk_distance_m,
        "discontinuity_count": 0,
        "unmatched_point_count": 0,
        "restricted_segment_count": len(restricted_edge_ids),
        "finding_evidence": finding_evidence,
        "unpaved_segment_count": len(unpaved_edge_ids),
        "unknown_surface_segment_count": 0,
        "authored_surface": authored_surface,
        "override": override_summary,
    }
