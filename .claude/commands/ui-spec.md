---
description: Build or refine Trailhead UI following project design rules
---

You are working on the **Trailhead** frontend — an adventure trip planner SPA served from `dashboard/dashboard.html` (~1150 lines) and a marketing landing page at `dashboard/landing.html` (~1270 lines). The Expo mobile app lives in `mobile/`.

## Stack facts
- No build system, no npm, no TypeScript, no framework — pure HTML/CSS/JS
- One SPA file: `dashboard/dashboard.html` — Mapbox GL JS v3 + chat interface
- Landing page: `dashboard/landing.html`
- Backend: Python FastAPI at `dashboard/server.py`
- Map: Mapbox GL JS v3 — satellite-streets + 3D terrain. Token from `/api/config`
- All API calls use `fetch()` with `Authorization: Bearer <token>` header
- Mobile: Expo React Native in `mobile/` — thin client, all logic in backend

## Design language — Trailhead aesthetic
- **Adventure-first, NOT corporate** — feels like a trail map + field guide, not a SaaS dashboard
- Earthy palette: deep forest greens, burnt orange accents, slate/stone neutrals, off-white
- Tactile, physical feel — textures, subtle grain, worn edges where appropriate
- Typography: heavy weight for headings (like trail signage), readable body
- The map IS the hero — UI chrome should frame it, not compete with it
- Dark mode: deep charcoal/slate base, NOT pure black
- Every surface: loading state, empty state, error state
- Mobile-first for any new components (the Expo app is Phase 2+ priority)
- Hover/focus states on all interactive elements
- No placeholder lorem ipsum

## Workflow for UI work
1. Read the relevant section of `dashboard/dashboard.html` first — find the existing CSS variables and patterns
2. Identify existing classes already in use for the component type — reuse before inventing
3. If Playwright MCP is available, screenshot the current state BEFORE editing
4. Make edits — keep Mapbox token fetched from `/api/config`, never hardcode
5. After editing HTML, take an AFTER screenshot with Playwright and compare
6. Check console for JS errors: `mcp__playwright__browser_console_messages`
7. For mobile components: check `mobile/components/` for existing patterns first

## Output order
1. Section of file being changed (with line range)
2. Plan (what the design will look like)
3. Edits
4. Before/after screenshots
5. What to visually inspect
