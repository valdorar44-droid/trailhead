"""Server-owned route evidence gate for multi-chapter Trailhead Originals.

Authoring JSON may name a reviewed evidence document, but it cannot supply or
override that document. Publication resolves an allowlisted, checked-in
artifact and requires every chapter variant to match its exact geometry.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


DEFAULT_SMOKIES_ROUTE_EVIDENCE = (
    Path(__file__).resolve().parents[1]
    / "originals"
    / "smokies"
    / "official_route_evidence_v1.json"
)

# This additive publication artifact is intentionally absent until the
# field-drive and source-review checkpoint has produced and independently
# reviewed it. Registration makes the eventual identity explicit without
# weakening the historical, blocked evidence record above.
SMOKIES_PUBLICATION_ROUTE_EVIDENCE = (
    Path(__file__).resolve().parents[1]
    / "originals"
    / "smokies"
    / "official_route_evidence_publication_v1.json"
)

_REGISTERED_EVIDENCE = {
    "smokies-official-routes-2026-v1": DEFAULT_SMOKIES_ROUTE_EVIDENCE,
    "smokies-official-routes-2026-publication-v1": (
        SMOKIES_PUBLICATION_ROUTE_EVIDENCE
    ),
}
_BINDING_KEYS = {
    "schema_version",
    "evidence_id",
    "evidence_sha256",
    "product_id",
    "route_spec_sha256",
    "source_snapshot_sha256",
}
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_SMOKIES_PUBLICATION_REVIEW_BINDING_KEYS = {
    "technical_field_drive_evidence_sha256",
    "source_review_evidence_sha256",
    "vehicle_source_policy_sha256",
}
_SMOKIES_PUBLICATION_EVIDENCE_ID = (
    "smokies-official-routes-2026-publication-v1"
)
_SMOKIES_PUBLICATION_VEHICLE_SOURCE_POLICY_SHA256 = (
    "17b9eea045ac2369e7679f5fbec3291cca46374b004165f15087ceb4bded7a21"
)


class OriginalRouteEvidenceError(ValueError):
    """Raised when authored routes do not match server-owned evidence."""


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OriginalRouteEvidenceError(f"{label} must be an object")
    return value


def _sha256(value: object, label: str) -> str:
    clean = str(value or "").strip().lower()
    if not _SHA256_RE.fullmatch(clean):
        raise OriginalRouteEvidenceError(f"{label} must be a lowercase SHA-256")
    return clean


def normalize_route_evidence_binding(value: object, *, required: bool) -> dict | None:
    if value is None:
        if required:
            raise OriginalRouteEvidenceError(
                "OriginalManifestV2 publication requires server-owned route evidence"
            )
        return None
    binding = dict(_object(value, "Original V2 route evidence binding"))
    extra = sorted(set(binding) - _BINDING_KEYS)
    missing = sorted(_BINDING_KEYS - set(binding))
    if extra:
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence binding contains unsupported fields: "
            + ", ".join(extra)
        )
    if missing:
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence binding is missing fields: "
            + ", ".join(missing)
        )
    if binding.get("schema_version") != 1:
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence binding schema_version must be 1"
        )
    for key in ("evidence_id", "product_id"):
        clean = str(binding.get(key) or "").strip()
        if not clean or len(clean) > 240:
            raise OriginalRouteEvidenceError(
                f"Original V2 route evidence {key} is invalid"
            )
        binding[key] = clean
    for key in ("evidence_sha256", "route_spec_sha256", "source_snapshot_sha256"):
        binding[key] = _sha256(
            binding.get(key),
            f"Original V2 route evidence {key}",
        )
    return binding


def load_registered_route_evidence(evidence_id: str) -> dict:
    path = _REGISTERED_EVIDENCE.get(str(evidence_id or "").strip())
    if path is None:
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence is not registered by the server"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence could not be loaded"
        ) from exc
    return _object(payload, "Registered Original route evidence")


def validate_smokies_publication_route_evidence_document(value: object) -> dict:
    """Require the additive publication record to change only reviewed gates.

    The accepted route artifact remains the immutable geometry/source baseline.
    Its publication successor may only clear the three known blockers and add
    the exact field-drive, source-review, and reviewed-policy hash envelope.
    """
    evidence = dict(_object(value, "Smokies publication route evidence"))
    try:
        historical = _object(
            json.loads(DEFAULT_SMOKIES_ROUTE_EVIDENCE.read_text(encoding="utf-8")),
            "Historical Smokies route evidence",
        )
    except (OSError, json.JSONDecodeError) as exc:
        raise OriginalRouteEvidenceError(
            "Historical Smokies route evidence could not be loaded"
        ) from exc
    expected_keys = set(historical) | {
        "evidence_id",
        "publication_review_bindings",
    }
    if set(evidence) != expected_keys:
        raise OriginalRouteEvidenceError(
            "Smokies publication route evidence fields are invalid"
        )
    bindings = _object(
        evidence.get("publication_review_bindings"),
        "Smokies publication route review bindings",
    )
    if set(bindings) != _SMOKIES_PUBLICATION_REVIEW_BINDING_KEYS:
        raise OriginalRouteEvidenceError(
            "Smokies publication route review binding fields are invalid"
        )
    for key in sorted(_SMOKIES_PUBLICATION_REVIEW_BINDING_KEYS):
        bindings[key] = _sha256(
            bindings.get(key),
            f"Smokies publication route review {key}",
        )
    if (
        bindings["vehicle_source_policy_sha256"]
        != _SMOKIES_PUBLICATION_VEHICLE_SOURCE_POLICY_SHA256
    ):
        raise OriginalRouteEvidenceError(
            "Smokies publication route reviewed vehicle/source policy drifted"
        )
    if evidence.get("evidence_id") != _SMOKIES_PUBLICATION_EVIDENCE_ID:
        raise OriginalRouteEvidenceError(
            "Smokies publication route evidence identity drifted"
        )
    if (
        evidence.get("publication_status") != "ready_for_publication"
        or evidence.get("publication_blockers") != []
    ):
        raise OriginalRouteEvidenceError(
            "Smokies publication route evidence is blocked"
        )
    for key, historical_value in historical.items():
        if key in {"publication_status", "publication_blockers"}:
            continue
        if evidence.get(key) != historical_value:
            raise OriginalRouteEvidenceError(
                f"Smokies publication route evidence {key} drifted"
            )
    evidence["publication_review_bindings"] = bindings
    return evidence


def _variant_key(value: dict, label: str) -> tuple[str, str]:
    chapter_id = str(value.get("chapter_id") or "").strip()
    variant_id = str(value.get("variant_id") or "").strip()
    if not chapter_id or not variant_id:
        raise OriginalRouteEvidenceError(f"{label} identity is incomplete")
    return chapter_id, variant_id


def validate_manifest_route_evidence(
    manifest: dict,
    binding: dict,
    *,
    expected_product_id: str | None = None,
    evidence_document: dict | None = None,
) -> dict:
    """Require exact, ready evidence for every selectable route variant."""

    evidence = _object(
        evidence_document
        if evidence_document is not None
        else load_registered_route_evidence(binding["evidence_id"]),
        "Registered Original route evidence",
    )
    if binding.get("evidence_id") == _SMOKIES_PUBLICATION_EVIDENCE_ID:
        evidence = validate_smokies_publication_route_evidence_document(evidence)
    if evidence.get("evidence_id") is not None and (
        evidence.get("evidence_id") != binding.get("evidence_id")
    ):
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence document identity drifted"
        )
    if evidence.get("schema_version") != 1 or evidence.get("kind") != (
        "trailhead_original_official_route_evidence"
    ):
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence has an unsupported contract"
        )
    publication_status = evidence.get("publication_status")
    publication_blockers = evidence.get("publication_blockers")
    if publication_status != "ready_for_publication":
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence is not ready for publication"
        )
    if not isinstance(publication_blockers, list) or publication_blockers:
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence has publication blockers"
        )
    actual_evidence_sha = canonical_sha256(evidence)
    if actual_evidence_sha != binding["evidence_sha256"]:
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence hash does not match the registered artifact"
        )
    for key in ("product_id", "route_spec_sha256", "source_snapshot_sha256"):
        if str(evidence.get(key) or "").strip() != binding[key]:
            raise OriginalRouteEvidenceError(
                f"Original V2 route evidence {key} does not match the registered artifact"
            )
    if expected_product_id is not None and binding["product_id"] != str(
        expected_product_id
    ).strip():
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence product does not match its authored pack"
        )
    policy = _object(evidence.get("source_policy"), "Registered route source policy")
    if (
        policy.get("geometry_authority") != "nps_public_roads"
        or policy.get("mapbox_candidate_geometry_persisted") is not False
    ):
        raise OriginalRouteEvidenceError(
            "Registered Original route evidence does not use the approved source policy"
        )
    geometry_authorities = policy.get("geometry_authorities")
    if geometry_authorities is None:
        if policy.get("license") != "us-pd":
            raise OriginalRouteEvidenceError(
                "Registered Original route evidence source license is unsupported"
            )
    else:
        if not isinstance(geometry_authorities, list) or not geometry_authorities:
            raise OriginalRouteEvidenceError(
                "Registered Original route evidence authorities are invalid"
            )
        authority_licenses: dict[str, str] = {}
        for raw_authority in geometry_authorities:
            authority = _object(
                raw_authority,
                "Registered route geometry authority",
            )
            authority_id = str(authority.get("id") or "").strip()
            authority_license = str(authority.get("license") or "").strip()
            attribution = str(authority.get("attribution") or "").strip()
            if (
                not authority_id
                or authority_id in authority_licenses
                or not attribution
            ):
                raise OriginalRouteEvidenceError(
                    "Registered Original route evidence authorities are invalid"
                )
            authority_licenses[authority_id] = authority_license
        if authority_licenses.get("nps_public_roads") != "us-pd" or any(
            authority_id not in {"nps_public_roads", "nc_onemap_ng911"}
            for authority_id in authority_licenses
        ):
            raise OriginalRouteEvidenceError(
                "Registered Original route evidence authorities are unsupported"
            )
        if (
            "nc_onemap_ng911" in authority_licenses
            and authority_licenses["nc_onemap_ng911"] != "free_unrestricted_use"
        ):
            raise OriginalRouteEvidenceError(
                "Registered Original route evidence source license is unsupported"
            )

    evidence_variants: dict[tuple[str, str], dict] = {}
    for raw_variant in evidence.get("variants") or []:
        variant = _object(raw_variant, "Registered route evidence variant")
        key = _variant_key(variant, "Registered route evidence variant")
        if key in evidence_variants:
            raise OriginalRouteEvidenceError(
                "Registered Original route evidence contains a duplicate variant"
            )
        evidence_variants[key] = variant

    manifest_variants: dict[tuple[str, str], dict] = {}
    for raw_chapter in manifest.get("chapters") or []:
        chapter = _object(raw_chapter, "Original V2 chapter")
        chapter_id = str(chapter.get("id") or "").strip()
        for raw_variant in chapter.get("variants") or []:
            variant = _object(raw_variant, "Original V2 route variant")
            key = (chapter_id, str(variant.get("id") or "").strip())
            if not all(key) or key in manifest_variants:
                raise OriginalRouteEvidenceError(
                    "Original V2 route evidence selection identity is invalid"
                )
            manifest_variants[key] = variant

    if set(manifest_variants) != set(evidence_variants):
        missing = sorted(set(evidence_variants) - set(manifest_variants))
        unexpected = sorted(set(manifest_variants) - set(evidence_variants))
        details = []
        if missing:
            details.append("missing " + ", ".join(f"{a}/{b}" for a, b in missing))
        if unexpected:
            details.append(
                "unexpected " + ", ".join(f"{a}/{b}" for a, b in unexpected)
            )
        raise OriginalRouteEvidenceError(
            "Original V2 route evidence must cover the exact chapter variants"
            + (": " + "; ".join(details) if details else "")
        )

    verified = []
    for key in sorted(manifest_variants):
        evidence_variant = evidence_variants[key]
        blockers = evidence_variant.get("blocking_issues")
        if (
            evidence_variant.get("status") != "official_geometry_candidate"
            or evidence_variant.get("geometry_ready_for_editorial_cues") is not True
            or not isinstance(blockers, list)
            or blockers
        ):
            raise OriginalRouteEvidenceError(
                f"Original V2 route {key[0]}/{key[1]} still has official-source blockers"
            )
        evidence_geometry = _object(
            evidence_variant.get("geometry"),
            f"Registered route evidence {key[0]}/{key[1]} geometry",
        )
        evidence_geometry_sha = canonical_sha256(evidence_geometry)
        if evidence_geometry_sha != _sha256(
            evidence_variant.get("geometry_sha256"),
            f"Registered route evidence {key[0]}/{key[1]} geometry SHA-256",
        ):
            raise OriginalRouteEvidenceError(
                f"Registered route evidence {key[0]}/{key[1]} geometry is corrupted"
            )
        manifest_route = _object(
            manifest_variants[key].get("route"),
            f"Original V2 route {key[0]}/{key[1]}",
        )
        if canonical_sha256(manifest_route.get("geometry")) != evidence_geometry_sha:
            raise OriginalRouteEvidenceError(
                f"Original V2 route {key[0]}/{key[1]} geometry does not match official evidence"
            )
        distance = manifest_route.get("distance_m")
        evidence_distance = evidence_variant.get("distance_m")
        if (
            isinstance(distance, bool)
            or not isinstance(distance, (int, float))
            or isinstance(evidence_distance, bool)
            or not isinstance(evidence_distance, (int, float))
            or abs(float(distance) - float(evidence_distance)) > 1.0
        ):
            raise OriginalRouteEvidenceError(
                f"Original V2 route {key[0]}/{key[1]} distance does not match official evidence"
            )
        verified.append({
            "chapter_id": key[0],
            "variant_id": key[1],
            "geometry_sha256": evidence_geometry_sha,
        })

    return {
        "schema_version": 1,
        "evidence_id": binding["evidence_id"],
        "evidence_sha256": actual_evidence_sha,
        "product_id": binding["product_id"],
        "source_snapshot_sha256": binding["source_snapshot_sha256"],
        "route_spec_sha256": binding["route_spec_sha256"],
        "variants": verified,
    }
