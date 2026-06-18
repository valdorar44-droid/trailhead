#!/usr/bin/env python3
"""Static QA for map filter, inline search, and Co-Pilot theme guardrails."""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAP_SCREEN = ROOT / "mobile/app/(tabs)/map.tsx"
FILTER_SHEET = ROOT / "mobile/components/map/MapFilterSheet.tsx"
NATIVE_MAP = ROOT / "mobile/components/NativeMap/index.tsx"
WEB_MAP = ROOT / "mobile/components/NativeMap/index.web.tsx"
SERVER = ROOT / "dashboard/server.py"


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
    native_map = read(NATIVE_MAP)
    web_map = read(WEB_MAP)
    server = read(SERVER)

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
        "scoped map search state": "const [mapSearchSession, setMapSearchSession] = useState<ScopedMapSearchSession | null>(null);",
        "scoped map search parser": "function parseScopedMapSearchQuery(query: string): ScopedMapSearchIntent | null",
        "scoped map search runner": "async function runScopedMapSearch(intent: ScopedMapSearchIntent)",
        "scoped search center geocode": "geocodePrefer: 'search_center'",
        "scoped map search active state": "const scopedMapSearchActive = Boolean(mapSearchSession",
        "scoped search poi override": "const scopedMapSearchPois = scopedMapSearchActive ?",
        "scoped search map status hide": "hideMapStatusBadge={scopedMapSearchActive}",
        "scoped search chrome rail": "scopedSearchRail",
        "android compass jump filter": "const lastAndroidHeadingRef = useRef<{ at: number; raw: number; smooth: number } | null>(null);",
        "android compass delta helper": "function angleDeltaDeg(a: number, b: number)",
        "inline search opener": "function openInlineMapSearch()",
        "inline search chrome": "inlineMapSearchWrap",
        "search button opens inline": "onPress={openInlineMapSearch}",
        "extreme search opens inline": "val: inlineSearchOpen",
        "tap tool ownership state": "const mapTapToolOwnsFeatureSelection = Boolean(",
        "trail builder owns feature taps": "trailRouteBuilderOpen ||",
        "trail trace owns feature taps": "trailTraceMode ||",
        "trail builder ignores map taps": "if (trailTraceMode || trailRouteBuilderOpen) {",
        "map passes suppress feature taps": "suppressFeatureTaps={mapTapToolOwnsFeatureSelection}",
        "inline search map tap dismissal": "closeInlineMapSearch(false);",
        "map controls collapse state": "const [mapControlsCollapsed, setMapControlsCollapsed] = useState(false);",
        "map controls collapse action": "setMapControlsCollapsed(value => !value)",
        "trail tool quick message lift": "const trailToolPanelActive = trailPinCaptureMode || trailTraceMode || trailRouteBuilderOpen;",
        "quick map message guard": "const showQuickMapMessage = Boolean(",
        "quick toast two-line clamp": "numberOfLines={2}>{quickToast}</Text>",
        "preserve geocode source label": "source_label: place.source_label || (place.source === 'mapbox'",
        "copilot accent text": "const copilotAccentText = themeMode === 'light'",
        "copilot themed backdrop": "const copilotBackdrop = light ?",
        "copilot themed placeholder": "placeholderTextColor={C.text3}",
    }
    for label, marker in map_required.items():
        if marker not in map_screen:
            failures.append(f"Missing map marker for {label}: {marker}")

    filter_sheet_required = {
        "android viewport fallback": "const { height: viewportHeight } = useWindowDimensions();",
        "platform safe sheet height": "const sheetHeight = React.useMemo(() => {",
        "android sheet style": "styles.androidSheet",
        "filter flex body": "contentStyle={{ padding: 0, flex: 1 }}",
        "ios explicit sheet height": "styles.iosSheet, { height: sheetHeight }",
        "android elevated overlay": "zIndex: 20000",
    }
    for label, marker in filter_sheet_required.items():
        if marker not in filter_sheet:
            failures.append(f"Missing filter sheet marker for {label}: {marker}")

    server_required = {
        "explore geocode helper": "def _explore_catalog_geocode_candidates(",
        "explore geocode source": '"source": "trailhead_explore"',
        "geocode explore merge": "explore_candidates = _explore_catalog_geocode_candidates(query, limit, country_filter)",
        "search center preference helper": "def _geocode_prefer_search_center(prefer: str) -> bool:",
        "search center endpoint param": 'async def geocode_places(q: str, limit: int = 8, countrycodes: str = "", prefer: str = ""):',
        "strong explore geocode short circuit": "if not prefer_search_center and _strong_explore_geocode_hit(explore_candidates):",
        "search center geocode merge": "groups = [canonical_landmarks, places, explore_candidates] if prefer_search_center else [explore_candidates, canonical_landmarks, places]",
        "road query protection": "def _geocode_query_is_road(query: str) -> bool:",
    }
    for label, marker in server_required.items():
        if marker not in server:
            failures.append(f"Missing server search marker for {label}: {marker}")

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

    native_required = {
        "native suppress prop": "suppressFeatureTaps?: boolean;",
        "native standard tap guard": "if (suppressFeatureTapsRef.current) return;",
        "native press guard": "if (suppressFeatureTaps) {\n        onMapTap(lat, lng);",
        "native camp guard": "if (suppressFeatureTaps) {\n      onMapTap(coords?.[1], coords?.[0]);",
        "native marker guard": "suppressFeatureTaps ? onMapTap(poi.lat, poi.lng)",
        "native map status hide prop": "hideMapStatusBadge?: boolean;",
        "native map status hidden": "{!hideMapStatusBadge && (",
        "native user camera cancellation": "programmaticCameraUntilRef.current = 0;",
        "native pending camera cancellation": "pendingFreeCameraRef.current = null;",
    }
    for label, marker in native_required.items():
        if marker not in native_map:
            failures.append(f"Missing native map tap guard for {label}: {marker}")

    web_required = {
        "web suppress prop": "suppressFeatureTaps?: boolean;",
        "web click guard": "if (suppressFeatureTapsRef.current) {",
        "web marker guard": "props.suppressFeatureTaps ? props.onMapTap(p.lat, p.lng)",
    }
    for label, marker in web_required.items():
        if marker not in web_map:
            failures.append(f"Missing web map tap guard for {label}: {marker}")

    print("Map filter/search QA matrix")
    print("Checks: top-level legend modal, filter-only map presets, inline map search, Trailhead Explore search, tap ownership, Android filter height, map tool collapse, themed Co-Pilot controls")

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
