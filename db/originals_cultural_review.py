"""Fail-closed cultural claim gate for Trailhead Originals authoring.

The checked-in dossier is the claim registry.  Authored manifests cannot add,
rename, or omit Smokies claims, and a future cultural approval may authorize
only the exact claim IDs listed in its immutable attestation.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from functools import cache
from pathlib import Path
from typing import Any

from db.originals_sources import (
    CULTURAL_PROHIBITIONS_V1,
    CULTURAL_REVIEW_TRIGGERS_V1,
    GATED_CULTURAL_CLASSIFICATION_V1,
    PUBLIC_RECORD_CULTURAL_SCOPE_V1,
    gated_cultural_scope_triggers_are_valid_v1,
)


DEFAULT_SMOKIES_SOURCE_DOSSIER = (
    Path(__file__).resolve().parents[1]
    / "originals"
    / "smokies"
    / "source_dossiers_v1.json"
)
DEFAULT_SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION = (
    Path(__file__).resolve().parents[1]
    / "originals"
    / "smokies"
    / "smokies_public_record_scope_determination_v1.json"
)
SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION_ID = (
    "smokies_public_record_scope_2026_v1"
)

# The expected file hash makes the checked-in internal determination immutable
# at runtime instead of trusting whichever bytes happen to exist at its path.
_REGISTERED_PUBLIC_RECORD_SCOPE_DETERMINATIONS: dict[
    str, tuple[Path, str]
] = {
    SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION_ID: (
        DEFAULT_SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION,
        "bea2ed1a3a5df0a54c7369ec3738155a5530cea93f26531959475442b9758f3d",
    )
}

# Approval records are deliberately empty until Trailhead completes the
# compensated EBCI review and checks in the resulting immutable attestation.
_REGISTERED_APPROVAL_RECORDS: dict[str, Path] = {}


class OriginalCulturalReviewError(ValueError):
    """Raised when culturally gated material lacks registered approval."""


def _object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise OriginalCulturalReviewError(f"{label} is invalid")
    return value


@cache
def _dossier_registry() -> dict[str, Any]:
    try:
        raw = DEFAULT_SMOKIES_SOURCE_DOSSIER.read_bytes()
        payload = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise OriginalCulturalReviewError(
            "The checked-in Smokies source dossier could not be loaded"
        ) from exc
    payload = _object(payload, "The checked-in Smokies source dossier")
    if payload.get("schema_version") != 1:
        raise OriginalCulturalReviewError(
            "The checked-in Smokies source dossier schema is unsupported"
        )
    cultural_review = _object(
        payload.get("cultural_review"),
        "The checked-in Smokies cultural-review contract",
    )
    cultural_status = str(cultural_review.get("status") or "").strip()
    if cultural_status not in {
        "public_record_only",
        "required_before_drafting",
        "approved",
    }:
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural-review status is invalid"
        )
    raw_prohibited = cultural_review.get("prohibited_until_approved")
    if (
        not isinstance(raw_prohibited, list)
        or any(not isinstance(item, str) or not item.strip() for item in raw_prohibited)
        or len(raw_prohibited) != len(set(raw_prohibited))
        or set(raw_prohibited) != CULTURAL_PROHIBITIONS_V1
    ):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural-review prohibitions are incomplete"
        )
    raw_blocked = cultural_review.get("blocked_entry_ids")
    if (
        not isinstance(raw_blocked, list)
        or any(not isinstance(item, str) or not item.strip() for item in raw_blocked)
        or len(raw_blocked) != len(set(raw_blocked))
    ):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural-review block list is invalid"
        )
    blocked_entry_ids = frozenset(item.strip() for item in raw_blocked)
    product_id = str(payload.get("product_id") or "").strip()
    claims = payload.get("claims")
    if not isinstance(claims, list):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural claim registry is invalid"
        )
    raw_sources = payload.get("sources")
    if not isinstance(raw_sources, list):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies source registry is invalid"
        )
    source_ids = []
    for raw_source in raw_sources:
        source = _object(raw_source, "A Smokies source-dossier source")
        source_id = str(source.get("id") or "").strip()
        if not source_id:
            raise OriginalCulturalReviewError(
                "The checked-in Smokies source registry is incomplete"
            )
        source_ids.append(source_id)
    if len(source_ids) != len(set(source_ids)):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies source registry is incomplete"
        )
    registered_source_ids = frozenset(source_ids)
    claim_gates: dict[str, str] = {}
    claim_scopes: dict[str, dict[str, Any]] = {}
    for raw_claim in claims:
        claim = _object(raw_claim, "A Smokies source-dossier claim")
        claim_id = str(claim.get("id") or "").strip()
        gate = str(claim.get("cultural_gate") or "").strip()
        scope = _object(
            claim.get("cultural_scope"),
            "A Smokies source-dossier cultural scope",
        )
        if set(scope) != {"classification", "collection_method", "review_triggers"}:
            raise OriginalCulturalReviewError(
                "The checked-in Smokies cultural scope is incomplete"
            )
        classification = str(scope.get("classification") or "").strip()
        collection_method = str(scope.get("collection_method") or "").strip()
        claim_status = str(claim.get("status") or "").strip()
        raw_source_ids = claim.get("source_ids")
        raw_triggers = scope.get("review_triggers")
        if (
            not isinstance(raw_triggers, list)
            or any(not isinstance(item, str) or not item.strip() for item in raw_triggers)
            or len(raw_triggers) != len(set(raw_triggers))
            or not set(raw_triggers).issubset(CULTURAL_REVIEW_TRIGGERS_V1)
        ):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies cultural review triggers are invalid"
            )
        if (
            not isinstance(raw_source_ids, list)
            or any(
                not isinstance(item, str) or not item.strip()
                for item in raw_source_ids
            )
            or not raw_source_ids
            or len(raw_source_ids) != len(set(raw_source_ids))
            or not set(raw_source_ids).issubset(registered_source_ids)
        ):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies claim source binding is invalid"
            )
        if (
            not claim_id
            or claim_id in claim_gates
            or gate not in {"not_required", "ebci_required"}
        ):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies cultural claim registry is incomplete"
            )
        if gate == "ebci_required":
            if (
                classification != GATED_CULTURAL_CLASSIFICATION_V1
                or not gated_cultural_scope_triggers_are_valid_v1(
                    collection_method,
                    set(raw_triggers),
                )
            ):
                raise OriginalCulturalReviewError(
                    "The checked-in Smokies gated cultural scope is incomplete"
                )
            expected_claim_status = (
                "cultural_review_approved"
                if cultural_status == "approved"
                else "cultural_review_required"
            )
            if claim_status != expected_claim_status:
                raise OriginalCulturalReviewError(
                    "The checked-in Smokies gated claim status is inconsistent"
                )
        elif (
            {
                "classification": classification,
                "collection_method": collection_method,
            } != PUBLIC_RECORD_CULTURAL_SCOPE_V1
            or raw_triggers
        ):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies public-record scope does not match its claim gate"
            )
        elif claim_status != "source_verified":
            raise OriginalCulturalReviewError(
                "The checked-in Smokies public-record claim is not source verified"
            )
        claim_gates[claim_id] = gate
        claim_scopes[claim_id] = {
            "classification": classification,
            "collection_method": collection_method,
            "review_triggers": tuple(sorted(raw_triggers)),
        }

    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies story claim registry is invalid"
        )
    story_claims: dict[str, frozenset[str]] = {}
    expected_blocked_entry_ids: set[str] = set()
    for raw_entry in entries:
        entry = _object(raw_entry, "A Smokies source-dossier entry")
        story_id = str(entry.get("id") or "").strip()
        raw_claim_ids = entry.get("claim_ids")
        if not isinstance(raw_claim_ids, list):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies story claim registry is incomplete"
            )
        claim_ids = frozenset(str(item or "").strip() for item in raw_claim_ids)
        if (
            not product_id
            or not story_id
            or story_id in story_claims
            or not claim_ids
            or "" in claim_ids
            or not claim_ids.issubset(claim_gates)
        ):
            raise OriginalCulturalReviewError(
                "The checked-in Smokies story claim registry is incomplete"
            )
        story_claims[story_id] = claim_ids
        has_pending_cultural_claim = any(
            claim_gates[claim_id] == "ebci_required"
            for claim_id in claim_ids
        )
        expected_script_status = (
            "blocked_cultural_review"
            if has_pending_cultural_claim and cultural_status != "approved"
            else "outline_only"
        )
        if raw_entry.get("script_status") != expected_script_status:
            raise OriginalCulturalReviewError(
                "The checked-in Smokies story cultural status is inconsistent"
            )
        if expected_script_status == "blocked_cultural_review":
            expected_blocked_entry_ids.add(story_id)

    required = frozenset(
        claim_id
        for claim_id, gate in claim_gates.items()
        if gate == "ebci_required"
    )
    if cultural_status == "public_record_only" and required:
        raise OriginalCulturalReviewError(
            "The checked-in Smokies public-record dossier contains a gated claim"
        )
    if cultural_status in {"required_before_drafting", "approved"} and not required:
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural-review status lacks a gated claim"
        )
    if blocked_entry_ids != frozenset(expected_blocked_entry_ids):
        raise OriginalCulturalReviewError(
            "The checked-in Smokies cultural-review block list is inconsistent"
        )
    return {
        "product_id": product_id,
        "dossier_sha256": hashlib.sha256(raw).hexdigest(),
        "cultural_status": cultural_status,
        "claim_gates": claim_gates,
        "claim_scopes": claim_scopes,
        "story_claims": story_claims,
        "public_record_claim_ids": frozenset(
            claim_id
            for claim_id, gate in claim_gates.items()
            if gate == "not_required"
        ),
        "required_claim_ids": required,
    }


def cultural_dossier_binding(product_id: str) -> dict | None:
    registry = _dossier_registry()
    if str(product_id or "").strip() != registry["product_id"]:
        return None
    return {
        "schema_version": 1,
        "product_id": registry["product_id"],
        "dossier_sha256": registry["dossier_sha256"],
    }


def _validate_public_record_scope_determination(registry: dict[str, Any]) -> None:
    registration = _REGISTERED_PUBLIC_RECORD_SCOPE_DETERMINATIONS.get(
        SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION_ID
    )
    if registration is None:
        raise OriginalCulturalReviewError(
            "An immutable internal public-record scope determination is required "
            "before this Original can be published"
        )
    path, expected_sha256 = registration
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination could not be loaded"
        ) from exc
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination hash does not match"
        )
    try:
        record = _object(
            json.loads(raw),
            "The registered public-record scope determination",
        )
    except json.JSONDecodeError as exc:
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination is invalid"
        ) from exc
    allowed_keys = {
        "schema_version",
        "kind",
        "determination_id",
        "product_id",
        "status",
        "scope",
        "authority",
        "authorization_basis",
        "authorized_at",
        "determination_basis",
        "dossier_sha256",
        "public_record_claim_ids",
        "external_outreach_required",
        "external_outreach_performed",
        "ebci_approval_claimed",
        "prohibited_until_approved",
    }
    if set(record) != allowed_keys:
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination contract is invalid"
        )
    if (
        record.get("schema_version") != 1
        or record.get("kind")
        != "trailhead_original_public_record_scope_determination"
        or record.get("determination_id")
        != SMOKIES_PUBLIC_RECORD_SCOPE_DETERMINATION_ID
        or record.get("product_id") != registry["product_id"]
        or record.get("status") != "accepted_internal_scope_determination"
        or record.get("scope")
        != "exact_checked_in_public_record_factual_claims_only"
        or record.get("authority") != "Trailhead project owner"
        or record.get("authorization_basis")
        != "project_owner_authorized_internal_source_scope_determination"
        or record.get("determination_basis")
        != "source_verified published public records bound by the immutable source dossier"
        or record.get("dossier_sha256") != registry["dossier_sha256"]
        or record.get("external_outreach_required") is not False
        or record.get("external_outreach_performed") is not False
        or record.get("ebci_approval_claimed") is not False
    ):
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination does not match this Original"
        )
    try:
        date.fromisoformat(str(record.get("authorized_at") or ""))
    except ValueError as exc:
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination date is invalid"
        ) from exc
    raw_claim_ids = record.get("public_record_claim_ids")
    if (
        not isinstance(raw_claim_ids, list)
        or any(not isinstance(item, str) or not item.strip() for item in raw_claim_ids)
        or raw_claim_ids != sorted(raw_claim_ids)
        or len(raw_claim_ids) != len(set(raw_claim_ids))
        or frozenset(raw_claim_ids) != registry["public_record_claim_ids"]
    ):
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination claim set does not match"
        )
    raw_prohibitions = record.get("prohibited_until_approved")
    if (
        not isinstance(raw_prohibitions, list)
        or raw_prohibitions != sorted(raw_prohibitions)
        or set(raw_prohibitions) != CULTURAL_PROHIBITIONS_V1
    ):
        raise OriginalCulturalReviewError(
            "The registered public-record scope determination weakens cultural safeguards"
        )


def validate_cultural_publication_scope(product_id: str) -> None:
    """Accept exact public records internally; keep gated material fail-closed."""

    registry = _dossier_registry()
    if str(product_id or "").strip() != registry["product_id"]:
        return
    if registry["public_record_claim_ids"]:
        _validate_public_record_scope_determination(registry)
    if (
        registry["required_claim_ids"]
        and registry["cultural_status"] != "approved"
    ):
        raise OriginalCulturalReviewError(
            "An immutable EBCI cultural approval is required before gated material "
            "in this Original can be published"
        )


def validate_cultural_story_claims(
    *,
    product_id: str,
    story_id: str,
    claim_ids: list[str],
) -> dict | None:
    """Bind each Smokies story to the exact immutable dossier entry."""

    registry = _dossier_registry()
    supplied = frozenset(str(item or "").strip() for item in claim_ids)
    if str(product_id or "").strip() != registry["product_id"]:
        registered_namespaces = {
            claim_id.split("_", 1)[0] + "_"
            for claim_id in registry["claim_gates"]
            if "_" in claim_id
        }
        if supplied.intersection(registry["claim_gates"]) or any(
            claim_id.startswith(tuple(registered_namespaces))
            for claim_id in supplied
        ):
            raise OriginalCulturalReviewError(
                "Smokies cultural claims cannot be reused by another Original"
            )
        return None
    expected = registry["story_claims"].get(str(story_id or "").strip())
    if expected is None:
        raise OriginalCulturalReviewError(
            f"Original V2 story {story_id} is not registered in the Smokies source dossier"
        )
    unknown = sorted(supplied - set(registry["claim_gates"]))
    if unknown:
        raise OriginalCulturalReviewError(
            "Original V2 story uses an unknown source-dossier claim: "
            + ", ".join(unknown)
        )
    if supplied != expected:
        raise OriginalCulturalReviewError(
            f"Original V2 story {story_id} claims do not match its source dossier"
        )
    return cultural_dossier_binding(product_id)


def validate_cultural_claim_approval(
    *,
    product_id: str,
    story_id: str,
    transcript_sha256: str,
    claim_ids: list[str],
    approval_record_id: str | None,
    approval_record_sha256: str | None,
    approved_at: str | None,
    pronunciation_bundle_sha256: str | None,
) -> None:
    registry = _dossier_registry()
    gated = sorted(set(claim_ids).intersection(registry["required_claim_ids"]))
    if not gated:
        return
    if not approval_record_id or not approval_record_sha256:
        raise OriginalCulturalReviewError(
            "EBCI cultural review is required before authoring claim: "
            + ", ".join(gated)
        )
    clean_story_id = str(story_id or "").strip()
    clean_transcript_sha256 = str(transcript_sha256 or "").strip().lower()
    clean_pronunciation_sha256 = str(
        pronunciation_bundle_sha256 or ""
    ).strip().lower()
    if (
        clean_story_id not in registry["story_claims"]
        or not re.fullmatch(r"[a-f0-9]{64}", clean_transcript_sha256)
        or not re.fullmatch(r"[a-f0-9]{64}", clean_pronunciation_sha256)
    ):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval script binding is incomplete"
        )
    path = _REGISTERED_APPROVAL_RECORDS.get(approval_record_id)
    if path is None:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record is not registered by the server"
        )
    if str(product_id or "").strip() != registry["product_id"]:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval product does not match this Original"
        )
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record could not be loaded"
        ) from exc
    if hashlib.sha256(raw).hexdigest() != approval_record_sha256:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record hash does not match"
        )
    try:
        record = _object(
            json.loads(raw),
            "The EBCI cultural approval record",
        )
    except json.JSONDecodeError as exc:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record is invalid"
        ) from exc
    allowed_keys = {
        "schema_version",
        "kind",
        "approval_record_id",
        "product_id",
        "status",
        "approved_claim_ids",
        "dossier_sha256",
        "approved_story_transcript_sha256_by_id",
        "pronunciation_bundle_sha256",
        "approved_at",
    }
    if set(record) != allowed_keys:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record contract is invalid"
        )
    if (
        record.get("schema_version") != 1
        or record.get("kind") != "trailhead_original_cultural_approval"
        or record.get("approval_record_id") != approval_record_id
        or record.get("product_id") != registry["product_id"]
        or record.get("status") != "approved"
        or record.get("dossier_sha256") != registry["dossier_sha256"]
    ):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval record does not match this Original"
        )
    record_claims = record.get("approved_claim_ids")
    if not isinstance(record_claims, list):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval claim scope is invalid"
        )
    approved_claim_ids = frozenset(str(item or "").strip() for item in record_claims)
    if (
        not approved_claim_ids
        or "" in approved_claim_ids
        or not approved_claim_ids.issubset(registry["required_claim_ids"])
        or not set(gated).issubset(approved_claim_ids)
    ):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval does not cover the requested claims"
        )
    transcript_bindings = record.get("approved_story_transcript_sha256_by_id")
    expected_story_ids = {
        dossier_story_id
        for dossier_story_id, dossier_claim_ids in registry["story_claims"].items()
        if dossier_claim_ids.intersection(approved_claim_ids)
    }
    if (
        not isinstance(transcript_bindings, dict)
        or set(transcript_bindings) != expected_story_ids
    ):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval transcript scope is invalid"
        )
    if any(
        not isinstance(value, str)
        or not re.fullmatch(r"[a-f0-9]{64}", value)
        for value in transcript_bindings.values()
    ):
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval transcript scope is invalid"
        )
    if transcript_bindings.get(clean_story_id) != clean_transcript_sha256:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval does not match the reviewed script"
        )
    if record.get("pronunciation_bundle_sha256") != clean_pronunciation_sha256:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval does not match the pronunciation bundle"
        )
    try:
        record_date = date.fromisoformat(str(record.get("approved_at") or ""))
    except ValueError as exc:
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval date is invalid"
        ) from exc
    if str(record_date) != str(approved_at or "").strip():
        raise OriginalCulturalReviewError(
            "The EBCI cultural approval date does not match its attestation"
        )
