"""FCC mobile coverage adapter.

This adapter intentionally avoids bot-protected National Broadband Map web
endpoints. It exposes clear source labels for FCC modeled outdoor stationary
coverage metadata and optionally queries the FCC VIZMO crowdsourced speed-test
API for location-specific observations.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from config.settings import settings
from db.store import get_cached, set_cached
from ingestors.provider_guard import provider_budget_available, record_provider_call, runtime_cached_call


VIZMO_BASE = "http://vizmo.fcc.gov/api"

TECHNOLOGY_LABELS = {
    "300": "3G",
    "400": "4G LTE",
    "500": "5G-NR",
    "lte": "4G LTE",
    "4g": "4G LTE",
    "5g": "5G-NR",
    "5g-nr": "5G-NR",
    "nr": "5G-NR",
}

PROVIDER_ALIASES = {
    "att": "AT&T",
    "at&t": "AT&T",
    "verizon": "Verizon",
    "tmobile": "T-Mobile",
    "t-mobile": "T-Mobile",
    "sprint": "Sprint",
    "other": "Other carriers",
    "combined": "Combined carriers",
}


def normalize_technology(value: object) -> str:
    text = str(value or "").strip().lower().replace("_", "-")
    return TECHNOLOGY_LABELS.get(text, str(value or "").strip() or "Mobile broadband")


def normalize_provider(value: object) -> str:
    text = str(value or "").strip()
    return PROVIDER_ALIASES.get(text.lower(), text or "Mobile carrier")


def normalize_availability_class(value: object) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return "unknown"
    if text in {"1", "true", "yes", "available", "covered", "served"}:
        return "modeled_available"
    if text in {"0", "false", "no", "unavailable", "not_covered", "unserved"}:
        return "not_modeled_available"
    if "strong" in text or "good" in text:
        return "crowdsourced_good"
    if "fair" in text or "moderate" in text:
        return "crowdsourced_fair"
    if "poor" in text or "weak" in text:
        return "crowdsourced_weak"
    return text.replace(" ", "_")


def normalize_mobile_coverage_record(record: dict[str, Any], *, source: str = "fcc") -> dict:
    provider = normalize_provider(
        record.get("provider")
        or record.get("carrier")
        or record.get("brandName")
        or record.get("brand")
        or record.get("name")
    )
    technology = normalize_technology(record.get("technology") or record.get("tech") or record.get("network"))
    availability = normalize_availability_class(record.get("availability") or record.get("covered") or record.get("signal") or record.get("quality"))
    return {
        "provider": provider,
        "technology": technology,
        "availability_class": availability,
        "signal": record.get("signal") or record.get("quality") or record.get("rsrp") or record.get("download"),
        "download_mbps": _number(record.get("download") or record.get("download_mbps") or record.get("medianDownload")),
        "upload_mbps": _number(record.get("upload") or record.get("upload_mbps") or record.get("medianUpload")),
        "sample_count": _int(record.get("count") or record.get("tests") or record.get("sample_count")),
        "data_date": str(record.get("data_date") or record.get("date") or settings.fcc_bdc_mobile_data_date or ""),
        "source": source,
        "source_label": "FCC modeled" if source == "fcc_bdc" else "FCC crowdsourced speed tests",
    }


def _number(value: object) -> float | None:
    try:
        if value in (None, ""):
            return None
        return round(float(value), 2)
    except Exception:
        return None


def _int(value: object) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(value))
    except Exception:
        return None


def _vizmo_records(data: Any) -> list[dict]:
    if isinstance(data, dict):
        for key in ("carriers", "carrier", "data", "results", "features"):
            value = data.get(key)
            if isinstance(value, list):
                if key == "features":
                    return [(item.get("properties") or item) for item in value if isinstance(item, dict)]
                return [item for item in value if isinstance(item, dict)]
        # VIZMO provider response can be a dict keyed by carrier.
        records = []
        for key, value in data.items():
            if isinstance(value, dict):
                records.append({"provider": key, **value})
        return records
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


async def get_mobile_coverage(lat: float, lng: float) -> dict:
    cache_key = f"fcc_mobile_coverage:{float(lat):.3f}:{float(lng):.3f}:v1"
    cached = get_cached("campsite_cache", cache_key, ttl_seconds=3600 * 24 * 7)
    if cached is not None:
        record_provider_call("fcc", "mobile_coverage", cache_status="hit", source_action="camp_mobile_coverage", key=cache_key)
        return cached

    async def fetch_vizmo() -> list[dict]:
        if not settings.fcc_vizmo_enabled or not provider_budget_available("fcc", "vizmo"):
            return []
        started = time.time()
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "TrailheadFCC/1.0"}) as client:
                res = await client.get(f"{VIZMO_BASE}/carrier.json", params={"lat": f"{lat:.6f}", "lon": f"{lng:.6f}"})
                record_provider_call("fcc", "vizmo", status_code=res.status_code, duration_ms=round((time.time() - started) * 1000), source_action="camp_mobile_coverage", key=cache_key)
                res.raise_for_status()
                return [normalize_mobile_coverage_record(record, source="fcc_vizmo") for record in _vizmo_records(res.json())]
        except Exception:
            return []

    crowdsourced = await runtime_cached_call(
        f"{cache_key}:vizmo",
        3600,
        fetch_vizmo,
        provider="fcc",
        endpoint="vizmo",
        source_action="camp_mobile_coverage",
    )
    result = {
        "available": bool(crowdsourced or settings.fcc_bdc_mobile_source_url),
        "records": crowdsourced[:8],
        "modeled_source": {
            "source": "fcc_bdc",
            "source_label": "FCC modeled",
            "data_date": settings.fcc_bdc_mobile_data_date,
            "url": settings.fcc_bdc_mobile_source_url,
            "status": "metadata_only",
        },
        "source_label": "FCC modeled / crowdsourced",
        "disclaimer": "FCC mobile availability data is modeled outdoor stationary coverage and crowdsourced speed-test data is observational. It is advisory, not a guarantee of service at a campsite.",
        "last_checked": int(time.time()),
    }
    set_cached("campsite_cache", cache_key, result)
    return result
