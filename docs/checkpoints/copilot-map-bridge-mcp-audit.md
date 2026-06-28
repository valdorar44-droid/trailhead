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

## Audit Notes

- Existing Mapbox temporary-use handling remains centralized in the current `/api/map-context/*` endpoints.
- Discovery remains centralized in `/api/discovery/context`; the MCP adapter does not call source providers directly.
- The bridge uses current Explorer/Co-Pilot entitlement checks before listing or executing tools.
- Tool execution adds bridge metadata to request metadata and ledger events without changing existing map-context response bodies.
- Realtime Co-Pilot still exposes the existing `map_action` tool; this checkpoint adds bridge metadata rather than requiring a new mobile realtime function executor.
- Mapbox-backed Explorer map layers remain free for signed-in users. Co-Pilot and AI Planner are Explorer AI entitlements; non-Explorer AI Planner users still go through the paid credit path.

## Validation

- Added focused unit tests in `tests/test_copilot_tool_bridge.py`.
- MCP adapter has a standalone `npm --prefix tools/trailhead-mcp run check` syntax check.
- Broader validation target: `tests.test_copilot_tool_bridge`, `tests.test_extreme_explorer`, `tests.test_discovery_pack_bridge`, mobile TypeScript, and mobile API copy audit.

## Next Checkpoint

- Add a mobile/debug UI surface that can inspect available bridge tools and replay a staged Co-Pilot action through `/api/copilot/tools/execute`.
- Add server-side contract snapshots if MCP consumers start depending on stable schema diffs.
- Consider moving realtime Co-Pilot to a dedicated `trailhead_tool` function only after the mobile realtime executor can handle it directly.
