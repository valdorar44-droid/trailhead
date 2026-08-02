#!/usr/bin/env python3
"""Build an immutable, hash-pinned public Explore release.

The command is a dry run unless ``--apply`` is supplied.  It never writes the
legacy live catalog or serving index; applied releases are created beneath
``dashboard/explore_releases/<release_id>/`` and are activated separately by
the server deployment configuration.
"""

from __future__ import annotations

import argparse
from collections import Counter
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "dashboard" / "explore_releases"
MANIFEST_SCHEMA = "explore_public_promotion_manifest_v1"
RELEASE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DISPOSITIONS = frozenset({"published", "canonical_merge", "remapped", "rejected"})
R1_EVIDENCE_IDS = frozenset({"combined_manifest", "promotion_review", "catalog_merge_review"})
R2_EVIDENCE_IDS = frozenset({
    f"b{batch}_{kind}"
    for batch in (1, 2, 3)
    for kind in ("manifest", "audit", "review")
})
B08_R1_IMAGE_CORRECTIONS = {
    "place:ridb:261716": "https://cdn.recreation.gov/public/2021/06/01/14/10/261716_b60960bd-92b5-4404-8f02-e8c82dc0ac65_700.webp",
    "place:ridb:269134": "https://cdn.recreation.gov/public/images/83803_1440.webp",
}
B08_CHILD_CORRECTIONS = {
    "nps:item:7475825b-e844-4012-841b-0e29e05d4540": {
        "summary": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
        "description": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
        "card.summary": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
        "card.highlight": "Aspenglen Campground offers tent and RV campsites by reservation during its summer operating season.",
    },
    "nps:item:a859e76b-fa23-43ce-8bed-904fb4d41b60": {
        "name": "Kulanaokuaiki Campground",
        "card.title": "Kulanaokuaiki Campground",
        "card.headline": "Kulanaokuaiki Campground",
    },
}
PROTECTED_OUTPUTS = frozenset({
    "dashboard/explore_catalog_v3.json",
    "dashboard/explore_serving_index_v2.json",
    "dashboard/explore_internal_preview_v1.json",
})
ALLOWED_CHILD_CORRECTION_PATHS = frozenset({
    "name",
    "category",
    "summary",
    "description",
    "module_target",
    "card.title",
    "card.headline",
    "card.summary",
    "card.highlight",
    "source_pack.extract",
})

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.data.build_canonical_serving_indexes import (  # noqa: E402
    build_explore_index,
    explore_filter_coverage,
    explore_serving_sort_key,
)


class PromotionError(ValueError):
    """A deterministic release-safety check failed."""


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def _repo_path(repo_root: Path, value: str | Path, *, must_exist: bool = True) -> Path:
    repo_root = repo_root.resolve()
    candidate = Path(value)
    resolved = (candidate if candidate.is_absolute() else repo_root / candidate).resolve()
    try:
        resolved.relative_to(repo_root)
    except ValueError as exc:
        raise PromotionError(f"path must stay inside the repository: {value}") from exc
    if must_exist and not resolved.is_file():
        raise PromotionError(f"required input is missing: {_relative(repo_root, resolved)}")
    return resolved


def _input_path(
    repo_root: Path,
    source_root: Path,
    value: str | Path,
) -> tuple[Path, str]:
    """Resolve an input from this worktree or an alternate checkout.

    b08's large, gitignored audit candidates live in the primary checkout.  A
    clean release worktree may read them through ``--source-root`` while the
    manifest records their stable repository-relative logical path.
    """
    repo_root = repo_root.resolve()
    source_root = source_root.resolve()
    raw = Path(value)
    candidates = [raw.resolve()] if raw.is_absolute() else [
        (repo_root / raw).resolve(),
        (source_root / raw).resolve(),
    ]
    for candidate in candidates:
        for root in (repo_root, source_root):
            try:
                logical = candidate.relative_to(root).as_posix()
            except ValueError:
                continue
            if candidate.is_file():
                return candidate, logical
    raise PromotionError(f"required input is missing or outside approved source roots: {value}")


