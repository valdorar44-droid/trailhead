#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.explore_sources.travel.viator.client import ViatorClient, config_from_env
from scripts.explore_sources.travel.viator.normalize_viator import normalize_viator_products


def load_payload(path: str | Path) -> dict:
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return {"products": data}
    raise ValueError(f"unsupported Viator fixture shape: {path}")


def import_viator_fixture(path: str | Path, fetched_at: int | None = None, ttl_hours: int = 24):
    return normalize_viator_products(load_payload(path), fetched_at=fetched_at, ttl_hours=ttl_hours)


def write_json(path: str | Path, payload: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build TrailHead Viator Tours & Experiences source pack.")
    parser.add_argument("--fixture", action="append", default=[], help="Viator product search fixture JSON. May be repeated.")
    parser.add_argument("--destination-id", default="", help="Viator destination id for live Basic Access /products/search.")
    parser.add_argument("--tag", action="append", type=int, default=[], help="Viator tag id for live search. May be repeated.")
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--pages", type=int, default=0, help="Number of small product-search pages to fetch. Defaults to count/page-size.")
    parser.add_argument("--page-size", type=int, default=6, help="Products per page. Capped by the Viator client.")
    parser.add_argument("--currency", default="USD")
    parser.add_argument("--out", default="dashboard/explore_bookable_experiences_v1.json")
    parser.add_argument("--viator-out", default="dashboard/explore_tours_viator_v1.json")
    args = parser.parse_args()

    fetched_at = int(time.time())
    config = config_from_env()
    experiences = []
    for fixture in args.fixture:
        experiences.extend(import_viator_fixture(fixture, fetched_at=fetched_at, ttl_hours=config.cache_ttl_hours))
    if args.destination_id:
        client = ViatorClient(config)
        remaining = max(1, int(args.count or args.page_size))
        page_size = max(1, min(int(args.page_size or config.page_size), config.page_size))
        page_total = int(args.pages or math.ceil(remaining / page_size))
        for page in range(max(1, min(page_total, 20))):
            if remaining <= 0:
                break
            payload = client.search_products(
                destination_id=args.destination_id,
                tags=args.tag,
                count=min(page_size, remaining),
                start=(page * page_size) + 1,
                currency=args.currency,
            )
            experiences.extend(normalize_viator_products(payload, fetched_at=fetched_at, ttl_hours=config.cache_ttl_hours))
            remaining -= page_size
    seen = set()
    deduped = []
    for item in experiences:
        if item.source_id in seen:
            continue
        seen.add(item.source_id)
        deduped.append(item)
    payload = {
        "schema_version": 1,
        "source": "viator",
        "attribution": "Tours and experiences sourced from Viator.",
        "generated_at": fetched_at,
        "fixture_mode": bool(args.fixture and not args.destination_id),
        "count": len(deduped),
        "experiences": [item.to_dict() for item in deduped],
    }
    write_json(args.out, payload)
    write_json(args.viator_out, payload)
    print(f"wrote {len(deduped)} Viator experiences to {args.out}")
    print(f"wrote {len(deduped)} Viator experiences to {args.viator_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
