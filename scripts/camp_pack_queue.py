#!/usr/bin/env python3
"""Build and upload selected offline place packs."""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dashboard import place_packs


PROGRESS_INTERVAL_SECONDS = 20


def existing_regions(pack_id: str) -> set[str]:
    return {p.name[: -(len(pack_id) + 6)] for p in (ROOT / "data" / "place_packs").glob(f"*-{pack_id}.json")}


def ordered_unique_regions(states: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for state in states:
        value = state.lower()
        if value in seen:
            continue
        seen.add(value)
        unique.append(value)
    return place_packs.ordered_regions(unique)


def _current_pack_progress(current_key: str = "") -> dict:
    status = place_packs.status()
    batch = status.get("batch") or {}
    current = current_key or str(batch.get("current") or "")
    pack_status = (status.get("packs") or {}).get(current, {}) if current else {}
    return {
        "event": "place_pack_queue_progress",
        "running": status.get("running"),
        "batch": {
            "running": batch.get("running"),
            "current": batch.get("current"),
            "completed": batch.get("completed"),
            "total": batch.get("total"),
            "error_count": len(batch.get("errors") or []),
        },
        "current": current,
        "status": pack_status.get("status"),
        "progress": pack_status.get("progress"),
        "point_count": pack_status.get("point_count"),
        "failed_cell_count": pack_status.get("failed_cell_count"),
        "size_bytes": pack_status.get("size_bytes"),
    }


async def run_with_progress(awaitable, *, current_key: str = ""):
    task = asyncio.create_task(awaitable)
    last_line = ""
    while not task.done():
        await asyncio.sleep(PROGRESS_INTERVAL_SECONDS)
        line = json.dumps(_current_pack_progress(current_key), sort_keys=True)
        if line != last_line:
            print(line, flush=True)
            last_line = line
    return await task


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("states", nargs="*", help="State ids to build. Defaults to every state missing a camps pack.")
    parser.add_argument("--pack", default="camps", choices=sorted(place_packs.PACK_DEFINITIONS), help="Place pack id to build.")
    parser.add_argument("--force-state", action="append", default=[], help="State id to rebuild even if a camps pack exists.")
    args = parser.parse_args()

    pack_id = args.pack.lower()
    all_states = sorted(s.lower() for s in place_packs.STATE_BBOXES)
    built = existing_regions(pack_id)
    states = ordered_unique_regions([s.lower() for s in args.states] if args.states else [s for s in all_states if s not in built])
    force_states = ordered_unique_regions([s.lower() for s in args.force_state])
    force_state_set = set(force_states)
    states = [state for state in states if state not in force_state_set]

    print(json.dumps({
        "event": "place_pack_queue_start",
        "pack_id": pack_id,
        "states": states,
        "force_states": force_states,
    }), flush=True)

    if states:
        await run_with_progress(place_packs.build_all_task(states, [pack_id], skip_existing=True))
        print(json.dumps({
            "event": "place_pack_queue_missing_done",
            "pack_id": pack_id,
            "states": states,
            "batch": place_packs.status().get("batch"),
        }), flush=True)

    for state in force_states:
        print(json.dumps({"event": "place_pack_force_start", "pack_id": pack_id, "state": state}), flush=True)
        ok = await run_with_progress(place_packs.build_and_upload(state, pack_id), current_key=f"{state}:{pack_id}")
        print(json.dumps({"event": "place_pack_force_done", "pack_id": pack_id, "state": state, "ok": ok}), flush=True)

    await place_packs.update_manifest_on_r2()
    print(json.dumps({"event": "place_pack_queue_complete", "pack_id": pack_id}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
