from __future__ import annotations

import json
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable


WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
WIKIDATA_USER_AGENT = "Trailhead/1.0 explore-wikidata-fetcher"

DEFAULT_CLASS_QIDS = [
    "Q35666",  # glacier
    "Q8502",  # mountain
    "Q133056",  # mountain pass
    "Q23397",  # lake
    "Q34038",  # waterfall
    "Q839954",  # archaeological site
    "Q4989906",  # monument
]

UrlOpener = Callable[[urllib.request.Request, float], Any]


def fetch_wikidata_places_to_cache(
    *,
    cache_dir: str | Path = "data/explore/source_cache",
    class_qids: Iterable[str] | None = None,
    country_qids: Iterable[str] | None = None,
    limit: int = 500,
    timeout: float = 90.0,
    force: bool = False,
    opener: UrlOpener = urllib.request.urlopen,
) -> Path:
    classes = list(class_qids or DEFAULT_CLASS_QIDS)
    countries = list(country_qids or [])
    target = cache_path(cache_dir, class_qids=classes, country_qids=countries, limit=limit)
    if target.exists() and not force:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    bindings = fetch_wikidata_bindings(
        class_qids=classes,
        country_qids=countries,
        limit=limit,
        timeout=timeout,
        opener=opener,
    )
    records = [record_from_binding(binding) for binding in bindings]
    records = [record for record in records if record]
    payload = {
        "source": "wikidata",
        "endpoint": "sparql",
        "fetched_at": int(time.time()),
        "count": len(records),
        "records": records,
    }
    write_json_atomic(target, payload)
    return target


def fetch_wikidata_bindings(
    *,
    class_qids: Iterable[str] | None = None,
    country_qids: Iterable[str] | None = None,
    limit: int = 500,
    timeout: float = 90.0,
    opener: UrlOpener = urllib.request.urlopen,
) -> list[dict[str, Any]]:
    if limit <= 0:
        raise ValueError("limit must be positive")
    query = sparql_query(class_qids=class_qids or DEFAULT_CLASS_QIDS, country_qids=country_qids, limit=limit)
    params = urllib.parse.urlencode({"query": query, "format": "json"})
    request = urllib.request.Request(
        f"{WIKIDATA_SPARQL_ENDPOINT}?{params}",
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": WIKIDATA_USER_AGENT,
        },
    )
    try:
        with opener(request, timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Wikidata SPARQL fetch failed: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Wikidata SPARQL fetch failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Wikidata SPARQL response was not valid JSON") from exc
    rows = payload.get("results", {}).get("bindings", [])
    return rows if isinstance(rows, list) else []


def sparql_query(*, class_qids: Iterable[str], country_qids: Iterable[str] | None = None, limit: int = 500) -> str:
    classes = " ".join(f"wd:{clean_qid(qid)}" for qid in class_qids if clean_qid(qid))
    countries = " ".join(f"wd:{clean_qid(qid)}" for qid in country_qids or [] if clean_qid(qid))
    country_filter = f"  VALUES ?country {{ {countries} }}\n  ?item wdt:P17 ?country .\n" if countries else "  OPTIONAL { ?item wdt:P17 ?country . }\n"
    return f"""
SELECT ?item ?itemLabel ?itemDescription ?class ?classLabel ?coord ?countryLabel ?adminLabel ?image WHERE {{
  VALUES ?class {{ {classes} }}
  ?item wdt:P31/wdt:P279* ?class ;
        wdt:P625 ?coord .
{country_filter}  OPTIONAL {{ ?item wdt:P131 ?admin . }}
  OPTIONAL {{ ?item wdt:P18 ?image . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" . }}
}}
LIMIT {int(limit)}
""".strip()


def record_from_binding(row: dict[str, Any]) -> dict[str, Any] | None:
    item_url = binding_value(row, "item")
    qid = wikidata_qid(item_url)
    label = clean_text(binding_value(row, "itemLabel"))
    lat, lng = point_to_lat_lng(binding_value(row, "coord"))
    if not qid or not label or lat is None or lng is None:
        return None
    class_label = clean_text(binding_value(row, "classLabel"))
    country = clean_text(binding_value(row, "countryLabel"))
    admin = clean_text(binding_value(row, "adminLabel"))
    image = image_url_from_wikidata(binding_value(row, "image"))
    return {
        "qid": qid,
        "label": label,
        "description": clean_text(binding_value(row, "itemDescription")),
        "instance_of": class_label,
        "instance_of_label": class_label,
        "country": country,
        "region": admin or country,
        "admin": admin,
        "lat": lat,
        "lng": lng,
        "wikidata_url": f"https://www.wikidata.org/wiki/{qid}",
        **({"image_url": image, "image_credit": "Wikimedia Commons", "image_license": "Wikimedia Commons"} if image else {}),
        "aliases": [label, qid, *(part for part in (admin, country, class_label) if part)],
        "tags": ["wikidata", "sparql", class_label],
    }


def binding_value(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    if isinstance(value, dict):
        return str(value.get("value") or "")
    return ""


def point_to_lat_lng(value: str) -> tuple[float | None, float | None]:
    match = re.search(r"Point\(([-0-9.]+)\s+([-0-9.]+)\)", value or "")
    if not match:
        return None, None
    return float(match.group(2)), float(match.group(1))


def image_url_from_wikidata(value: str) -> str:
    if not value:
        return ""
    if value.startswith("http://"):
        value = value.replace("http://", "https://", 1)
    if value.startswith("https://"):
        return value
    return ""


def wikidata_qid(item_url: str) -> str:
    return item_url.rstrip("/").rsplit("/", 1)[-1] if item_url else ""


def cache_path(
    cache_dir: str | Path,
    *,
    class_qids: Iterable[str] | None = None,
    country_qids: Iterable[str] | None = None,
    limit: int = 500,
) -> Path:
    classes = compact_key(class_qids or DEFAULT_CLASS_QIDS)
    countries = compact_key(country_qids or [])
    parts = ["sparql", f"classes-{classes}"]
    if countries:
        parts.append(f"countries-{countries}")
    parts.append(f"max-{limit}")
    return Path(cache_dir) / "wikidata" / ("_".join(parts) + ".json")


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def compact_key(values: Iterable[str]) -> str:
    return "-".join(clean_qid(value).lower() for value in values if clean_qid(value))[:120]


def clean_qid(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("http://www.wikidata.org/entity/") or text.startswith("https://www.wikidata.org/entity/"):
        text = text.rsplit("/", 1)[-1]
    return text if re.match(r"^Q\d+$", text) else ""


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()
