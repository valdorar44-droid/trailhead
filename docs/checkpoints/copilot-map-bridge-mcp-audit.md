# Co-Pilot Map Bridge MCP Audit

Date: 2026-06-28

## Scope

Create a Trailhead-owned tool contract that bridges Co-Pilot, the mobile app, and local MCP clients into the existing map-context, Mapbox-backed temporary-use, route, matrix, and discovery-context backend paths.

## Completed

- Added `/api/copilot/tools` and `/api/extreme/copilot/tools` for authenticated tool discovery.
- Added `/api/copilot/tools/execute` and `/api/extreme/copilot/tools/execute` for authenticated tool execution.
- Tool contract version: `trailhead-copilot-tools-v1`.
- Tools:
  - `trailhead.visible_map_context`
  - `trailhead.search_places`
  - `trailhead.resolve_place`
  - `trailhead.reverse_geocode`
  - `trailhead.route_preview`
  - `trailhead.route_matrix`
  - `trailhead.discovery_context`
- Co-Pilot staged map actions now include `args.tool_bridge` and `map_updates.tool_bridge` metadata so existing `map_action` execution can be audited against the backend bridge.
- Mobile `api.ts` now has typed helpers for listing/executing tools and a direct `mapContextMatrix(...)` helper.
- Added `tools/trailhead-mcp`, a local stdio MCP adapter that proxies all tool calls through Trailhead instead of calling Mapbox directly.
- Realtime Co-Pilot now exposes `trailhead_tool` alongside `map_action`. `trailhead_tool` is read-only and calls the same backend bridge; `map_action` remains the path for UI changes, selections, navigation, saves, reports, downloads, and confirmations.
- Mobile realtime voice now parses `trailhead_tool`, executes it through `api.executeCopilotTool(...)`, and returns a compact voice-safe summary to the realtime model.

## Audit Notes

- Existing Mapbox temporary-use handling remains centralized in the current `/api/map-context/*` endpoints.
- Discovery remains centralized in `/api/discovery/context`; the MCP adapter does not call source providers directly.
- The bridge uses current Explorer/Co-Pilot entitlement checks before listing or executing tools.
- Tool execution adds bridge metadata to request metadata and ledger events without changing existing map-context response bodies.
- Realtime Co-Pilot exposes both `map_action` and direct read-only `trailhead_tool` execution.
- Mapbox-backed Explorer map layers remain free for signed-in users. Co-Pilot and AI Planner are Explorer AI entitlements; non-Explorer AI Planner users still go through the paid credit path.
- Final-polish research notes:
  - Keep Search Box as the high-quality place/POI source for interactive and standalone location search.
  - Keep Directions for route geometry/preview and Matrix for travel-time/distance comparisons; use each tool narrowly so the assistant does not infer routing facts from plain text.
  - Keep MCP tools server-side and authenticated. Tool inputs are validated, outputs are sanitized for voice, and sensitive operations stay behind `map_action` confirmation.

## Validation

- Added focused unit tests in `tests/test_copilot_tool_bridge.py`.
- MCP adapter has a standalone `npm --prefix tools/trailhead-mcp run check` syntax check.
- Broader validation target: `tests.test_copilot_tool_bridge`, `tests.test_extreme_explorer`, `tests.test_discovery_pack_bridge`, mobile TypeScript, and mobile API copy audit.
- Production deployment `4c47628f-6bed-40ae-b305-1ee07afc2da7` passed bridge smoke tests on 2026-06-28:
  - `/api/copilot/tools` returned contract `trailhead-copilot-tools-v1` with 7 tools.
  - Direct production execution passed for all 7 bridge tools.
  - Local MCP adapter was exercised through the MCP SDK stdio client and passed list/call tests for all 7 tools.
  - Live provider paths returned expected compact results: Mapbox search/geocode/reverse/route/matrix and pack-backed discovery context.

## Next Checkpoint

- Add a mobile/debug UI surface that can inspect available bridge tools and replay a staged Co-Pilot action through `/api/copilot/tools/execute`.
- Add server-side contract snapshots if MCP consumers start depending on stable schema diffs.
- Add structured MCP outputs (`structuredContent`/output schemas) once external MCP hosts need machine-readable results beyond JSON text blocks.
- Add a visual "tools used" trace in the Co-Pilot sheet for transparent MapGPT-style answers.
- Add eval scripts for common map-agent prompts: "what am I looking at", "coffee near here", "route there", "camp along this route", "is this drive reachable", and "open the second result".
