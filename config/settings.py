from __future__ import annotations
import os, secrets

class Settings:
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    mapbox_token: str = os.environ.get("MAPBOX_TOKEN", "")
    nrel_api_key: str = os.environ.get("NREL_API_KEY", "DEMO_KEY")
    ridb_api_key: str = os.environ.get("RIDB_API_KEY", "")
    secret_key: str = os.environ.get("SECRET_KEY", "trailhead-dev-secret-change-in-prod")
    db_path: str = os.environ.get("TRAILHEAD_DB_PATH", "/data/trailhead.db" if os.path.isdir("/data") else "./trailhead.db")
    stripe_secret_key: str = os.environ.get("STRIPE_SECRET_KEY", "")
    stripe_webhook_secret: str = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    # Public URL used for Stripe redirect after checkout
    public_url: str = os.environ.get("PUBLIC_URL", "https://trailhead-production-2049.up.railway.app")
    protomaps_key: str = os.environ.get("PROTOMAPS_KEY", "")
    r2_account_id: str = os.environ.get("R2_ACCOUNT_ID", "")
    r2_access_key_id: str = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret_access_key: str = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket: str = os.environ.get("R2_BUCKET", "trailhead-tiles")

settings = Settings()
