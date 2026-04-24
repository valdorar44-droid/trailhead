---
description: Debug a backend issue in Trailhead FastAPI server or DB
---

You are debugging a backend issue in **Trailhead**.

## Stack
- FastAPI at `dashboard/server.py` — all routes
- SQLite WAL at `/data/trailhead.db` (prod) / `./trailhead.db` (dev) via `db/store.py`
- AI planner at `ai/planner.py` — Claude claude-sonnet-4-6
- RIDB ingestor at `ingestors/ridb.py`
- NREL ingestor at `ingestors/nrel.py`
- OSM ingestor at `ingestors/osm.py`
- Config from env vars via `config/settings.py`

## Debug workflow
1. **Locate** — find the route in `server.py` and its DB query in `store.py`
2. **Read the route + store function fully** before touching anything
3. **Reproduce** — curl the endpoint or check Railway logs
4. **Check syntax** — run `python -m py_compile dashboard/server.py` after any edit
5. **Fix root cause** — don't add broad exception swallowing
6. **Verify** — curl the fixed endpoint, check response shape matches what frontend expects

## Common Trailhead-specific causes
- 500 on `/api/plan`: Claude API key missing, or planner.py JSON parse failed — check `ai/planner.py` response handling
- Slow geocoding: Nominatim rate limit (1 req/sec) — `asyncio.sleep(1.1)` is intentional
- Campsites empty: RIDB_API_KEY missing, or bbox too small
- DB locked: WAL mode not set — check `PRAGMA journal_mode=WAL` in `db/store.py` `_conn()`
- Auth 401 on register/login: `bcrypt` issue, or SECRET_KEY env var missing
- Credits not adding: `add_credits()` in `store.py` — check transaction commit
- Report photo 404: `photo_data` column null or base64 decode failed

## After every edit
```bash
python -m py_compile dashboard/server.py
python -m py_compile db/store.py
python -m py_compile ai/planner.py
```

## Output
1. Root cause (one sentence)
2. Files changed + line numbers
3. Verification command + result
4. Any remaining risk
