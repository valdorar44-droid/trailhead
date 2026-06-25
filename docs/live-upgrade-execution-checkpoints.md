# Trailhead Live Upgrade Execution Checkpoints

**Date:** 2026-06-25  
**Primary spec:** `docs/codex-master-live-app-upgrade-plan.md`  
**Reference board:** `docs/reference/trailhead-ui-reference-board.json`

This file tracks the implementation path for the live-app refresh. Each
checkpoint must leave an audit note before the next checkpoint starts.

## Rules

- Production app only: no temporary UI, throwaway state, or copied template work.
- Every visible recommendation needs source, freshness, or a reason where the
  surface supports it.
- User-facing copy must avoid implementation wording such as AI, provider,
  sandbox, debug, internal, geocode, lat/lng, endpoint, payload, and schema.
- Do not grow `mobile/app/(tabs)/map.tsx` or
  `mobile/app/(tabs)/route-builder.tsx` with new feature logic.
- Paid references, Mobbin screenshots, Figma kit files, fonts, and premium
  assets stay out of the repo unless redistribution is explicitly allowed.

## Checkpoints

1. **Spec Import + Stage A Audit**
   - Status: complete.
   - Import PR #12 docs.
   - Fix the reference-board schema example noted by review.
   - Save Stage A audit and first design decisions.

2. **Welcome Gate + Launch Cleanup**
   - Status: complete.
   - Keep `TrailheadLaunchLoader`.
   - Stop automatic first-run walkthrough modal.
   - Add `WelcomeGate` with Create account, Log in, Continue for now.
   - Move existing walkthrough to Profile access.

3. **User-Facing Copy Guardrail**
   - Status: complete for Planner; expand as each screen is redesigned.
   - Add shared sanitizer.
   - Apply to Planner/Copilot response surfaces first.

4. **Activity Tokens + Route Builder Shell**
   - Status: complete for first extraction pass.
   - Add shared activity/status/disclosure primitives.
   - Extract Route Builder shell components without changing route logic.

5. **Library + Offline Readiness**
   - Status: next.
   - Start Profile Saved/Downloads path toward a mobile Library model.

6. **Map Sheets + Mapbox Layer Polish**
   - Keep Mapbox Outdoors near Trailhead Topo.
   - Remove duplicate Explorer entry points if layer workflow replaces them.
   - Keep Mapbox layer access free where product direction requires it.

7. **Planner/Copilot Structured Cards**
   - Use cards and staged actions instead of raw chat-only output.

8. **Viator/Partner Readiness**
   - Fixture/sandbox/external checkout only.
   - No in-app booking.

## Validation Gate

Run the relevant subset before each checkpoint closes:

```bash
cd mobile && npx tsc --noEmit
cd mobile && npm run audit:routes
python3 -m py_compile dashboard/server.py
python3 -m py_compile dashboard/provider_registry.py
python3 -m unittest tests.test_viator_sourcepack
git diff --check
```
