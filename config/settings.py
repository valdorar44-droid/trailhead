from __future__ import annotations
import os

class Settings:
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    mapbox_token: str = os.environ.get("MAPBOX_TOKEN", "")
    nrel_api_key: str = os.environ.get("NREL_API_KEY", "DEMO_KEY")
    ridb_api_key: str = os.environ.get("RIDB_API_KEY", "")
    db_path: str = os.environ.get("TRAILHEAD_DB_PATH", "/data/trailhead.db" if os.path.isdir("/data") else "./trailhead.db")

settings = Settings()
