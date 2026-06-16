# Copilot Route Scout Hardening Audit

Date: 2026-06-13

## Scope

This checkpoint hardens Trailhead Copilot in the route-scout path:

- shared route/camp intent fields
- clarification before weak route-scout guesses
- better overnight window payloads
- less generic route-scout wording
- broader camp, trail, park, monument, and POI vocabulary

## Shipped

Updated:

- `dashboard/server.py`
- `mobile/app/(tabs)/map.tsx`
- `mobile/app/(tabs)/route-builder.tsx`
- `mobile/lib/api.ts`
- `mobile/lib/copilotCapabilities.ts`
- `mobile/lib/routeBuilder/audit.ts`
- `mobile/lib/routeBuilder/__tests__/routeBuilder.test.ts`

## Checkpoints

### C1. Shared draft contract tightened

What changed:

- Added `roadPreference` and `riskTolerance` to the copilot draft contract.
- Expanded normalized POI preferences to include:
  - parks
  - monuments
  - historic stops
  - visitor centers
  - water access
  - camp services
- Route-scout args now normalize through the same mobile draft cleaner instead of ad hoc field handling.

Why it matters:

- The map and server now share a cleaner route intent surface.
- The route-scout path has fewer one-off interpretations of the same user phrase.

### C2. Clarification gate added

What changed:

- Multi-day route-scout requests can now pause for one short follow-up before plotting when:
  - camp style is missing
  - route style is missing
  - rough-road intent conflicts with missing or weak rig context
  - an active scout update is too vague
- Clarification runs through `startRouteScout` with saved draft context, not a stateless prompt.

Why it matters:

- Follow-up answers now keep the pending scout context alive.
- Copilot is less likely to guess wrong from vague route language.

### C3. Overnight payloads carry stronger wording data

What changed:

- Route camp windows now return:
  - `display_name`
  - `reason_short`
  - `overnight_kind`
  - `overnight_style`
  - `fallback_label`
  - `fit_notes`
- Review anchors are now named as review areas instead of generic overnight placeholders.

Why it matters:

- The UI no longer has to narrate thin raw payloads.
- The scout summary can stay short without sounding repetitive or padded.

### C4. Route-scout summary copy cleaned up

What changed:

- Removed the repeated corridor filler sentence from the spoken summary.
- Locked overnights and review stops are now called out directly by day.
- Missing drive-window input now comes back as a concrete next question with options.

Why it matters:

- The summary reads more like a route briefing and less like repeated template text.

### C5. Rough-road and rig intent widened

What changed:

- Added parsing for:
  - stock SUV
  - trailer-safe
  - forest roads
  - gravel roads
  - high-clearance
  - 4WD
  - dangerous / gnarly / rough-road intent
- Rough-road requests are treated as `wild but safe`, not “roughest possible”.

Why it matters:

- Copilot can now distinguish “rough but sane” from generic `wild`.
- Trailer and low-clearance conflicts now produce a follow-up instead of silent optimism.

### C6. Route Builder placeholder leakage reduced

What changed:

- Replaced the old Copilot placeholder text in imported builder stops.
- Fallback stop names now use `review area` instead of `overnight area`.

Why it matters:

- Route Builder inherits less generic scout wording.

## Self-Audit

What improved:

- route-scout intent parsing is broader and more deliberate
- route-scout follow-ups can preserve pending context
- overnight summaries should no longer default to `Campsite` or the old filler corridor sentence
- parks, monuments, history, water-access, and camp-service phrasing now lands in structured intent fields

What is still not done:

- route-scout road selection is still limited by the current routing providers; this pass improves intent and guardrails more than raw route-engine capability
- the copilot audit script itself is still lightweight; validation today is typecheck/compile plus contract coverage, not a full voice-session replay harness

## Validation

Passed:

- `npx tsc --noEmit`
- `python3 -m py_compile dashboard/server.py`
- `git diff --check`

Blocked:

- `npx tsx mobile/lib/routeBuilder/__tests__/routeBuilder.test.ts`
  - failed in this shell because the React Native dependency graph trips the local `tsx` transform on `react-native/index.js`

## Decision

Checkpoint result: `continue`

Reason:

- the copilot route-scout contract is materially stronger now
- the remaining work is deeper behavior evaluation and future route-engine/ranking improvements, not the same wording/parser weaknesses that triggered this pass