def _relative(repo_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError as exc:
        raise PromotionError(f"path must stay inside the repository: {path}") from exc


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PromotionError(f"invalid JSON input: {path}") from exc


def _require_object(payload: Any, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise PromotionError(f"{label} must be a JSON object")
    return payload


def _records(payload: dict[str, Any], key: str, label: str) -> list[dict[str, Any]]:
    records = payload.get(key)
    if not isinstance(records, list) or not all(isinstance(item, dict) for item in records):
        raise PromotionError(f"{label}.{key} must be an array of objects")
    declared = payload.get("count")
    if declared is not None and int(declared) != len(records):
        raise PromotionError(f"{label} count does not match {key}")
    ids = [str(item.get("id") or "").strip() for item in records]
    if any(not item_id for item_id in ids) or len(ids) != len(set(ids)):
        raise PromotionError(f"{label} contains missing or duplicate stable IDs")
    return records


def _validate_catalog(payload: Any, label: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    catalog = _require_object(payload, label)
    if int(catalog.get("schema_version") or 0) < 3:
        raise PromotionError(f"{label} must use Explore catalog schema v3")
    places = _records(catalog, "places", label)
    return catalog, places


def _validate_serving(payload: Any, label: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    serving = _require_object(payload, label)
    if int(serving.get("schema_version") or 0) != 2:
        raise PromotionError(f"{label} must use Explore serving schema v2")
    items = _records(serving, "items", label)
    if serving.get("reviewable_count") is not None and int(serving["reviewable_count"]) != len(items):
        raise PromotionError(f"{label} reviewable_count does not match items")
    gate = serving.get("gate") if isinstance(serving.get("gate"), dict) else {}
    if not gate.get("passed"):
        raise PromotionError(f"{label} canonical serving gate did not pass")
    return serving, items


def _list_payload(payload: Any, key: str, label: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        values = payload
    elif isinstance(payload, dict) and isinstance(payload.get(key), list):
        values = payload[key]
    else:
        raise PromotionError(f"{label} must be an array or an object containing {key}")
    if not all(isinstance(item, dict) for item in values):
        raise PromotionError(f"{label} must contain only objects")
    return values


def _load_aliases(path: Path) -> tuple[list[dict[str, str]], Any]:
    raw = _load_json(path)
    aliases: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in _list_payload(raw, "aliases", "aliases"):
        from_id = str(item.get("from_id") or "").strip()
        to_id = str(item.get("to_id") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if not from_id or not to_id or not reason or from_id == to_id:
            raise PromotionError("every alias requires distinct from_id/to_id and a reason")
        if from_id in seen:
            raise PromotionError(f"duplicate alias source: {from_id}")
        seen.add(from_id)
        aliases.append({"from_id": from_id, "to_id": to_id, "reason": reason})
    aliases.sort(key=lambda item: (item["from_id"], item["to_id"]))
    alias_sources = {item["from_id"] for item in aliases}
    if any(item["to_id"] in alias_sources for item in aliases):
        raise PromotionError("alias targets must be final public IDs, not another alias source")
    return aliases, raw


def _load_dispositions(path: Path) -> tuple[list[dict[str, str]], Any]:
    raw = _load_json(path)
    dispositions: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in _list_payload(raw, "child_dispositions", "child dispositions"):
        source_id = str(item.get("source_id") or "").strip()
        public_id = str(item.get("public_id") or "").strip()
        disposition = str(item.get("disposition") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if not source_id or not reason or disposition not in DISPOSITIONS:
            raise PromotionError(f"invalid child disposition for {source_id or '<missing>'}")
        if source_id in seen:
            raise PromotionError(f"duplicate child disposition: {source_id}")
        if disposition == "rejected":
            if public_id:
                raise PromotionError(f"rejected child may not have a public_id: {source_id}")
        elif not public_id:
            raise PromotionError(f"child disposition requires public_id: {source_id}")
        if disposition == "remapped" and public_id == source_id:
            raise PromotionError(f"remapped child must receive a new public_id: {source_id}")
        seen.add(source_id)
        dispositions.append({
            "source_id": source_id,
            "public_id": public_id,
            "disposition": disposition,
            "reason": reason,
        })
    dispositions.sort(key=lambda item: item["source_id"])
    return dispositions, raw


def _payload_count(payload: Any) -> int:
    if isinstance(payload, list):
        return len(payload)
    if not isinstance(payload, dict):
        return 0
    if payload.get("count") is not None:
        return int(payload["count"])
    for key in ("places", "items", "aliases", "child_dispositions"):
        if isinstance(payload.get(key), list):
            return len(payload[key])
    return len(payload)


def _input_ref(input_id: str, path: Path, logical_path: str, payload: Any) -> dict[str, Any]:
    return {
        "id": input_id,
        "path": logical_path,
        "sha256": _sha256(path),
        "count": _payload_count(payload),
    }


def _validate_sha(value: str, label: str) -> str:
    normalized = str(value or "").strip().lower()
    if not SHA256_RE.fullmatch(normalized):
        raise PromotionError(f"{label} must be an exact lowercase SHA-256")
    return normalized


def _validate_current_hashes(
    current_catalog: Path,
    current_serving: Path,
    expected_catalog_sha256: str,
    expected_serving_sha256: str,
) -> None:
    actual_catalog = _sha256(current_catalog)
    actual_serving = _sha256(current_serving)
    if actual_catalog != expected_catalog_sha256:
        raise PromotionError(
            f"current catalog hash changed: expected {expected_catalog_sha256}, got {actual_catalog}"
        )
    if actual_serving != expected_serving_sha256:
        raise PromotionError(
            f"current serving index hash changed: expected {expected_serving_sha256}, got {actual_serving}"
        )


def _validate_commit_sha(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", normalized):
        raise PromotionError("rollback git_commit must be a full 40-character commit SHA")
    return normalized


def _validate_railway_uuid(value: str) -> str:
    normalized = str(value or "").strip().lower()
    try:
        parsed = uuid.UUID(normalized)
    except (ValueError, AttributeError) as exc:
        raise PromotionError("rollback railway_deployment_id must be a UUID") from exc
    if str(parsed) != normalized:
        raise PromotionError("rollback railway_deployment_id must use canonical UUID form")
    return normalized


def _manifest_artifact(payload: dict[str, Any], basename: str) -> dict[str, Any]:
    artifacts = payload.get("artifacts")
    values = artifacts.values() if isinstance(artifacts, dict) else artifacts
    for item in values or []:
        if isinstance(item, dict) and Path(str(item.get("path") or "")).name == basename:
            return item
    raise PromotionError(f"evidence manifest is missing artifact: {basename}")


def _validate_rollback_manifest(
    path: Path,
    *,
    expected_release_id: str,
    expected_catalog_sha256: str,
    expected_serving_sha256: str,
    required: bool,
) -> dict[str, Any]:
    if not path.is_file():
        if required:
            raise PromotionError(f"--apply requires an existing rollback manifest: {path}")
        return {"ready": False, "reason": "rollback manifest is missing"}
    payload = _require_object(_load_json(path), "rollback manifest")
    if payload.get("schema") != MANIFEST_SCHEMA:
        raise PromotionError("rollback manifest schema is not recognized")
    release_id = str(payload.get("release_id") or "").strip()
    if release_id != expected_release_id:
        raise PromotionError("rollback release does not match expected_current")
    catalog_hash = _validate_sha(
        _manifest_artifact(payload, "explore_catalog_v3.json").get("sha256"),
        "rollback catalog hash",
    )
    serving_hash = _validate_sha(
        _manifest_artifact(payload, "explore_serving_index_v2.json").get("sha256"),
        "rollback serving hash",
    )
    if catalog_hash != expected_catalog_sha256 or serving_hash != expected_serving_sha256:
        raise PromotionError("rollback artifact hashes do not match expected_current")
    return {"ready": True, "release_id": release_id}


def _evidence_v1(evidence: dict[str, Any], evidence_id: str) -> dict[str, Any]:
    payload = _require_object(evidence[evidence_id], f"evidence {evidence_id}")
    if int(payload.get("schema_version") or 0) != 1:
        raise PromotionError(f"evidence {evidence_id} must use schema_version 1")
    return payload


def _validate_r1_evidence(
    evidence: dict[str, Any],
    *,
    catalog_sha256: str,
    serving_sha256: str,
    catalog_count: int,
    serving_count: int,
    aliases: list[dict[str, str]],
    reviewed_exceptions: dict[str, Any],
    serving: dict[str, Any],
    apply: bool,
) -> None:
    combined = _evidence_v1(evidence, "combined_manifest")
    if not combined.get("catalog_gate_passed") or combined.get("live_catalog_modified") is not False or combined.get("live_serving_index_modified") is not False:
        raise PromotionError("combined_manifest did not pass its non-mutating catalog gate")
    if _manifest_artifact(combined, "explore_catalog_v3_review.json").get("sha256") != catalog_sha256:
        raise PromotionError("combined_manifest catalog hash does not match catalog input")
    if _manifest_artifact(combined, "serving_index_review.json").get("sha256") != serving_sha256:
        raise PromotionError("combined_manifest serving hash does not match serving input")

    promotion = _evidence_v1(evidence, "promotion_review")
    if not isinstance(promotion.get("gate"), dict) or not promotion["gate"].get("passed"):
        raise PromotionError("promotion_review gate did not pass")
    if int((promotion.get("counts") or {}).get("merged") or -1) != serving_count:
        raise PromotionError("promotion_review count does not match serving output")
    displaced = {
        (str(item.get("old_id") or ""), str(item.get("replacement_id") or ""))
        for item in promotion.get("displaced_records") or []
        if isinstance(item, dict)
    }
    alias_pairs = {(item["from_id"], item["to_id"]) for item in aliases}
    if displaced != alias_pairs or (apply and len(alias_pairs) != 5):
        raise PromotionError("promotion_review displaced records do not exactly match five aliases")

    catalog_review = _evidence_v1(evidence, "catalog_merge_review")
    if catalog_review.get("unique_ids") is not True:
        raise PromotionError("catalog_merge_review unique_ids did not pass")
    if int((catalog_review.get("counts") or {}).get("merged") or -1) != catalog_count:
        raise PromotionError("catalog_merge_review count does not match catalog output")

    corrections = reviewed_exceptions.get("approved_image_corrections") or []
    actual = {
        str(item.get("id") or ""): str(item.get("image_url") or "")
        for item in corrections
        if isinstance(item, dict) and str(item.get("reason") or "").strip()
    }
    if apply and actual != B08_R1_IMAGE_CORRECTIONS:
        raise PromotionError("b08 top-level release requires the two exact image corrections")
    serving_by_id = {
        str(item.get("id") or ""): item for item in serving.get("items") or [] if isinstance(item, dict)
    }
    for item_id, image_url in actual.items():
        if str((serving_by_id.get(item_id) or {}).get("image_url") or "") != image_url:
            raise PromotionError(f"image correction does not match serving artifact: {item_id}")


def _validate_r2_evidence(
    evidence: dict[str, Any],
    *,
    child_payloads: list[tuple[str, dict[str, Any]]],
    child_input_refs: list[tuple[str, Path, str, Any]],
    dispositions: list[dict[str, str]],
    reviewed_exceptions: dict[str, Any],
    apply: bool,
) -> None:
    child_paths = {input_id: path for input_id, path, _logical, _payload in child_input_refs}
    batches: dict[str, tuple[dict[str, Any], Path]] = {}
    for input_id, payload in child_payloads:
        match = re.fullmatch(r"post-b08-nps-child-depth-b([123])", str(payload.get("batch_id") or ""))
        if not match:
            raise PromotionError(f"unrecognized child batch_id: {payload.get('batch_id')}")
        batches[f"b{match.group(1)}"] = (payload, child_paths[input_id])
    if set(batches) != {"b1", "b2", "b3"}:
        raise PromotionError("child-depth evidence requires accepted b1, b2, and b3 inputs")

    shared_clusters = parent_fallbacks = stripped_images = explicit_b3 = 0
    for batch in ("b1", "b2", "b3"):
        child, child_path = batches[batch]
        child_count = len(child.get("places") or [])
        batch_id = str(child.get("batch_id") or "")
        manifest = _evidence_v1(evidence, f"{batch}_manifest")
        audit = _evidence_v1(evidence, f"{batch}_audit")
        review = _evidence_v1(evidence, f"{batch}_review")
        if any(str(value.get("batch_id") or "") != batch_id for value in (manifest, audit, review)):
            raise PromotionError(f"{batch} evidence batch_id does not match child input")
        if manifest.get("live_catalog_modified") is not False or manifest.get("live_serving_index_modified") is not False:
            raise PromotionError(f"{batch}_manifest modified a live artifact")
        if _manifest_artifact(manifest, "nps_child_depth_v1.json").get("sha256") != _sha256(child_path):
            raise PromotionError(f"{batch}_manifest hash does not match child input")
        if audit.get("passed") is not True or audit.get("errors") != [] or audit.get("unique_ids") is not True:
            raise PromotionError(f"{batch}_audit did not pass")
        if int(audit.get("count") or -1) != child_count:
            raise PromotionError(f"{batch}_audit count does not match child input")
        shared_clusters += sum(
            int(item.get("count") or 0)
            for item in audit.get("warnings") or []
            if isinstance(item, dict) and item.get("code") == "shared_coordinate_clusters"
        )
        if int(review.get("requests_used") or 0) != 0 or review.get("live_catalog_modified") is not False or review.get("live_serving_index_modified") is not False:
            raise PromotionError(f"{batch}_review did not pass its offline non-mutating gate")
        if int((review.get("counts") or {}).get("sidecar_places") or -1) != child_count:
            raise PromotionError(f"{batch}_review count does not match child input")
        parent_fallbacks += int((review.get("reader_link_actions") or {}).get("used_parent_nps_url") or 0)
        stripped_images += int((review.get("media_policy") or {}).get("stripped_images") or 0)
        if batch == "b3":
            explicit_b3 = len(review.get("parent_page_source_fallbacks") or [])

    if not apply:
        return
    counts = Counter(item["disposition"] for item in dispositions)
    if len(dispositions) != 457 or counts != Counter({"published": 448, "remapped": 3, "canonical_merge": 6}):
        raise PromotionError("child dispositions must be 448 published, 3 remapped, 6 canonical_merge, 0 rejected")
    expected = {
        "shared_coordinate_clusters": 24,
        "parent_page_source_fallbacks_total": 12,
        "parent_page_source_fallbacks_explicit_b3": 9,
        "text_only_images": 89,
    }
    observed = {
        "shared_coordinate_clusters": shared_clusters,
        "parent_page_source_fallbacks_total": parent_fallbacks,
        "parent_page_source_fallbacks_explicit_b3": explicit_b3,
        "text_only_images": stripped_images,
    }
    if observed != expected:
        raise PromotionError(f"accepted child evidence counts changed: {observed}")
    if any(int(reviewed_exceptions.get(key) or -1) != value for key, value in expected.items()):
        raise PromotionError("reviewed child exception counts do not match accepted evidence")
    corrections = reviewed_exceptions.get("child_corrections")
    if not isinstance(corrections, dict) or set(corrections) != set(B08_CHILD_CORRECTIONS):
        raise PromotionError("both exact child corrections are required")
    for source_id, expected_patch in B08_CHILD_CORRECTIONS.items():
        value = corrections[source_id]
        if not isinstance(value, dict) or value.get("set") != expected_patch:
            raise PromotionError(f"child correction changed: {source_id}")
        if not str(value.get("reason") or "").strip() or not str(value.get("source_url") or "").startswith("https://"):
            raise PromotionError(f"child correction lacks source evidence: {source_id}")


def _validate_stage_evidence(
    stage: str,
    evidence: dict[str, Any],
    *,
    apply: bool,
    **context: Any,
) -> dict[str, Any]:
    required = R1_EVIDENCE_IDS if stage == "top_level" else R2_EVIDENCE_IDS
    unknown = sorted(set(evidence) - required)
    if unknown:
        raise PromotionError(f"unrecognized {stage} evidence IDs: {unknown}")
    missing = sorted(required - set(evidence))
    if missing:
        if apply:
            raise PromotionError(f"--apply requires complete {stage} evidence: missing={missing}")
        return {"ready": False, "missing": missing}
    if stage == "top_level":
        _validate_r1_evidence(
            evidence,
            catalog_sha256=context["catalog_sha256"],
            serving_sha256=context["serving_sha256"],
            catalog_count=context["catalog_count"],
            serving_count=context["serving_count"],
            aliases=context["aliases"],
            reviewed_exceptions=context["reviewed_exceptions"],
            serving=context["serving"],
            apply=apply,
        )
    else:
        _validate_r2_evidence(
            evidence,
            child_payloads=context["child_payloads"],
            child_input_refs=context["child_input_refs"],
            dispositions=context["dispositions"],
            reviewed_exceptions=context["reviewed_exceptions"],
            apply=apply,
        )
    return {"ready": True, "evidence_ids": sorted(evidence)}


def _set_correction(record: dict[str, Any], dotted_path: str, value: Any) -> None:
    if dotted_path not in ALLOWED_CHILD_CORRECTION_PATHS:
        raise PromotionError(f"child correction path is not approved: {dotted_path}")
    parts = dotted_path.split(".")
    target = record
    for part in parts[:-1]:
        nested = target.get(part)
        if not isinstance(nested, dict):
            nested = {}
            target[part] = nested
        target = nested
    target[parts[-1]] = value


def _apply_child_corrections(
    children: dict[str, dict[str, Any]],
    reviewed_exceptions: dict[str, Any],
) -> None:
    corrections = reviewed_exceptions.get("child_corrections") or {}
    if not isinstance(corrections, dict):
        raise PromotionError("reviewed_exceptions.child_corrections must be an object")
    for source_id, raw in corrections.items():
        if source_id not in children:
            raise PromotionError(f"child correction references unknown source_id: {source_id}")
        if not isinstance(raw, dict):
            raise PromotionError(f"child correction must be an object: {source_id}")
        reason = str(raw.get("reason") or "").strip()
        source_url = str(raw.get("source_url") or "").strip()
        patch = raw.get("set")
        if not reason or not source_url.startswith("https://") or not isinstance(patch, dict) or not patch:
            raise PromotionError(
                f"child correction requires reason, public HTTPS source_url, and nonempty set: {source_id}"
            )
        for dotted_path, value in sorted(patch.items()):
            _set_correction(children[source_id], str(dotted_path), value)


def _child_source_identity(record: dict[str, Any]) -> str:
    identities = sorted({
        str(value or "").strip().lower()
        for value in record.get("source_ids") or []
        if str(value or "").strip().lower().startswith("nps:item:")
    })
    if len(identities) > 1:
        raise PromotionError(f"child has multiple source-owned NPS identities: {record.get('id')}")
    if identities:
        return identities[0]
    source_pack = record.get("source_pack") if isinstance(record.get("source_pack"), dict) else {}
    nps_item_id = str(source_pack.get("nps_item_id") or "").strip().lower()
    if nps_item_id:
        return f"nps:item:{nps_item_id}"
    return str(record.get("id") or "").strip()


def _index_one_child(record: dict[str, Any], generated_at: int, temp_dir: Path) -> dict[str, Any]:
    path = temp_dir / "child.json"
    payload = {
        "schema_version": 3,
        "catalog_id": "trailhead-explore-public-child-validation",
        "generated_at": generated_at,
        "count": 1,
        "places": [record],
    }
    path.write_bytes(_canonical_bytes(payload))
    index = build_explore_index(path, minimum_reviewable=0, enforce_enrichment_gate=True)
    if len(index.get("items") or []) != 1 or index.get("rejections"):
        reasons = index.get("rejections") or index.get("rejection_reason_counts") or {}
        raise PromotionError(f"child failed canonical serving gate: {record.get('id')}: {reasons}")
    item = dict(index["items"][0])
    item.update({
        "canonical_role": "child",
        "parent_hub_id": record.get("parent_hub_id") or "",
        "parent_hub_title": record.get("parent_hub_title") or "",
        "module_target": record.get("module_target") or "",
        "hidden_from_featured": True,
    })
    return item


def _merge_serving_by_identity(
    base: dict[str, Any],
    child_items: list[dict[str, Any]],
    aliases: list[dict[str, str]],
    *,
    generated_at: int,
    child_source_count: int,
    catalog_id: str,
) -> dict[str, Any]:
    alias_sources = {item["from_id"] for item in aliases}
    by_id: dict[str, dict[str, Any]] = {}
    for item in base.get("items") or []:
        item_id = str(item.get("id") or "").strip()
        if item_id and item_id not in alias_sources:
            by_id[item_id] = dict(item)
    for item in child_items:
        item_id = str(item.get("id") or "").strip()
        if not item_id:
            raise PromotionError("canonical child item is missing an ID")
        if item_id in by_id:
            raise PromotionError(f"published child collides with existing public ID: {item_id}")
        by_id[item_id] = item
    items = sorted(by_id.values(), key=explore_serving_sort_key)
    accepted_ids = set(by_id)
    rejections = [
        dict(item)
        for item in base.get("rejections") or []
        if isinstance(item, dict) and str(item.get("id") or "") not in accepted_ids
    ]
    rejections.sort(
        key=lambda item: (
            item.get("rejection_reasons") or [],
            str(item.get("title") or "").casefold(),
            str(item.get("id") or ""),
        )
    )
    rejection_counts = Counter(
        str(reason)
        for item in rejections
        for reason in item.get("rejection_reasons") or []
    )
    grade_counts = Counter(str(item.get("enrichment_grade") or "candidate") for item in items)
    filter_counts, missing_filters = explore_filter_coverage(items)
    minimum = int((base.get("gate") or {}).get("minimum_reviewable") or 4000)
    catalogs = [dict(item) for item in base.get("catalogs") or [] if isinstance(item, dict)]
    catalogs.append({
        "catalog_id": catalog_id,
        "generated_at": generated_at,
        "source_count": child_source_count,
    })
    return {
        "schema_version": 2,
        "generated_at": generated_at,
        "catalogs": catalogs,
        "source_count": int(base.get("source_count") or 0) + child_source_count,
        "count": len(items),
        "reviewable_count": len(items),
        "grade_counts": dict(sorted(grade_counts.items())),
        "rejection_reason_counts": dict(sorted(rejection_counts.items())),
        "filter_counts": filter_counts,
        "missing_filters": missing_filters,
        "rejections": rejections,
        "gate": {
            "minimum_reviewable": minimum,
            "reviewable_count": len(items),
            "passed": len(items) >= minimum,
        },
        "items": items,
    }


def _build_child_depth(
    base_catalog: dict[str, Any],
    base_serving: dict[str, Any],
    child_payloads: list[tuple[str, dict[str, Any]]],
    dispositions: list[dict[str, str]],
    aliases: list[dict[str, str]],
    reviewed_exceptions: dict[str, Any],
    release_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    base_places = _records(base_catalog, "places", "base catalog")
    _records(base_serving, "items", "base serving index")
    children: dict[str, dict[str, Any]] = {}
    generated_at = int(base_catalog.get("generated_at") or 0)
    for input_id, payload in child_payloads:
        generated_at = max(generated_at, int(payload.get("generated_at") or 0))
        for child in _records(payload, "places", f"child input {input_id}"):
            source_id = _child_source_identity(child)
            if not source_id:
                raise PromotionError(f"child lacks a stable source identity: {child.get('id')}")
            if source_id in children:
                raise PromotionError(f"child source ID appears in multiple batches: {source_id}")
            children[source_id] = copy.deepcopy(child)
    disposition_by_id = {item["source_id"]: item for item in dispositions}
    missing = sorted(set(children) - set(disposition_by_id))
    extra = sorted(set(disposition_by_id) - set(children))
    if missing or extra:
        raise PromotionError(
            f"child dispositions are incomplete: missing={missing[:12]} extra={extra[:12]}"
        )
    _apply_child_corrections(children, reviewed_exceptions)

    alias_sources = {item["from_id"] for item in aliases}
    catalog_by_id = {
        str(item.get("id") or ""): copy.deepcopy(item)
        for item in base_places
        if str(item.get("id") or "") not in alias_sources
    }
    existing_public_ids = set(catalog_by_id) | {
        str(item.get("id") or "") for item in base_serving.get("items") or []
    }
    public_children: list[dict[str, Any]] = []
    for source_id in sorted(children):
        disposition = disposition_by_id[source_id]
        kind = disposition["disposition"]
        public_id = disposition["public_id"]
        if kind == "rejected":
            continue
        if kind == "canonical_merge":
            if public_id not in existing_public_ids:
                raise PromotionError(
                    f"canonical_merge target does not exist in current public artifacts: {source_id} -> {public_id}"
                )
            continue
        child = children[source_id]
        child["id"] = public_id
        child["canonical_role"] = "child"
        child["hidden_from_featured"] = True
        source_ids = [str(value) for value in child.get("source_ids") or [] if str(value).strip()]
        if source_id not in source_ids:
            source_ids.append(source_id)
        child["source_ids"] = source_ids
        if not str(child.get("parent_hub_id") or "").strip() or not str(child.get("module_target") or "").strip():
            raise PromotionError(f"published child lacks parent/module binding: {source_id}")
        if public_id in catalog_by_id:
            raise PromotionError(f"published child collides with full-catalog ID: {public_id}")
        catalog_by_id[public_id] = child
        public_children.append(child)

    final_public_ids = set(catalog_by_id) | {
        str(item.get("id") or "")
        for item in base_serving.get("items") or []
        if str(item.get("id") or "") not in alias_sources
    }
    for alias in aliases:
        if alias["to_id"] not in final_public_ids:
            raise PromotionError(f"alias target is absent from release: {alias['to_id']}")
    for child in public_children:
        if str(child.get("parent_hub_id") or "") not in final_public_ids:
            raise PromotionError(f"child parent is absent from release: {child.get('id')}")

    catalog = dict(base_catalog)
    catalog.update({
        "schema_version": 3,
        "catalog_id": f"trailhead-explore-public-{release_id}",
        "generated_at": generated_at,
        "source": "Trailhead reviewed public Explore promotion",
        "count": len(catalog_by_id),
        "places": [catalog_by_id[item_id] for item_id in sorted(catalog_by_id)],
    })

    with tempfile.TemporaryDirectory(prefix="trailhead-explore-child-index-") as temp:
        temp_dir = Path(temp)
        child_items = [
            _index_one_child(child, generated_at, temp_dir)
            for child in sorted(public_children, key=lambda item: str(item.get("id") or ""))
        ]
    serving = _merge_serving_by_identity(
        base_serving,
        child_items,
        aliases,
        generated_at=generated_at,
        child_source_count=len(children),
        catalog_id=catalog["catalog_id"],
    )
    if not serving["gate"]["passed"]:
        raise PromotionError("child-depth serving gate did not pass")
    return catalog, serving


def _validate_alias_targets(
    aliases: list[dict[str, str]],
    catalog: dict[str, Any],
    serving: dict[str, Any],
) -> None:
    ids = {
        str(item.get("id") or "")
        for item in [*(catalog.get("places") or []), *(serving.get("items") or [])]
        if isinstance(item, dict)
    }
    for alias in aliases:
        if alias["to_id"] not in ids:
            raise PromotionError(f"alias target is absent from release: {alias['to_id']}")
        if alias["from_id"] in ids:
            raise PromotionError(f"alias source remains in release artifacts: {alias['from_id']}")


def _git_dirty_paths(repo_root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "status", "--porcelain=v1", "--untracked-files=all"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def _atomic_write_release(target: Path, files: dict[str, bytes]) -> None:
    if target.exists():
        raise PromotionError(f"immutable release already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.parent / f".{target.name}.tmp-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        for name, data in files.items():
            destination = staging / name
            destination.write_bytes(data)
        staging.replace(target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def promote(args: argparse.Namespace, *, repo_root: Path = ROOT) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    source_root = Path(getattr(args, "source_root", repo_root)).resolve()
    release_id = str(args.release_id or "").strip()
    if not RELEASE_ID_RE.fullmatch(release_id):
        raise PromotionError("release_id must be 1-96 safe filename characters")
    stage = str(args.stage or "").strip()
    if stage not in {"top_level", "child_depth"}:
        raise PromotionError("stage must be top_level or child_depth")

    output_root = _repo_path(repo_root, args.output_root, must_exist=False)
    expected_output_root = (repo_root / "dashboard" / "explore_releases").resolve()
    if output_root != expected_output_root:
        raise PromotionError("public releases must be written beneath dashboard/explore_releases")
    target = output_root / release_id
    if target.exists():
        raise PromotionError(f"immutable release already exists: {_relative(repo_root, target)}")
    target_rel = _relative(repo_root, target)
    if any(target_rel == path or target_rel.startswith(f"{path}/") for path in PROTECTED_OUTPUTS):
        raise PromotionError("release output may not target a protected live artifact")
    if args.apply:
        dirty = _git_dirty_paths(repo_root)
        if dirty:
            raise PromotionError(f"--apply requires a clean worktree: {dirty[:12]}")

    catalog_input, catalog_input_logical = _input_path(repo_root, source_root, args.catalog_input)
    serving_input, serving_input_logical = _input_path(repo_root, source_root, args.serving_input)
    current_catalog = _repo_path(repo_root, args.current_catalog)
    current_serving = _repo_path(repo_root, args.current_serving)
    aliases_path, aliases_logical = _input_path(repo_root, source_root, args.aliases)
    dispositions_path, dispositions_logical = _input_path(repo_root, source_root, args.child_dispositions)
    exceptions_path, exceptions_logical = _input_path(repo_root, source_root, args.reviewed_exceptions)
    expected_catalog_hash = _validate_sha(args.expected_current_catalog_sha256, "expected current catalog hash")
    expected_serving_hash = _validate_sha(args.expected_current_serving_sha256, "expected current serving hash")
    _validate_current_hashes(
        current_catalog,
        current_serving,
        expected_catalog_hash,
        expected_serving_hash,
    )

    catalog_payload = _load_json(catalog_input)
    serving_payload = _load_json(serving_input)
    catalog, _ = _validate_catalog(catalog_payload, "catalog input")
    serving, _ = _validate_serving(serving_payload, "serving input")
    aliases, aliases_raw = _load_aliases(aliases_path)
    dispositions, dispositions_raw = _load_dispositions(dispositions_path)
    reviewed_exceptions = _require_object(_load_json(exceptions_path), "reviewed exceptions")

    child_payloads: list[tuple[str, dict[str, Any]]] = []
    child_input_refs: list[tuple[str, Path, str, Any]] = []
    evidence_input_refs: list[tuple[str, Path, str, Any]] = []
    seen_input_ids: set[str] = {
        "catalog_input",
        "serving_input",
        "aliases",
        "child_dispositions",
        "reviewed_exceptions",
    }
    for raw in args.child_input or []:
        if "=" not in raw:
            raise PromotionError("--child-input must use id=repo/relative/path.json")
        input_id, raw_path = raw.split("=", 1)
        input_id = input_id.strip()
        if not input_id or input_id in seen_input_ids:
            raise PromotionError(f"invalid or duplicate child input ID: {input_id}")
        seen_input_ids.add(input_id)
        path, logical_path = _input_path(repo_root, source_root, raw_path.strip())
        payload = _require_object(_load_json(path), f"child input {input_id}")
        child_payloads.append((input_id, payload))
        child_input_refs.append((input_id, path, logical_path, payload))

    for raw in getattr(args, "evidence_input", None) or []:
        if "=" not in raw:
            raise PromotionError("--evidence-input must use id=repo/relative/path.json")
        input_id, raw_path = raw.split("=", 1)
        input_id = input_id.strip()
        if not input_id or input_id in seen_input_ids:
            raise PromotionError(f"duplicate manifest input ID: {input_id or '<missing>'}")
        seen_input_ids.add(input_id)
        path, logical_path = _input_path(repo_root, source_root, raw_path.strip())
        payload = _load_json(path)
        evidence_input_refs.append((input_id, path, logical_path, payload))

    if stage == "top_level":
        if child_payloads or dispositions:
            raise PromotionError("top_level releases must have no child inputs or child dispositions")
        output_catalog = copy.deepcopy(catalog)
        output_serving = copy.deepcopy(serving)
    else:
        if not child_payloads:
            raise PromotionError("child_depth releases require at least one --child-input")
        if args.apply and any(item["disposition"] == "rejected" for item in dispositions):
            raise PromotionError("child_depth --apply refuses unresolved rejected dispositions")
        output_catalog, output_serving = _build_child_depth(
            catalog,
            serving,
            child_payloads,
            dispositions,
            aliases,
            reviewed_exceptions,
            release_id,
        )

    _validate_alias_targets(aliases, output_catalog, output_serving)
    output_catalog["count"] = len(output_catalog.get("places") or [])
    output_serving["count"] = len(output_serving.get("items") or [])
    output_serving["reviewable_count"] = len(output_serving.get("items") or [])
    if output_catalog["count"] != int(args.expected_catalog_count):
        raise PromotionError(
            f"catalog count mismatch: expected {args.expected_catalog_count}, got {output_catalog['count']}"
        )
    if output_serving["count"] != int(args.expected_serving_count):
        raise PromotionError(
            f"serving count mismatch: expected {args.expected_serving_count}, got {output_serving['count']}"
        )

    catalog_bytes = _canonical_bytes(output_catalog)
    serving_bytes = _canonical_bytes(output_serving)
    catalog_rel = f"{target_rel}/explore_catalog_v3.json"
    serving_rel = f"{target_rel}/explore_serving_index_v2.json"
    manifest_rel = f"{target_rel}/manifest.json"

    inputs = [
        _input_ref("catalog_input", catalog_input, catalog_input_logical, catalog_payload),
        _input_ref("serving_input", serving_input, serving_input_logical, serving_payload),
        _input_ref("aliases", aliases_path, aliases_logical, aliases_raw),
        _input_ref("child_dispositions", dispositions_path, dispositions_logical, dispositions_raw),
        _input_ref("reviewed_exceptions", exceptions_path, exceptions_logical, reviewed_exceptions),
        *[
            _input_ref(input_id, path, logical_path, payload)
            for input_id, path, logical_path, payload in sorted(child_input_refs, key=lambda item: item[0])
        ],
        *[
            _input_ref(input_id, path, logical_path, payload)
            for input_id, path, logical_path, payload in sorted(evidence_input_refs, key=lambda item: item[0])
        ],
    ]
    input_ids = [item["id"] for item in inputs]
    if len(input_ids) != len(set(input_ids)):
        raise PromotionError("manifest input IDs must be unique")

    evidence = {
        input_id: _require_object(payload, f"evidence {input_id}")
        for input_id, _path, _logical_path, payload in evidence_input_refs
    }
    _validate_stage_evidence(
        stage,
        evidence,
        apply=bool(args.apply),
        catalog_sha256=_sha256(catalog_input),
        serving_sha256=_sha256(serving_input),
        catalog_count=output_catalog["count"],
        serving_count=output_serving["count"],
        aliases=aliases,
        reviewed_exceptions=reviewed_exceptions,
        serving=output_serving,
        child_payloads=child_payloads,
        child_input_refs=child_input_refs,
        dispositions=dispositions,
    )

    expected_current_release_id = str(args.expected_current_release_id or "").strip()
    rollback_release_id = str(args.rollback_release_id or "").strip()
    if not expected_current_release_id:
        raise PromotionError("expected current release_id is required")
    if rollback_release_id != expected_current_release_id:
        raise PromotionError("rollback release_id must match expected_current release_id")
    rollback_git_commit = _validate_commit_sha(args.rollback_git_commit)
    rollback_railway_deployment_id = _validate_railway_uuid(args.rollback_railway_deployment_id)
    rollback_manifest_path = _repo_path(repo_root, args.rollback_manifest_path, must_exist=False)
    _validate_rollback_manifest(
        rollback_manifest_path,
        expected_release_id=expected_current_release_id,
        expected_catalog_sha256=expected_catalog_hash,
        expected_serving_sha256=expected_serving_hash,
        required=bool(args.apply),
    )
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "release_id": release_id,
        "stage": stage,
        "expected_current": {
            "release_id": expected_current_release_id,
            "catalog_v3_sha256": expected_catalog_hash,
            "serving_index_sha256": expected_serving_hash,
        },
        "inputs": inputs,
        "artifacts": {
            "catalog_v3": {
                "path": catalog_rel,
                "sha256": _sha256_bytes(catalog_bytes),
                "count": output_catalog["count"],
            },
            "serving_index": {
                "path": serving_rel,
                "sha256": _sha256_bytes(serving_bytes),
                "count": output_serving["count"],
            },
        },
        "aliases": aliases,
        "child_dispositions": dispositions,
        "reviewed_exceptions": reviewed_exceptions,
        "rollback": {
            "release_id": rollback_release_id,
            "git_commit": rollback_git_commit,
            "railway_deployment_id": rollback_railway_deployment_id,
            "manifest_path": _relative(repo_root, rollback_manifest_path),
        },
    }
    if not all(manifest["rollback"].values()):
        raise PromotionError("all rollback fields are required")
    manifest_bytes = _canonical_bytes(manifest)

    if args.apply:
        _atomic_write_release(target, {
            "explore_catalog_v3.json": catalog_bytes,
            "explore_serving_index_v2.json": serving_bytes,
            "manifest.json": manifest_bytes,
        })

    return {
        "applied": bool(args.apply),
        "release_id": release_id,
        "stage": stage,
        "target": target_rel,
        "catalog_count": output_catalog["count"],
        "serving_count": output_serving["count"],
        "catalog_sha256": manifest["artifacts"]["catalog_v3"]["sha256"],
        "serving_sha256": manifest["artifacts"]["serving_index"]["sha256"],
        "manifest_sha256": _sha256_bytes(manifest_bytes),
        "manifest": manifest,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--stage", choices=("top_level", "child_depth"), required=True)
    parser.add_argument("--catalog-input", required=True)
    parser.add_argument("--serving-input", required=True)
    parser.add_argument("--child-input", action="append", default=[])
    parser.add_argument(
        "--evidence-input",
        action="append",
        default=[],
        help="hash-pin review evidence as id=path without merging it into release artifacts",
    )
    parser.add_argument("--aliases", required=True)
    parser.add_argument("--child-dispositions", required=True)
    parser.add_argument("--reviewed-exceptions", required=True)
    parser.add_argument("--current-catalog", required=True)
    parser.add_argument("--current-serving", required=True)
    parser.add_argument("--expected-current-release-id", required=True)
    parser.add_argument("--expected-current-catalog-sha256", required=True)
    parser.add_argument("--expected-current-serving-sha256", required=True)
    parser.add_argument("--expected-catalog-count", type=int, required=True)
    parser.add_argument("--expected-serving-count", type=int, required=True)
    parser.add_argument("--rollback-release-id", required=True)
    parser.add_argument("--rollback-git-commit", required=True)
    parser.add_argument("--rollback-railway-deployment-id", required=True)
    parser.add_argument("--rollback-manifest-path", required=True)
    parser.add_argument("--output-root", default="dashboard/explore_releases")
    parser.add_argument("--repo-root", default=str(ROOT), help=argparse.SUPPRESS)
    parser.add_argument(
        "--source-root",
        default=str(ROOT),
        help="alternate Trailhead checkout containing gitignored candidate inputs",
    )
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = promote(args, repo_root=Path(args.repo_root))
    except (PromotionError, OSError, subprocess.CalledProcessError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    printable = {key: value for key, value in report.items() if key != "manifest"}
    print(json.dumps(printable, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
