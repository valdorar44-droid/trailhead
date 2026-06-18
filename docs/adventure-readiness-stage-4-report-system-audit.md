# Adventure Readiness Stage 4 Report System Audit

Date: 2026-06-18

Scope: Stage 4 from `docs/adventure-app-production-readiness-plan.md`.

## Changes

- Expanded the Report submit taxonomy while staying inside backend-valid report type keys.
- Added road, closure, camp, trail, weather, fire, smoke, water, fuel, service, signal, wildlife, hazard, traffic, viewpoint, access, and patrol report choices.
- Added source confidence controls: `I saw this` and `I heard this`.
- Added a local offline retry queue for text/location reports when submit fails from network loss.
- Added visible queue status and a manual retry button on the Submit screen.
- Updated report cards with source, distance, age, expiry, and trust context.
- Reworked report actions to use explicit `Still there`, `Not there`, and `Report more` buttons.
- Updated local report state after confirmations, upvotes, and dismissals so actions do not feel dead.
- Added detail modal trust rows for source, distance, age, expiry, and confirmation state.
- Added `scripts/qa_report_system_matrix.py` to keep report picker types aligned with backend-valid report types and required trust/action hooks.

## Verification

- `python3 scripts/qa_report_system_matrix.py` - pass
- `npx tsc --noEmit` from `mobile/` - pass
- `npm run audit:routes` from `mobile/` - pass, 12 cases
- `git diff --check` - pass

## Notes

- The offline queue intentionally stores text/location reports without photos. Secure storage is not a safe place for large base64 images.
- `Not there` uses the existing downvote endpoint. The backend already expires heavily disputed reports.
- `Still there` uses the existing confirmation endpoint and refreshes the local expiry display.
- Route-around and saved-report actions were not added in this pass because there is no safe existing handler for those actions yet. The added `Report more` action is live and opens Submit.
