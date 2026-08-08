"""Strict editorial source dossiers for long-form Trailhead Originals.

This module intentionally stops before script or audio production. It binds each
planned entry to reviewed sources and keeps culturally sensitive work blocked
until the named cultural authority has approved the work.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import date
from urllib.parse import urlsplit


_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,159}$")
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_ALLOWED_CHAPTERS = {
    "mountain_crossing",
    "little_river_cades_cove",
    "roaring_fork",
    "foothills_parkway",
}
_EXPECTED_COUNTS = {
    "mountain_crossing": {"story": 18, "cue": 10},
    "little_river_cades_cove": {"story": 14, "cue": 9},
    "roaring_fork": {"story": 7, "cue": 6},
    "foothills_parkway": {"story": 6, "cue": 7},
}
_SOURCE_RIGHTS = {"reference_only", "public_domain", "licensed", "permission_confirmed"}
_MEDIA_STATES = {"exact_asset_not_selected", "candidate_requires_clearance", "approved"}
_MEDIA_RIGHTS_REQUIREMENTS = {
    "asset_url",
    "dimensions",
    "exact_credit",
    "identity_match",
    "license_record",
    "rights_basis",
    "sha256",
}
PUBLIC_RECORD_CULTURAL_SCOPE_V1 = {
    "classification": "public_record_factual",
    "collection_method": "published_public_record",
}
GATED_CULTURAL_CLASSIFICATION_V1 = "immutable_ebci_review_required"
GATED_CULTURAL_COLLECTION_METHODS_V1 = {
    "published_public_record",
    "direct_ebci_member_research",
    "fieldwork_on_ebci_tribal_land",
    "unpublished_or_restricted_knowledge",
}
CULTURAL_REVIEW_TRIGGERS_V1 = {
    "sacred_or_traditional_interpretation",
    "direct_ebci_member_research",
    "unpublished_or_restricted_knowledge",
    "culturally_supplied_pronunciation",
    "research_on_ebci_tribal_land",
}
CULTURAL_PROHIBITIONS_V1 = CULTURAL_REVIEW_TRIGGERS_V1 | {
    "tts_rendering_of_gated_content",
}


def gated_cultural_scope_triggers_are_valid_v1(
    collection_method: str,
    review_triggers: set[str],
) -> bool:
    if not review_triggers or collection_method not in GATED_CULTURAL_COLLECTION_METHODS_V1:
        return False
    if collection_method == "published_public_record":
        return bool(review_triggers.intersection({
            "sacred_or_traditional_interpretation",
            "culturally_supplied_pronunciation",
        }))
    required_trigger = {
        "direct_ebci_member_research": "direct_ebci_member_research",
        "fieldwork_on_ebci_tribal_land": "research_on_ebci_tribal_land",
        "unpublished_or_restricted_knowledge": "unpublished_or_restricted_knowledge",
    }[collection_method]
    return required_trigger in review_triggers


class OriginalSourceDossierError(ValueError):
    """Raised when editorial evidence is incomplete, stale, or overclaims rights."""


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise OriginalSourceDossierError(f"{label} must be an object")
    return value


def _list(value: object, label: str, *, minimum: int = 1, maximum: int = 500) -> list:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise OriginalSourceDossierError(
            f"{label} must contain between {minimum} and {maximum} entries"
        )
    return value


def _forbid_keys(value: dict, allowed: set[str], label: str) -> None:
    extra = sorted(set(value) - allowed)
    if extra:
        raise OriginalSourceDossierError(
            f"{label} contains unsupported fields: {', '.join(extra)}"
        )


def _text(value: object, label: str, *, maximum: int = 2_000) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    if not clean or len(clean) > maximum:
        raise OriginalSourceDossierError(f"{label} is missing or too long")
    return clean


def _stable_id(value: object, label: str) -> str:
    clean = str(value or "").strip()
    if not _ID_RE.fullmatch(clean):
        raise OriginalSourceDossierError(f"{label} must be a stable lowercase identifier")
    return clean


def _https_url(value: object, label: str) -> str:
    clean = _text(value, label, maximum=2_048)
    parsed = urlsplit(clean)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise OriginalSourceDossierError(f"{label} must be an absolute HTTPS URL")
    return clean


def _iso_date(value: object, label: str) -> date:
    clean = _text(value, label, maximum=10)
    try:
        return date.fromisoformat(clean)
    except ValueError as exc:
        raise OriginalSourceDossierError(f"{label} must be an ISO date") from exc


def _unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise OriginalSourceDossierError(f"{label} must be unique")


def normalize_original_source_dossier(
    payload: dict,
    *,
    as_of: date | None = None,
) -> tuple[dict, str]:
    """Normalize a source dossier and return its canonical JSON.

    ``as_of`` is injectable so a checked-in evidence artifact can be reproduced
    deterministically. A release compiler should call this with the real date.
    """

    today = as_of or date.today()
    raw = copy.deepcopy(_object(payload, "Original source dossier"))
    _forbid_keys(
        raw,
        {
            "schema_version",
            "product_id",
            "title",
            "locale",
            "reviewed_at",
            "source_review_max_age_days",
            "target_counts",
            "cultural_review",
            "sources",
            "claims",
            "entries",
            "media_candidates",
        },
        "Original source dossier",
    )
    if raw.get("schema_version") != 1:
        raise OriginalSourceDossierError("Original source dossier schema_version must be 1")
    raw["product_id"] = _stable_id(raw.get("product_id"), "Original source dossier product_id")
    raw["title"] = _text(raw.get("title"), "Original source dossier title", maximum=200)
    if raw.get("locale") != "en-US":
        raise OriginalSourceDossierError("Original source dossier locale must be en-US")
    reviewed = _iso_date(raw.get("reviewed_at"), "Original source dossier reviewed_at")
    if reviewed > today:
        raise OriginalSourceDossierError("Original source dossier review date cannot be in the future")
    max_age = raw.get("source_review_max_age_days")
    if isinstance(max_age, bool) or not isinstance(max_age, int) or max_age != 180:
        raise OriginalSourceDossierError("Story source review age must be exactly 180 days")

    counts = _object(raw.get("target_counts"), "Original source dossier target_counts")
    if counts != _EXPECTED_COUNTS:
        raise OriginalSourceDossierError("Original source dossier target counts do not match the approved product")

    cultural = _object(raw.get("cultural_review"), "Original source dossier cultural_review")
    _forbid_keys(
        cultural,
        {
            "status",
            "authority",
            "official_review_url",
            "contact_path",
            "compensation_required",
            "blocked_entry_ids",
            "prohibited_until_approved",
            "approval_record_id",
            "approved_at",
            "approval_record_sha256",
            "approved_claim_ids",
        },
        "Original source dossier cultural_review",
    )
    if cultural.get("status") not in {
        "public_record_only",
        "required_before_drafting",
        "approved",
    }:
        raise OriginalSourceDossierError(
            "Cultural review must remain public-record-only, required, or explicitly approved"
        )
    cultural["authority"] = _text(cultural.get("authority"), "Cultural review authority", maximum=200)
    cultural["official_review_url"] = _https_url(
        cultural.get("official_review_url"), "Cultural review official URL"
    )
    cultural["contact_path"] = _text(cultural.get("contact_path"), "Cultural review contact path", maximum=300)
    if cultural.get("compensation_required") is not True:
        raise OriginalSourceDossierError("Cultural participation must be compensated")
    blocked_entry_ids = [
        _stable_id(item, "Cultural review blocked entry")
        for item in _list(
            cultural.get("blocked_entry_ids"),
            "Cultural review blocked entries",
            minimum=0,
        )
    ]
    _unique(blocked_entry_ids, "Cultural review blocked entries")
    cultural["blocked_entry_ids"] = sorted(blocked_entry_ids)
    prohibited = [
        _stable_id(item, "Cultural review prohibited action")
        for item in _list(cultural.get("prohibited_until_approved"), "Cultural review prohibited actions")
    ]
    _unique(prohibited, "Cultural review prohibited actions")
    if set(prohibited) != CULTURAL_PROHIBITIONS_V1:
        raise OriginalSourceDossierError(
            "Cultural review prohibited actions do not match the fail-closed contract"
        )
    cultural["prohibited_until_approved"] = sorted(prohibited)
    approval_fields = {
        "approval_record_id",
        "approved_at",
        "approval_record_sha256",
        "approved_claim_ids",
    }
    present_approval = {key for key in approval_fields if cultural.get(key) not in (None, "", [])}
    if cultural["status"] in {"public_record_only", "required_before_drafting"}:
        if present_approval:
            raise OriginalSourceDossierError("Pending cultural review cannot carry partial approval evidence")
    else:
        if present_approval != approval_fields:
            raise OriginalSourceDossierError("Approved cultural review lacks immutable approval evidence")
        cultural["approval_record_id"] = _stable_id(
            cultural["approval_record_id"], "Cultural review approval record id"
        )
        approved_at = _iso_date(cultural["approved_at"], "Cultural review approved_at")
        if approved_at > today:
            raise OriginalSourceDossierError("Cultural review approval cannot be in the future")
        cultural["approved_at"] = approved_at.isoformat()
        if not _SHA256_RE.fullmatch(str(cultural["approval_record_sha256"])):
            raise OriginalSourceDossierError("Cultural review approval record SHA-256 is invalid")
        approved_claim_ids = [
            _stable_id(item, "Cultural review approved claim")
            for item in _list(cultural["approved_claim_ids"], "Cultural review approved claims")
        ]
        _unique(approved_claim_ids, "Cultural review approved claims")
        cultural["approved_claim_ids"] = sorted(approved_claim_ids)

    sources: list[dict] = []
    for item in _list(raw.get("sources"), "Original source dossier sources"):
        source = copy.deepcopy(_object(item, "Original source dossier source"))
        _forbid_keys(
            source,
            {"id", "title", "url", "publisher", "role", "authority", "reviewed_at", "rights_status", "scope"},
            "Original source dossier source",
        )
        source["id"] = _stable_id(source.get("id"), "Original source dossier source id")
        source["title"] = _text(source.get("title"), f"Source {source['id']} title", maximum=300)
        source["url"] = _https_url(source.get("url"), f"Source {source['id']} URL")
        source["publisher"] = _text(source.get("publisher"), f"Source {source['id']} publisher", maximum=200)
        if source.get("role") != "story" or source.get("authority") not in {"official", "authoritative"}:
            raise OriginalSourceDossierError(f"Source {source['id']} must be an authoritative story source")
        source_date = _iso_date(source.get("reviewed_at"), f"Source {source['id']} reviewed_at")
        age = (today - source_date).days
        if age < 0 or age > max_age:
            raise OriginalSourceDossierError(f"Source {source['id']} review is stale")
        if source.get("rights_status") not in _SOURCE_RIGHTS:
            raise OriginalSourceDossierError(f"Source {source['id']} rights status is invalid")
        scope = [_stable_id(value, f"Source {source['id']} scope") for value in _list(source.get("scope"), f"Source {source['id']} scope")]
        _unique(scope, f"Source {source['id']} scope")
        source["scope"] = sorted(scope)
        sources.append(source)
    sources.sort(key=lambda item: item["id"])
    _unique([item["id"] for item in sources], "Original source dossier source ids")
    sources_by_id = {item["id"]: item for item in sources}

    claims: list[dict] = []
    for item in _list(raw.get("claims"), "Original source dossier claims"):
        claim = copy.deepcopy(_object(item, "Original source dossier claim"))
        _forbid_keys(
            claim,
            {
                "id",
                "chapter_id",
                "statement",
                "status",
                "cultural_gate",
                "cultural_scope",
                "source_ids",
            },
            "Original source dossier claim",
        )
        claim["id"] = _stable_id(claim.get("id"), "Original source dossier claim id")
        chapter_id = _stable_id(claim.get("chapter_id"), f"Claim {claim['id']} chapter_id")
        if chapter_id not in _ALLOWED_CHAPTERS:
            raise OriginalSourceDossierError(f"Claim {claim['id']} chapter is invalid")
        claim["chapter_id"] = chapter_id
        claim["statement"] = _text(claim.get("statement"), f"Claim {claim['id']} statement", maximum=1_000)
        if claim.get("status") not in {
            "source_verified",
            "cultural_review_required",
            "cultural_review_approved",
        }:
            raise OriginalSourceDossierError(f"Claim {claim['id']} status is invalid")
        if claim.get("cultural_gate") not in {"not_required", "ebci_required"}:
            raise OriginalSourceDossierError(f"Claim {claim['id']} cultural gate is invalid")
        scope = copy.deepcopy(
            _object(
                claim.get("cultural_scope"),
                f"Claim {claim['id']} cultural scope",
            )
        )
        _forbid_keys(
            scope,
            {"classification", "collection_method", "review_triggers"},
            f"Claim {claim['id']} cultural scope",
        )
        classification = _stable_id(
            scope.get("classification"),
            f"Claim {claim['id']} cultural scope classification",
        )
        collection_method = _stable_id(
            scope.get("collection_method"),
            f"Claim {claim['id']} cultural scope collection method",
        )
        review_triggers = [
            _stable_id(value, f"Claim {claim['id']} cultural review trigger")
            for value in _list(
                scope.get("review_triggers"),
                f"Claim {claim['id']} cultural review triggers",
                minimum=0,
                maximum=20,
            )
        ]
        _unique(review_triggers, f"Claim {claim['id']} cultural review triggers")
        unknown_triggers = sorted(set(review_triggers) - CULTURAL_REVIEW_TRIGGERS_V1)
        if unknown_triggers:
            raise OriginalSourceDossierError(
                f"Claim {claim['id']} cultural scope has unknown review triggers"
            )
        if claim["cultural_gate"] == "ebci_required":
            if classification != GATED_CULTURAL_CLASSIFICATION_V1:
                raise OriginalSourceDossierError(
                    f"Claim {claim['id']} cultural scope does not match its gate"
                )
            if not gated_cultural_scope_triggers_are_valid_v1(
                collection_method,
                set(review_triggers),
            ):
                raise OriginalSourceDossierError(
                    f"Claim {claim['id']} gated cultural scope is incomplete"
                )
        elif (
            {
                "classification": classification,
                "collection_method": collection_method,
            } != PUBLIC_RECORD_CULTURAL_SCOPE_V1
            or review_triggers
        ):
            raise OriginalSourceDossierError(
                f"Claim {claim['id']} public-record scope does not match its gate"
            )
        claim["cultural_scope"] = {
            "classification": classification,
            "collection_method": collection_method,
            "review_triggers": sorted(review_triggers),
        }
        source_ids = [_stable_id(value, f"Claim {claim['id']} source") for value in _list(claim.get("source_ids"), f"Claim {claim['id']} sources")]
        _unique(source_ids, f"Claim {claim['id']} sources")
        missing_sources = sorted(set(source_ids) - set(sources_by_id))
        if missing_sources:
            raise OriginalSourceDossierError(f"Claim {claim['id']} references unknown sources")
        if claim["cultural_gate"] == "ebci_required":
            expected_cultural_status = (
                "cultural_review_approved"
                if cultural["status"] == "approved"
                else "cultural_review_required"
            )
            if claim["status"] != expected_cultural_status:
                raise OriginalSourceDossierError(
                    f"Claim {claim['id']} must match the EBCI review state"
                )
        claim["source_ids"] = sorted(source_ids)
        claims.append(claim)
    claims.sort(key=lambda item: item["id"])
    _unique([item["id"] for item in claims], "Original source dossier claim ids")
    claims_by_id = {item["id"]: item for item in claims}
    cultural_claim_ids = {
        item["id"] for item in claims if item["cultural_gate"] == "ebci_required"
    }
    if cultural["status"] == "public_record_only" and cultural_claim_ids:
        raise OriginalSourceDossierError(
            "Public-record-only cultural review cannot contain gated claims"
        )
    if cultural["status"] in {"required_before_drafting", "approved"} and not cultural_claim_ids:
        raise OriginalSourceDossierError(
            "Cultural review status requires at least one EBCI-gated claim"
        )
    if cultural["status"] == "approved":
        if set(cultural["approved_claim_ids"]) != cultural_claim_ids:
            raise OriginalSourceDossierError(
                "Cultural approval evidence must cover every EBCI-gated claim exactly"
            )

    entries: list[dict] = []
    entry_counts: dict[str, Counter] = defaultdict(Counter)
    entry_sequences: dict[tuple[str, str], list[int]] = defaultdict(list)
    referenced_claims: set[str] = set()
    for item in _list(raw.get("entries"), "Original source dossier entries"):
        entry = copy.deepcopy(_object(item, "Original source dossier entry"))
        _forbid_keys(
            entry,
            {
                "id",
                "chapter_id",
                "sequence",
                "kind",
                "title",
                "route_context",
                "visible_scene",
                "purpose",
                "claim_ids",
                "target_words",
                "directional_adaptation",
                "script_status",
            },
            "Original source dossier entry",
        )
        entry["id"] = _stable_id(entry.get("id"), "Original source dossier entry id")
        chapter_id = _stable_id(entry.get("chapter_id"), f"Entry {entry['id']} chapter_id")
        if chapter_id not in _ALLOWED_CHAPTERS:
            raise OriginalSourceDossierError(f"Entry {entry['id']} chapter is invalid")
        entry["chapter_id"] = chapter_id
        kind = entry.get("kind")
        if kind not in {"story", "cue"}:
            raise OriginalSourceDossierError(f"Entry {entry['id']} kind is invalid")
        sequence = entry.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise OriginalSourceDossierError(f"Entry {entry['id']} sequence is invalid")
        entry["title"] = _text(entry.get("title"), f"Entry {entry['id']} title", maximum=200)
        entry["route_context"] = _stable_id(entry.get("route_context"), f"Entry {entry['id']} route context")
        entry["visible_scene"] = _text(entry.get("visible_scene"), f"Entry {entry['id']} visible scene", maximum=500)
        entry["purpose"] = _text(entry.get("purpose"), f"Entry {entry['id']} purpose", maximum=800)
        claim_ids = [_stable_id(value, f"Entry {entry['id']} claim") for value in _list(entry.get("claim_ids"), f"Entry {entry['id']} claims")]
        _unique(claim_ids, f"Entry {entry['id']} claims")
        if set(claim_ids) - set(claims_by_id):
            raise OriginalSourceDossierError(f"Entry {entry['id']} references unknown claims")
        if any(claims_by_id[claim_id]["chapter_id"] != chapter_id for claim_id in claim_ids):
            raise OriginalSourceDossierError(f"Entry {entry['id']} references a claim from another chapter")
        target_words = entry.get("target_words")
        valid_range = (390, 725) if kind == "story" else (35, 190)
        if isinstance(target_words, bool) or not isinstance(target_words, int) or not valid_range[0] <= target_words <= valid_range[1]:
            raise OriginalSourceDossierError(f"Entry {entry['id']} target word count is invalid")
        if not isinstance(entry.get("directional_adaptation"), bool):
            raise OriginalSourceDossierError(f"Entry {entry['id']} directional_adaptation must be boolean")
        has_blocked_cultural_claim = any(
            claims_by_id[claim_id]["status"] == "cultural_review_required"
            for claim_id in claim_ids
        )
        expected_status = "blocked_cultural_review" if has_blocked_cultural_claim else "outline_only"
        if entry.get("script_status") != expected_status:
            raise OriginalSourceDossierError(f"Entry {entry['id']} script status must be {expected_status}")
        if has_blocked_cultural_claim and entry["id"] not in blocked_entry_ids:
            raise OriginalSourceDossierError(f"Entry {entry['id']} is missing from the cultural-review block list")
        entry["claim_ids"] = sorted(claim_ids)
        entries.append(entry)
        referenced_claims.update(claim_ids)
        entry_counts[chapter_id][kind] += 1
        entry_sequences[(chapter_id, kind)].append(sequence)
    entries.sort(key=lambda item: (item["chapter_id"], item["kind"], item["sequence"], item["id"]))
    _unique([item["id"] for item in entries], "Original source dossier entry ids")
    if {chapter: dict(counter) for chapter, counter in entry_counts.items()} != _EXPECTED_COUNTS:
        raise OriginalSourceDossierError("Original source dossier entries do not match approved counts")
    for key, values in entry_sequences.items():
        if sorted(values) != list(range(1, len(values) + 1)):
            raise OriginalSourceDossierError(f"Entry sequences for {key[0]} {key[1]} are not contiguous")
    if set(blocked_entry_ids) != {entry["id"] for entry in entries if entry["script_status"] == "blocked_cultural_review"}:
        raise OriginalSourceDossierError("Cultural-review blocked entries do not match the entry set")
    if referenced_claims != set(claims_by_id):
        raise OriginalSourceDossierError("Every dossier claim must be used by an editorial entry")

    used_sources = {source_id for claim in claims for source_id in claim["source_ids"]}
    if used_sources != set(sources_by_id):
        raise OriginalSourceDossierError("Every dossier source must support at least one claim")

    media_candidates: list[dict] = []
    for item in _list(raw.get("media_candidates"), "Original source dossier media candidates"):
        media = copy.deepcopy(_object(item, "Original source dossier media candidate"))
        _forbid_keys(
            media,
            {
                "id",
                "chapter_id",
                "subject",
                "source_page_url",
                "rights_policy_url",
                "intended_use",
                "status",
                "rights_requirements",
                "asset_url",
                "exact_credit",
                "identity_match",
                "rights_basis",
                "license_record",
                "width",
                "height",
                "sha256",
            },
            "Original source dossier media candidate",
        )
        media["id"] = _stable_id(media.get("id"), "Original media candidate id")
        chapter_id = _stable_id(media.get("chapter_id"), f"Media {media['id']} chapter_id")
        if chapter_id not in _ALLOWED_CHAPTERS:
            raise OriginalSourceDossierError(f"Media {media['id']} chapter is invalid")
        media["chapter_id"] = chapter_id
        media["subject"] = _text(media.get("subject"), f"Media {media['id']} subject", maximum=300)
        media["source_page_url"] = _https_url(media.get("source_page_url"), f"Media {media['id']} source page")
        media["rights_policy_url"] = _https_url(media.get("rights_policy_url"), f"Media {media['id']} rights policy")
        media["intended_use"] = _stable_id(media.get("intended_use"), f"Media {media['id']} intended use")
        if media.get("status") not in _MEDIA_STATES:
            raise OriginalSourceDossierError(f"Media {media['id']} status is invalid")
        requirements = [_stable_id(value, f"Media {media['id']} rights requirement") for value in _list(media.get("rights_requirements"), f"Media {media['id']} rights requirements")]
        _unique(requirements, f"Media {media['id']} rights requirements")
        if set(requirements) != _MEDIA_RIGHTS_REQUIREMENTS:
            raise OriginalSourceDossierError(
                f"Media {media['id']} rights requirements do not match the approval contract"
            )
        media["rights_requirements"] = sorted(requirements)
        exact_fields = {"asset_url", "exact_credit", "identity_match", "rights_basis", "license_record", "width", "height", "sha256"}
        present_exact = {key for key in exact_fields if media.get(key) not in (None, "")}
        if media["status"] == "approved":
            if present_exact != exact_fields:
                raise OriginalSourceDossierError(f"Approved media {media['id']} lacks exact rights evidence")
            media["asset_url"] = _https_url(media["asset_url"], f"Media {media['id']} asset URL")
            for key in ("exact_credit", "identity_match", "rights_basis", "license_record"):
                media[key] = _text(media[key], f"Media {media['id']} {key}", maximum=500)
            for key in ("width", "height"):
                if isinstance(media[key], bool) or not isinstance(media[key], int) or media[key] < 1:
                    raise OriginalSourceDossierError(f"Media {media['id']} {key} is invalid")
            if not _SHA256_RE.fullmatch(str(media["sha256"])):
                raise OriginalSourceDossierError(f"Media {media['id']} SHA-256 is invalid")
        elif present_exact:
            raise OriginalSourceDossierError(f"Unapproved media {media['id']} cannot carry partial rights evidence")
        media_candidates.append(media)
    media_candidates.sort(key=lambda item: item["id"])
    _unique([item["id"] for item in media_candidates], "Original media candidate ids")

    normalized = {
        "schema_version": 1,
        "product_id": raw["product_id"],
        "title": raw["title"],
        "locale": "en-US",
        "reviewed_at": reviewed.isoformat(),
        "source_review_max_age_days": max_age,
        "target_counts": copy.deepcopy(_EXPECTED_COUNTS),
        "cultural_review": cultural,
        "sources": sources,
        "claims": claims,
        "entries": entries,
        "media_candidates": media_candidates,
    }
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return normalized, encoded


def original_source_dossier_sha256(payload: dict, *, as_of: date | None = None) -> str:
    _, encoded = normalize_original_source_dossier(payload, as_of=as_of)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def original_story_citations(payload: dict, claim_ids: list[str], *, as_of: date | None = None) -> list[dict]:
    """Project reviewed dossier evidence into OriginalManifestV2 citations."""

    normalized, _ = normalize_original_source_dossier(payload, as_of=as_of)
    claims = {item["id"]: item for item in normalized["claims"]}
    sources = {item["id"]: item for item in normalized["sources"]}
    selected = [_stable_id(item, "Story citation claim") for item in claim_ids]
    _unique(selected, "Story citation claims")
    if set(selected) - set(claims):
        raise OriginalSourceDossierError("Story citation references an unknown claim")
    blocked = [
        item
        for item in selected
        if claims[item]["status"] not in {"source_verified", "cultural_review_approved"}
    ]
    if blocked:
        raise OriginalSourceDossierError("Story citation cannot compile before cultural review")
    affected_by_source: dict[str, list[str]] = defaultdict(list)
    for claim_id in selected:
        for source_id in claims[claim_id]["source_ids"]:
            affected_by_source[source_id].append(claim_id)
    citations: list[dict] = []
    cultural_claims = {
        claim_id for claim_id in selected
        if claims[claim_id]["status"] == "cultural_review_approved"
    }
    for source_id in sorted(affected_by_source):
        citation = {
            "title": sources[source_id]["title"],
            "url": sources[source_id]["url"],
            "publisher": sources[source_id]["publisher"],
            "role": "story",
            "authority": sources[source_id]["authority"],
            "reviewed_at": sources[source_id]["reviewed_at"],
            "rights_status": sources[source_id]["rights_status"],
            "affected_claims": sorted(set(affected_by_source[source_id])),
        }
        if cultural_claims.intersection(citation["affected_claims"]):
            citation.update({
                "cultural_approval_record_id": normalized["cultural_review"]["approval_record_id"],
                "cultural_approval_record_sha256": normalized["cultural_review"]["approval_record_sha256"],
                "cultural_approved_at": normalized["cultural_review"]["approved_at"],
            })
        citations.append(citation)
    return citations
