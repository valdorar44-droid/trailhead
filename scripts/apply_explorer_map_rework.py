#!/usr/bin/env python3
"""Apply the Explorer map access rework.

Run from the repository root, then review the diff before shipping.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, path: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    return text.replace(old, new, 1)


def replace_all(text: str, old: str, new: str) -> str:
    return text.replace(old, new)


def patch_routing() -> None:
    path = "mobile/components/NativeMap/routing.ts"
    text = read(path)
    text = replace_all(
        text,
        " * Online priority:  Trailhead Valhalla for backroads → Mapbox → OSRM fallback",
        " * Online priority:  Trailhead Valhalla → Mapbox fallback → OSRM fallback",
    )
    text = replace_all(text, "EXTREME Mapbox", "Explorer Mapbox")
    text = replace_all(text, "extreme-mapbox-directions', 'Explorer Mapbox Directions", "explorer-mapbox-directions', 'Explorer Mapbox Directions")
    text = replace_once(
        text,
        "  if (providerMode === 'extreme-mapbox') {\n",
        "  if (providerMode === 'extreme-mapbox' || String(providerMode) === 'explorer-mapbox') {\n",
        path,
    )
    old = """  // C. Online: for overland-style routes, prefer our Valhalla service. Racing\n  // Mapbox here lets paved/highway routes win before Valhalla can return.\n  const onlineEngines = routeOpts.backRoads || routeOpts.avoidHighways\n    ? [\n        () => fetchValhalla(pairs, fromIdx, routeOpts),\n        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),\n        () => fetchOSRM(pairs, fromIdx, routeOpts),\n      ]\n    : [\n        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),\n        () => fetchValhalla(pairs, fromIdx, routeOpts),\n        () => fetchOSRM(pairs, fromIdx, routeOpts),\n      ];\n"""
    new = """  // C. Online: Trailhead owns the first route attempt. Mapbox is a fallback,\n  // and OSRM remains the last live backup. Traffic-first can be enabled by an\n  // explicit provider mode without changing the default free routing path.\n  const wantsMapboxFirst = String(providerMode) === 'mapbox-traffic' || String(providerMode) === 'traffic';\n  const onlineEngines = wantsMapboxFirst\n    ? [\n        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),\n        () => fetchValhalla(pairs, fromIdx, routeOpts),\n        () => fetchOSRM(pairs, fromIdx, routeOpts),\n      ]\n    : [\n        () => fetchValhalla(pairs, fromIdx, routeOpts),\n        () => fetchMapbox(pairs, fromIdx, mapboxToken, routeOpts),\n        () => fetchOSRM(pairs, fromIdx, routeOpts),\n      ];\n"""
    text = replace_once(text, old, new, path)
    write(path, text)


def patch_store() -> None:
    path = "db/store.py"
    text = read(path)
    text = replace_all(text, "tier_name\": \"Extreme Explorer\"", "tier_name\": \"Explorer\"")
    text = replace_all(text, 'plan in {"extreme", "extreme_beta"}', 'plan in {"explorer", "explorer_beta", "extreme", "extreme_beta"}')
    text = replace_all(
        text,
        '"""Hidden beta entitlement for Extreme Explorer before public products exist."""',
        '"""Explorer entitlement. Legacy plan names remain accepted during migration."""',
    )
    text = replace_all(
        text,
        "    State map downloads are free for everyone. Plan users are free for all\n    offline assets. Free users get one state routing pack, then pay credits.\n    Re-downloading an already-authorized asset is free.",
        "    Trailhead-owned map, route, topo, trail, and place packs are free for\n    everyone. Plan users also pass any remaining paid offline asset.\n    Re-downloading an already-authorized asset is free.",
    )
    old = """      if cost <= 0:\n          db.execute(\n              \"INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)\",\n              (user_id, asset_type, region_id, 0, 0, now),\n          )\n          db.commit()\n          return {\"authorized\": True, \"charged\": 0, \"free_used\": False, \"credits\": user.get(\"credits\", 0)}\n"""
    new = """      free_trailhead_assets = {\n          \"state_map\", \"country_map\", \"conus_map\",\n          \"state_route\", \"country_route\", \"trip_corridor\",\n          \"state_contours\", \"state_trails\", \"place_pack\", \"trail_pack\",\n      }\n      if cost <= 0 or asset_type in free_trailhead_assets:\n          db.execute(\n              \"INSERT OR IGNORE INTO offline_downloads (user_id,asset_type,region_id,cost,free_used,created_at) VALUES (?,?,?,?,?,?)\",\n              (user_id, asset_type, region_id, 0, 0, now),\n          )\n          db.commit()\n          return {\"authorized\": True, \"charged\": 0, \"free_used\": False, \"credits\": user.get(\"credits\", 0)}\n"""
    text = replace_once(text, old, new, path)
    write(path, text)


