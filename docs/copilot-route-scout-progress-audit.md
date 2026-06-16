# Copilot Route Scout Progress Audit

Date: 2026-06-13

## Scope

This checkpoint fixes the dead-air gap during Route Scout camp search.

The main issue was simple:

- the route line and first few window pans were staged on timers
- overnight search itself was one batched request
- after the last staged pan, the UI could sit quiet until every overnight window finished

## Shipped

Updated:

- `mobile/app/(tabs)/map.tsx`

## Checkpoints

### C1. Overnight search is now progressive

What changed:

- Route Scout now requests overnight windows individually with a small worker pool instead of waiting on one all-or-nothing batch
- each completed day updates scout state immediately

Why it matters:

- the user now sees progress land as each overnight window resolves
- the long “nothing is happening” gap after the last pan is reduced

### C2. Route Scout now reports found windows while it works

What changed:

- progress messages now say things like:
  - `Day 2 locked ...`
  - `Day 4 marked ... review area`
  - `X of Y overnight windows checked`
- partial preview stops update as windows return

Why it matters:

- the scout feels alive while it is still working
- users can tell whether the system is finding real camps or only review areas

### C3. Tail keepalive added

What changed:

- Route Scout now keeps a late search-phase message alive for the last overnight fits instead of going visually still after the last scheduled focus move

Why it matters:

- the final window no longer feels like a freeze before the summary appears

### C4. Summary trimmed

What changed:

- locked overnight list is capped
- day briefs are capped
- route summary wording is shorter

Why it matters:

- admin transcripts and spoken summaries are less likely to get clipped
- the final summary stays readable after a long scout

## Self-Audit

What improved:

- route-scout progress is no longer tied only to timer-based map pans
- overnight search can visibly advance after Day 4 or Day 5 instead of appearing stalled
- final summaries are shorter and less likely to cut off

What is still not done:

- this is still request/response, not true server streaming
- if the last overnight lookup itself is slow, the user still waits, but now with a live progress state instead of a quiet stall
- the next improvement would be route-scout telemetry for time-to-first-window and time-to-final-window

## Validation

Passed:

- `cd mobile && npx tsc --noEmit`
- `git diff --check`

## Decision

Checkpoint result: `continue`

Reason:

- the user-visible stall is addressed without changing backend contracts
- the next step is to capture a fresh admin debug transcript and confirm the dead-air gap is materially reduced in real use
