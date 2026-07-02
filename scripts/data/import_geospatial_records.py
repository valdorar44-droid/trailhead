#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

try:
    import pyogrio
    from shapely import wkb
    from shapely.geometry import mapping
    from shapely.ops import transform as shapely_transform
    from pyproj import CRS, Transformer
except Exception as exc:  # pragma: no cover - dependency check path
    raise SystemExit(
        "pyogrio, shapely, and pyproj are required. "
        "Create a data env with: python3 -m venv /home/sean/.venv-trailhead-data && "
        "/home/sean/.venv-trailhead-data/bin/pip install pyogrio shapely pyarrow pyproj"
    ) from exc

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from import_raw_records import DB_PATH, RAW_DIR, PROCESSED_DIR, init_db, insert_raw, upsert_sources


USFS_LAYERS = [
    ("recreation-sites", "Rec_Infra_RecSite", RAW_DIR / "usfs" / "recreation-sites" / "source.gdb.zip"),
    ("recreation-opportunities", "Rec_RecOpportunities", RAW_DIR / "usfs" / "recreation-opportunities" / "source.gdb.zip"),
    ("recreation-area-activities", "Rec_RecArea_Activities_V", RAW_DIR / "usfs" / "recreation-area-activities" / "source.gdb.zip"),
    ("trails", "Trans_Trail_NFS_Publish", RAW_DIR / "usfs" / "trails" / "source.gdb.zip"),
    ("roads", "Trans_RoadCore_FS", RAW_DIR / "usfs" / "roads" / "source.gdb.zip"),
    ("national-forest-system-land-units", "BdyDesg_LSRS_NationalForestSystemLandUnit", RAW_DIR / "usfs" / "national-forest-system-land-units" / "source.gdb.zip"),
    ("ranger-districts", "BdyAdm_LSRS_RangerDistrict", RAW_DIR / "usfs" / "ranger-districts" / "source.gdb.zip"),
    ("final-fire-perimeters", "FirePerimeterFinal", RAW_DIR / "usfs" / "final-fire-perimeters" / "source.gdb.zip"),
]

PADUS_ZIP = RAW_DIR / "padus" / "PADUS4_1Geodatabase.zip"
PADUS_LAYERS = [
    ("fee", "PADUS4_1Fee"),
    ("proclamation", "PADUS4_1Proclamation"),
    ("designation", "PADUS4_1Designation"),
]


def zip_uri(path: Path, inner_gdb: str = "") -> str:
    suffix = f"/{inner_gdb}" if inner_gdb else ""
    return f"/vsizip/{path.resolve()}{suffix}"


def clean_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return str(value)
    return value


def clean_row(row: dict[str, Any], geom_name: str, transformer: Transformer | None) -> dict[str, Any]:
    geom_wkb = row.pop(geom_name, None)
    cleaned = {key: clean_value(value) for key, value in row.items()}
    if geom_wkb:
        try:
            geometry = wkb.loads(geom_wkb)
            if transformer:
                geometry = shapely_transform(transformer.transform, geometry)
            cleaned["__geom_geojson"] = mapping(geometry)
        except Exception as exc:
            cleaned["__geom_wkb_hex"] = bytes(geom_wkb).hex()
            cleaned["__geom_error"] = type(exc).__name__
    return cleaned


def transformer_for_layer(uri: str, layer: str) -> tuple[dict[str, Any], Transformer | None]:
    info = pyogrio.read_info(uri, layer=layer)
    crs = info.get("crs")
    if not crs:
        return info, None
    parsed = CRS.from_user_input(crs)
    if parsed.is_geographic:
        return info, None
    return info, Transformer.from_crs(parsed, "EPSG:4326", always_xy=True)


def import_layer(
    db: sqlite3.Connection,
    dataset_id: str,
    endpoint: str,
    uri: str,
    layer: str,
    batch_size: int,
    limit: int,
) -> int:
    info, transformer = transformer_for_layer(uri, layer)
    total = int(info.get("features") or 0)
    geom_name = str(info.get("geometry_name") or "SHAPE")
    imported = 0
    offset = 0
    started = time.time()
    while offset < total:
        if limit and imported >= limit:
            break
        max_features = min(batch_size, total - offset)
        if limit:
            max_features = min(max_features, limit - imported)
        _meta, table = pyogrio.read_arrow(
            uri,
            layer=layer,
            skip_features=offset,
            max_features=max_features,
            read_geometry=True,
            return_fids=True,
            datetime_as_string=False,
        )
        for row in table.to_pylist():
            item = clean_row(row, geom_name, transformer)
            insert_raw(db, dataset_id, endpoint, item, int(started))
            imported += 1
        offset += max_features
        if imported and imported % max(batch_size * 5, 1) == 0:
            db.commit()
            print(f"{dataset_id} {endpoint}: {imported}/{total}")
    db.commit()
    print(f"{dataset_id} {endpoint}: {imported} records")
    return imported


def selected_sources(source: str) -> set[str]:
    clean = source.strip().lower()
    if clean == "all":
        return {"usfs-edw", "padus"}
    if clean == "usfs":
        return {"usfs-edw"}
    return {clean}


def main() -> int:
    parser = argparse.ArgumentParser(description="Import official geospatial source archives into the local raw cache.")
    parser.add_argument("--source", default="all")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=2500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sources = selected_sources(args.source)
    if args.dry_run:
        print(f"DRY geospatial import for {', '.join(sorted(sources))}")
        return 0

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    counts: dict[str, int] = {}
    try:
        init_db(db)
        upsert_sources(db, "all")
        if "usfs-edw" in sources:
            for endpoint, layer, archive in USFS_LAYERS:
                if not archive.exists():
                    print(f"usfs-edw {endpoint}: missing {archive}")
                    continue
                counts[f"usfs-edw:{endpoint}"] = import_layer(
                    db,
                    "usfs-edw",
                    endpoint,
                    zip_uri(archive),
                    layer,
                    args.batch_size,
                    args.limit,
                )
        if "padus" in sources:
            if not PADUS_ZIP.exists():
                print(f"padus: missing {PADUS_ZIP}")
            else:
                uri = zip_uri(PADUS_ZIP, "PADUS4_1Geodatabase.gdb")
                for endpoint, layer in PADUS_LAYERS:
                    counts[f"padus:{endpoint}"] = import_layer(
                        db,
                        "padus",
                        endpoint,
                        uri,
                        layer,
                        args.batch_size,
                        args.limit,
                    )
        summary_path = PROCESSED_DIR / "geospatial-raw-import-summary.json"
        summary_path.write_text(json.dumps({"database": str(DB_PATH), "counts": counts}, indent=2) + "\n")
        print(json.dumps({"counts": counts}, indent=2))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
