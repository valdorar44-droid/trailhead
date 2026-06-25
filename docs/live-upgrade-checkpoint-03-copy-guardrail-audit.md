# Live Upgrade Checkpoint 3 Audit

**Date:** 2026-06-25  
**Checkpoint:** 3 - User-Facing Copy Guardrail

## Scope

- Added `mobile/scripts/user-facing-copy-audit.mjs`.
- Added `npm run audit:copy`.
- Applied the first audit target to the Planner screen.
- Renamed the Planner response sanitizer from implementation-facing language to
  `userFacingPlannerText`.
- Cleaned nearby Planner comments so the intent is clear without relying on
  implementation wording.

## Guarded Terms

The initial guard checks visible strings and JSX text for these blocked terms:

- AI
- LLM
- Prompt
- Provider
- Sandbox
- Internal
- Debug
- Geocode
- Lat/Lng
- Endpoint
- Payload
- Schema
- Developer
- Experimental

## Audit

- The guard uses the TypeScript compiler API instead of plain text matching, so
  comments and identifiers do not create false failures.
- The default target is intentionally narrow: `app/(tabs)/plan.tsx`.
- Other screens should be added as they are redesigned, so existing legacy copy
  does not block unrelated work before the screen is touched.

## Validation

```bash
cd mobile && npm run audit:copy
```

Passed on 2026-06-25.