def patch_server() -> None:
    path = "dashboard/server.py"
    text = read(path)
    text = replace_all(text, '"tier_name": "Extreme Explorer"', '"tier_name": "Explorer"')
    text = replace_all(text, "Extreme Explorer", "Explorer")
    text = replace_all(text, "EXTREME", "EXPLORER")
    write(path, text)


def patch_api_types() -> None:
    path = "mobile/lib/api.ts"
    text = read(path)
    text = replace_all(text, "tier_name: 'Extreme Explorer' | string;", "tier_name: 'Explorer' | string;")
    text = replace_all(text, "// AI features", "// Guide features")
    text = replace_all(text, "Extreme Explorer", "Explorer")
    text = replace_all(text, "EXTREME", "EXPLORER")
    write(path, text)


def patch_layer_copy() -> None:
    for path in [
        "mobile/components/map/MapLayerSheetContent.tsx",
        "mobile/components/map/MapStyleSheet.tsx",
    ]:
        text = read(path)
        text = replace_all(text, "PREMIUM MAP", "MAP STYLES")
        text = replace_all(text, "Beta locked", "Explorer")
        text = replace_all(text, "EXTREME", "EXPLORER")
        text = replace_all(text, ">Extreme<", ">Explorer<")
        text = replace_all(text, ">EXTREME<", ">EXPLORER<")
        write(path, text)


def patch_offline_modal() -> None:
    path = "mobile/components/NativeMap/OfflineModal.tsx"
    text = read(path)
    old = """  const user        = useStore(st => st.user);\n  const mapboxToken = useStore(st => st.mapboxToken);\n"""
    new = """  const user        = useStore(st => st.user);\n  const mapboxToken = useStore(st => st.mapboxToken);\n  const hasPlan     = useStore(st => st.hasPlan || !!st.user?.is_admin);\n"""
    text = replace_once(text, old, new, path)
    old = """  const startMlnPack = useCallback(async (\n    name: string, bounds: [[number,number],[number,number]], minZoom: number, maxZoom: number\n  ) => {\n    setActivePackName(name);\n"""
    new = """  const startMlnPack = useCallback(async (\n    name: string, bounds: [[number,number],[number,number]], minZoom: number, maxZoom: number\n  ) => {\n    if (!hasPlan) {\n      setPackError('Explorer unlocks custom area saves. State and country packs stay free.');\n      return;\n    }\n    setActivePackName(name);\n"""
    text = replace_once(text, old, new, path)
    text = replace_once(text, "  }, [mapboxToken]);", "  }, [hasPlan, mapboxToken]);", path)
    text = replace_all(text, "MLN packs still used for legacy corridor fallback (can be removed later)", "Custom area packs use the smaller area save path")
    write(path, text)


def patch_native_map_copy() -> None:
    path = "mobile/components/NativeMap/index.tsx"
    text = read(path)
    text = replace_all(text, "EXTREME Mapbox", "Explorer Mapbox")
    text = replace_all(text, "extreme-mapbox", "explorer-mapbox")
    text = replace_all(text, "provider: isExtremeMapbox ? 'rnmapbox' : 'maplibre'", "provider: isExtremeMapbox ? 'mapbox' : 'trailhead'")
    write(path, text)


def main() -> None:
    patch_routing()
    patch_store()
    patch_server()
    patch_api_types()
    patch_layer_copy()
    patch_offline_modal()
    patch_native_map_copy()
    print("Explorer map access patch applied. Review the diff, then run mobile typecheck and backend tests.")


if __name__ == "__main__":
    main()
