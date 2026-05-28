"""Hydro/bathymetry metadata and classification helpers.

Safe Water hydro data is awareness context. It is intentionally separate from
land contours and must not be presented as certified navigation data.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from dashboard.marine_chart_provider import LAKE_OF_THE_WOODS_BOUNDS, MarineBounds


HYDRO_LAYERS = ["depth_contours", "depth_areas", "reef_hazards", "hydro_labels"]
HYDRO_DIR = Path("/data/hydro")
LOCAL_HYDRO_DIR = Path("data/hydro")

MN_DNR_BATHY_SOURCE = {
    "id": "mn_dnr_lake_bathymetry",
    "name": "Minnesota DNR Lake Bathymetry",
    "url": "https://resources.gisdata.mn.gov/pub/gdrs/data/pub/us_mn_state_dnr/water_lake_bathymetry/",
    "license": "Public Minnesota Geospatial Commons dataset; verify attribution before redistribution.",
    "note": (
        "Lake bathymetric contours, DEM, outline, aquatic vegetation, and metadata for selected Minnesota lakes. "
        "The current Minnesota DNR GeoPackage was probed for Lake of the Woods and returned no bathymetry "
        "features in the Lake of the Woods bounding box."
    ),
}

CHS_NONNA_SOURCE = {
    "id": "chs_nonna",
    "name": "CHS NONNA bathymetry",
    "url": "https://www.chs.gc.ca/data-gestion/nonna/index-eng.html",
    "license": "Live non-navigational CHS context only; do not redistribute offline PMTiles without an approved license/path.",
    "note": "Canadian Lake of the Woods bathymetry remains live-only until licensed/offline CHS distribution is solved.",
}

NON_NAV_WARNING = (
    "Informational awareness only; not certified navigation, not a chartplotter, "
    "and not turn-by-turn boat routing. Verify with official/current charts, "
    "markers, water levels, weather, and local notices."
)


@dataclass(frozen=True)
class HydroRegion:
    id: str
    name: str
    file: str
    bounds: MarineBounds
    source: dict[str, Any]
    confidence: str
    status: str
    offline: bool = False
    coverage_note: str = ""


HYDRO_REGIONS: dict[str, HydroRegion] = {
    "mn-lotw": HydroRegion(
        id="mn-lotw",
        name="Lake of the Woods - Minnesota-side bathymetry candidate",
        file="mn-lotw.pmtiles",
        bounds=LAKE_OF_THE_WOODS_BOUNDS,
        source=MN_DNR_BATHY_SOURCE,
        confidence="source_probe_no_lotw_features",
        status="no_source_coverage",
        offline=True,
        coverage_note="Minnesota DNR Lake Bathymetry was checked; Lake of the Woods is not present in the published GeoPackage.",
    ),
    "ca-lotw": HydroRegion(
        id="ca-lotw",
        name="Lake of the Woods - Canadian-side live bathymetry context",
        file="ca-lotw.pmtiles",
        bounds=LAKE_OF_THE_WOODS_BOUNDS,
        source=CHS_NONNA_SOURCE,
        confidence="official_non_navigational_live",
        status="live_only",
        offline=False,
        coverage_note="CHS NONNA remains live-only and non-navigational; no offline PMTiles are generated from it in this tranche.",
    ),
}


def _intersects(a: MarineBounds, b: MarineBounds) -> bool:
    return not (a.east < b.west or a.west > b.east or a.north < b.south or a.south > b.north)


def depth_band(depth_ft: float | int | None) -> str:
    if depth_ft is None:
        return "unknown"
    depth = float(depth_ft)
    if depth < 5:
        return "shallow_0_5"
    if depth < 10:
        return "shallow_5_10"
    if depth < 20:
        return "moderate_10_20"
    if depth < 40:
        return "deep_20_40"
    return "deep_40_plus"


def is_index_depth(depth_ft: float | int | None, interval_ft: int = 10) -> bool:
    if depth_ft is None or interval_ft <= 0:
        return False
    return round(float(depth_ft)) % interval_ft == 0


def classify_hazard(
    depth_ft: float | int | None,
    *,
    source_tags: dict[str, Any] | None = None,
    adjacent_delta_ft: float | int | None = None,
) -> dict[str, Any] | None:
    tags = {str(k).lower(): str(v).lower() for k, v in (source_tags or {}).items() if v not in (None, "")}
    text = " ".join(tags.values())
    if any(token in text for token in ("reef", "shoal", "rock", "obstruction", "wreck")):
        return {"kind": "reef_or_shoal", "confidence": "source", "hazard": True}
    if depth_ft is not None and float(depth_ft) < 5:
        return {"kind": "shallow_under_5ft", "confidence": "derived", "hazard": True}
    if adjacent_delta_ft is not None and float(adjacent_delta_ft) >= 15:
        return {"kind": "steep_dropoff_candidate", "confidence": "derived", "hazard": True}
    return None


def _region_dict(region: HydroRegion, pack: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": region.id,
        "name": region.name,
        "file": region.file,
        "bounds": asdict(region.bounds),
        "layers": HYDRO_LAYERS,
        "source": region.source,
        "confidence": region.confidence,
        "status": region.status,
        "offline": region.offline,
        "coverage_note": region.coverage_note,
        "warning": NON_NAV_WARNING,
        "available": bool(pack and int(pack.get("size") or 0) > 0),
    }
    if pack:
        payload.update({
            "size": pack.get("size"),
            "generated_at": pack.get("generated_at"),
            "counts": pack.get("counts") or {},
        })
    return payload


def read_hydro_manifest(data_dir: Path | None = None) -> dict[str, Any]:
    root = data_dir or (HYDRO_DIR if HYDRO_DIR.exists() else LOCAL_HYDRO_DIR)
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        try:
            raw = json.loads(manifest_path.read_text())
            if isinstance(raw, dict) and "regions" in raw and "packs" in raw:
                return raw
            if isinstance(raw, dict):
                packs = raw
                return {
                    "version": 1,
                    "mode": "safe_water_awareness",
                    "generated_at": None,
                    "layers": HYDRO_LAYERS,
                    "warning": NON_NAV_WARNING,
                    "packs": packs,
                    "regions": [
                        _region_dict(region, packs.get(region.file))
                        for region in HYDRO_REGIONS.values()
                    ],
                }
        except Exception:
            pass

    packs: dict[str, Any] = {}
    if root.exists():
        for path in sorted(root.glob("*.pmtiles")):
            packs[path.name] = {"size": path.stat().st_size, "region": path.stem}
    return {
        "version": 1,
        "mode": "safe_water_awareness",
        "generated_at": int(time.time()) if packs else None,
        "layers": HYDRO_LAYERS,
        "warning": NON_NAV_WARNING,
        "packs": packs,
        "regions": [
            _region_dict(region, packs.get(region.file))
            for region in HYDRO_REGIONS.values()
        ],
    }


def hydro_regions_for_bounds(bounds: MarineBounds, manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    manifest = manifest or read_hydro_manifest()
    regions = []
    for item in manifest.get("regions") or []:
        b = item.get("bounds") or {}
        try:
            region_bounds = MarineBounds(
                north=float(b["north"]),
                south=float(b["south"]),
                east=float(b["east"]),
                west=float(b["west"]),
            )
        except Exception:
            continue
        if _intersects(bounds, region_bounds):
            regions.append(item)
    return regions


def hydro_profile(bounds: MarineBounds, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    regions = hydro_regions_for_bounds(bounds, manifest)
    available = [region for region in regions if region.get("available")]
    live_only = [region for region in regions if region.get("status") == "live_only" and not region.get("available")]
    counts = {"contours": 0, "shallow_zones": 0, "hazards": 0, "labels": 0}
    for region in available:
        rc = region.get("counts") or {}
        counts["contours"] += int(rc.get("contours") or rc.get("depth_contours") or 0)
        counts["shallow_zones"] += int(rc.get("shallow_zones") or rc.get("depth_areas") or 0)
        counts["hazards"] += int(rc.get("hazards") or rc.get("reef_hazards") or 0)
        counts["labels"] += int(rc.get("labels") or rc.get("hydro_labels") or 0)
    return {
        "available": bool(available),
        "coverage": "available" if available else ("live_only" if live_only else ("planned" if regions else "none")),
        "regions": available or regions,
        "counts": counts,
        "layers": HYDRO_LAYERS,
        "warning": NON_NAV_WARNING,
    }
