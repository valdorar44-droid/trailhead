# Trailhead Local MCP

Local MCP adapter for Trailhead Co-Pilot map and discovery bridge tools.

## Setup

```bash
npm install --prefix tools/trailhead-mcp
TRAILHEAD_API_BASE=https://api.gettrailhead.app \
TRAILHEAD_API_TOKEN=<trailhead bearer token> \
npm --prefix tools/trailhead-mcp start
```

For local backend work:

```bash
TRAILHEAD_API_BASE=http://127.0.0.1:8000 \
TRAILHEAD_API_TOKEN=<local bearer token> \
npm --prefix tools/trailhead-mcp start
```

## Tools

- `trailhead.visible_map_context`
- `trailhead.search_places`
- `trailhead.resolve_place`
- `trailhead.reverse_geocode`
- `trailhead.route_preview`
- `trailhead.route_matrix`
- `trailhead.discovery_context`

The adapter does not call Mapbox directly. It proxies every tool call through Trailhead's authenticated `/api/copilot/tools/execute` bridge so server-side entitlements, temporary-use policy, logging, and provider normalization stay centralized.

## Codex/Claude Desktop Example

```json
{
  "mcpServers": {
    "trailhead": {
      "command": "npm",
      "args": ["--prefix", "/home/sean/.openclaw/workspace/trailhead/tools/trailhead-mcp", "start"],
      "env": {
        "TRAILHEAD_API_BASE": "http://127.0.0.1:8000",
        "TRAILHEAD_API_TOKEN": "replace-with-token"
      }
    }
  }
}
```
