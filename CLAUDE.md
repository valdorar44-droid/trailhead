# TRAILHEAD — Claude Rules

_Read this before touching anything._

---

## Project Overview

Trailhead is an AI adventure trip planner for overlanders. Phase 1 is a web app (FastAPI + single-file SPA). Phase 2+ is Expo iOS/Android. Same backend serves both.

**Stack:** FastAPI · SQLite WAL · Anthropic SDK · Mapbox GL JS · RIDB API · NREL API · Railway

## File Map

| File | Purpose |
|------|---------|
| `run.py` | Entry point. Loads .env, starts server |
| `dashboard/server.py` | FastAPI app. All API routes |
| `dashboard/dashboard.html` | Single-file SPA. Read before editing |
| `ai/planner.py` | Claude trip planner. System prompt lives here |
| `ingestors/ridb.py` | RIDB (Recreation.gov) campsite fetcher |
| `ingestors/nrel.py` | NREL fuel station fetcher |
| `db/store.py` | SQLite WAL. Schema + queries |
| `config/settings.py` | All settings from env vars |

## Rules

1. **Read dashboard.html before editing it.** It is a single file. Edits require context.
2. **Never hardcode API keys.** Use `settings.py`. All keys from env vars.
3. **All routes proxy backend calls.** Frontend never calls RIDB/NREL/Anthropic directly — only through our API.
4. **Keep business logic in the backend.** Frontend does rendering only. This ensures mobile port is a frontend-only project.
5. **SQLite WAL mode always.** Set on connection open. Database at `/data/trailhead.db` in prod, `./trailhead.db` in dev.
6. **RIDB results are cached.** Don't re-fetch campsites for the same bbox within 24h. Use db cache.
7. **Test with DEMO_KEY for NREL in development.** Rate limited but functional.
8. **The AI waypoints are named places, not coordinates.** Claude generates place names → backend geocodes → frontend renders. Never ask Claude for coordinates directly.

## Trip Planning Response Schema

Claude always returns this JSON (no markdown wrapper):

```json
{
  "trip_name": "string",
  "overview": "string (2-3 sentences)",
  "duration_days": number,
  "states": ["UT", "CO"],
  "waypoints": [
    {
      "day": number,
      "name": "Specific Place Name, State",
      "type": "start|camp|waypoint|town|shower|fuel",
      "description": "string",
      "land_type": "BLM|USFS|NPS|private|town",
      "notes": "string (optional)"
    }
  ],
  "daily_itinerary": [
    {
      "day": number,
      "title": "string",
      "description": "string",
      "est_miles": number,
      "road_type": "paved|dirt|4wd|mixed",
      "highlights": ["string"]
    }
  ],
  "logistics": {
    "vehicle_recommendation": "string",
    "fuel_strategy": "string",
    "water_strategy": "string",
    "permits_needed": "string",
    "best_season": "string"
  }
}
```

## Deployment

- Railway auto-deploys on push to `main`
- Persistent Volume at `/data` — SQLite lives there
- Health check: `GET /api/health`
- Required env vars: `ANTHROPIC_API_KEY`, `MAPBOX_TOKEN`, `NREL_API_KEY`, `RIDB_API_KEY`

## Workflow

See `AGENT_WORKFLOW.md` for the Builder→Auditor→Fixer 2-agent structure used for significant features.

Custom slash commands in `.claude/commands/`:
- `/ui-spec` — build/refine UI following Trailhead design rules
- `/debug-ui` — debug frontend issues with Playwright workflow
- `/debug-backend` — debug FastAPI/DB issues

Playwright MCP + context7 plugins are installed — use for before/after screenshots and live library docs.

## Phase Roadmap

- **Phase 1** [done] Web app: AI trip planner + map + RIDB campsites + NREL gas
- **Phase 2** [done] Expo mobile app + full Waze-style reporting/gamification
- **Phase 3** [done] GPS Audio Guide: Claude narrations per waypoint + TTS + "What's here?" + weather forecast
- **Phase 4** [done] Community pins on map, trip sharing via native Share API
- **Phase 5** — Offline maps (Mapbox tile download for dead zones)
- **Phase 6** — iOverlander refugee import tool + Reddit/GPX harvest
- **Phase 7** — Background audio auto-play (expo-task-manager geofencing)
- **Phase 8** — Trail permit tracker (recreation.gov API)
