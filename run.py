"""Trailhead — AI Adventure Trip Planner
Entry point. Loads .env and starts the server.
"""
from __future__ import annotations
import os, sys

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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db.store import init_db

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    port = args.port or int(os.environ.get("PORT", 8000))
    host = args.host or "0.0.0.0"

    init_db()

    import uvicorn
    from dashboard.server import app
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    main()
