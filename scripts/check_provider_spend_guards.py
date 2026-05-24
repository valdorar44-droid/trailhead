"""Static guard for accidental provider spend in mobile typing handlers."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE_FILES = [
    ROOT / "mobile/app/(tabs)/map.tsx",
    ROOT / "mobile/app/(tabs)/route-builder.tsx",
    ROOT / "mobile/components/RouteSearchModal.tsx",
]
PROVIDER_CALLS = (
    "api.geocodePlaces",
    "api.getSearchPlaceCard",
    "api.resolveMapCard",
    "api.getNearbyPlaces",
    "api.getNearbySmartPack",
    "api.getPlaceDetail",
)


def main() -> int:
    failures: list[str] = []
    for path in MOBILE_FILES:
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        for idx, line in enumerate(lines):
            if "onChangeText" not in line:
                continue
            window = "\n".join(lines[idx : idx + 8])
            if any(call in window for call in PROVIDER_CALLS):
                failures.append(f"{path.relative_to(ROOT)}:{idx + 1}")
    if failures:
        print("Provider calls found near onChangeText handlers:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("OK: no provider calls are wired directly to mobile onChangeText handlers.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
