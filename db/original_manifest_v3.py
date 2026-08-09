"""Capability-gated long-form Originals manifest normalization.

V3 retains V2's authored bundle shape but splits must-play route cues from
longer selectable material. Only cue_refs are compiled into the V1 trigger
runtime; selectable_refs are returned in a separate scheduler sidecar.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from db.original_manifest_v2 import (
    OriginalManifestV2Error,
    normalize_original_manifest_v2,
    validate_original_narration_profile_asset,
)
from db.original_manifest_v2 import (
    _compile as _compile_v2,
)
from db.originals_cultural_review import (
    OriginalCulturalReviewError,
    validate_cultural_publication_scope,
)
from db.originals_operational import (
    OriginalOperationalReadinessError,
    validate_manifest_operational_binding,
)
from db.originals_route_evidence import (
    OriginalRouteEvidenceError,
    validate_manifest_route_evidence,
)


class OriginalManifestV3Error(ValueError):
    pass


ORIGINAL_LONG_FORM_CONTRACT_ID = "originals_long_form_delivery_v1"
ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES = [
    "originals_capacity_scheduler_v1",
    "originals_manifest_v3",
    "originals_selectable_v1",
]

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$")
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_MAX_BYTES = 8 * 1024 * 1024
_STORY_SOURCE_MAX_AGE_DAYS = 180
_TRIGGER_KEYS = {
    "enter_radius_m", "exit_radius_m", "lead_time_s",
    "route_progress_start_m", "route_progress_end_m",
    "approach_bearing_deg", "bearing_tolerance_deg",
}


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise OriginalManifestV3Error(f"{label} must be an object")
    return value


def _forbid_keys(value: dict, allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    if extra:
        raise OriginalManifestV3Error(
            f"{label} contains unsupported fields: {', '.join(extra)}"
        )


def _stable_id(value: object, label: str) -> str:
    clean = str(value or "").strip()
    if not _ID_RE.fullmatch(clean):
        raise OriginalManifestV3Error(f"{label} must be a stable identifier")
    return clean


def _sequence(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise OriginalManifestV3Error(f"{label} must be a positive integer")
    return value


def _number(
    value: object,
    label: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OriginalManifestV3Error(f"{label} must be a number")
    clean = float(value)
    if minimum is not None and clean < minimum:
        raise OriginalManifestV3Error(f"{label} is below its minimum")
    if maximum is not None and clean > maximum:
        raise OriginalManifestV3Error(f"{label} exceeds its maximum")
    return clean


def _coordinates(value: object, label: str) -> dict[str, float]:
    raw = _object(value, label)
    _forbid_keys(raw, {"lat", "lng"}, label)
    return {
        "lat": _number(raw.get("lat"), f"{label} latitude", minimum=-90, maximum=90),
        "lng": _number(raw.get("lng"), f"{label} longitude", minimum=-180, maximum=180),
    }


def _trigger(value: object, label: str) -> dict[str, float]:
    raw = copy.deepcopy(_object(value, label))
    _forbid_keys(raw, _TRIGGER_KEYS, label)
    enter = _number(raw.get("enter_radius_m"), f"{label} enter radius", minimum=50, maximum=1000)
    exit_radius = _number(raw.get("exit_radius_m"), f"{label} exit radius", minimum=enter)
    if exit_radius < max(enter * 1.5, enter + 50):
        raise OriginalManifestV3Error(f"{label} exit radius must provide route hysteresis")
    start = _number(raw.get("route_progress_start_m"), f"{label} progress start", minimum=0)
    end = _number(raw.get("route_progress_end_m"), f"{label} progress end", minimum=start)
    clean = {
        "enter_radius_m": enter,
        "exit_radius_m": exit_radius,
        "lead_time_s": _number(raw.get("lead_time_s", 0), f"{label} lead time", minimum=0, maximum=120),
        "route_progress_start_m": start,
        "route_progress_end_m": end,
    }
    bearing = raw.get("approach_bearing_deg")
    tolerance = raw.get("bearing_tolerance_deg")
    if bearing is not None:
        clean["approach_bearing_deg"] = _number(
            bearing, f"{label} approach bearing", minimum=0, maximum=359.999999,
        )
        clean["bearing_tolerance_deg"] = _number(
            45 if tolerance is None else tolerance,
            f"{label} bearing tolerance", minimum=1, maximum=180,
        )
    elif tolerance is not None:
        raise OriginalManifestV3Error(f"{label} bearing tolerance requires an approach bearing")
    return clean


def _literal_bool(value: object, expected: bool, label: str) -> bool:
    if value is not expected:
        raise OriginalManifestV3Error(f"{label} must be {str(expected).lower()}")
    return expected


def _consumer_contract(value: object) -> dict:
    raw = copy.deepcopy(_object(value, "Original V3 consumer_contract"))
    _forbid_keys(
        raw,
        {"schema_version", "contract_id", "required_capabilities"},
        "Original V3 consumer_contract",
    )
    if raw.get("schema_version") != 1:
        raise OriginalManifestV3Error("Original V3 consumer contract schema_version must be 1")
    if raw.get("contract_id") != ORIGINAL_LONG_FORM_CONTRACT_ID:
        raise OriginalManifestV3Error("Original V3 consumer contract id is unsupported")
    if raw.get("required_capabilities") != ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES:
        raise OriginalManifestV3Error(
            "Original V3 required capabilities must match the canonical sorted capability set"
        )
    return {
        "schema_version": 1,
        "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
        "required_capabilities": list(ORIGINAL_LONG_FORM_REQUIRED_CAPABILITIES),
    }


def _hard_ref(value: object, label: str) -> dict:
    raw = copy.deepcopy(_object(value, label))
    _forbid_keys(
        raw,
        {"story_id", "sequence", "coordinates", "explore_place_id", "trigger"},
        label,
    )
    result = {
        "story_id": _stable_id(raw.get("story_id"), f"{label} story id"),
        "sequence": _sequence(raw.get("sequence"), f"{label} sequence"),
        "coordinates": _coordinates(raw.get("coordinates"), f"{label} coordinates"),
        "trigger": _trigger(raw.get("trigger"), f"{label} trigger"),
    }
    if raw.get("explore_place_id") is not None:
        result["explore_place_id"] = _stable_id(
            raw["explore_place_id"], f"{label} Explore place id",
        )
    return result


def _selectable_ref(value: object, label: str) -> dict:
    raw = copy.deepcopy(_object(value, label))
    _forbid_keys(
        raw,
        {"story_id", "sequence", "coordinates", "explore_place_id", "trigger", "delivery"},
        label,
    )
    result: dict[str, Any] = {
        "story_id": _stable_id(raw.get("story_id"), f"{label} story id"),
        "sequence": _sequence(raw.get("sequence"), f"{label} sequence"),
    }
    if raw.get("coordinates") is not None:
        result["coordinates"] = _coordinates(raw["coordinates"], f"{label} coordinates")
    if raw.get("explore_place_id") is not None:
        result["explore_place_id"] = _stable_id(
            raw["explore_place_id"], f"{label} Explore place id",
        )
    delivery = copy.deepcopy(_object(raw.get("delivery"), f"{label} delivery"))
    mode = delivery.get("mode")
    if mode == "capacity_deeper":
        _forbid_keys(delivery, {
            "mode", "admission_policy_id", "next_hard_auto_story_id",
            "guard_before_next_hard_auto_window_s", "fallback_mode",
            "may_queue_behind_capacity", "may_wait_for_active_hard_auto",
        }, f"{label} delivery")
        if "coordinates" not in result or raw.get("trigger") is None:
            raise OriginalManifestV3Error(
                f"{label} capacity delivery requires coordinates and a trigger"
            )
        result["trigger"] = _trigger(raw["trigger"], f"{label} trigger")
        if delivery.get("admission_policy_id") != "capacity_before_next_hard_v1":
            raise OriginalManifestV3Error(f"{label} capacity admission policy is unsupported")
        if delivery.get("fallback_mode") != "completion_deeper":
            raise OriginalManifestV3Error(f"{label} capacity fallback must be completion_deeper")
        if delivery.get("guard_before_next_hard_auto_window_s") != 30:
            raise OriginalManifestV3Error(f"{label} capacity guard must be 30 seconds")
        result["delivery"] = {
            "mode": "capacity_deeper",
            "admission_policy_id": "capacity_before_next_hard_v1",
            "next_hard_auto_story_id": _stable_id(
                delivery.get("next_hard_auto_story_id"), f"{label} next hard-auto story id",
            ),
            "guard_before_next_hard_auto_window_s": 30,
            "fallback_mode": "completion_deeper",
            "may_queue_behind_capacity": _literal_bool(
                delivery.get("may_queue_behind_capacity"), False,
                f"{label} may_queue_behind_capacity",
            ),
            "may_wait_for_active_hard_auto": _literal_bool(
                delivery.get("may_wait_for_active_hard_auto"), True,
                f"{label} may_wait_for_active_hard_auto",
            ),
        }
    elif mode == "stopped_deeper":
        _forbid_keys(delivery, {
            "mode", "availability", "experience_group_id",
            "requires_user_confirmed_parked", "motion_inference_allowed",
            "parking_availability", "parking_promise", "availability_radius_m",
        }, f"{label} delivery")
        if raw.get("trigger") is not None:
            raise OriginalManifestV3Error(f"{label} stopped delivery cannot have a trigger")
        availability = delivery.get("availability")
        if availability not in {
            "before_route_user_confirmed_parked", "at_landmark_user_confirmed_parked",
        }:
            raise OriginalManifestV3Error(f"{label} stopped availability is unsupported")
        if availability == "at_landmark_user_confirmed_parked":
            if "coordinates" not in result:
                raise OriginalManifestV3Error(
                    f"{label} landmark stopped delivery requires coordinates"
                )
            availability_radius_m = _number(
                delivery.get("availability_radius_m"),
                f"{label} availability radius",
                minimum=50,
                maximum=1000,
            )
        else:
            if delivery.get("availability_radius_m") is not None:
                raise OriginalManifestV3Error(
                    f"{label} before-route stopped delivery cannot have an availability radius"
                )
            availability_radius_m = None
        stopped = {
            "mode": "stopped_deeper",
            "availability": availability,
            "requires_user_confirmed_parked": _literal_bool(
                delivery.get("requires_user_confirmed_parked"), True,
                f"{label} requires_user_confirmed_parked",
            ),
            "motion_inference_allowed": _literal_bool(
                delivery.get("motion_inference_allowed"), False,
                f"{label} motion_inference_allowed",
            ),
            "parking_availability": delivery.get("parking_availability"),
            "parking_promise": _literal_bool(
                delivery.get("parking_promise"), False, f"{label} parking_promise",
            ),
        }
        if stopped["parking_availability"] != "not_checked":
            raise OriginalManifestV3Error(f"{label} parking availability must be not_checked")
        if availability_radius_m is not None:
            stopped["availability_radius_m"] = availability_radius_m
        if delivery.get("experience_group_id") is not None:
            stopped["experience_group_id"] = _stable_id(
                delivery["experience_group_id"], f"{label} experience group id",
            )
        result["delivery"] = stopped
    elif mode == "completion_deeper":
        _forbid_keys(
            delivery, {"mode", "availability", "requires_route_completion"},
            f"{label} delivery",
        )
        if raw.get("trigger") is not None:
            raise OriginalManifestV3Error(f"{label} completion delivery cannot have a trigger")
        if delivery.get("availability") != "after_route_completion":
            raise OriginalManifestV3Error(f"{label} completion availability is unsupported")
        result["delivery"] = {
            "mode": "completion_deeper",
            "availability": "after_route_completion",
            "requires_route_completion": _literal_bool(
                delivery.get("requires_route_completion"), True,
                f"{label} requires_route_completion",
            ),
        }
    else:
        raise OriginalManifestV3Error(f"{label} delivery mode is unsupported")
    return result


def _effective_story(story: dict, chapter_id: str, variant_id: str) -> dict:
    override = next((
        item for item in story.get("variant_overrides", [])
        if item.get("chapter_id") == chapter_id and item.get("variant_id") == variant_id
    ), None)
    if override is None:
        return copy.deepcopy(story)
    result = copy.deepcopy(story)
    result.update({
        "title": override.get("title", story["title"]),
        "transcript": override["transcript"],
        "audio_asset_id": override["audio_asset_id"],
        "audio_duration_s": override["audio_duration_s"],
    })
    return result


def _geometry_sha256(route: dict) -> str:
    canonical = ";".join(
        f"{float(point[0]):.7f},{float(point[1]):.7f}"
        for point in ((route.get("geometry") or {}).get("coordinates") or [])
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _verified_metadata(value: object, label: str) -> dict:
    if isinstance(value, dict):
        return copy.deepcopy(value)
    try:
        decoded = json.loads(str(value or "{}"))
    except json.JSONDecodeError as exc:
        raise OriginalManifestV3Error(f"{label} is invalid") from exc
    if not isinstance(decoded, dict):
        raise OriginalManifestV3Error(f"{label} is invalid")
    return decoded


def _transcript_sha256(value: object) -> str:
    normalized = " ".join(str(value or "").split())
    if not normalized:
        raise OriginalManifestV3Error("Original V3 narration transcript is required")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _generator_license_is_attested(metadata: dict) -> bool:
    if metadata.get("license_status") != "attested":
        return False
    attestation = metadata.get("license_attestation")
    if not isinstance(attestation, dict):
        return False
    if (
        not str(attestation.get("terms_id") or "").strip()
        or not str(attestation.get("terms_url") or "").strip().startswith("https://")
        or not str(attestation.get("terms_version") or "").strip()
    ):
        return False
    admin_id = attestation.get("attested_by_admin_user_id")
    if isinstance(admin_id, bool) or not isinstance(admin_id, int) or admin_id < 1:
        return False
    try:
        reviewed_raw = str(attestation.get("reviewed_at") or "").strip()
        reviewed = (
            datetime.fromisoformat(
                reviewed_raw[:-1] + "+00:00"
                if reviewed_raw.endswith("Z") else reviewed_raw
            ).date()
            if "T" in reviewed_raw else date.fromisoformat(reviewed_raw)
        )
        attested_raw = str(attestation.get("attested_at") or "").strip()
        attested = datetime.fromisoformat(
            attested_raw[:-1] + "+00:00"
            if attested_raw.endswith("Z") else attested_raw
        )
    except (TypeError, ValueError):
        return False
    now = datetime.now(timezone.utc)
    return (
        attested.tzinfo is not None
        and reviewed.year >= 2000
        and reviewed <= now.date()
        and attested.year >= 2000
        and attested.astimezone(timezone.utc) <= now + timedelta(minutes=5)
    )


def _validate_selectable_publication_parity(
    manifest: dict,
    verified_assets: dict[str, dict] | None,
) -> None:
    """Apply V1 media/source publication gates to every effective V3 optional item."""
    verified_assets = verified_assets or {}
    assets = {str(item.get("id") or ""): item for item in manifest.get("assets", [])}
    stories = {str(item.get("id") or ""): item for item in manifest.get("stories", [])}
    profile = manifest.get("narration_profile")
    if not isinstance(profile, dict):
        raise OriginalManifestV3Error(
            "Original V3 narration_profile is required before publishing"
        )
    today = date.today()
    for chapter in manifest.get("chapters", []):
        chapter_id = str(chapter.get("id") or "")
        for variant in chapter.get("variants", []):
            variant_id = str(variant.get("id") or "")
            for reference in variant.get("selectable_refs", []):
                story = stories.get(str(reference.get("story_id") or ""))
                if not isinstance(story, dict):
                    raise OriginalManifestV3Error(
                        "Original V3 selectable story is unavailable"
                    )
                resolved = _effective_story(story, chapter_id, variant_id)
                story_id = str(resolved.get("id") or "")
                citations = resolved.get("citations")
                if not isinstance(citations, list) or not citations:
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} needs an authoritative story citation"
                    )
                has_story_source = False
                for citation in citations:
                    if not isinstance(citation, dict):
                        raise OriginalManifestV3Error(
                            f"Original V3 selectable story {story_id} citation is invalid"
                        )
                    if not str(citation.get("publisher") or "").strip():
                        raise OriginalManifestV3Error(
                            f"Original V3 selectable story {story_id} citations need an explicit publisher"
                        )
                    if (
                        citation.get("role") != "story"
                        or citation.get("authority") not in {"official", "authoritative"}
                    ):
                        raise OriginalManifestV3Error(
                            f"Original V3 selectable story {story_id} citations must be authoritative story sources"
                        )
                    try:
                        reviewed = date.fromisoformat(
                            str(citation.get("reviewed_at") or "")[:10]
                        )
                    except ValueError as exc:
                        raise OriginalManifestV3Error(
                            f"Original V3 selectable story {story_id} source reviewed_at is invalid"
                        ) from exc
                    if reviewed > today or reviewed < today - timedelta(
                        days=_STORY_SOURCE_MAX_AGE_DAYS
                    ):
                        raise OriginalManifestV3Error(
                            f"Original V3 selectable story {story_id} source review is too old to publish"
                        )
                    has_story_source = True
                if not has_story_source:
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} needs an authoritative story citation"
                    )

                narration_id = str(resolved.get("audio_asset_id") or "")
                narration = assets.get(narration_id)
                verified = verified_assets.get(narration_id)
                if (
                    not isinstance(narration, dict)
                    or narration.get("kind") != "narration"
                    or not str(narration.get("mime_type") or "").startswith("audio/")
                    or not isinstance(verified, dict)
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} needs a verified narration upload"
                    )
                expected = {
                    "kind": verified.get("kind"),
                    "path": verified.get("public_path"),
                    "mime_type": verified.get("mime_type"),
                    "bytes": int(verified.get("byte_count") or 0),
                    "sha256": verified.get("sha256"),
                }
                if any(narration.get(key) != value for key, value in expected.items()):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} narration does not match its verified upload"
                    )
                if verified.get("transcript_sha256") != _transcript_sha256(
                    resolved.get("transcript")
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} narration does not match its reviewed transcript"
                    )
                media = _verified_metadata(
                    verified.get("media_metadata_json"),
                    f"Original V3 selectable story {story_id} narration metadata",
                )
                probed_duration = float(media.get("duration_s") or 0)
                manifest_duration = float(resolved.get("audio_duration_s") or 0)
                if (
                    probed_duration <= 0
                    or abs(manifest_duration - probed_duration)
                    > max(0.25, probed_duration * 0.05)
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} narration duration does not match its verified audio"
                    )
                generator = _verified_metadata(
                    verified.get("generator_metadata_json"),
                    f"Original V3 selectable story {story_id} narration generator metadata",
                )
                provider = str(generator.get("provider") or "").strip().lower()
                model_id = str(generator.get("model_id") or "").strip()
                voice_id = str(generator.get("voice_id") or "").strip()
                if (
                    provider not in {"cartesia", "elevenlabs"}
                    or not model_id
                    or not voice_id
                    or not _generator_license_is_attested(generator)
                    or provider != str(profile.get("provider") or "").strip().lower()
                    or model_id != str(profile.get("model_snapshot") or "").strip()
                    or voice_id != str(profile.get("voice_id") or "").strip()
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} narration generator or commercial license is not verified"
                    )

                artwork_id = str(resolved.get("artwork_asset_id") or "").strip()
                artwork = assets.get(artwork_id)
                verified_artwork = verified_assets.get(artwork_id)
                if (
                    not artwork_id
                    or not isinstance(artwork, dict)
                    or artwork.get("kind") != "image"
                    or not str(artwork.get("mime_type") or "").startswith("image/")
                    or not isinstance(verified_artwork, dict)
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} needs a published artwork asset"
                    )
                expected_artwork = {
                    "kind": verified_artwork.get("kind"),
                    "path": verified_artwork.get("public_path"),
                    "mime_type": verified_artwork.get("mime_type"),
                    "bytes": int(verified_artwork.get("byte_count") or 0),
                    "sha256": verified_artwork.get("sha256"),
                }
                if any(artwork.get(key) != value for key, value in expected_artwork.items()):
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} artwork does not match its verified upload"
                    )
                art_media = _verified_metadata(
                    verified_artwork.get("media_metadata_json"),
                    f"Original V3 selectable story {story_id} artwork metadata",
                )
                if int(art_media.get("width") or 0) < 320 or int(
                    art_media.get("height") or 0
                ) < 180:
                    raise OriginalManifestV3Error(
                        f"Original V3 selectable story {story_id} artwork is too small for offline playback"
                    )


def original_manifest_v3_delivery_contract_sha256(
    manifest: dict,
    *,
    chapter_id: str,
    variant_id: str,
) -> str:
    """Return the canonical hash of scheduling and effective audio identity."""

    chapter = next((item for item in manifest.get("chapters", []) if item.get("id") == chapter_id), None)
    if not chapter:
        raise OriginalManifestV3Error("Original V3 delivery hash chapter was not found")
    variant = next((item for item in chapter.get("variants", []) if item.get("id") == variant_id), None)
    if not variant:
        raise OriginalManifestV3Error("Original V3 delivery hash variant was not found")
    stories = {item.get("id"): item for item in manifest.get("stories", [])}
    cue_refs = [
        _hard_ref(item, f"Original V3 delivery hash cue_refs[{index}]")
        for index, item in enumerate(variant.get("cue_refs", []))
    ]
    selectable_refs = [
        _selectable_ref(item, f"Original V3 delivery hash selectable_refs[{index}]")
        for index, item in enumerate(variant.get("selectable_refs", []))
    ]
    refs = sorted(
        copy.deepcopy(cue_refs) + copy.deepcopy(selectable_refs),
        key=lambda item: (int(item.get("sequence") or 0), str(item.get("story_id") or "")),
    )
    narration = []
    for ref in refs:
        story = stories.get(ref.get("story_id"))
        if not isinstance(story, dict):
            raise OriginalManifestV3Error("Original V3 delivery hash references an unknown story")
        resolved = _effective_story(story, chapter_id, variant_id)
        narration.append({
            "id": resolved["id"],
            "kind": resolved["kind"],
            "audio_asset_id": resolved["audio_asset_id"],
            "audio_duration_s": float(resolved["audio_duration_s"]),
        })
    payload = {
        "schema_version": 1,
        "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
        "chapter_id": chapter_id,
        "variant_id": variant_id,
        "route_geometry_sha256": _geometry_sha256(variant["route"]),
        "cue_refs": sorted(
            copy.deepcopy(cue_refs),
            key=lambda item: (item["sequence"], item["story_id"]),
        ),
        "selectable_refs": sorted(
            copy.deepcopy(selectable_refs),
            key=lambda item: (item["sequence"], item["story_id"]),
        ),
        "effective_narration": narration,
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _projection_normalize_v1(
    _pack_id: str, _title: str, manifest: dict, **_kwargs,
) -> tuple[dict, str]:
    result = copy.deepcopy(manifest)
    return result, json.dumps(result, separators=(",", ":"), sort_keys=True)


def _projection_cue(ref: dict, variant: dict) -> dict:
    coordinates = ref.get("coordinates")
    if coordinates is None:
        start = variant["route"]["geometry"]["coordinates"][0]
        coordinates = {"lat": float(start[1]), "lng": float(start[0])}
    trigger = ref.get("trigger") or {
        "enter_radius_m": 100.0,
        "exit_radius_m": 200.0,
        "lead_time_s": 0.0,
        "route_progress_start_m": 0.0,
        "route_progress_end_m": min(float(variant["route"]["distance_m"]), 100.0),
    }
    result = {
        "story_id": ref["story_id"],
        "sequence": ref["sequence"],
        "coordinates": copy.deepcopy(coordinates),
        "trigger": copy.deepcopy(trigger),
    }
    if ref.get("explore_place_id") is not None:
        result["explore_place_id"] = ref["explore_place_id"]
    return result


def _compile_hard(manifest: dict, chapter: dict, variant: dict) -> dict:
    hard_variant = copy.deepcopy(variant)
    hard_variant["cue_refs"] = [
        {**copy.deepcopy(ref), "sequence": index}
        for index, ref in enumerate(
            sorted(variant["cue_refs"], key=lambda item: (item["sequence"], item["story_id"])),
            start=1,
        )
    ]
    hard_variant.pop("selectable_refs", None)
    hard_variant.pop("delivery_contract_sha256", None)
    return _compile_v2(
        manifest, chapter, hard_variant,
        {item["id"]: item for item in manifest["stories"]},
    )


def normalize_original_manifest_v3(
    manifest: dict,
    *,
    pack_id: str,
    title: str,
    version: int | None,
    normalize_v1: Callable[..., tuple[dict, str]],
    publishing: bool = False,
    verified_assets: dict[str, dict] | None = None,
    validated_selections: set[str] | None = None,
    validated_delivery_contracts: set[str] | None = None,
    route_evidence_document: dict | None = None,
) -> tuple[dict, str]:
    """Normalize V3 while ensuring selectable items never enter V1 stops."""

    raw = copy.deepcopy(_object(manifest, "Original V3 manifest"))
    _forbid_keys(raw, {
        "schema_version", "manifest_id", "pack_id", "version", "locale", "title",
        "stories", "chapters", "assets", "offline_map", "review", "narration_profile",
        "route_evidence", "consumer_contract",
    }, "Original V3 manifest")
    if raw.get("schema_version") != 3:
        raise OriginalManifestV3Error("Original V3 manifest schema_version must be 3")
    contract = _consumer_contract(raw.get("consumer_contract"))

    projection = copy.deepcopy(raw)
    projection["schema_version"] = 2
    projection.pop("consumer_contract", None)
    normalized_refs: dict[tuple[str, str], dict[str, list[dict]]] = {}
    referenced: set[str] = set()
    story_ids = {
        str(item.get("id") or "").strip()
        for item in raw.get("stories", []) if isinstance(item, dict)
    }
    if not story_ids:
        raise OriginalManifestV3Error("Original V3 stories are required")
    raw_chapters = raw.get("chapters")
    projected_chapters = projection.get("chapters")
    if not isinstance(raw_chapters, list) or not isinstance(projected_chapters, list):
        raise OriginalManifestV3Error("Original V3 chapters are required")
    for raw_chapter, projected_chapter in zip(raw_chapters, projected_chapters):
        chapter_id = _stable_id(raw_chapter.get("id"), "Original V3 chapter id")
        raw_variants = raw_chapter.get("variants")
        projected_variants = projected_chapter.get("variants")
        if not isinstance(raw_variants, list) or not isinstance(projected_variants, list):
            raise OriginalManifestV3Error(f"Original V3 chapter {chapter_id} variants are required")
        for raw_variant, projected_variant in zip(raw_variants, projected_variants):
            _forbid_keys(raw_variant, {
                "id", "sequence", "title", "route", "cue_refs", "selectable_refs",
                "delivery_contract_sha256",
            }, f"Original V3 chapter {chapter_id} variant")
            variant_id = _stable_id(raw_variant.get("id"), "Original V3 variant id")
            if not isinstance(raw_variant.get("cue_refs"), list) or not raw_variant["cue_refs"]:
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} requires at least one hard cue"
                )
            if not isinstance(raw_variant.get("selectable_refs"), list):
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} selectable_refs must be a list"
                )
            hard = [
                _hard_ref(item, f"Original V3 variant {variant_id} cue_refs[{index}]")
                for index, item in enumerate(raw_variant["cue_refs"])
            ]
            selectable = [
                _selectable_ref(item, f"Original V3 variant {variant_id} selectable_refs[{index}]")
                for index, item in enumerate(raw_variant["selectable_refs"])
            ]
            combined = hard + selectable
            if len(combined) > 250:
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} has more than 250 delivery references"
                )
            combined.sort(key=lambda item: (item["sequence"], item["story_id"]))
            if [item["sequence"] for item in combined] != list(range(1, len(combined) + 1)):
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} delivery sequence must be contiguous starting at 1"
                )
            ref_ids = [item["story_id"] for item in combined]
            if len(ref_ids) != len(set(ref_ids)):
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} stories must occur exactly once across cue_refs and selectable_refs"
                )
            unknown = sorted(set(ref_ids) - story_ids)
            if unknown:
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant_id} references unknown stories: {', '.join(unknown)}"
                )
            hard_by_id = {item["story_id"]: item for item in hard}
            route_distance_m = _number(
                raw_variant.get("route", {}).get("distance_m"),
                f"Original V3 variant {variant_id} route distance",
                minimum=1,
            )
            for item in combined:
                if (
                    item.get("trigger") is not None
                    and item["trigger"]["route_progress_end_m"] > route_distance_m
                ):
                    raise OriginalManifestV3Error(
                        f"Original V3 story {item['story_id']} trigger exceeds its route distance"
                    )
            for item in selectable:
                if item["delivery"]["mode"] != "capacity_deeper":
                    continue
                next_id = item["delivery"]["next_hard_auto_story_id"]
                next_hard = hard_by_id.get(next_id)
                if next_hard is None:
                    raise OriginalManifestV3Error(
                        f"Original V3 capacity story {item['story_id']} must name a hard cue in its variant"
                    )
                if next_hard["sequence"] <= item["sequence"]:
                    raise OriginalManifestV3Error(
                        f"Original V3 capacity story {item['story_id']} must name a later hard cue"
                    )
                if item["trigger"]["route_progress_start_m"] >= next_hard["trigger"]["route_progress_start_m"]:
                    raise OriginalManifestV3Error(
                        f"Original V3 capacity story {item['story_id']} must precede its next hard cue"
                    )
            referenced.update(ref_ids)
            normalized_refs[(chapter_id, variant_id)] = {
                "hard": sorted(hard, key=lambda item: (item["sequence"], item["story_id"])),
                "selectable": sorted(selectable, key=lambda item: (item["sequence"], item["story_id"])),
            }
            projected_variant.pop("selectable_refs", None)
            projected_variant.pop("delivery_contract_sha256", None)
            projected_variant["cue_refs"] = [
                {**_projection_cue(item, raw_variant), "sequence": index}
                for index, item in enumerate(combined, start=1)
            ]
    if referenced != story_ids:
        missing = sorted(story_ids - referenced)
        raise OriginalManifestV3Error(
            "Every Original V3 story must be referenced by at least one route variant"
            + (f": {', '.join(missing)}" if missing else "")
        )

    try:
        normalized_v2, _ = normalize_original_manifest_v2(
            projection,
            pack_id=pack_id,
            title=title,
            version=version,
            normalize_v1=_projection_normalize_v1,
            # The projection contains synthetic refs only so V2 can normalize
            # shared fields. It is never publication evidence.
            publishing=False,
            verified_assets=None,
            validated_selections=None,
            route_evidence_document=None,
        )
    except OriginalManifestV2Error as exc:
        raise OriginalManifestV3Error(str(exc)) from exc

    result = copy.deepcopy(normalized_v2)
    result["schema_version"] = 3
    result["consumer_contract"] = contract
    hard_compiles: list[dict] = []
    raw_chapters_by_id = {item["id"]: item for item in raw_chapters}
    for chapter in result["chapters"]:
        raw_variants = {item["id"]: item for item in raw_chapters_by_id[chapter["id"]]["variants"]}
        for variant in chapter["variants"]:
            refs = normalized_refs[(chapter["id"], variant["id"])]
            variant["cue_refs"] = copy.deepcopy(refs["hard"])
            variant["selectable_refs"] = copy.deepcopy(refs["selectable"])
            supplied_hash = str(
                raw_variants[variant["id"]].get("delivery_contract_sha256") or ""
            ).strip().lower()
            if not _SHA256_RE.fullmatch(supplied_hash):
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant['id']} delivery_contract_sha256 is invalid"
                )
            expected_hash = original_manifest_v3_delivery_contract_sha256(
                result, chapter_id=chapter["id"], variant_id=variant["id"],
            )
            if supplied_hash != expected_hash:
                raise OriginalManifestV3Error(
                    f"Original V3 variant {variant['id']} delivery contract hash does not match its canonical content"
                )
            variant["delivery_contract_sha256"] = expected_hash
            hard_compiles.append(_compile_hard(result, chapter, variant))

    if publishing:
        required_route_selections: set[str] = set()
        required_delivery_contracts: set[str] = set()
        for chapter in result["chapters"]:
            validation = chapter["validation_selection"]
            selection_id = validation["selection_id"]
            for variant_id in validation["required_variant_ids"]:
                variant = next(
                    item for item in chapter["variants"] if item["id"] == variant_id
                )
                required_route_selections.add(f"{selection_id}:{variant_id}")
                required_delivery_contracts.add(
                    f"{selection_id}:{variant_id}:{variant['delivery_contract_sha256']}"
                )
        if set(validated_selections or ()) != required_route_selections:
            raise OriginalManifestV3Error(
                "OriginalManifestV3 publication requires authoritative hard-route validation for every chapter variant"
            )
        if set(validated_delivery_contracts or ()) != required_delivery_contracts:
            raise OriginalManifestV3Error(
                "OriginalManifestV3 publication requires trusted long-form validation for every delivery contract hash"
            )
        if not isinstance(result.get("narration_profile"), dict):
            raise OriginalManifestV3Error(
                "Original V3 narration_profile is required before publishing"
            )
        if result["narration_profile"].get("schema_version") == 2:
            narration_asset_ids = {
                str(asset_id)
                for story in result["stories"]
                for asset_id in (
                    [story["audio_asset_id"]]
                    + [
                        override["audio_asset_id"]
                        for override in story.get("variant_overrides", [])
                    ]
                )
            }
            try:
                for asset_id in sorted(narration_asset_ids):
                    validate_original_narration_profile_asset(
                        result["narration_profile"],
                        (verified_assets or {}).get(asset_id),
                        label=f"Original V3 narration asset {asset_id}",
                    )
            except OriginalManifestV2Error as exc:
                raise OriginalManifestV3Error(str(exc)) from exc
        _validate_selectable_publication_parity(result, verified_assets)
        binding = result.get("route_evidence")
        if not isinstance(binding, dict):
            raise OriginalManifestV3Error(
                "Original V3 route_evidence is required before publishing"
            )
        product_id = str(binding.get("product_id") or pack_id).strip()
        try:
            validate_cultural_publication_scope(product_id)
            validate_manifest_route_evidence(
                result,
                binding,
                expected_product_id=pack_id,
                evidence_document=route_evidence_document,
            )
            for chapter in result["chapters"]:
                validate_manifest_operational_binding(
                    chapter_id=chapter["id"],
                    operational_sources=chapter["operational_sources"],
                    operational_readiness=chapter["operational_readiness"],
                    require_current=True,
                )
        except (
            OriginalCulturalReviewError,
            OriginalOperationalReadinessError,
            OriginalRouteEvidenceError,
        ) as exc:
            raise OriginalManifestV3Error(str(exc)) from exc

    # Call the V1 validator only after every V3 publication prerequisite has
    # passed. A missing trusted long-form validation must fail before any
    # caller can observe a publishing=True hard-route validation.
    for compiled in hard_compiles:
        normalize_v1(
            pack_id,
            compiled["title"],
            compiled,
            version=version,
            publishing=publishing,
            verified_assets=verified_assets,
        )

    encoded = json.dumps(result, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > _MAX_BYTES:
        raise OriginalManifestV3Error("Original V3 manifest exceeds the size limit")
    return result, encoded


def _hydrate(reference: dict, story: dict, chapter_id: str, variant_id: str) -> dict:
    resolved = _effective_story(story, chapter_id, variant_id)
    result = {
        "id": resolved["id"],
        "kind": resolved["kind"],
        "sequence": reference["sequence"],
        "title": resolved["title"],
        "transcript": resolved["transcript"],
        "audio_asset_id": resolved["audio_asset_id"],
        "audio_duration_s": resolved["audio_duration_s"],
        "citations": copy.deepcopy(resolved["citations"]),
        "delivery": copy.deepcopy(reference["delivery"]),
    }
    for key in ("coordinates", "explore_place_id", "trigger"):
        if key in reference:
            result[key] = copy.deepcopy(reference[key])
    if resolved.get("artwork_asset_id") is not None:
        result["artwork_asset_id"] = resolved["artwork_asset_id"]
    return result


def compile_original_manifest_v3_selection(
    manifest: dict,
    *,
    chapter_id: str,
    variant_id: str | None,
    normalize_v1: Callable[..., tuple[dict, str]],
    publishing: bool = False,
    verified_assets: dict[str, dict] | None = None,
) -> dict:
    if manifest.get("schema_version") != 3:
        raise OriginalManifestV3Error("Original V3 manifest is required")
    _consumer_contract(manifest.get("consumer_contract"))
    chapter = next((item for item in manifest.get("chapters", []) if item.get("id") == chapter_id), None)
    if not chapter:
        raise OriginalManifestV3Error("Original V3 chapter selection was not found")
    chosen = variant_id or chapter.get("default_variant_id")
    variant = next((item for item in chapter.get("variants", []) if item.get("id") == chosen), None)
    if not variant:
        raise OriginalManifestV3Error("Original V3 route variant selection was not found")
    expected_contract_hash = original_manifest_v3_delivery_contract_sha256(
        manifest,
        chapter_id=chapter_id,
        variant_id=chosen,
    )
    if variant.get("delivery_contract_sha256") != expected_contract_hash:
        raise OriginalManifestV3Error(
            "Original V3 delivery contract changed after normalization"
        )
    compiled = _compile_hard(manifest, chapter, variant)
    normalized, _ = normalize_v1(
        manifest.get("pack_id") or "draft_original", compiled["title"], compiled,
        version=manifest.get("version"), publishing=publishing, verified_assets=verified_assets,
    )
    if manifest.get("manifest_id"):
        normalized["manifest_id"] = manifest["manifest_id"]
    stories = {item["id"]: item for item in manifest["stories"]}
    items = [
        _hydrate(ref, stories[ref["story_id"]], chapter_id, chosen)
        for ref in sorted(
            variant.get("selectable_refs", []),
            key=lambda item: (item["sequence"], item["story_id"]),
        )
    ]
    contract_hash = variant["delivery_contract_sha256"]
    return {
        "selection": {
            "validation_selection_id": chapter["validation_selection"]["selection_id"],
            "chapter_id": chapter_id,
            "variant_id": chosen,
            "delivery_contract_sha256": contract_hash,
        },
        "manifest": normalized,
        "selectable": {
            "schema_version": 1,
            "contract_id": ORIGINAL_LONG_FORM_CONTRACT_ID,
            "delivery_contract_sha256": contract_hash,
            "items": items,
        },
    }
