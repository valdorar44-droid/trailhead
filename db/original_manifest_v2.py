"""Pure multi-chapter Originals normalization and V1 runtime compilation."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Callable
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

from db.originals_operational import (
    OriginalOperationalReadinessError,
    validate_manifest_operational_binding,
)
from db.originals_cultural_review import (
    OriginalCulturalReviewError,
    validate_cultural_claim_approval,
    validate_cultural_publication_scope,
    validate_cultural_story_claims,
)
from db.originals_route_evidence import (
    OriginalRouteEvidenceError,
    normalize_route_evidence_binding,
    validate_manifest_route_evidence,
)


_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$")
_LOCALE_RE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$")
_MAX_BYTES = 8 * 1024 * 1024


class OriginalManifestV2Error(ValueError):
    pass


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise OriginalManifestV2Error(f"{label} must be an object")
    return value


def _forbid_keys(value: dict, allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    if extra:
        raise OriginalManifestV2Error(
            f"{label} contains unsupported fields: {', '.join(extra)}"
        )


def _matches_exact(value: dict, expected: dict) -> bool:
    return set(value) == set(expected) and all(
        type(value[key]) is type(expected[key]) and value[key] == expected[key]
        for key in expected
    )


def _items(value: object, label: str, maximum: int, *, required: bool = True) -> list:
    if not isinstance(value, list) or len(value) > maximum or (required and not value):
        qualifier = f"one to {maximum}" if required else f"at most {maximum}"
        raise OriginalManifestV2Error(f"{label} must contain {qualifier} entries")
    return value


def _text(value: object, label: str, maximum: int) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    if not clean or len(clean) > maximum:
        raise OriginalManifestV2Error(f"{label} must be between 1 and {maximum} characters")
    return clean


def _stable_id(value: object, label: str) -> str:
    clean = str(value or "").strip()
    if not _ID_RE.fullmatch(clean):
        raise OriginalManifestV2Error(f"{label} must be a stable identifier")
    return clean


def _review_date(value: object, label: str) -> str:
    clean = _text(value, label, 40)
    try:
        parsed = date.fromisoformat(clean)
    except ValueError as exc:
        raise OriginalManifestV2Error(f"{label} must be an ISO calendar date") from exc
    if parsed > datetime.now(timezone.utc).date():
        raise OriginalManifestV2Error(f"{label} cannot be in the future")
    return clean


def _attestation_time(value: object, label: str) -> str:
    clean = _text(value, label, 40)
    try:
        parsed = datetime.fromisoformat(clean.replace("Z", "+00:00"))
    except ValueError as exc:
        raise OriginalManifestV2Error(f"{label} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        raise OriginalManifestV2Error(f"{label} must include a timezone")
    if parsed.astimezone(timezone.utc) > datetime.now(timezone.utc):
        raise OriginalManifestV2Error(f"{label} cannot be in the future")
    return clean


def _https_url(value: object, label: str, *, allowed_hosts: set[str]) -> str:
    clean = _text(value, label, 2_000)
    parsed = urlsplit(clean)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in allowed_hosts
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise OriginalManifestV2Error(f"{label} must be an approved HTTPS URL")
    return clean


def _sequence(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise OriginalManifestV2Error(f"{label} must be a positive integer")
    return value


def _ordered(rows: list[dict], label: str) -> list[dict]:
    result = sorted(rows, key=lambda row: (row["sequence"], row.get("id", "")))
    if [row["sequence"] for row in result] != list(range(1, len(result) + 1)):
        raise OriginalManifestV2Error(f"{label} sequence must be contiguous starting at 1")
    return result


def _unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise OriginalManifestV2Error(f"{label} must be unique")


def _bounds(value: object, label: str) -> dict[str, float]:
    raw = _object(value, label)
    _forbid_keys(raw, {"north", "south", "east", "west"}, label)
    result: dict[str, float] = {}
    limits = {"north": (-90, 90), "south": (-90, 90), "east": (-180, 180), "west": (-180, 180)}
    for key, (minimum, maximum) in limits.items():
        item = raw.get(key)
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not minimum <= float(item) <= maximum:
            raise OriginalManifestV2Error(f"{label} {key} is invalid")
        result[key] = float(item)
    if result["north"] < result["south"] or result["east"] < result["west"]:
        raise OriginalManifestV2Error(f"{label} is invalid")
    return result


def _bounds_contains(bounds: dict[str, float], lng: object, lat: object, label: str) -> None:
    if isinstance(lng, bool) or isinstance(lat, bool) or not isinstance(lng, (int, float)) or not isinstance(lat, (int, float)):
        raise OriginalManifestV2Error(f"{label} coordinate is invalid")
    if not bounds["west"] <= float(lng) <= bounds["east"] or not bounds["south"] <= float(lat) <= bounds["north"]:
        raise OriginalManifestV2Error(f"{label} is outside the union offline map")


def _profile_v2(profile: dict) -> dict:
    """Normalize the accepted provider-native ElevenLabs MP3 contract.

    V2 is intentionally narrow. It records the bytes ElevenLabs returned as
    both the immutable source/master and mobile delivery. It must never imply
    that a lossy MP3 is a WAV/lossless master or that a Creator account has
    zero-retention processing.
    """
    _forbid_keys(profile, {
        "schema_version", "provider", "voice_id", "model_snapshot", "api_version",
        "language", "generation", "archival_master", "mobile_delivery",
        "commercial_license", "training_contribution", "provider_data_retention",
    }, "Original V2 narration_profile")
    if profile.get("provider") != "elevenlabs":
        raise OriginalManifestV2Error(
            "Original narration profile V2 supports only the accepted ElevenLabs path"
        )
    profile["voice_id"] = _text(
        profile.get("voice_id"), "Original narration profile voice_id", 240,
    )
    profile["api_version"] = _text(
        profile.get("api_version"), "Original narration profile api_version", 240,
    )
    profile["language"] = _text(
        profile.get("language"), "Original narration profile language", 40,
    )
    profile["model_snapshot"] = _text(
        profile.get("model_snapshot"), "Original narration profile model_snapshot", 240,
    )
    if profile["model_snapshot"] != "eleven_multilingual_v2":
        raise OriginalManifestV2Error(
            "Original narration profile V2 must pin eleven_multilingual_v2"
        )
    if profile["api_version"] != "elevenlabs_text_to_speech_v1":
        raise OriginalManifestV2Error(
            "Original narration profile V2 must pin the ElevenLabs text-to-speech v1 API contract"
        )
    if profile["language"] != "en":
        raise OriginalManifestV2Error(
            "Original narration profile V2 currently supports the reviewed English path only"
        )

    generation = _object(profile.get("generation"), "Original narration generation profile")
    archive = _object(profile.get("archival_master"), "Original narration archive profile")
    delivery = _object(profile.get("mobile_delivery"), "Original narration delivery profile")
    _forbid_keys(generation, {
        "output_format", "mime_type", "sample_rate_hz", "bitrate_kbps", "channels",
        "provider_native", "lossless",
    }, "Original narration generation profile")
    _forbid_keys(archive, {
        "mime_type", "sample_rate_hz", "bitrate_kbps", "channels",
        "provider_native", "immutable", "lossless",
    }, "Original narration archive profile")
    _forbid_keys(delivery, {
        "mime_type", "sample_rate_hz", "bitrate_kbps", "channels", "lossless",
        "transcoded", "byte_identical_to_archival_master",
    }, "Original narration delivery profile")
    expected_generation = {
        "output_format": "mp3_44100_128",
        "mime_type": "audio/mpeg",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "channels": 1,
        "provider_native": True,
        "lossless": False,
    }
    expected_archive = {
        "mime_type": "audio/mpeg",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "channels": 1,
        "provider_native": True,
        "immutable": True,
        "lossless": False,
    }
    expected_delivery = {
        "mime_type": "audio/mpeg",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "channels": 1,
        "lossless": False,
        "transcoded": False,
        "byte_identical_to_archival_master": True,
    }
    for row, expected, label in (
        (generation, expected_generation, "generation"),
        (archive, expected_archive, "archival master"),
        (delivery, expected_delivery, "mobile delivery"),
    ):
        if not _matches_exact(row, expected):
            raise OriginalManifestV2Error(
                f"Original narration profile V2 {label} must match provider-native mp3_44100_128"
            )

    commercial = _object(
        profile.get("commercial_license"), "Original narration commercial license",
    )
    _forbid_keys(commercial, {
        "status", "plan", "commercial_use_allowed", "terms_id", "terms_url",
        "terms_version", "reviewed_at", "verified_at",
    }, "Original narration commercial license")
    if (
        commercial.get("status") != "verified"
        or commercial.get("plan") != "creator"
        or commercial.get("commercial_use_allowed") is not True
    ):
        raise OriginalManifestV2Error(
            "Original ElevenLabs Creator narration needs verified commercial-use terms"
        )
    commercial["terms_id"] = _text(
        commercial.get("terms_id"), "Original narration license terms_id", 240,
    )
    commercial["terms_url"] = _https_url(
        commercial.get("terms_url"),
        "Original narration license terms_url",
        allowed_hosts={"elevenlabs.io", "www.elevenlabs.io"},
    )
    commercial["terms_version"] = _text(
        commercial.get("terms_version"), "Original narration license terms_version", 240,
    )
    commercial["reviewed_at"] = _review_date(
        commercial.get("reviewed_at"), "Original narration license reviewed_at",
    )
    commercial["verified_at"] = _attestation_time(
        commercial.get("verified_at"), "Original narration license verified_at",
    )

    training = _object(
        profile.get("training_contribution"), "Original narration training contribution",
    )
    _forbid_keys(training, {"status", "confirmed_at"}, "Original narration training contribution")
    if training.get("status") != "disabled":
        raise OriginalManifestV2Error(
            "Original ElevenLabs training contribution must be disabled"
        )
    training["confirmed_at"] = _attestation_time(
        training.get("confirmed_at"), "Original narration training contribution confirmed_at",
    )

    retention = _object(
        profile.get("provider_data_retention"), "Original narration provider data retention",
    )
    _forbid_keys(retention, {"status", "zero_retention", "confirmed_at"}, "Original narration provider data retention")
    if retention.get("status") != "provider_standard" or retention.get("zero_retention") is not False:
        raise OriginalManifestV2Error(
            "Original ElevenLabs Creator narration must record standard provider retention and zero_retention false"
        )
    retention["confirmed_at"] = _attestation_time(
        retention.get("confirmed_at"), "Original narration provider retention confirmed_at",
    )
    return profile


def _profile(value: object, *, required: bool) -> dict | None:
    if value is None:
        if required:
            raise OriginalManifestV2Error("Original V2 narration_profile is required before publishing")
        return None
    profile = copy.deepcopy(_object(value, "Original V2 narration_profile"))
    schema_version = profile.get("schema_version")
    if schema_version == 2:
        return _profile_v2(profile)
    _forbid_keys(profile, {
        "schema_version", "provider", "voice_id", "model_snapshot", "api_version",
        "language", "generation", "archival_master", "mobile_delivery",
        "commercial_license", "training_opt_out",
    }, "Original V2 narration_profile")
    if schema_version != 1:
        raise OriginalManifestV2Error("Original narration profile schema_version must be 1 or 2")
    if profile.get("provider") not in {"cartesia", "elevenlabs"}:
        raise OriginalManifestV2Error("Original narration profile provider is unsupported")
    for key in ("voice_id", "model_snapshot", "api_version", "language"):
        profile[key] = _text(profile.get(key), f"Original narration profile {key}", 240)
    if profile["provider"] == "cartesia" and not re.search(r"-\d{4}-\d{2}-\d{2}$", profile["model_snapshot"]):
        raise OriginalManifestV2Error("Original Cartesia narration must pin a dated model snapshot")
    generation = _object(profile.get("generation"), "Original narration generation profile")
    archive = _object(profile.get("archival_master"), "Original narration archive profile")
    delivery = _object(profile.get("mobile_delivery"), "Original narration delivery profile")
    _forbid_keys(generation, {"output_format", "sample_rate_hz", "channels"}, "Original narration generation profile")
    _forbid_keys(archive, {"mime_type", "sample_rate_hz", "channels", "bit_depth"}, "Original narration archive profile")
    _forbid_keys(delivery, {"mime_type", "bitrate_kbps", "sample_rate_hz", "channels"}, "Original narration delivery profile")
    if generation.get("output_format") != "wav" or archive.get("mime_type") != "audio/wav":
        raise OriginalManifestV2Error("Original narration generation and archive must use WAV")
    if delivery.get("mime_type") != "audio/mpeg":
        raise OriginalManifestV2Error("Original narration delivery format is unsupported")
    for row, label in ((generation, "generation"), (archive, "archive"), (delivery, "delivery")):
        rate, channels = row.get("sample_rate_hz"), row.get("channels")
        if isinstance(rate, bool) or not isinstance(rate, int) or not 8_000 <= rate <= 192_000:
            raise OriginalManifestV2Error(f"Original narration {label} sample rate is invalid")
        if channels not in {1, 2}:
            raise OriginalManifestV2Error(f"Original narration {label} channels must be 1 or 2")
    if archive.get("bit_depth") not in {16, 24, 32}:
        raise OriginalManifestV2Error("Original narration archive bit depth is invalid")
    if (
        archive.get("sample_rate_hz") != generation.get("sample_rate_hz")
        or archive.get("channels") != generation.get("channels")
    ):
        raise OriginalManifestV2Error("Original narration archive must match generation settings")
    bitrate = delivery.get("bitrate_kbps")
    if isinstance(bitrate, bool) or not isinstance(bitrate, int) or bitrate not in {64, 96, 128}:
        raise OriginalManifestV2Error("Original narration delivery bitrate is invalid")
    commercial = _object(profile.get("commercial_license"), "Original narration commercial license")
    opt_out = _object(profile.get("training_opt_out"), "Original narration training opt-out")
    _forbid_keys(commercial, {"status", "plan", "attested_at"}, "Original narration commercial license")
    _forbid_keys(opt_out, {"status", "confirmed_at"}, "Original narration training opt-out")
    if commercial.get("status") != "attested":
        raise OriginalManifestV2Error("Original narration commercial license must be attested")
    if commercial.get("plan") not in {"pro", "startup", "enterprise"}:
        raise OriginalManifestV2Error("Original narration commercial plan is not eligible")
    commercial["attested_at"] = _attestation_time(
        commercial.get("attested_at"), "Original narration license attested_at",
    )
    if opt_out.get("status") != "confirmed":
        raise OriginalManifestV2Error("Original narration training opt-out must be confirmed")
    opt_out["confirmed_at"] = _attestation_time(
        opt_out.get("confirmed_at"), "Original narration opt-out confirmed_at",
    )
    return profile


def _verified_metadata(value: object, label: str) -> dict:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError as exc:
            raise OriginalManifestV2Error(f"{label} is invalid") from exc
        if isinstance(decoded, dict):
            return decoded
    raise OriginalManifestV2Error(f"{label} is invalid")


def validate_original_narration_profile_asset(
    profile: dict,
    verified_asset: object,
    *,
    label: str,
) -> None:
    """Bind V2 profile claims to independently probed immutable upload data."""
    if profile.get("schema_version") != 2:
        return
    verified = _object(verified_asset, f"{label} verified asset")
    if verified.get("kind") != "narration" or verified.get("mime_type") != "audio/mpeg":
        raise OriginalManifestV2Error(
            f"{label} must be a verified audio/mpeg narration upload"
        )
    media = _verified_metadata(verified.get("media_metadata_json"), f"{label} media metadata")
    expected_media = {
        "format": "mp3",
        "sample_rate_hz": 44_100,
        "bitrate_kbps": 128,
        "channels": 1,
    }
    if not all(
        type(media.get(key)) is type(value) and media.get(key) == value
        for key, value in expected_media.items()
    ):
        raise OriginalManifestV2Error(
            f"{label} verified bytes do not match provider-native mp3_44100_128"
        )

    generator = _verified_metadata(
        verified.get("generator_metadata_json"), f"{label} generator metadata",
    )
    expected_generator = {
        "provider": profile["provider"],
        "model_id": profile["model_snapshot"],
        "voice_id": profile["voice_id"],
        "output_format": "mp3_44100_128",
        "provider_native_master": True,
        "lossless_master_claimed": False,
        "transcoded": False,
    }
    if not all(
        type(generator.get(key)) is type(value) and generator.get(key) == value
        for key, value in expected_generator.items()
    ):
        raise OriginalManifestV2Error(
            f"{label} generator provenance does not match narration profile V2"
        )
    zero_retention = generator.get("zero_retention")
    if zero_retention is not None and zero_retention is not False:
        raise OriginalManifestV2Error(
            f"{label} generator provenance cannot claim zero retention"
        )
    if generator.get("license_status") != "attested":
        raise OriginalManifestV2Error(f"{label} commercial license is not attested")
    attestation = _object(
        generator.get("license_attestation"), f"{label} commercial license attestation",
    )
    commercial = profile["commercial_license"]
    for key in ("terms_id", "terms_url", "terms_version", "reviewed_at"):
        if attestation.get(key) != commercial.get(key):
            raise OriginalManifestV2Error(
                f"{label} commercial terms do not match narration profile V2"
            )


def _compile(manifest: dict, chapter: dict, variant: dict, stories: dict[str, dict]) -> dict:
    stops = []
    for cue_index, cue in enumerate(variant["cue_refs"]):
        shared_story = stories[cue["story_id"]]
        override = next((
            item for item in shared_story.get("variant_overrides", [])
            if item["chapter_id"] == chapter["id"] and item["variant_id"] == variant["id"]
        ), None)
        story = copy.deepcopy(shared_story)
        if override is not None:
            story.update({
                "title": override.get("title", shared_story["title"]),
                "transcript": override["transcript"],
                "audio_asset_id": override["audio_asset_id"],
                "audio_duration_s": override["audio_duration_s"],
            })
        citations = copy.deepcopy(story["citations"])
        if cue_index == 0:
            # V1 publication validation expects operational provenance alongside
            # the compiled route. Keep it on one stop to avoid multiplying the
            # same sources across every story in the consumer bundle.
            citations.extend(copy.deepcopy(chapter["operational_sources"]))
        stop = {
            "id": story["id"],
            "sequence": cue["sequence"],
            "title": story["title"],
            "coordinates": copy.deepcopy(cue["coordinates"]),
            "transcript": story["transcript"],
            "audio_asset_id": story["audio_asset_id"],
            "audio_duration_s": story["audio_duration_s"],
            "trigger": copy.deepcopy(cue["trigger"]),
            "citations": citations,
        }
        for source, target in ((cue, "explore_place_id"), (story, "artwork_asset_id")):
            if target in source:
                stop[target] = source[target]
        stops.append(stop)
    return {
        "schema_version": 1,
        "locale": manifest["locale"],
        "title": f"{manifest['title']} \u2014 {chapter['title']}",
        "route": copy.deepcopy(variant["route"]),
        "stops": stops,
        "assets": copy.deepcopy(manifest["assets"]),
        "offline_map": copy.deepcopy(manifest["offline_map"]),
        "safety": copy.deepcopy(chapter["safety"]),
        "access": copy.deepcopy(chapter["access"]),
        "season": copy.deepcopy(chapter["season"]),
        "review": copy.deepcopy(manifest["review"]),
    }


def normalize_original_manifest_v2(
    manifest: dict,
    *,
    pack_id: str,
    title: str,
    version: int | None,
    normalize_v1: Callable[..., tuple[dict, str]],
    publishing: bool = False,
    verified_assets: dict[str, dict] | None = None,
    validated_selections: set[str] | None = None,
    route_evidence_document: dict | None = None,
) -> tuple[dict, str]:
    """Normalize V2 and validate every selectable compilation through V1."""
    raw = copy.deepcopy(_object(manifest, "Original V2 manifest"))
    _forbid_keys(raw, {
        "schema_version", "manifest_id", "pack_id", "version", "locale", "title",
        "stories", "chapters", "assets", "offline_map", "review", "narration_profile",
        "route_evidence",
    }, "Original V2 manifest")
    if raw.get("schema_version") != 2:
        raise OriginalManifestV2Error("Original V2 manifest schema_version must be 2")
    supplied_pack = raw.get("pack_id")
    supplied_version = raw.get("version")
    if supplied_pack is not None and supplied_pack != pack_id:
        raise OriginalManifestV2Error("Original V2 pack_id does not match its authored pack")
    if supplied_version is not None and version is not None and supplied_version != version:
        raise OriginalManifestV2Error("Original V2 version does not match its immutable version")
    locale = str(raw.get("locale") or "en-US").strip()
    if not _LOCALE_RE.fullmatch(locale):
        raise OriginalManifestV2Error("Original V2 locale is invalid")
    clean_title = _text(title, "Original V2 title", 200)
    if _text(raw.get("title"), "Original V2 manifest title", 200) != clean_title:
        raise OriginalManifestV2Error("Original V2 manifest title must match its authored pack")
    raw_route_evidence = raw.get("route_evidence")
    cultural_product_id = str(
        raw_route_evidence.get("product_id")
        if isinstance(raw_route_evidence, dict)
        else pack_id
    ).strip()
    if publishing:
        try:
            validate_cultural_publication_scope(cultural_product_id)
        except OriginalCulturalReviewError as exc:
            raise OriginalManifestV2Error(str(exc)) from exc

    offline_map = copy.deepcopy(_object(raw.get("offline_map"), "Original V2 offline map"))
    _forbid_keys(offline_map, {"region_id", "bounds", "min_zoom", "max_zoom", "estimated_bytes"}, "Original V2 offline map")
    offline_map["region_id"] = _stable_id(offline_map.get("region_id"), "Original V2 offline map region id")
    union_bounds = _bounds(offline_map.get("bounds"), "Original V2 offline map bounds")
    offline_map["bounds"] = union_bounds
    for key in ("min_zoom", "max_zoom", "estimated_bytes"):
        value = offline_map.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise OriginalManifestV2Error(f"Original V2 offline map {key} is invalid")
    if offline_map["max_zoom"] < offline_map["min_zoom"] or offline_map["max_zoom"] > 24:
        raise OriginalManifestV2Error("Original V2 offline map zoom range is invalid")

    assets = [copy.deepcopy(_object(item, "Original V2 asset")) for item in _items(raw.get("assets"), "Original V2 assets", 500, required=False)]
    for asset in assets:
        _forbid_keys(asset, {"id", "kind", "path", "mime_type", "bytes", "sha256"}, "Original V2 asset")
    assets.sort(key=lambda item: _stable_id(item.get("id"), "Original V2 asset id"))
    _unique([item["id"] for item in assets], "Original V2 asset ids")
    assets_by_id = {item["id"]: item for item in assets}
    stories: list[dict] = []
    for item in _items(raw.get("stories"), "Original V2 stories", 250):
        story = copy.deepcopy(_object(item, "Original V2 story"))
        _forbid_keys(story, {
            "id", "kind", "title", "transcript", "audio_asset_id",
            "audio_duration_s", "artwork_asset_id", "citations", "variant_overrides",
        }, "Original V2 story")
        story["id"] = _stable_id(story.get("id"), "Original V2 story id")
        if story.get("kind") not in {"story", "cue"}:
            raise OriginalManifestV2Error(f"Original V2 story {story['id']} kind is invalid")
        story["title"] = _text(story.get("title"), f"Original V2 story {story['id']} title", 200)
        story["transcript"] = _text(story.get("transcript"), f"Original V2 story {story['id']} transcript", 20_000)
        story["audio_asset_id"] = _stable_id(story.get("audio_asset_id"), f"Original V2 story {story['id']} narration")
        duration = story.get("audio_duration_s")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 0 < float(duration) <= 3600:
            raise OriginalManifestV2Error(f"Original V2 story {story['id']} duration is invalid")
        story["audio_duration_s"] = float(duration)
        if not assets_by_id.get(story["audio_asset_id"], {}).get("kind") == "narration":
            raise OriginalManifestV2Error(f"Original V2 story {story['id']} must reference a narration asset")
        if story.get("artwork_asset_id") is not None:
            story["artwork_asset_id"] = _stable_id(story["artwork_asset_id"], f"Original V2 story {story['id']} artwork")
            if not assets_by_id.get(story["artwork_asset_id"], {}).get("kind") == "image":
                raise OriginalManifestV2Error(f"Original V2 story {story['id']} must reference an image asset")
        overrides: list[dict] = []
        for raw_override in _items(
            story.get("variant_overrides") or [],
            f"Original V2 story {story['id']} variant overrides",
            20,
            required=False,
        ):
            override = copy.deepcopy(_object(
                raw_override,
                f"Original V2 story {story['id']} variant override",
            ))
            _forbid_keys(override, {
                "chapter_id", "variant_id", "title", "transcript",
                "audio_asset_id", "audio_duration_s",
            }, f"Original V2 story {story['id']} variant override")
            override["chapter_id"] = _stable_id(
                override.get("chapter_id"),
                f"Original V2 story {story['id']} override chapter",
            )
            override["variant_id"] = _stable_id(
                override.get("variant_id"),
                f"Original V2 story {story['id']} override variant",
            )
            if override.get("title") is not None:
                override["title"] = _text(
                    override["title"],
                    f"Original V2 story {story['id']} override title",
                    200,
                )
            override["transcript"] = _text(
                override.get("transcript"),
                f"Original V2 story {story['id']} override transcript",
                20_000,
            )
            override["audio_asset_id"] = _stable_id(
                override.get("audio_asset_id"),
                f"Original V2 story {story['id']} override narration",
            )
            override_duration = override.get("audio_duration_s")
            if (
                isinstance(override_duration, bool)
                or not isinstance(override_duration, (int, float))
                or not 0 < float(override_duration) <= 3600
            ):
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} override duration is invalid"
                )
            override["audio_duration_s"] = float(override_duration)
            if not assets_by_id.get(override["audio_asset_id"], {}).get("kind") == "narration":
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} override must reference a narration asset"
                )
            if (
                override.get("title", story["title"]) == story["title"]
                and override["transcript"] == story["transcript"]
                and override["audio_asset_id"] == story["audio_asset_id"]
                and override["audio_duration_s"] == story["audio_duration_s"]
            ):
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} override must change its effective narration"
                )
            overrides.append(override)
        overrides.sort(key=lambda item: (item["chapter_id"], item["variant_id"]))
        _unique(
            [f"{item['chapter_id']}:{item['variant_id']}" for item in overrides],
            f"Original V2 story {story['id']} override selections",
        )
        if overrides:
            story["variant_overrides"] = overrides
        else:
            story.pop("variant_overrides", None)
        citations = _items(story.get("citations"), f"Original V2 story {story['id']} citations", 50)
        story_claim_ids: list[str] = []
        for citation in citations:
            citation = _object(citation, f"Original V2 story {story['id']} source")
            _forbid_keys(citation, {
                "title", "url", "publisher", "role", "authority", "reviewed_at",
                "rights_status", "affected_claims", "cultural_approval_record_id",
                "cultural_approval_record_sha256", "cultural_approved_at",
                "cultural_pronunciation_bundle_sha256",
            }, f"Original V2 story {story['id']} source")
            if citation.get("role") != "story" or citation.get("authority") not in {"official", "authoritative"}:
                raise OriginalManifestV2Error(f"Original V2 story {story['id']} citations must be authoritative story sources")
            _text(citation.get("publisher"), f"Original V2 story {story['id']} source publisher", 200)
            _review_date(
                citation.get("reviewed_at"),
                f"Original V2 story {story['id']} source reviewed_at",
            )
            if citation.get("rights_status") not in {
                "public_domain", "licensed", "permission_confirmed", "reference_only",
            }:
                raise OriginalManifestV2Error(f"Original V2 story {story['id']} source rights are invalid")
            claim_ids = [
                _stable_id(claim, f"Original V2 story {story['id']} affected claim")
                for claim in _items(
                    citation.get("affected_claims"),
                    f"Original V2 story {story['id']} affected claims",
                    100,
                )
            ]
            _unique(claim_ids, f"Original V2 story {story['id']} affected claims")
            story_claim_ids.extend(claim_ids)
            approval_fields = {
                "cultural_approval_record_id",
                "cultural_approval_record_sha256",
                "cultural_approved_at",
            }
            present_approval = {
                key for key in approval_fields if citation.get(key) not in (None, "")
            }
            if present_approval and present_approval != approval_fields:
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} cultural approval evidence is incomplete"
                )
            if (
                citation.get("cultural_pronunciation_bundle_sha256") not in (None, "")
                and present_approval != approval_fields
            ):
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} cultural approval evidence is incomplete"
                )
            if present_approval:
                citation["cultural_approval_record_id"] = _stable_id(
                    citation["cultural_approval_record_id"],
                    f"Original V2 story {story['id']} cultural approval record",
                )
                approval_sha = str(citation["cultural_approval_record_sha256"]).strip().lower()
                if not re.fullmatch(r"[a-f0-9]{64}", approval_sha):
                    raise OriginalManifestV2Error(
                        f"Original V2 story {story['id']} cultural approval SHA-256 is invalid"
                    )
                citation["cultural_approval_record_sha256"] = approval_sha
                citation["cultural_approved_at"] = _review_date(
                    citation["cultural_approved_at"],
                    f"Original V2 story {story['id']} cultural approval date",
                )
                if citation.get("cultural_pronunciation_bundle_sha256") not in (None, ""):
                    pronunciation_sha = str(
                        citation["cultural_pronunciation_bundle_sha256"]
                    ).strip().lower()
                    if not re.fullmatch(r"[a-f0-9]{64}", pronunciation_sha):
                        raise OriginalManifestV2Error(
                            f"Original V2 story {story['id']} cultural pronunciation SHA-256 is invalid"
                        )
                    citation["cultural_pronunciation_bundle_sha256"] = pronunciation_sha
            try:
                validate_cultural_claim_approval(
                    product_id=cultural_product_id,
                    story_id=story["id"],
                    transcript_sha256=hashlib.sha256(
                        story["transcript"].encode("utf-8")
                    ).hexdigest(),
                    claim_ids=claim_ids,
                    approval_record_id=citation.get("cultural_approval_record_id"),
                    approval_record_sha256=citation.get(
                        "cultural_approval_record_sha256"
                    ),
                    approved_at=citation.get("cultural_approved_at"),
                    pronunciation_bundle_sha256=citation.get(
                        "cultural_pronunciation_bundle_sha256"
                    ),
                )
                for override in overrides:
                    validate_cultural_claim_approval(
                        product_id=cultural_product_id,
                        story_id=story["id"],
                        transcript_sha256=hashlib.sha256(
                            override["transcript"].encode("utf-8")
                        ).hexdigest(),
                        claim_ids=claim_ids,
                        approval_record_id=citation.get("cultural_approval_record_id"),
                        approval_record_sha256=citation.get(
                            "cultural_approval_record_sha256"
                        ),
                        approved_at=citation.get("cultural_approved_at"),
                        pronunciation_bundle_sha256=citation.get(
                            "cultural_pronunciation_bundle_sha256"
                        ),
                    )
            except OriginalCulturalReviewError as exc:
                raise OriginalManifestV2Error(str(exc)) from exc
        try:
            validate_cultural_story_claims(
                product_id=cultural_product_id,
                story_id=story["id"],
                claim_ids=story_claim_ids,
            )
        except OriginalCulturalReviewError as exc:
            raise OriginalManifestV2Error(str(exc)) from exc
        stories.append(story)
    stories.sort(key=lambda item: item["id"])
    _unique([item["id"] for item in stories], "Original V2 story ids")
    stories_by_id = {item["id"]: item for item in stories}

    raw_chapters = _items(raw.get("chapters"), "Original V2 chapters", 20)
    chapter_ids = [_stable_id(_object(item, "Original V2 chapter").get("id"), "Original V2 chapter id") for item in raw_chapters]
    _unique(chapter_ids, "Original V2 chapter ids")
    chapters: list[dict] = []
    referenced: set[str] = set()
    selection_ids: list[str] = []
    required_validation_selections: set[str] = set()
    for raw_chapter, chapter_id in zip(raw_chapters, chapter_ids):
        chapter = copy.deepcopy(raw_chapter)
        _forbid_keys(chapter, {
            "id", "sequence", "title", "summary", "default_variant_id", "safety",
            "access", "season", "operational_sources", "operational_readiness",
            "validation_selection", "variants",
        }, "Original V2 chapter")
        chapter["id"] = chapter_id
        chapter["sequence"] = _sequence(chapter.get("sequence"), f"Original V2 chapter {chapter_id} sequence")
        chapter["title"] = _text(chapter.get("title"), f"Original V2 chapter {chapter_id} title", 200)
        chapter["summary"] = _text(chapter.get("summary"), f"Original V2 chapter {chapter_id} summary", 2000)
        chapter_objects = {
            "safety": {"summary", "emergency_note", "disclaimers"},
            "access": {"surface", "vehicle", "fees", "accessibility_notes"},
            "season": {"recommended_months", "closures_note"},
        }
        for key, allowed_fields in chapter_objects.items():
            label = f"Original V2 chapter {chapter_id} {key}"
            chapter[key] = copy.deepcopy(_object(chapter.get(key), label))
            _forbid_keys(chapter[key], allowed_fields, label)
        sources = _items(chapter.get("operational_sources"), f"Original V2 chapter {chapter_id} operational sources", 100)
        available_scopes: set[str] = set()
        for source in sources:
            source = _object(source, f"Original V2 chapter {chapter_id} operational source")
            _forbid_keys(source, {
                "title", "url", "publisher", "reviewed_at", "role", "authority", "scope",
            }, f"Original V2 chapter {chapter_id} operational source")
            if source.get("role") != "operational" or source.get("authority") not in {"official", "authoritative"}:
                raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} operational source is invalid")
            _review_date(
                source.get("reviewed_at"),
                f"Original V2 chapter {chapter_id} source reviewed_at",
            )
            for scope in _items(source.get("scope"), f"Original V2 chapter {chapter_id} source scopes", 20):
                available_scopes.add(_stable_id(scope, f"Original V2 chapter {chapter_id} source scope"))
        readiness = _object(chapter.get("operational_readiness"), f"Original V2 chapter {chapter_id} readiness")
        _forbid_keys(readiness, {
            "policy", "candidate_id", "candidate_sha256", "source_scopes",
            "alternate_chapter_ids",
        }, f"Original V2 chapter {chapter_id} readiness")
        if readiness.get("policy") != "required_before_start":
            raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} readiness policy is invalid")
        readiness["candidate_id"] = _stable_id(
            readiness.get("candidate_id"),
            f"Original V2 chapter {chapter_id} operational candidate id",
        )
        candidate_sha256 = str(readiness.get("candidate_sha256") or "").strip().lower()
        if not re.fullmatch(r"[a-f0-9]{64}", candidate_sha256):
            raise OriginalManifestV2Error(
                f"Original V2 chapter {chapter_id} operational candidate SHA-256 is invalid"
            )
        readiness["candidate_sha256"] = candidate_sha256
        readiness_scopes = [_stable_id(scope, f"Original V2 chapter {chapter_id} readiness scope") for scope in _items(readiness.get("source_scopes"), f"Original V2 chapter {chapter_id} readiness scopes", 20)]
        if not set(readiness_scopes).issubset(available_scopes):
            raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} readiness lacks a source")
        alternate_ids = [_stable_id(item, f"Original V2 chapter {chapter_id} alternate") for item in _items(readiness.get("alternate_chapter_ids"), f"Original V2 chapter {chapter_id} alternates", 20, required=False)]
        if chapter_id in alternate_ids or not set(alternate_ids).issubset(set(chapter_ids)):
            raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} alternate is invalid")
        if publishing:
            try:
                validate_manifest_operational_binding(
                    chapter_id=chapter_id,
                    operational_sources=sources,
                    operational_readiness=readiness,
                    require_current=True,
                )
            except OriginalOperationalReadinessError as exc:
                raise OriginalManifestV2Error(str(exc)) from exc
        variants: list[dict] = []
        for raw_variant in _items(chapter.get("variants"), f"Original V2 chapter {chapter_id} variants", 10):
            variant = copy.deepcopy(_object(raw_variant, f"Original V2 chapter {chapter_id} variant"))
            _forbid_keys(variant, {"id", "sequence", "title", "route", "cue_refs"}, f"Original V2 chapter {chapter_id} variant")
            variant["id"] = _stable_id(variant.get("id"), f"Original V2 chapter {chapter_id} variant id")
            variant["sequence"] = _sequence(variant.get("sequence"), f"Original V2 variant {variant['id']} sequence")
            variant["title"] = _text(variant.get("title"), f"Original V2 variant {variant['id']} title", 200)
            route_label = f"Original V2 variant {variant['id']} route"
            variant["route"] = copy.deepcopy(_object(variant.get("route"), route_label))
            _forbid_keys(
                variant["route"],
                {"profile", "direction", "geometry", "bounds", "distance_m", "duration_s"},
                route_label,
            )
            route_bounds = _bounds(variant["route"].get("bounds"), f"Original V2 variant {variant['id']} route bounds")
            if (
                route_bounds["north"] > union_bounds["north"]
                or route_bounds["south"] < union_bounds["south"]
                or route_bounds["east"] > union_bounds["east"]
                or route_bounds["west"] < union_bounds["west"]
            ):
                raise OriginalManifestV2Error(f"Original V2 variant {variant['id']} route is outside the union offline map")
            geometry_label = f"Original V2 variant {variant['id']} geometry"
            geometry = _object(variant["route"].get("geometry"), geometry_label)
            _forbid_keys(geometry, {"type", "coordinates"}, geometry_label)
            for coordinate in _items(geometry.get("coordinates"), f"Original V2 variant {variant['id']} coordinates", 20_000):
                if not isinstance(coordinate, list) or len(coordinate) != 2:
                    raise OriginalManifestV2Error(f"Original V2 variant {variant['id']} coordinate is invalid")
                _bounds_contains(union_bounds, coordinate[0], coordinate[1], f"Original V2 variant {variant['id']} route")
            cues: list[dict] = []
            for raw_cue in _items(variant.get("cue_refs"), f"Original V2 variant {variant['id']} cue refs", 250):
                cue = copy.deepcopy(_object(raw_cue, f"Original V2 variant {variant['id']} cue"))
                _forbid_keys(cue, {"story_id", "sequence", "coordinates", "explore_place_id", "trigger"}, f"Original V2 variant {variant['id']} cue")
                cue["story_id"] = _stable_id(cue.get("story_id"), f"Original V2 variant {variant['id']} story id")
                if cue["story_id"] not in stories_by_id:
                    raise OriginalManifestV2Error(f"Original V2 variant {variant['id']} references an unknown story")
                cue["sequence"] = _sequence(cue.get("sequence"), f"Original V2 variant {variant['id']} cue sequence")
                coordinate_label = f"Original V2 variant {variant['id']} cue coordinates"
                cue["coordinates"] = copy.deepcopy(_object(cue.get("coordinates"), coordinate_label))
                _forbid_keys(cue["coordinates"], {"lat", "lng"}, coordinate_label)
                _bounds_contains(
                    union_bounds,
                    cue["coordinates"].get("lng"),
                    cue["coordinates"].get("lat"),
                    f"Original V2 variant {variant['id']} cue",
                )
                trigger_label = f"Original V2 variant {variant['id']} cue trigger"
                cue["trigger"] = copy.deepcopy(_object(cue.get("trigger"), trigger_label))
                _forbid_keys(cue["trigger"], {
                    "enter_radius_m", "exit_radius_m", "lead_time_s",
                    "route_progress_start_m", "route_progress_end_m",
                    "approach_bearing_deg", "bearing_tolerance_deg",
                }, trigger_label)
                cues.append(cue)
                referenced.add(cue["story_id"])
            variant["cue_refs"] = _ordered(cues, f"Original V2 variant {variant['id']} cue")
            _unique([cue["story_id"] for cue in cues], f"Original V2 variant {variant['id']} story references")
            variants.append(variant)
        chapter["variants"] = _ordered(variants, f"Original V2 chapter {chapter_id} variant")
        variant_ids = [variant["id"] for variant in chapter["variants"]]
        _unique(variant_ids, f"Original V2 chapter {chapter_id} variant ids")
        chapter["default_variant_id"] = _stable_id(chapter.get("default_variant_id"), f"Original V2 chapter {chapter_id} default variant")
        if chapter["default_variant_id"] not in variant_ids:
            raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} default variant is unknown")
        validation = _object(chapter.get("validation_selection"), f"Original V2 chapter {chapter_id} validation selection")
        _forbid_keys(validation, {"selection_id", "required_variant_ids"}, f"Original V2 chapter {chapter_id} validation selection")
        validation["selection_id"] = _stable_id(validation.get("selection_id"), f"Original V2 chapter {chapter_id} validation selection id")
        selection_ids.append(validation["selection_id"])
        required_variants = [_stable_id(item, f"Original V2 chapter {chapter_id} required variant") for item in _items(validation.get("required_variant_ids"), f"Original V2 chapter {chapter_id} required variants", 10)]
        if sorted(required_variants) != sorted(variant_ids):
            raise OriginalManifestV2Error(f"Original V2 chapter {chapter_id} validation must include every variant")
        required_validation_selections.update(
            f"{validation['selection_id']}:{variant_id}"
            for variant_id in required_variants
        )
        chapters.append(chapter)
    chapters = _ordered(chapters, "Original V2 chapter")
    _unique(selection_ids, "Original V2 validation selection ids")
    if publishing and set(validated_selections or ()) != required_validation_selections:
        raise OriginalManifestV2Error(
            "OriginalManifestV2 publication requires authoritative validation for every chapter variant"
        )
    if set(stories_by_id) != referenced:
        raise OriginalManifestV2Error("Every Original V2 story must be referenced by at least one variant")
    known_selections = {
        f"{chapter['id']}:{variant['id']}"
        for chapter in chapters
        for variant in chapter["variants"]
    }
    story_selections = {
        story_id: {
            f"{chapter['id']}:{variant['id']}"
            for chapter in chapters
            for variant in chapter["variants"]
            if any(cue["story_id"] == story_id for cue in variant["cue_refs"])
        }
        for story_id in stories_by_id
    }
    for story in stories:
        for override in story.get("variant_overrides", []):
            selection = f"{override['chapter_id']}:{override['variant_id']}"
            if selection not in known_selections:
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} override references an unknown chapter route variant"
                )
            if selection not in story_selections[story["id"]]:
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} override is unused by that route variant"
                )
    review = copy.deepcopy(_object(raw.get("review"), "Original V2 review"))
    _forbid_keys(review, {
        "editorial_status", "field_drive_completed_at", "source_review_completed_at",
        "route_network_override",
    }, "Original V2 review")
    if review.get("route_network_override") is not None:
        override_label = "Original V2 review route_network_override"
        override = copy.deepcopy(_object(review["route_network_override"], override_label))
        _forbid_keys(override, {
            "schema_version", "status", "finding_codes", "reason",
            "official_source_url", "approved_at", "approved_by_admin_user_id",
        }, override_label)
        review["route_network_override"] = override

    result = {
        "schema_version": 2,
        "locale": locale,
        "title": clean_title,
        "stories": stories,
        "chapters": chapters,
        "assets": assets,
        "offline_map": offline_map,
        "review": review,
    }
    try:
        route_evidence = normalize_route_evidence_binding(
            raw.get("route_evidence"), required=publishing,
        )
        if route_evidence is not None:
            result["route_evidence"] = route_evidence
        if publishing:
            validate_manifest_route_evidence(
                result,
                route_evidence,
                expected_product_id=pack_id,
                evidence_document=route_evidence_document,
            )
    except OriginalRouteEvidenceError as exc:
        raise OriginalManifestV2Error(str(exc)) from exc
    narration_profile = _profile(raw.get("narration_profile"), required=publishing)
    if narration_profile is not None:
        expected_mime = narration_profile["mobile_delivery"]["mime_type"]
        narration_asset_ids: set[str] = set()
        for story in stories:
            narration_ids = [story["audio_asset_id"]] + [
                override["audio_asset_id"]
                for override in story.get("variant_overrides", [])
            ]
            narration_asset_ids.update(narration_ids)
            if any(
                assets_by_id[asset_id].get("mime_type") != expected_mime
                for asset_id in narration_ids
            ):
                raise OriginalManifestV2Error(
                    f"Original V2 story {story['id']} narration format does not match its profile"
                )
        if publishing and narration_profile.get("schema_version") == 2:
            for asset_id in sorted(narration_asset_ids):
                validate_original_narration_profile_asset(
                    narration_profile,
                    (verified_assets or {}).get(asset_id),
                    label=f"Original narration asset {asset_id}",
                )
        result["narration_profile"] = narration_profile
    if version is not None:
        result.update({"manifest_id": f"original_manifest_{pack_id}_v{version}", "pack_id": pack_id, "version": version})
    for chapter in chapters:
        for variant in chapter["variants"]:
            normalize_v1(
                pack_id,
                f"{clean_title} \u2014 {chapter['title']}",
                _compile(result, chapter, variant, stories_by_id),
                version=version,
                publishing=publishing,
                verified_assets=verified_assets,
            )
    encoded = json.dumps(result, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    if len(encoded.encode()) > _MAX_BYTES:
        raise OriginalManifestV2Error("Original V2 manifest exceeds the size limit")
    return result, encoded


def compile_original_manifest_v2_selection(
    manifest: dict,
    *,
    chapter_id: str,
    variant_id: str | None,
    normalize_v1: Callable[..., tuple[dict, str]],
    publishing: bool = False,
    verified_assets: dict[str, dict] | None = None,
) -> dict:
    if manifest.get("schema_version") != 2:
        raise OriginalManifestV2Error("Original V2 manifest is required")
    chapter = next((item for item in manifest.get("chapters", []) if item.get("id") == chapter_id), None)
    if not chapter:
        raise OriginalManifestV2Error("Original V2 chapter selection was not found")
    chosen = variant_id or chapter.get("default_variant_id")
    variant = next((item for item in chapter.get("variants", []) if item.get("id") == chosen), None)
    if not variant:
        raise OriginalManifestV2Error("Original V2 route variant selection was not found")
    compiled = _compile(manifest, chapter, variant, {item["id"]: item for item in manifest["stories"]})
    normalized, _ = normalize_v1(manifest.get("pack_id") or "draft_original", compiled["title"], compiled, version=manifest.get("version"), publishing=publishing, verified_assets=verified_assets)
    # The union bundle retains one immutable pack/version/manifest identity.
    # Future V2 session persistence must key progress by this explicit selection.
    if manifest.get("manifest_id"):
        normalized["manifest_id"] = manifest["manifest_id"]
    return {
        "selection": {
            "validation_selection_id": chapter["validation_selection"]["selection_id"],
            "chapter_id": chapter_id,
            "variant_id": chosen,
        },
        "manifest": normalized,
    }


def original_manifest_v2_preview(manifest: dict) -> dict:
    stories = {item.get("id"): item for item in manifest.get("stories", []) if isinstance(item, dict)}
    chapters = []
    for chapter in manifest.get("chapters", []):
        variants = []
        for variant in chapter.get("variants", []):
            cues = [item for item in variant.get("cue_refs", []) if isinstance(item, dict)]
            variants.append({
                "id": variant.get("id"), "sequence": variant.get("sequence"), "title": variant.get("title"),
                "direction": (variant.get("route") or {}).get("direction"),
                "distance_m": (variant.get("route") or {}).get("distance_m"),
                "duration_s": (variant.get("route") or {}).get("duration_s"),
                "story_count": sum(stories.get(cue.get("story_id"), {}).get("kind") == "story" for cue in cues),
                "cue_count": sum(stories.get(cue.get("story_id"), {}).get("kind") == "cue" for cue in cues),
            })
        chapters.append({
            "id": chapter.get("id"), "sequence": chapter.get("sequence"), "title": chapter.get("title"),
            "summary": chapter.get("summary"), "default_variant_id": chapter.get("default_variant_id"),
            "variants": variants,
        })
    offline = manifest.get("offline_map") if isinstance(manifest.get("offline_map"), dict) else {}
    preview = {
        "schema_version": 2,
        **{key: manifest[key] for key in ("manifest_id", "pack_id", "version", "locale", "title") if key in manifest},
        "chapters": chapters,
        "offline_map": {key: offline[key] for key in ("region_id", "bounds", "min_zoom", "max_zoom", "estimated_bytes") if key in offline},
    }
    route_evidence = manifest.get("route_evidence")
    if isinstance(route_evidence, dict):
        preview["route_evidence"] = {
            key: route_evidence[key]
            for key in (
                "schema_version", "evidence_id", "evidence_sha256", "product_id",
                "route_spec_sha256", "source_snapshot_sha256",
            )
            if key in route_evidence
        }
    return preview


def original_manifest_v2_operational_bindings(manifest: dict) -> list[dict]:
    """Return deterministic chapter-to-candidate bindings for validation metadata."""

    if int(manifest.get("schema_version") or 0) != 2:
        return []
    bindings = []
    for chapter in manifest.get("chapters") or []:
        readiness = chapter.get("operational_readiness") or {}
        bindings.append({
            "chapter_id": str(chapter.get("id") or ""),
            "candidate_id": str(readiness.get("candidate_id") or ""),
            "candidate_sha256": str(readiness.get("candidate_sha256") or "").lower(),
        })
    return sorted(
        bindings,
        key=lambda item: (
            item["chapter_id"], item["candidate_id"], item["candidate_sha256"],
        ),
    )
