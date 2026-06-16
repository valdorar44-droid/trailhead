#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OPENAPI_URL = "https://docs-v2.campflare.com/api-reference/openapi.json"
API_BASE = "https://api.campflare.com/v2"
DEFAULT_AREAS = ["Moab", "Yosemite", "Yellowstone", "Big Bend", "White Sands"]
FALLBACK_SEARCH_PATHS = ["/campgrounds/search"]
FALLBACK_DETAIL_PATH = "/campground/{id}"
FALLBACK_CAMPSITES_PATH = "/campground/{id}/campsites"
AREA_BBOXES = {
    "Moab": {
        "min_latitude": 38.2,
        "max_latitude": 38.95,
        "min_longitude": -109.95,
        "max_longitude": -109.1,
    },
    "Yosemite": {
        "min_latitude": 37.4,
        "max_latitude": 38.05,
        "min_longitude": -120.15,
        "max_longitude": -119.15,
    },
    "Yellowstone": {
        "min_latitude": 44.0,
        "max_latitude": 44.95,
        "min_longitude": -111.2,
        "max_longitude": -110.0,
    },
    "Big Bend": {
        "min_latitude": 28.8,
        "max_latitude": 29.6,
        "min_longitude": -103.9,
        "max_longitude": -102.7,
    },
    "White Sands": {
        "min_latitude": 32.45,
        "max_latitude": 33.0,
        "min_longitude": -106.65,
        "max_longitude": -105.75,
    },
}


def fetch_json(url: str, headers: dict[str, str] | None = None) -> tuple[int, dict | list | str]:
    curl_cmd = ["curl", "-sS", "-w", "\n%{http_code}"]
    for key, value in (headers or {}).items():
        curl_cmd.extend(["-H", f"{key}: {value}"])
    curl_cmd.append(url)
    curl_result = subprocess.run(curl_cmd, capture_output=True, text=True, check=False)
    if curl_result.returncode == 0 and curl_result.stdout:
        body, _, status_text = curl_result.stdout.rpartition("\n")
        if status_text.isdigit():
            try:
                return int(status_text), json.loads(body)
            except json.JSONDecodeError:
                return int(status_text), body

    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        return exc.code, parsed
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach {url}: {exc}") from exc


