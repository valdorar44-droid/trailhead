---
description: Debug a frontend issue in Trailhead dashboard or landing page
---

You are debugging a frontend issue in **Trailhead**.

## Stack
- Vanilla JS SPA in `dashboard/dashboard.html` — Mapbox GL JS v3, chat interface
- Landing page at `dashboard/landing.html`
- API calls via `fetch()` with `Authorization: Bearer <token>` header
- Mapbox token fetched from `/api/config` on load

## Debug workflow
1. **Locate** — find the exact section in `dashboard.html` by searching for component name, route, or relevant JS function
2. **Read before touching** — read 50+ lines of context around the bug site
3. **Reproduce** — use Playwright MCP to navigate to the affected view and screenshot it
4. **Check network** — `mcp__playwright__browser_network_requests` for failed API calls
5. **Check console** — `mcp__playwright__browser_console_messages` for JS errors
6. **Fix the smallest root cause** — don't refactor surrounding code
7. **Verify** — take an after screenshot, confirm fix didn't break adjacent elements

## Common Trailhead-specific causes
- Map not rendering: Mapbox token null — check `/api/config` response, not hardcoded
- Trip plan not showing on map: waypoints missing `lat`/`lng` — geocoding failed or returned no results
- Auth 401: check Bearer token in localStorage — `localStorage.getItem('trailhead_token')`
- RIDB campsites missing: RIDB_API_KEY not set in env, or radius too small
- NREL gas stations empty: using DEMO_KEY (rate limited) or NREL_API_KEY not set
- Audio guide 500: ANTHROPIC_API_KEY not configured or planner.py exception
- Community pins not saving: user not authenticated, or lat/lng out of US bounds
- Report credits not updating: streak calculation edge case in `db/store.py`

## Output
1. Root cause (one sentence)
2. Files changed + line numbers
3. What was verified (screenshot or curl)
4. Any remaining risk
