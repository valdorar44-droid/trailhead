"""Privacy-minimized, server-owned vehicle binding for Originals readiness."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


class OriginalVehicleBindingError(ValueError):
    """Raised when a vehicle binding payload cannot be trusted."""


ORIGINAL_VEHICLE_KINDS = {
    "passenger",
    "motorcycle",
    "motorhome",
    "bus",
    "commercial_service",
    "van_camper",
    "other",
}

ORIGINAL_OPERATIONAL_VEHICLE_CLASSES = {
    "passenger",
    "motorcycle",
    "motorhome",
    "bus",
    "commercial_service",
    "towing_trailer",
    "van_over_25_ft",
}

_BINDING_INPUT_KEYS = {"vehicle_kind", "vehicle_length_ft", "is_towing"}


def normalize_original_vehicle_binding_input(value: object) -> dict[str, Any]:
    """Return the minimal canonical rig projection used by operational checks."""

    if not isinstance(value, dict):
        raise OriginalVehicleBindingError("Vehicle binding must be an object")
    unsupported = set(value) - _BINDING_INPUT_KEYS
    if unsupported:
        raise OriginalVehicleBindingError("Vehicle binding contains unsupported fields")
    missing = _BINDING_INPUT_KEYS - set(value)
    if missing:
        raise OriginalVehicleBindingError("Vehicle binding is incomplete")

    vehicle_kind = value.get("vehicle_kind")
    if not isinstance(vehicle_kind, str) or vehicle_kind not in ORIGINAL_VEHICLE_KINDS:
        raise OriginalVehicleBindingError("Vehicle kind is unsupported")

    is_towing = value.get("is_towing")
    if type(is_towing) is not bool:
        raise OriginalVehicleBindingError("Towing selection must be true or false")

    raw_length = value.get("vehicle_length_ft")
    vehicle_length_ft: float | None
    if raw_length is None:
        vehicle_length_ft = None
    elif isinstance(raw_length, bool) or not isinstance(raw_length, (int, float)):
        raise OriginalVehicleBindingError("Vehicle length must be a number")
    else:
        vehicle_length_ft = float(raw_length)
        if not math.isfinite(vehicle_length_ft) or not 1 <= vehicle_length_ft <= 100:
            raise OriginalVehicleBindingError("Vehicle length is outside the supported range")
        vehicle_length_ft = round(vehicle_length_ft, 2)

    return {
        "vehicle_kind": vehicle_kind,
        "vehicle_length_ft": vehicle_length_ft,
        "is_towing": is_towing,
    }


def derive_original_vehicle_class(profile: object) -> str | None:
    """Derive the restriction class conservatively; ambiguous profiles return None."""

    normalized = normalize_original_vehicle_binding_input(profile)
    if normalized["is_towing"]:
        return "towing_trailer"
    vehicle_kind = normalized["vehicle_kind"]
    if vehicle_kind in {
        "passenger",
        "motorcycle",
        "motorhome",
        "bus",
        "commercial_service",
    }:
        return vehicle_kind
    if vehicle_kind == "van_camper":
        length = normalized["vehicle_length_ft"]
        if length is None:
            return None
        return "van_over_25_ft" if length > 25 else "passenger"
    return None


def original_vehicle_profile_sha256(profile: object) -> str:
    normalized = normalize_original_vehicle_binding_input(profile)
    encoded = json.dumps(
        normalized,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
