#!/usr/bin/env python3
"""Build the small, reviewed Explore sidecar used by admin preview bundles.

This does not alter the public serving index. It copies exact candidate records
that have already passed their source-specific audit into a bounded artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AGENCY = ROOT / "data/explore/audit_candidates/agencies/live-20260731-b08-quality/explore_catalog_v3.json"
DEFAULT_NPS = ROOT / "data/explore/audit_candidates/combined/live-20260731-b08/nps_catalog_scoped.json"
DEFAULT_SERVING = ROOT / "data/explore/audit_candidates/combined/live-20260731-b08/serving_index_review.json"
DEFAULT_OUTPUT = ROOT / "dashboard/explore_internal_preview_v1.json"
DEFAULT_AGENCY_IDS = (
    "place:usfs:9006",
    "place:blm:moab-field-office",
    "place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8",
    "place:usfs:usfs-sierra-sites-5f618db8-3fe8-4011-a735-18a738acfb43",
    "place:usfs:usfs-sierra-sites-b01b7bab-bef1-45a7-a0f5-8707be86d2ba",
    "place:usfs:usfs-sierra-sites-307b30f3-9f42-4aa4-8de0-fe6eb125d8e2",
    "place:usfs:usfs-sierra-sites-1089761d-6a96-47fa-b575-6b69bd7c1772",
)
DEFAULT_NPS_CODES = ("cave", "cato", "chis", "goga", "grte", "gumo")


def _read_catalog(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    return [item for item in payload.get("places") or [] if isinstance(item, dict)]


def _read_serving_index(path: Path) -> dict[str, dict]:
    payload = json.loads(path.read_text())
    return {
        str(item.get("id") or ""): item
        for item in payload.get("items") or []
        if isinstance(item, dict) and item.get("id")
    }


def _merge_serving_context(place: dict, serving: dict | None) -> dict:
    """Add cross-agency media/source facts without replacing reviewed V3 copy."""
    merged = json.loads(json.dumps(place))
    if not serving:
        return merged

    image_url = str(serving.get("image_url") or "").strip()
    if image_url:
        media = [item for item in merged.get("media") or [] if isinstance(item, dict)]
        if not any(str(item.get("url") or "") == image_url for item in media):
            media.insert(0, {
                "url": image_url,
                "caption": str(merged.get("name") or serving.get("title") or ""),
                "credit": str(serving.get("image_credit") or ""),
                "license": str(serving.get("image_license") or ""),
                "source_url": str(serving.get("image_source_url") or ""),
            })
        merged["media"] = media

    sources = [item for item in merged.get("sources") or [] if isinstance(item, dict)]
    seen = {
        (str(item.get("source") or "").casefold(), str(item.get("source_id") or "").casefold())
        for item in sources
    }
    provenance = serving.get("provenance") if isinstance(serving.get("provenance"), dict) else {}
    for source in provenance.get("sources") or []:
        if not isinstance(source, dict):
            continue
        key = (str(source.get("source") or "").casefold(), str(source.get("source_id") or "").casefold())
        if not all(key) or key in seen:
            continue
        seen.add(key)
        sources.append({
            "source": source.get("source"),
            "source_id": source.get("source_id"),
            "url": source.get("url"),
            "license": source.get("license"),
            "attribution": source.get("attribution"),
            "quality": source.get("quality"),
        })
    merged["sources"] = sources

    reservation_available = any(
        isinstance(fact, dict)
        and str(fact.get("key") or "") == "reservations"
        and str(fact.get("value") or "").casefold() == "available"
        for fact in serving.get("planning_facts") or []
    )
    if reservation_available:
        reservations = dict(merged.get("reservations") or {})
        reservations["reservable"] = True
        merged["reservations"] = reservations
    return merged


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _select_records(
    agency_places: list[dict],
    nps_places: list[dict],
    *,
    agency_ids: tuple[str, ...],
    nps_codes: tuple[str, ...],
) -> list[dict]:
    agency_by_id = {str(item.get("id") or ""): item for item in agency_places}
    nps_by_code = {
        str((item.get("source_pack") or {}).get("nps_park_code") or "").lower(): item
        for item in nps_places
    }
    missing_agencies = [item_id for item_id in agency_ids if item_id not in agency_by_id]
    missing_nps = [code for code in nps_codes if code not in nps_by_code]
    if missing_agencies or missing_nps:
        raise SystemExit(
            f"Missing reviewed records: agency={missing_agencies or 'none'} nps={missing_nps or 'none'}"
        )
    selected = [agency_by_id[item_id] for item_id in agency_ids]
    selected.extend(nps_by_code[code] for code in nps_codes)
    ids = [str(item.get("id") or "") for item in selected]
    if len(ids) != len(set(ids)):
        raise SystemExit("Internal preview records must have unique stable IDs")
    return selected


def build(args: argparse.Namespace) -> dict:
    agency_path = Path(args.agency_catalog).resolve()
    nps_path = Path(args.nps_catalog).resolve()
    serving_path = Path(args.serving_index).resolve()
    output = Path(args.output).resolve()
    selected = _select_records(
        _read_catalog(agency_path),
        _read_catalog(nps_path),
        agency_ids=tuple(args.agency_id),
        nps_codes=tuple(code.lower() for code in args.nps_code),
    )
    serving_by_id = _read_serving_index(serving_path)
    selected = [_merge_serving_context(item, serving_by_id.get(str(item.get("id") or ""))) for item in selected]
    payload = {
        "schema_version": 1,
        "catalog_id": "trailhead-explore-internal-preview-v1",
        "stage": "internal",
        "count": len(selected),
        "sources": {
            "agency_catalog": {
                "path": str(agency_path.relative_to(ROOT)),
                "sha256": _sha256(agency_path),
            },
            "nps_catalog": {
                "path": str(nps_path.relative_to(ROOT)),
                "sha256": _sha256(nps_path),
            },
            "serving_index": {
                "path": str(serving_path.relative_to(ROOT)),
                "sha256": _sha256(serving_path),
            },
        },
        "places": selected,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    return {
        "output": str(output),
        "bytes": output.stat().st_size,
        "sha256": _sha256(output),
        "place_ids": [str(item.get("id") or "") for item in selected],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agency-catalog", default=str(DEFAULT_AGENCY))
    parser.add_argument("--nps-catalog", default=str(DEFAULT_NPS))
    parser.add_argument("--serving-index", default=str(DEFAULT_SERVING))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--agency-id", action="append", default=list(DEFAULT_AGENCY_IDS))
    parser.add_argument("--nps-code", action="append", default=list(DEFAULT_NPS_CODES))
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(build(parse_args()), indent=2))
