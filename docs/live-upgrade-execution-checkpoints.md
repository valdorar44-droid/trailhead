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
   - Status: complete for first consolidated Library pass.
   - Start Profile Saved/Downloads path toward a mobile Library model.

6. **Map Sheets + Mapbox Layer Polish**
   - Status: complete for layer-sheet ordering and Explorer copy cleanup.
   - Keep Mapbox Outdoors near Trailhead Topo.
   - Remove duplicate Explorer entry points if layer workflow replaces them.
   - Keep Mapbox layer access free where product direction requires it.

7. **Planner/Copilot Structured Cards**
   - Status: complete for first production structured-card slice.
   - Use cards and staged actions instead of raw chat-only output.

8. **Viator/Partner Readiness**
   - Status: complete for first external-checkout copy/readiness slice.
   - Fixture/sandbox/external checkout only.
   - No in-app booking.

9. **Reports + Mission Control Signal Polish**
   - Status: complete for first shared field-report composer slice.
   - Extract map field-report form UI out of `map.tsx`.
   - Show report trust/freshness as a compact Mission Control signal.
   - Keep backend payloads, credits, TTL, and submit behavior unchanged.

10. **Explore Control Surface**
    - Status: complete for first production control-surface slice.
    - Wire the full Explore category chips into the home feed.
    - Add compact count/source/sort status controls.
    - Extract control markup out of `guide.tsx` without changing catalog,
      map, route, saved, cache, or detail behavior.

11. **Planner Composer + Copy Cleanup**
    - Status: complete for first input/composer slice.
    - Replace the Planner preset-card wall with compact starter prompts.
    - Remove the visible Planner context-chip strip.
    - Move Planner reporting behind a compact composer icon.
    - Clean support/report and first-run Planner copy from implementation-style
      wording.
    - Validate the authenticated Planner welcome, composer typing, and report
      sheet through Figma and Playwright.

12. **Map Navigation Stability + Mapbox Native QA**
    - Status: complete for first iOS navigation pan-stability slice.
    - Debounce native map gesture/follow breakaway events.
    - Keep navigation running while the user pans into free-camera mode.
    - Keep locate/follow as the explicit return-to-follow action.
    - Add a short recent-viewport cache for quick map returns.
    - Reconfirm Trailhead Topo / Mapbox Outdoors layer ordering and free Mapbox
      style access.

13. **Route Builder Deeper Redesign**
    - Status: complete for first hub extraction and copy-cleanup slice.
    - Extract Route Builder hub into a reusable component.
    - Keep route computation, Mapbox bridge calls, saved geometry, camp scoring,
      and API payloads unchanged.
    - Clean visible Route Builder wording flagged by targeted copy audit.
    - Save design decision, audit checkpoint, and Figma checkpoint frame.

14. **Route Builder Workspace Extraction**
    - Status: complete for workspace summary/readiness slice.
    - Extract active workspace summary into a reusable component.
    - Extract trip-readiness rendering into a typed reusable component.
    - Keep route computation, Mapbox bridge calls, saved geometry, camp scoring,
      API payloads, and offline readiness calculations unchanged.
    - Save design decision, audit checkpoint, and Figma checkpoint frame.

15. **Route Search Layering**
    - Status: complete for Route Builder actions/search-layering slice.
    - Extract Route Builder timeline actions and insert guidance.
    - Keep route computation, saved geometry, camp scoring, and route readiness
      calculations unchanged.
    - Reserve the map top lane for search, move/hide transient banners and tool
      controls while search owns that lane, and pair Android `zIndex` with
      `elevation`.
    - Add shared place-lookup fallback coverage to `RouteSearchModal`.
    - Save design decision, audit checkpoint, and Figma checkpoint frame.

16. **Route Builder Stop Rows**
    - Status: complete for active-day stop-row and leg-action extraction.
    - Extract active-day stop row rendering into a reusable component.
    - Extract between-stop distance/fuel/action rendering into a reusable
      component.
    - Keep route computation, discovery scans, camp scoring, saved geometry, and
      offline readiness calculations unchanged.
    - Clean visible Route Builder stop/search copy from "POIs" to "places."
    - Save design decision, audit checkpoint, Figma checkpoint frame, and
      Playwright smoke screenshot.

17. **Route Builder Footer Dock**
    - Status: complete for fixed route summary/open-on-map dock extraction.
    - Extract footer summary and primary map action into a reusable component.
    - Keep route totals, fuel estimates, saved geometry, route saving,
      keyboard visibility, and safe-area positioning unchanged.
    - Save design decision, audit checkpoint, Figma checkpoint frame, and
      Playwright smoke screenshot.

