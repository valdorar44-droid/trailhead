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
    valhalla_url: str = os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de")
    smtp_host: str = os.environ.get("SMTP_HOST", "")
    smtp_port: int = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user: str = os.environ.get("SMTP_USER", "")
    smtp_password: str = os.environ.get("SMTP_PASSWORD", "")
    smtp_from_email: str = os.environ.get("SMTP_FROM_EMAIL", "hello@gettrailhead.app")
    smtp_from_name: str = os.environ.get("SMTP_FROM_NAME", "Trailhead")
    smtp_tls: bool = os.environ.get("SMTP_TLS", "true").lower() != "false"
    cloudflare_email_account_id: str = os.environ.get("CLOUDFLARE_EMAIL_ACCOUNT_ID", os.environ.get("CF_EMAIL_ACCOUNT_ID", ""))
    cloudflare_email_api_token: str = os.environ.get("CLOUDFLARE_EMAIL_API_TOKEN", os.environ.get("CF_EMAIL_API_TOKEN", ""))
    r2_account_id: str = os.environ.get("R2_ACCOUNT_ID", "")
    r2_access_key_id: str = os.environ.get("R2_ACCESS_KEY_ID", "")
    r2_secret_access_key: str = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    r2_bucket: str = os.environ.get("R2_BUCKET", "trailhead-tiles")

settings = Settings()
