"""Trailhead — AI Adventure Trip Planner
Entry point. Loads .env and starts the server.
"""
from __future__ import annotations
import os, subprocess, sys

def _activate_packaged_venv():
    venv_python = "/opt/venv/bin/python"
    if os.path.exists(venv_python) and os.path.abspath(sys.executable) != venv_python:
        os.execv(venv_python, [venv_python, *sys.argv])

def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:]
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)

_load_env()
_activate_packaged_venv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db.store import init_db

def _env_enabled(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() not in {"0", "false", "no", "off"}

def _canonical_index_build_blocks_startup() -> bool:
    mode = os.environ.get("TRAILHEAD_CANONICAL_INDEX_BUILD_MODE", "background").strip().lower()
    if mode in {"blocking", "sync", "startup"}:
        return True
    if mode in {"background", "async", "nonblocking"}:
        return False
    return _env_enabled("TRAILHEAD_BLOCKING_CANONICAL_INDEX_BUILD", "0")

def _maybe_build_canonical_serving_indexes():
    if not _env_enabled("TRAILHEAD_ENSURE_CANONICAL_INDEXES", "1"):
        return
    root = os.path.dirname(os.path.abspath(__file__))
    official_db = os.path.join(root, "data", "processed", "trailhead_official_data.sqlite")
    app_db = os.path.join(root, "trailhead.db")
    explore_catalog = os.path.join(root, "data", "processed", "explore_catalog_v3.candidate.json")
    out_dir = os.environ.get(
        "TRAILHEAD_CANONICAL_SERVING_DIR",
        os.path.join(root, "data", "processed", "canonical_serving"),
    )
    sources = [path for path in (official_db, app_db, explore_catalog) if os.path.exists(path)]
    if not sources:
        return
    expected = [
        os.path.join(out_dir, "camps.candidate.json"),
        os.path.join(out_dir, "trails.candidate.json"),
        os.path.join(out_dir, "explore.candidate.json"),
    ]
    latest_source_mtime = max(os.path.getmtime(path) for path in sources)
    if all(os.path.exists(path) and os.path.getmtime(path) >= latest_source_mtime for path in expected):
        return
    script = os.path.join(root, "scripts", "data", "build_canonical_serving_indexes.py")
    if not os.path.exists(script):
        return
    timeout = int(os.environ.get("TRAILHEAD_CANONICAL_INDEX_TIMEOUT", "180"))
    cmd = [sys.executable, script, "--out-dir", out_dir]
    if not _canonical_index_build_blocks_startup() and not _env_enabled("TRAILHEAD_REQUIRE_CANONICAL_INDEXES", "0"):
        try:
            subprocess.Popen(
                cmd,
                cwd=root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except Exception as exc:
            print(f"Trailhead catalog index build skipped: {exc}", file=sys.stderr)
        return
    try:
        subprocess.run(cmd, cwd=root, check=True, timeout=timeout)
    except Exception as exc:
        print(f"Trailhead catalog index build skipped: {exc}", file=sys.stderr)
        if _env_enabled("TRAILHEAD_REQUIRE_CANONICAL_INDEXES", "0"):
            raise

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    port = args.port or int(os.environ.get("PORT", 8000))
    host = args.host or "0.0.0.0"

    init_db()
    _maybe_build_canonical_serving_indexes()

    import uvicorn
    from dashboard.server import app
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    main()
