#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config.settings import settings


def main() -> None:
    db = sqlite3.connect(settings.db_path)
    db.row_factory = sqlite3.Row

    rows = db.execute(
        """
        SELECT event_type, event_data, created_at
        FROM analytics_events
        WHERE event_type LIKE 'phase0_%'
        ORDER BY created_at DESC
        LIMIT 250
        """
    ).fetchall()

    counts = Counter(row["event_type"] for row in rows)
    print("Phase 0 analytics counts")
    for event_type, count in sorted(counts.items()):
        print(f"{event_type}: {count}")

    print("\nRecent Phase 0 events")
    for row in rows[:40]:
        payload = {}
        try:
            payload = json.loads(row["event_data"]) if row["event_data"] else {}
        except Exception:
            payload = {"raw": row["event_data"]}
        trimmed = {k: payload[k] for k in list(payload.keys())[:6]}
        print(f"{row['created_at']}  {row['event_type']}  {json.dumps(trimmed, ensure_ascii=True)}")


if __name__ == "__main__":
    main()
