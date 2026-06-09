from __future__ import annotations
import os, secrets

class Settings:
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    elevenlabs_api_key: str = os.environ.get("ELEVENLABS_API_KEY", "")
    elevenlabs_voice_id: str = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    openai_realtime_model: str = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
    openai_realtime_fallback_model: str = os.environ.get("OPENAI_REALTIME_FALLBACK_MODEL", "gpt-realtime-mini")
    audio_cache_dir: str = os.environ.get("AUDIO_CACHE_DIR", "/data/audio_cache" if os.path.isdir("/data") else "./audio_cache")
    audio_cache_r2_prefix: str = os.environ.get("AUDIO_CACHE_R2_PREFIX", "audio-cache")
    mapbox_token: str = os.environ.get("MAPBOX_TOKEN", "")
    extreme_enabled: bool = os.environ.get("EXTREME_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_kill_switch: bool = os.environ.get("EXTREME_KILL_SWITCH", "false").lower() in {"1", "true", "yes", "on"}
    extreme_beta_user_ids: str = os.environ.get("EXTREME_BETA_USER_IDS", "")
    extreme_beta_emails: str = os.environ.get("EXTREME_BETA_EMAILS", "")
    extreme_allowed_surfaces: str = os.environ.get("EXTREME_ALLOWED_SURFACES", "map_layers")
    extreme_max_demo_session_seconds: int = int(os.environ.get("EXTREME_MAX_DEMO_SESSION_SECONDS", "900"))
    extreme_max_navigation_session_seconds: int = int(os.environ.get("EXTREME_MAX_NAVIGATION_SESSION_SECONDS", "14400"))
    extreme_cost_cap_cents_daily: int = int(os.environ.get("EXTREME_COST_CAP_CENTS_DAILY", "5000"))
    extreme_search_enabled: bool = os.environ.get("EXTREME_SEARCH_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
    extreme_weather_enabled: bool = os.environ.get("EXTREME_WEATHER_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_mapbox_weather_enabled: bool = os.environ.get("EXTREME_MAPBOX_WEATHER_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_navigation_enabled: bool = os.environ.get("EXTREME_NAVIGATION_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_voice_enabled: bool = os.environ.get("EXTREME_VOICE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_copilot_enabled: bool = os.environ.get("EXTREME_COPILOT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_mapgpt_pilot_enabled: bool = os.environ.get("EXTREME_MAPGPT_PILOT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_atlas_pilot_enabled: bool = os.environ.get("EXTREME_ATLAS_PILOT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_native_mode_enabled: bool = os.environ.get("EXTREME_NATIVE_MODE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_copilot_wake_phrase_enabled: bool = os.environ.get("EXTREME_COPILOT_WAKE_PHRASE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    extreme_copilot_persona: str = os.environ.get("EXTREME_COPILOT_PERSONA", "calm overland navigator")
    extreme_copilot_voice: str = os.environ.get("EXTREME_COPILOT_VOICE", "trailhead")
    extreme_style_standard: str = os.environ.get("EXTREME_STYLE_STANDARD", "mapbox://styles/mapbox/standard")
    extreme_style_live_road: str = os.environ.get("EXTREME_STYLE_LIVE_ROAD", "mapbox://styles/mapbox/standard")
    extreme_style_satellite_trail: str = os.environ.get("EXTREME_STYLE_SATELLITE_TRAIL", "mapbox://styles/mapbox/satellite-streets-v12")
    extreme_style_3d_terrain: str = os.environ.get("EXTREME_STYLE_3D_TERRAIN", "mapbox://styles/mapbox/standard")
    extreme_style_night_drive: str = os.environ.get("EXTREME_STYLE_NIGHT_DRIVE", "mapbox://styles/mapbox/dark-v11")
    extreme_style_weather_watch: str = os.environ.get("EXTREME_STYLE_WEATHER_WATCH", "mapbox://styles/mapbox/outdoors-v12")
    extreme_style_outdoors: str = os.environ.get("EXTREME_STYLE_OUTDOORS", "mapbox://styles/mapbox/outdoors-v12")
    nrel_api_key: str = os.environ.get("NREL_API_KEY", "DEMO_KEY")
    eia_api_key: str = os.environ.get("EIA_API_KEY", "")
    ridb_api_key: str = os.environ.get("RIDB_API_KEY", "")
    active_campground_api_key: str = os.environ.get("ACTIVE_CAMPGROUND_API_KEY", "")
    active_activity_search_api_key: str = os.environ.get("ACTIVE_ACTIVITY_SEARCH_API_KEY", "")
    # Dormant until provider access and terms are confirmed.
    active_net_us_api_key: str = os.environ.get("ACTIVE_NET_US_API_KEY", "")
    active_net_ca_api_key: str = os.environ.get("ACTIVE_NET_CA_API_KEY", "")
    active_trainer_api_key: str = os.environ.get("ACTIVE_TRAINER_API_KEY", "")
    active_net_enabled: bool = os.environ.get("ACTIVE_NET_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
    fcc_vizmo_enabled: bool = os.environ.get("FCC_VIZMO_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
    fcc_bdc_mobile_data_date: str = os.environ.get("FCC_BDC_MOBILE_DATA_DATE", "")
    fcc_bdc_mobile_source_url: str = os.environ.get("FCC_BDC_MOBILE_SOURCE_URL", "https://broadbandmap.fcc.gov/data-download/nationwide-data")
    secret_key: str = os.environ.get("SECRET_KEY", "trailhead-dev-secret-change-in-prod")
    db_path: str = os.environ.get("TRAILHEAD_DB_PATH", "/data/trailhead.db" if os.path.isdir("/data") else "./trailhead.db")
    stripe_secret_key: str = os.environ.get("STRIPE_SECRET_KEY", "")
    stripe_webhook_secret: str = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    # Public URL used for account emails and web callbacks.
    public_url: str = os.environ.get(
        "PUBLIC_URL",
        f"https://{os.environ.get('RAILWAY_PUBLIC_DOMAIN', 'api.gettrailhead.app')}"
    )
    protomaps_key: str = os.environ.get("PROTOMAPS_KEY", "")
    google_places_api_key: str = os.environ.get("GOOGLE_PLACES_API_KEY", "")
    tomtom_api_key: str = os.environ.get("TOMTOM_API_KEY", "")
    airnow_api_key: str = os.environ.get("AIRNOW_API_KEY", "")
    nasa_firms_map_key: str = os.environ.get("NASA_FIRMS_MAP_KEY", "")
    google_oauth_client_ids: str = os.environ.get("GOOGLE_OAUTH_CLIENT_IDS", "")
    valhalla_url: str = os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de")
    valhalla_area_urls: str = os.environ.get("VALHALLA_AREA_URLS", "")
    route_fallback_urls: str = os.environ.get("ROUTE_FALLBACK_URLS", "https://routing.openstreetmap.de/routed-car")
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
    r2_public_url: str = os.environ.get("R2_PUBLIC_URL", "")
    nps_api_key: str = os.environ.get("NPS_API_KEY", "")
    apple_bundle_id: str = os.environ.get("APPLE_BUNDLE_ID", os.environ.get("IOS_BUNDLE_ID", ""))
    apple_service_id: str = os.environ.get("APPLE_SERVICE_ID", "")
    apple_issuer_id: str = os.environ.get("APPLE_ISSUER_ID", "")
    apple_key_id: str = os.environ.get("APPLE_KEY_ID", "")
    apple_private_key: str = os.environ.get("APPLE_PRIVATE_KEY", "")
    apple_private_key_path: str = os.environ.get("APPLE_PRIVATE_KEY_PATH", "")
    google_play_package_name: str = os.environ.get("GOOGLE_PLAY_PACKAGE_NAME", "com.trailhead.app")
    google_play_service_account_json: str = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "")
    google_play_service_account_path: str = os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_PATH", "")

settings = Settings()