def post_json(
    url: str,
    payload: dict[str, object],
    headers: dict[str, str] | None = None,
) -> tuple[int, dict | list | str]:
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    body = json.dumps(payload)
    curl_cmd = ["curl", "-sS", "-w", "\n%{http_code}"]
    for key, value in request_headers.items():
        curl_cmd.extend(["-H", f"{key}: {value}"])
    curl_cmd.extend(["-X", "POST", "--data", body, url])
    curl_result = subprocess.run(curl_cmd, capture_output=True, text=True, check=False)
    if curl_result.returncode == 0 and curl_result.stdout:
        response_body, _, status_text = curl_result.stdout.rpartition("\n")
        if status_text.isdigit():
            try:
                return int(status_text), json.loads(response_body)
            except json.JSONDecodeError:
                return int(status_text), response_body

    encoded = body.encode("utf-8")
    request = urllib.request.Request(url, data=encoded, headers=request_headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
            return response.status, json.loads(response_body)
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError:
            parsed = response_body
        return exc.code, parsed
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach {url}: {exc}") from exc


def load_openapi() -> dict:
    status, payload = fetch_json(OPENAPI_URL)
    if status != 200 or not isinstance(payload, dict):
        raise RuntimeError(f"Could not load Campflare OpenAPI spec ({status})")
    return payload


def find_path(spec: dict, includes: list[str], method: str) -> tuple[str, dict]:
    for path, methods in spec.get("paths", {}).items():
        normalized = path.replace(":id", "{id}")
        if all(token in normalized for token in includes) and method in methods:
            return path, methods[method]
    raise RuntimeError(f"Could not find {method.upper()} path matching {includes}")


def search_paths_and_schema(spec: dict | None) -> tuple[list[str], dict | None]:
    if not spec:
        return FALLBACK_SEARCH_PATHS, None

    paths: list[str] = []
    schema: dict | None = None
    for path, methods in spec.get("paths", {}).items():
        normalized = path.replace(":id", "{id}")
        if "campground" in normalized and "search" in normalized and "post" in methods:
            paths.append(path)
            if not schema:
                content = (
                    methods["post"]
                    .get("requestBody", {})
                    .get("content", {})
                    .get("application/json", {})
                )
                candidate = content.get("schema")
                if isinstance(candidate, dict):
                    schema = candidate
    return (paths or FALLBACK_SEARCH_PATHS), schema


def path_to_url(path: str, **params: str) -> str:
    resolved = path
    for key, value in params.items():
        resolved = resolved.replace(f"{{{key}}}", value).replace(f":{key}", value)
    return f"{API_BASE}{resolved}"


def auth_variants(api_key: str) -> list[tuple[str, dict[str, str]]]:
    return [
        ("authorization_raw", {"Authorization": api_key}),
        ("authorization_bearer", {"Authorization": f"Bearer {api_key}"}),
        ("x_api_key", {"X-API-Key": api_key}),
    ]


def search_payload_variants(schema: dict | None, area: str) -> list[dict[str, object]]:
    properties = (schema or {}).get("properties", {}) if isinstance(schema, dict) else {}
    variants: list[dict[str, object]] = []
    if "bbox" in properties and area in AREA_BBOXES:
        variants.append({"bbox": AREA_BBOXES[area], "limit": 5})
        variants.append({"query": area, "bbox": AREA_BBOXES[area], "limit": 5})
    if "query" in properties:
        variants.append({"query": area, "limit": 5})
    if not variants:
        variants.append({"query": area, "limit": 5})
    return variants


def save_payload(save_dir: Path, area: str, label: str, payload: object) -> None:
    save_dir.mkdir(parents=True, exist_ok=True)
    target = save_dir / f"{area.lower().replace(' ', '_')}_{label}.json"
    target.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def summarize_campground(campground: dict) -> dict[str, object]:
    metadata = campground.get("metadata") or {}
    connections = campground.get("connections") or {}
    contact = campground.get("contact") or campground.get("contacts") or {}
    amenities = campground.get("amenities") or {}
    cell_service = campground.get("cell_service") or {}
    return {
        "id": campground.get("id"),
        "name": campground.get("name"),
        "kind": campground.get("kind"),
        "status": campground.get("status"),
        "has_availability_alerts": metadata.get("has_availability_alerts"),
        "has_availability_data": metadata.get("has_availability_data"),
        "has_campsite_level_data": metadata.get("has_campsite_level_data"),
        "last_updated": metadata.get("last_updated"),
        "ridb_facility_id": connections.get("ridb_facility_id"),
        "usfs_site_id": connections.get("usfs_site_id"),
        "max_rv_length": campground.get("max_rv_length"),
        "max_trailer_length": campground.get("max_trailer_length"),
        "big_rig_friendly": campground.get("big_rig_friendly"),
        "has_pull_through_sites": campground.get("has_pull_through_sites"),
        "reservation_url": campground.get("reservation_url"),
        "price": campground.get("price"),
        "photo_count": len(campground.get("photos") or []),
        "amenities": {
            "toilets": amenities.get("toilets"),
            "toilet_kind": amenities.get("toilet_kind"),
            "water": amenities.get("water"),
            "showers": amenities.get("showers"),
            "fires_allowed": amenities.get("fires_allowed"),
            "dump_station": amenities.get("dump_station"),
            "electric_hookups": amenities.get("electric_hookups"),
            "water_hookups": amenities.get("water_hookups"),
            "sewer_hookups": amenities.get("sewer_hookups"),
        },
        "cell_service": cell_service,
        "primary_phone": contact.get("primary_phone"),
        "primary_email": contact.get("primary_email"),
    }


def summarize_campsite(campsite: dict) -> dict[str, object]:
    equipment = campsite.get("equipment") or []
    photos = campsite.get("photos") or []
    return {
        "id": campsite.get("id"),
        "name": campsite.get("name"),
        "kind": campsite.get("kind"),
        "kind_listed": campsite.get("kind_listed"),
        "max_rv_length": campsite.get("max_rv_length"),
        "max_trailer_length": campsite.get("max_trailer_length"),
        "pull_through": campsite.get("pull_through"),
        "hookups": {
            "water": campsite.get("water_hookups"),
            "electric": campsite.get("electric_hookups"),
            "sewer": campsite.get("sewer_hookups"),
        },
        "firepit": campsite.get("firepit"),
        "picnic_table": campsite.get("picnic_table"),
        "ada_accessible": campsite.get("ada_accessible"),
        "max_people": campsite.get("max_people"),
        "max_cars": campsite.get("max_cars"),
        "equipment_kinds": [item.get("kind") for item in equipment if isinstance(item, dict)],
        "photo_count": len(photos),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate Campflare campground payload quality for named areas.")
    parser.add_argument("--api-key", help="Campflare read API key. Defaults to CAMPFLARE_API_KEY env var if omitted.")
    parser.add_argument("--areas", nargs="*", default=DEFAULT_AREAS, help="Named areas to probe.")
    parser.add_argument("--save-dir", help="Optional directory for raw response payloads.")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("CAMPFLARE_API_KEY", "")
    if not api_key:
        print("Missing Campflare API key. Pass --api-key or set CAMPFLARE_API_KEY before running.", file=sys.stderr)
        return 2

    spec = None
    try:
        spec = load_openapi()
    except RuntimeError:
        spec = None
    search_paths, search_schema = search_paths_and_schema(spec)
    detail_path = find_path(spec, ["campground", "{id}"], "get")[0] if spec else FALLBACK_DETAIL_PATH
    campsites_path = find_path(spec, ["campground", "{id}", "campsites"], "get")[0] if spec else FALLBACK_CAMPSITES_PATH
    save_dir = Path(args.save_dir) if args.save_dir else None

    summary: dict[str, object] = {
        "search_paths": search_paths,
        "search_uses_post": True,
        "detail_path": detail_path,
        "campsites_path": campsites_path,
        "used_openapi": bool(spec),
        "results": [],
    }

    for area in args.areas:
        area_result: dict[str, object] = {"area": area, "attempts": []}
        success_headers: dict[str, str] | None = None
        search_payload: dict | list | str | None = None
        fallback_headers: dict[str, str] | None = None
        fallback_search_payload: dict | list | str | None = None
        for auth_name, headers in auth_variants(api_key):
            for search_path in search_paths:
                for payload in search_payload_variants(search_schema, area):
                    url = path_to_url(search_path)
                    try:
                        status, response_payload = post_json(url, payload=payload, headers=headers)
                        attempt = {
                            "path": search_path,
                            "auth": auth_name,
                            "payload": payload,
                            "status": status,
                            "keys": sorted(response_payload.keys()) if isinstance(response_payload, dict) else None,
                        }
                        if isinstance(response_payload, dict) and response_payload.get("error"):
                            attempt["error"] = response_payload["error"]
                    except RuntimeError as exc:
                        status = 0
                        response_payload = None
                        attempt = {
                            "path": search_path,
                            "auth": auth_name,
                            "payload": payload,
                            "status": 0,
                            "error": {"kind": "network_unreachable", "message": str(exc)},
                        }
                    area_result["attempts"].append(attempt)
                    if status == 200 and isinstance(response_payload, dict):
                        campgrounds = response_payload.get("campgrounds") or response_payload.get("results") or []
                        if isinstance(campgrounds, list) and campgrounds:
                            success_headers = headers
                            search_payload = response_payload
                            break
                        if fallback_search_payload is None:
                            fallback_headers = headers
                            fallback_search_payload = response_payload
                if success_headers:
                    break
            if success_headers:
                break

        if not success_headers and fallback_headers and fallback_search_payload is not None:
            success_headers = fallback_headers
            search_payload = fallback_search_payload

        if not success_headers or not isinstance(search_payload, dict):
            area_result["status"] = "failed"
            summary["results"].append(area_result)
            continue

        campgrounds = search_payload.get("campgrounds") or search_payload.get("results") or []
        if save_dir:
            save_payload(save_dir, area, "search", search_payload)
        area_result["status"] = "ok"
        area_result["campground_count"] = len(campgrounds) if isinstance(campgrounds, list) else 0
        if not isinstance(campgrounds, list) or not campgrounds:
            summary["results"].append(area_result)
            continue

        first = campgrounds[0]
        campground_id = str(first.get("id", ""))
        detail_status, detail_payload = fetch_json(path_to_url(detail_path, id=campground_id), headers=success_headers)
        campsites_status, campsites_payload = fetch_json(path_to_url(campsites_path, id=campground_id), headers=success_headers)
        if save_dir and isinstance(detail_payload, (dict, list)):
            save_payload(save_dir, area, "detail", detail_payload)
        if save_dir and isinstance(campsites_payload, (dict, list)):
            save_payload(save_dir, area, "campsites", campsites_payload)

        detail = detail_payload if isinstance(detail_payload, dict) else {}
        campsites = campsites_payload if isinstance(campsites_payload, list) else (campsites_payload.get("campsites") if isinstance(campsites_payload, dict) else [])
        area_result["first_match"] = summarize_campground(detail or first)
        area_result["detail_status"] = detail_status
        area_result["campsites_status"] = campsites_status
        area_result["campsite_count"] = len(campsites) if isinstance(campsites, list) else 0
        if isinstance(campsites, list) and campsites:
            area_result["first_campsite"] = summarize_campsite(campsites[0])
        summary["results"].append(area_result)

    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
