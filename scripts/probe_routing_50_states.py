#!/usr/bin/env python3
"""Probe Trailhead routing coverage across all 50 states.

By default this hits production /api/route, which is the same backend path used
by Route Builder and Co-Pilot. A route only counts as Valhalla-covered when
`_trailhead.engine == "valhalla"`; OSRM fallback is reported separately.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time


PAIRS: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    "AL": ((33.5186, -86.8104), (32.3668, -86.3000)),
    "AK": ((61.2176, -149.8997), (61.5809, -149.4415)),
    "AZ": ((33.4484, -112.0740), (35.1983, -111.6513)),
    "AR": ((34.7465, -92.2896), (34.5037, -93.0552)),
    "CA": ((37.7749, -122.4194), (34.0522, -118.2437)),
    "CO": ((39.7392, -104.9903), (38.8339, -104.8214)),
    "CT": ((41.7658, -72.6734), (41.3083, -72.9279)),
    "DE": ((39.7447, -75.5484), (39.1582, -75.5244)),
    "FL": ((28.5383, -81.3792), (27.9506, -82.4572)),
    "GA": ((33.7490, -84.3880), (32.0809, -81.0912)),
    "HI": ((21.3069, -157.8583), (21.4022, -157.7394)),
    "IA": ((41.5868, -93.6250), (41.9779, -91.6656)),
    "ID": ((43.6150, -116.2023), (42.5629, -114.4609)),
    "IL": ((41.8781, -87.6298), (39.7817, -89.6501)),
    "IN": ((39.7684, -86.1581), (41.0793, -85.1394)),
    "KS": ((37.6872, -97.3301), (39.0473, -95.6752)),
    "KY": ((38.2527, -85.7585), (38.0406, -84.5037)),
    "LA": ((29.9511, -90.0715), (30.4515, -91.1871)),
    "MA": ((42.3601, -71.0589), (42.2626, -71.8023)),
    "MD": ((39.2904, -76.6122), (39.4143, -77.4105)),
    "ME": ((43.6591, -70.2568), (44.3106, -69.7795)),
    "MI": ((42.3314, -83.0458), (42.7325, -84.5555)),
    "MN": ((44.9778, -93.2650), (46.7867, -92.1005)),
    "MO": ((39.0997, -94.5786), (38.9517, -92.3341)),
    "MS": ((32.2988, -90.1848), (34.2576, -88.7034)),
    "MT": ((45.7833, -108.5007), (45.6770, -111.0429)),
    "NC": ((35.2271, -80.8431), (35.7796, -78.6382)),
    "ND": ((46.8772, -96.7898), (46.8083, -100.7837)),
    "NE": ((41.2565, -95.9345), (40.8136, -96.7026)),
    "NH": ((42.9956, -71.4548), (43.2081, -71.5376)),
    "NJ": ((40.7357, -74.1724), (40.2206, -74.7597)),
    "NM": ((35.0844, -106.6504), (35.6870, -105.9378)),
    "NV": ((36.1699, -115.1398), (39.5296, -119.8138)),
    "NY": ((40.7128, -74.0060), (42.6526, -73.7562)),
    "OH": ((39.9612, -82.9988), (41.4993, -81.6944)),
    "OK": ((35.4676, -97.5164), (36.1540, -95.9928)),
    "OR": ((45.5152, -122.6784), (44.0521, -123.0868)),
    "PA": ((39.9526, -75.1652), (40.4406, -79.9959)),
    "RI": ((41.8240, -71.4128), (41.4901, -71.3128)),
    "SC": ((34.0007, -81.0348), (32.7765, -79.9311)),
    "SD": ((43.5446, -96.7311), (44.0805, -103.2310)),
    "TN": ((36.1627, -86.7816), (35.9606, -83.9207)),
    "TX": ((30.2672, -97.7431), (29.4241, -98.4936)),
    "UT": ((40.7608, -111.8910), (38.5733, -109.5498)),
    "VA": ((37.5407, -77.4360), (37.2710, -79.9414)),
    "VT": ((44.4759, -73.2121), (44.2601, -72.5754)),
    "WA": ((47.6062, -122.3321), (47.6588, -117.4260)),
    "WI": ((43.0389, -87.9065), (43.0731, -89.4012)),
    "WV": ((38.3498, -81.6326), (39.6295, -79.9559)),
    "WY": ((41.1400, -104.8202), (42.8501, -106.3252)),
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="https://api.gettrailhead.app/api/route")
    parser.add_argument("--timeout", type=int, default=45)
    args = parser.parse_args()

    results = []
    for state, (a, b) in PAIRS.items():
        payload = json.dumps({
            "locations": [{"lat": a[0], "lon": a[1]}, {"lat": b[0], "lon": b[1]}],
            "options": {},
            "units": "miles",
        })
        started = time.time()
        cp = subprocess.run(
            [
                "curl", "-sS", "-X", "POST", args.api,
                "-H", "Content-Type: application/json",
                "-H", "User-Agent: TrailheadRouteAudit/1.0",
                "--data", payload,
            ],
            capture_output=True,
            text=True,
            timeout=args.timeout,
        )
        ms = round((time.time() - started) * 1000)
        try:
            data = json.loads(cp.stdout)
            trip = data.get("trip") or {}
            meta = data.get("_trailhead") or {}
            results.append({
                "state": state,
                "ok": trip.get("status") == 0 and bool(trip.get("legs")),
                "engine": meta.get("engine") or "unknown",
                "target": meta.get("target") or meta.get("valhalla_target") or "",
                "length": round(float((trip.get("summary") or {}).get("length") or 0), 1),
                "ms": ms,
                "message": trip.get("status_message") or data.get("detail") or data.get("error") or "",
            })
        except Exception as exc:
            results.append({
                "state": state,
                "ok": False,
                "engine": "request-error",
                "target": "",
                "length": 0,
                "ms": ms,
                "message": (cp.stdout or cp.stderr or str(exc))[:200],
            })

    valhalla = [r for r in results if r["engine"] == "valhalla" and r["ok"]]
    fallback = [r for r in results if r["engine"] == "osrm-fallback" and r["ok"]]
    failed = [r for r in results if not r["ok"]]
    print(json.dumps({
        "total": len(results),
        "valhalla": len(valhalla),
        "osrm_fallback": len(fallback),
        "failed": [r["state"] for r in failed],
        "non_valhalla_states": [r["state"] for r in results if r["engine"] != "valhalla"],
    }, indent=2))
    for r in results:
        print("\t".join(str(r[k]) for k in ("state", "ok", "engine", "target", "length", "ms", "message")))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