18. **Route Builder Timeline Day Rows**
    - Status: complete for route timeline day-card extraction.
    - Extract route day title/status/body/action rendering into a reusable
      component.
    - Keep route day planning, status calculation, discovery scans, camp preview
      rendering, inline discovery results, saved geometry, and readiness
      calculations unchanged.
    - Save design decision, audit checkpoint, Figma checkpoint frame, and
      Playwright smoke screenshot.

19. **Route Builder Inline Discovery Results**
    - Status: complete for inline discovery-result extraction and footer
      clearance.
    - Extract inline route discovery result shell, camp cards, and compact
      result rows into reusable components.
    - Keep discovery state, filtering, empty states, add/swap callbacks, route
      place open callbacks, saved geometry, and readiness calculations
      unchanged.
    - Add phone-viewport content clearance so the fixed footer dock does not
      cover active route content.
    - Save design decision, audit checkpoint, Figma checkpoint frame, and
      Playwright smoke screenshot.

20. **Route Builder Route Fit Cards**
    - Status: complete for route-fit/readiness card assembly extraction.
    - Extract route-fit card assembly from `route-builder.tsx` into a typed
      route-builder helper.
    - Keep route computation, saved geometry, offline readiness, fuel estimates,
      and Mapbox handoff behavior unchanged.
    - Save design decision, audit checkpoint, Figma checkpoint frame, and
      Playwright smoke screenshot.
    - Release: production OTA
      `f2bbe3b9-2dd4-42d0-9d0b-eca5a01161c5`; preview OTA
      `5a4df7c2-16e2-4f71-824b-1a401fad02d8`.

21. **Route Builder Search Flow Extraction**
    - Status: complete for helper extraction.
    - Extracted route-builder search/result state and place-add mapping where it
      can be shared with map search and Planner/Copilot route handoff flows.
    - Kept provider calls, Android lookup fallback, saved geometry, and
      existing search result behavior unchanged.
    - Reviewed Mobbin/Figma travel search and route-stop patterns before code.
    - Saved design decision, audit checkpoint, and Playwright smoke
      screenshots.
    - Release: production OTA
      `846b67d8-64af-40b3-9bf6-a2b0ef3587fe`; preview OTA
      `bb64e724-0998-424c-b81e-4388fa793f28`.

22. **Route Builder Search Surface Component**
    - Status: queued.
    - Extract the Route Builder search type chips, insert notice placement,
      search box, and result rows into a presentational component.
    - Keep the Checkpoint 21 helper, provider calls, Android lookup fallback,
      saved geometry, route computation, and existing result behavior
      unchanged.
    - Continue Mobbin/Figma research against travel destination pickers,
      itinerary add-place flows, and compact route-stop search surfaces before
      code.

## Refresh Handoff

- Saved continuation context in `docs/live-upgrade-refresh-handoff.md`.
- Mobbin MCP OAuth login succeeded, but the active Codex session did not expose
  Mobbin tools after login. Refresh Codex, then verify Mobbin tool discovery.
- Mobbin tools were visible after refresh and were used for Checkpoint 12
  research.
- Checkpoint 12 implementation context is saved in
  `docs/live-upgrade-checkpoint-12-map-navigation-audit.md`.
- Checkpoint 13 first-slice context is saved in
  `docs/live-upgrade-checkpoint-13-route-builder-audit.md`.
- Checkpoint 14 workspace extraction context is saved in
  `docs/live-upgrade-checkpoint-14-route-builder-workspace-audit.md`.
- Checkpoint 15 route/search layering context is saved in
  `docs/live-upgrade-checkpoint-15-route-search-layering-audit.md`.
- Checkpoint 16 stop-row extraction context is saved in
  `docs/live-upgrade-checkpoint-16-route-builder-stop-rows-audit.md`.
- Checkpoint 17 footer-dock extraction context is saved in
  `docs/live-upgrade-checkpoint-17-route-builder-footer-dock-audit.md`.
- Checkpoint 18 timeline day-row extraction context is saved in
  `docs/live-upgrade-checkpoint-18-route-builder-timeline-day-rows-audit.md`.
- Checkpoint 19 inline discovery-result extraction context is saved in
  `docs/live-upgrade-checkpoint-19-route-builder-inline-discovery-results-audit.md`.
- Checkpoint 21 search-flow extraction context is saved in
  `docs/live-upgrade-checkpoint-21-route-builder-search-flow-audit.md`.

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
