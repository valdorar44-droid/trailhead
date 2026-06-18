#!/usr/bin/env python3
"""Static QA for Stage 9 native navigation surface guardrails."""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_CONFIG = ROOT / "mobile/app.config.js"
ANDROID_MANIFEST = ROOT / "mobile/android/app/src/main/AndroidManifest.xml"
SERVER = ROOT / "dashboard/server.py"
EXTREME_TESTS = ROOT / "tests/test_extreme_explorer.py"
AUDIT = ROOT / "docs/adventure-readiness-stage-9-navigation-surfaces-audit.md"


def read(path: Path) -> str:
    return path.read_text()


def main() -> int:
    failures: list[str] = []
    app_config = read(APP_CONFIG)
    manifest = read(ANDROID_MANIFEST)
    server = read(SERVER)
    tests = read(EXTREME_TESTS)
    audit = read(AUDIT) if AUDIT.exists() else ""

    config_markers = {
        "android background disabled": "isAndroidBackgroundLocationEnabled: false",
        "android foreground service disabled": "isAndroidForegroundServiceEnabled: false",
        "blocked background permission": "'android.permission.ACCESS_BACKGROUND_LOCATION'",
        "blocked foreground service": "'android.permission.FOREGROUND_SERVICE'",
        "blocked foreground service location": "'android.permission.FOREGROUND_SERVICE_LOCATION'",
    }
    for label, marker in config_markers.items():
        if marker not in app_config:
            failures.append(f"Missing app config marker for {label}: {marker}")

    manifest_markers = {
        "manifest removes background": 'android.permission.ACCESS_BACKGROUND_LOCATION" tools:node="remove"',
        "manifest removes foreground service": 'android.permission.FOREGROUND_SERVICE" tools:node="remove"',
        "manifest removes location foreground service": 'android.permission.FOREGROUND_SERVICE_LOCATION" tools:node="remove"',
        "location task service removed": 'expo.modules.location.services.LocationTaskService" tools:node="remove"',
    }
    for label, marker in manifest_markers.items():
        if marker not in manifest:
            failures.append(f"Missing Android manifest marker for {label}: {marker}")

    if "androidx.car.app.category.NAVIGATION" in manifest:
        failures.append("Android Auto navigation category is present before the separate native review lane is ready")

    server_markers = {
        "navigation confirmation": "acknowledged_billing",
        "free drive block": "extreme_free_drive_blocked",
        "free drive never authorized": '"free_drive_authorized": False',
        "explicit authorization flag": '"requires_explicit_authorization": True',
        "no free drive in config": '"free_drive": False',
    }
    for label, marker in server_markers.items():
        if marker not in server:
            failures.append(f"Missing server guardrail marker for {label}: {marker}")

    test_markers = {
        "navigation guardrail test": "test_navigation_authorization_requires_confirmation_and_blocks_free_drive",
        "free drive assertion": "self.assertFalse(result[\"free_drive_authorized\"])",
    }
    for label, marker in test_markers.items():
        if marker not in tests:
            failures.append(f"Missing test marker for {label}: {marker}")

    audit_markers = {
        "CarPlay entitlement request package": "CarPlay entitlement request package",
        "bundle id": "com.trailhead.app",
        "Mapbox free drive guardrail": "startFreeDriveAutomatically",
        "ActivityKit spike": "ActivityKit",
        "APNs update path": "APNs",
        "Android Auto manifest plan": "androidx.car.app.category.NAVIGATION",
        "native separate from OTA": "native work is separated from OTA",
        "hardware validation": "real hardware",
    }
    for label, marker in audit_markers.items():
        if marker not in audit:
            failures.append(f"Missing audit marker for {label}: {marker}")

    print("Navigation surfaces QA matrix")
    print("Checks: CarPlay package, Live Activity spike, Android Auto deferral, Mapbox billing guardrails")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: native navigation surface guardrails are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
