# Stage 8 Mission Control v2 Audit

Date: 2026-06-18

## Checkpoint

Stage 8 turns Mission Control into a deterministic adventure-readiness brief that can be shown in the app now and narrated by Co-Pilot later.

## Implemented

- Added `schema_version: 2` to Mission Control responses.
- Added `status_summary` with the Stage 8 matrix:
  - route status
  - overnights
  - rig fit
  - legal stay
  - fuel risk
  - conditions
  - offline readiness
  - reports
- Added `next_actions` as staged, non-mutating copies of recommendations.
- Added provider/source evidence to the brief using the provider registry and source-quality scoring from Stage 7.
- Added report scoring for current, stale, and conflicting route/community reports.
- Expanded offline readiness from binary ready/not-ready into complete, partial, and missing.
- Updated mobile Mission Control types and card rendering to show compact status rows and expanded source confidence rows.

## Guardrails

- Mission Control still returns a deterministic brief without calling an LLM.
- Unit tests keep the no-provider-call path at `debug.provider_calls == 0`.
- Staged actions do not mutate trip state without a follow-up user action.
- Provider evidence is attached as attribution/confidence context, not as hidden routing truth.
- Partial offline packs no longer display as ready when route graph or other declared pieces are missing.

## Validation

- `python3 scripts/qa_mission_control_matrix.py`
- `python3 scripts/qa_provider_registry_matrix.py`
- `python3 -m unittest tests.test_adventure_intelligence`
- `python3 -m unittest tests.test_extreme_explorer tests.test_adventure_intelligence`
- `python3 -m py_compile dashboard/adventure_intelligence.py dashboard/server.py`
- `(cd mobile && npx tsc --noEmit)`
- `(cd mobile && npm run audit:routes)`
- `git diff --check`

## Notes

- Route Scout and the trip detail view can now reuse the same `status_summary` object instead of interpreting raw score IDs separately.
- Co-Pilot voice should narrate this brief later, but mutation should continue to go through staged actions and user confirmation.
