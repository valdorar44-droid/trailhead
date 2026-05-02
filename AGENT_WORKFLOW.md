# Trailhead — Agent Build Workflow

Use for significant web or mobile features.

## Structure

```
Agent A (Builder)  →  Agent B (Auditor)  →  Agent A (Fixer)
```

---

## Agent Roles

### Agent A — Builder
- Implements the feature / changes
- Takes Playwright before/after screenshots for web changes
- Commits code and pushes to `main` (Railway auto-deploys)
- For mobile: kicks off `eas build --platform ios --profile preview --non-interactive`
- Publishes OTA for JS-only mobile changes: `eas update --branch preview --message "..."`
- **Hands off to Agent B** once done

### Agent B — Auditor
- Reviews all changed files for:
  - Visual/layout issues (Playwright screenshots via web build or mobile web preview)
  - Logic bugs, edge cases, missing null checks
  - Broken API calls or mismatched response shapes
  - TypeScript errors in mobile: `npx tsc --noEmit`
  - Accessibility: missing labels, doubled elements
  - Map rendering issues: Mapbox token, missing lat/lng on waypoints
- Reports findings as a numbered list back to Agent A
- Does NOT make code changes — audit only

### Agent A — Fixer
- Receives Agent B's report
- Applies fixes
- Pushes to `main` for web (Railway deploys in ~2 min)
- Pushes OTA for mobile JS-only changes; full build if native changed

---

## Trigger Conditions

Use this workflow when:
- Adding a new screen, page, or major component
- Changing Mapbox layers or adding new data sources
- Mobile: changing native config (app.json, eas.json, new native packages)
- Pre-release / before sharing a mobile build with testers

Skip for: small bug fixes, copy changes, minor style tweaks

---

## Handoff Template

**Agent A → Agent B:**
> "Changes complete. Changed files: `dashboard/dashboard.html` lines X-Y, `db/store.py` function Z.
> Playwright screenshots taken at `/app` before and after.
> Please audit for visual issues, logic bugs, and broken API calls."

**Agent B → Agent A:**
> Findings:
> 1. [file:line] Issue description
> 2. ...
> "No blocking issues" or "X issues found, recommend fixing before deploy."

---

## Commands Reference

```bash
# Syntax check after any Python edit
python -m py_compile dashboard/server.py
python -m py_compile db/store.py

# Start local server for Playwright screenshots
python run.py

# Mobile: build (native changes)
cd mobile && eas build --platform ios --profile preview --non-interactive

# Mobile: OTA update (JS-only changes)
cd mobile && eas update --branch preview --message "Description"

# Mobile: TypeScript check
cd mobile && npx tsc --noEmit

# Mobile: web preview for Playwright audit
cd mobile && npx expo start --web --port 8081

# Check Railway deploy status
# → Railway dashboard or `railway logs`
```

---

## Notes
- Railway auto-deploys on push to `main` — web changes are live in ~2 min
- Mobile OTA updates require installed build to have matching channel in eas.json
- Mapbox token is fetched from `/api/config` — never hardcoded in HTML
- Nominatim geocoding is rate-limited to 1 req/sec — `asyncio.sleep(1.1)` is intentional
- Playwright MCP plugin installed globally — use `mcp__playwright__*` tools for screenshots
