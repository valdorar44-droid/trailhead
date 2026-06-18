#!/usr/bin/env python3
"""Static QA for map filter, inline search, and Co-Pilot theme guardrails."""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAP_SCREEN = ROOT / "mobile/app/(tabs)/map.tsx"
FILTER_SHEET = ROOT / "mobile/components/map/MapFilterSheet.tsx"


def read(path: Path) -> str:
    return path.read_text()


def between(text: str, start: str, end: str) -> str:
    start_idx = text.find(start)
    if start_idx == -1:
        return ""
    end_idx = text.find(end, start_idx)
    if end_idx == -1:
        return text[start_idx:]
    return text[start_idx:end_idx]


def main() -> int:
    failures: list[str] = []
    map_screen = read(MAP_SCREEN)
    filter_sheet = read(FILTER_SHEET)

    if "MapLegendSheet" in filter_sheet:
        failures.append("MapFilterSheet still imports or renders MapLegendSheet; legend must be top-level on iOS.")
    if "legendVisible" in filter_sheet:
        failures.append("MapFilterSheet still owns legendVisible state; legend state must live in the map screen.")
    if "onOpenLegend" not in filter_sheet:
        failures.append("MapFilterSheet is missing the onOpenLegend callback prop.")

    map_required = {
        "top-level legend import": "import MapLegendSheet from '@/components/map/MapLegendSheet';",
        "legend sheet state": "const [showMapLegendSheet, setShowMapLegendSheet] = useState(false);",
        "legend open callback": "const openMapFilterLegend = () =>",
        "legend rendered as sibling": "<MapLegendSheet",
        "filter callback wired": "onOpenLegend={openMapFilterLegend}",
        "inline search state": "const [inlineSearchOpen, setInlineSearchOpen] = useState(false);",
        "inline search opener": "function openInlineMapSearch()",
        "inline search chrome": "inlineMapSearchWrap",
        "search button opens inline": "onPress={openInlineMapSearch}",
        "extreme search opens inline": "val: inlineSearchOpen",
        "copilot accent text": "const copilotAccentText = themeMode === 'light'",
        "copilot themed backdrop": "const copilotBackdrop = light ?",
        "copilot themed placeholder": "placeholderTextColor={C.text3}",
    }
    for label, marker in map_required.items():
        if marker not in map_screen:
            failures.append(f"Missing map marker for {label}: {marker}")

    preset_block = between(map_screen, "const applyMapFilterPreset = (preset: MapModePresetId) => {", "const showMapStatusBar = Boolean(")
    if not preset_block:
        failures.append("Could not locate applyMapFilterPreset block.")
    else:
        forbidden_calls = [
            "applyMapLayer(",
            "toggleDataLayer(",
            "closeSafeWaterMode(",
            "toggleLandOverlay(",
            "toggleUsgsOverlay(",
            "togglePoiOverlay(",
            "setLayerTrails(",
            "setLayerFire(",
            "setLayerAva(",
            "setLayerRadar(",
            "setLayerMvum(",
            "setLayerNautical(",
        ]
        for call in forbidden_calls:
            if call in preset_block:
                failures.append(f"Map mode presets still perform layer/style side effects: {call}")
        for preset_id in ["default", "tonight", "remoteRoute", "overland", "trailDay", "familyEasy", "weatherRisk", "waterFish", "townReset"]:
            if re.search(rf"preset === ['\"]{preset_id}['\"]", preset_block) is None:
                failures.append(f"Map mode preset branch missing: {preset_id}")

    copilot_modal = between(map_screen, "<Modal visible={showExtremeCopilot && !navMode}", "<MapFilterSheet")
    if 'color="#050505"' in copilot_modal or "color={'#050505'}" in copilot_modal:
        failures.append("Co-Pilot modal still hard-codes black icon colors instead of theme accent text.")
    if "OVR.text3" in copilot_modal:
        failures.append("Co-Pilot modal still uses overlay placeholder text instead of app theme text.")

    print("Map filter/search QA matrix")
    print("Checks: top-level legend modal, filter-only map presets, inline map search, themed Co-Pilot controls")

    if failures:
        print("")
        print("Failures")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: map filter/search guardrails are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
