## AI Reporting + Android Review Audit

Date:

2026-06-13

Shipped:

- added shared [AiReportModal.tsx](/home/sean/.openclaw/workspace/trailhead/mobile/components/AiReportModal.tsx)
- added `REPORT BUG` and `REPORT OFFENSIVE` actions to:
  - [index.tsx](/home/sean/.openclaw/workspace/trailhead/mobile/app/(tabs)/index.tsx)
  - [map.tsx](/home/sean/.openclaw/workspace/trailhead/mobile/app/(tabs)/map.tsx)
- extended [api.ts](/home/sean/.openclaw/workspace/trailhead/mobile/lib/api.ts) bug-report payloads with:
  - category
  - source surface
  - screenshot
  - AI context
- extended backend/admin bug-report handling in:
  - [server.py](/home/sean/.openclaw/workspace/trailhead/dashboard/server.py)
  - [store.py](/home/sean/.openclaw/workspace/trailhead/db/store.py)
  - [admin.html](/home/sean/.openclaw/workspace/trailhead/dashboard/admin.html)

What improved:

- AI planner and Co-Pilot now have a direct in-app reporting path for:
  - model mistakes
  - offensive output
- reports can include a screenshot and recent conversation context
- admin can review the screenshot, source surface, category, session/trip ids, and recent messages in one place

What still feels weak:

- there is no reviewer-side one-click “ban this prompt pattern” or “mark as false positive” workflow yet
- planner bug reports from Profile still use the older generic bug-report form
- screenshot uploads are stored inline as base64, which is acceptable for this scale but not ideal long term

Android review risks found:

1. `ACCESS_BACKGROUND_LOCATION` is still a review risk.
   - [app.config.js](/home/sean/.openclaw/workspace/trailhead/mobile/app.config.js)
   - If background navigation/audio is not central to the first Android launch story, Google may scrutinize it hard.

2. `RECORD_AUDIO` is still a review risk.
   - Co-Pilot voice justifies it, but the Play listing and Data safety answers must match the implementation.

3. Billing verification must be live in production.
   - Config keys exist in [settings.py](/home/sean/.openclaw/workspace/trailhead/config/settings.py)
   - Production still needs valid Google Play service-account config on Railway for fully verified Android subscriptions.

4. Data safety answers must match reality.
   - The app handles:
     - precise/coarse/background location
     - microphone
     - photos/camera
     - account data
     - purchase/subscription state
     - user-submitted report text and screenshots
   - If the Play Console disclosures understate any of that, review can stall even if the app behavior is valid.

5. I did not verify a separate official Google Play “AI-only report button” rule in this pass.
   - The new flow is still the right safeguard because Play is generally stricter on content surfaces, moderation, and objectionable-output handling.

Metrics or spot checks:

- `python3 -m py_compile dashboard/server.py db/store.py`
- `cd mobile && npx tsc --noEmit`
- `git diff --check`

Decision:

- complete
- ship the reporting flow
- keep the Android launch checklist focused on:
  - background location justification
  - microphone/data safety disclosure accuracy
  - Google Play billing verification config
