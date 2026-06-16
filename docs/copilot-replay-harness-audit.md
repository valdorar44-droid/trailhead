# Copilot Replay Harness Audit

Date: 2026-06-13

## Scope

This checkpoint adds a repeatable replay and transcript-audit harness for Trailhead Copilot using saved production data, then expands it to score overnight-confidence and visible-map clutter failures inside route sessions.

Shipped:

- `scripts/replay_copilot_debug.py`
- `dashboard/server.py`

## What the harness does

### 1. Exact replay for staged text actions

The harness replays saved `extreme_copilot_actions` rows through the live server classifier:

- input: original `command`
- context: saved `payload.context`
- function under test: `_build_extreme_map_action(...)`

It compares:

- `action_type`
- `requires_confirmation`
- key action args

### 2. Transcript audit for admin debug snapshots

For saved `copilot_admin_debug_snapshot` rows, the harness scores transcript symptoms that matter for product trust:

- repeated route-scout attempts
- zero overnights found
- route-not-drawn failures
- generic `Campsite` route summaries
- repeated corridor filler copy

This covers voice/admin sessions where the original utterance is not fully recoverable.

### 3. Overnight-confidence and route-clutter scoring

The harness now also flags:

- confirmed overnights spoken without a real place name
- route summaries that still present placeholder campsite labels
- visible-map fuel clutter inside route-planning sessions, not just generic map clutter

This matters because the main route-scout trust failures were no longer only parser mistakes. Some were weak summary payloads plus noisy on-screen context.

## Live run

Production bundle source:

- exported from Railway live `/data/trailhead.db`
- replayed locally against the current server classifier

Results:

- replay cases: `10`
- exact matches: `9`
- mismatches: `1`
- debug snapshots audited: `10`

Transcript symptom counts:

- `repeated_route_scout_attempts`: `5`
- `zero_overnights`: `3`
- `route_not_drawn`: `1`
- `generic_campsite_summary`: `1`
- `corridor_filler_sentence`: `1`

Expanded transcript symptom counts after the scoring update:

- `repeated_route_scout_attempts`: `5`
- `zero_overnights`: `3`
- `route_not_drawn`: `1`
- `generic_campsite_summary`: `1`
- `confirmed_overnight_without_name`: `1`
- `visible_fuel_pollution`: `1`
- `route_session_visible_fuel_pollution`: `1`
- `corridor_filler_sentence`: `1`

Worst saved session:

- snapshot `1687`
- session `extreme_00f6070370776de181ca90e8`
- score `7`
- symptoms:
  - route not drawn
  - generic campsite summary
  - confirmed overnight without a real name
  - corridor filler sentence
  - repeated route-scout attempts
  - visible fuel clutter
  - route-session visible fuel clutter

Evidence from that snapshot:

- overnight labels extracted from transcript: `Campsite`, `Campsite`
- top visible stack: 4 fuel/store items before other visible context
- no active result set and no query context

## Bug found and fixed

The replay harness exposed a classifier issue:

- command: `show camps near my route`
- old behavior:
  - treated `my route` like a place query
  - added `query=""`
  - set `open_card=false`
- fix:
  - route-scoped phrases like `my route`, `the route`, `route corridor`, and `along my route` are now stripped from named-place extraction

Important note:

- the replay mismatch remains visible in the saved report because the production action row was captured before the fix landed
- that mismatch is now a useful “behavior changed on purpose” marker, not an unresolved regression

## Validation

Passed:

- `python3 -m py_compile dashboard/server.py scripts/replay_copilot_debug.py`
- live bundle replay through `scripts/replay_copilot_debug.py`

Not run:

- mobile OTA, because this checkpoint is backend/script only

## Decision

Checkpoint result: `continue`

Why:

- the harness is usable now for future copilot audits
- it already found one real parser bug
- it now catches a real route-session clutter case and a real placeholder-overnight case from production debug data
- the next value is to connect these harness findings back into route-scout summary generation and visible-context guardrails
