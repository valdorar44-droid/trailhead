#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import store  # noqa: E402


def build_report(args: argparse.Namespace) -> dict:
    store.init_db()
    leads = store.list_dispersed_site_leads_for_publication(
        max_age_days=args.max_age_days,
        source_batch=args.source_batch,
        limit=args.limit,
    )
    report = {
        "mode": "commit" if args.commit else "dry_run",
        "max_age_days": args.max_age_days,
        "source_batch": args.source_batch or None,
        "eligible": len(leads),
        "published": 0,
        "merged": 0,
        "skipped": 0,
        "errors": [],
        "by_status": dict(Counter(str(lead.get("status") or "unknown") for lead in leads)),
        "by_category": dict(Counter(str(lead.get("category") or "unknown") for lead in leads)),
        "sample": [
            {
                "lead_key": lead.get("lead_key"),
                "category": lead.get("category"),
                "status": lead.get("status"),
                "source_verified_at": lead.get("source_verified_at"),
                "freshness": store.dispersed_lead_verified_freshness(lead),
            }
            for lead in leads[: min(10, len(leads))]
        ],
    }
    if not args.commit:
        return report

    if not args.coordinate_only_confirmed:
        raise SystemExit("--coordinate-only-confirmed is required with --commit")

    for lead in leads:
        lead_key = str(lead.get("lead_key") or "").strip()
        if not lead_key:
            report["skipped"] += 1
            continue
        try:
            before_camp_id = lead.get("canonical_camp_id")
            published = store.publish_dispersed_site_lead(
                lead_key,
                admin_id=args.admin_id,
                profile_data={},
            )
            if not published:
                report["skipped"] += 1
                continue
            report["published"] += 1
            if before_camp_id and published.get("canonical_camp_id") == before_camp_id:
                report["merged"] += 1
        except Exception as exc:
            report["errors"].append({"lead_key": lead_key, "error": str(exc)})
            if not args.keep_going:
                raise
    report["db_summary"] = store.get_dispersed_site_lead_summary(args.source_batch or None)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Publish recent sanitized private dispersed coordinate leads as public Trailhead dispersed camps.",
    )
    parser.add_argument("--max-age-days", type=int, default=366)
    parser.add_argument("--source-batch", default="")
    parser.add_argument("--limit", type=int, default=0, help="0 means all eligible leads.")
    parser.add_argument("--admin-id", type=int, default=None)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument(
        "--coordinate-only-confirmed",
        action="store_true",
        help="Confirms public records will use only coordinates plus Trailhead-generated fields.",
    )
    parser.add_argument("--keep-going", action="store_true")
    args = parser.parse_args(argv)
    report = build_report(args)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
