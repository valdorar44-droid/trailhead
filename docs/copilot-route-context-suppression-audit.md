# Copilot Route Context Suppression Audit

Date: 2026-06-13

## Scope

This checkpoint turns the replay-harness findings into behavior fixes:

- route-scout summaries no longer treat placeholder overnight names like confirmed camps
- route-planning sessions stop leaning on visible gas/store clutter when there is no active result list or selected place
- route follow-ups like `open the first one` no longer fall through to visible-map labels during route planning unless the user clearly referenced the screen

## Shipped

Updated:

- `dashboard/server.py`
- `mobile/app/(tabs)/map.tsx`

## Checkpoints

### C1. Placeholder overnight names downgraded

What changed:

- backend overnight display names now treat generic names like `Campsite`, `Campground`, or `RV Park` as review-only labels
- strong overnight confidence now requires a real display name, not just corridor fit

Why it matters:

- route-scout payloads stop presenting generic provider names as if they were trustworthy locked camps

### C2. Route-scout spoken summary tightened again

What changed:

- map summary now locks only `strong` overnight windows with non-placeholder names
- review windows are spoken as review areas, not as confirmed overnight stays
- route-scout completion status now stays in `review` until those windows are actually strong

Why it matters:

- the spoken summary matches the real confidence level instead of sounding more certain than the data deserves

### C3. Visible route-planning clutter suppressed

What changed:

- when route scout is active and there is no selected place, no active result list, and no current query context, background copilot context drops visible map labels
- explicit `getMapContext` still works, but it filters fuel/store-heavy clutter first during route planning

Why it matters:

- route-planning prompts stop inheriting random visible gas and store labels as pseudo-search context

### C4. Unsafe route-session selection blocked

What changed:

- during route-active sessions, commands like `open the first one` no longer select visible map labels if there is no current result list
- Copilot now asks whether the user meant camps, trails, fuel, food, or a visible map label

Why it matters:

- route sessions no longer silently jump from “no result list” into visible label selection

## Self-Audit

What improved:

- route-scout confidence language is stricter
- placeholder overnight names are pushed back into review territory
- background route-planning context is quieter and less likely to drift into fuel clutter
- route follow-ups are safer when there is no structured result list

What is still not done:

- the saved debug transcript still scores the same in the replay harness because it was captured before these fixes landed
- the next proof point should be a fresh admin debug snapshot or live route-scout session after deployment
- route-scout still depends on current provider routing and camp-source breadth; this pass fixed confidence handling, not inventory coverage

## Validation

Passed:

- `python3 -m py_compile dashboard/server.py`
- `cd mobile && npx tsc --noEmit`
- `python3 scripts/replay_copilot_debug.py --input-json /tmp/copilot_debug_bundle.json --json-out /tmp/copilot_replay_report.json`
- `git diff --check`

## Decision

Checkpoint result: `continue`

Reason:

- the replay-harness findings are now reflected in runtime behavior
- the next step is to capture fresh post-fix copilot debug snapshots and verify that the old placeholder/fuel-clutter pattern does not recur
