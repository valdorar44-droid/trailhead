# Welcome First-Run Redesign Checkpoint

## Current Problems

- The old first-run gate behaved like a modal sheet instead of the first screen of a live travel app.
- Account actions were present, but trip setup was not captured as reusable planning context.
- The welcome artwork was synthetic map decoration, which felt less polished than the rest of the redesigned app direction.
- Profile could replay the walkthrough, but users had no clean way to finish or change travel preferences later.

## Research Reviewed

- Mobbin: Wanderlog creating a trip plan, completing a questionnaire, and setting up a profile.
- Figma: Untitled UI Pro Styles, Untitled UI Pro Variables, Nucleus UI Lite, Sublima Mobile App, Main File Light/Dark, and the Mobbin-to-Figma community boards supplied by Sean.
- Trailhead reference: `docs/reference/trailhead-ui-reference-board.json`.

Figma MCP design-system searches returned no reusable component/token results for the queried files in this environment, so this checkpoint uses the repo reference board and observed interaction patterns rather than imported Figma components.

## Patterns Extracted

- Use one full-screen visual brand moment before account creation.
- Keep account creation optional and keep "continue for now" visible.
- Ask only high-value setup questions, one group at a time.
- Put setup answers into product behavior immediately instead of leaving them as onboarding-only state.
- Allow the same setup flow to reopen from Profile.

## Component Tree

- `TrailheadLaunchLoader`
  - brand mark
  - short rotating launch line
  - route progress animation
- `WelcomeGate`
  - full-screen image background
  - welcome mode
  - setup mode
  - single-choice rows
  - multi-select needs rows
  - account action row
- `RootLayout`
  - first-open gate state
  - profile-triggered setup state
  - setup persistence handlers
- `Profile`
  - Trip Setup quick action

## Planning Integration

- Setup preferences persist through `mobile/lib/welcomeGate.ts`.
- `mobile/lib/tripPreferences.ts` maps answers into route style, camp preference, camp reuse, place filters, and rental interest.
- Planner sends preferences through existing `rig_context`.
- Route Builder applies preferences to fresh routes and saves them in route metadata.
- Map Copilot and Explorer/Mission Control include preferences in provider-neutral context.

## Why This Is Better

- The first screen now looks like a travel app experience, not a generic form.
- Users can skip account creation and still make Trailhead useful immediately.
- Rental, camping, party, towing, pet, kid, and download preferences become real planning signals.
- The setup flow can evolve without rewriting Planner, Route Builder, or Copilot.

## Future Improvements

- Push the finished welcome/setup frames into Figma once the Figma MCP file write path is confirmed.
- Add preference editing as a full Profile section, not only a quick setup replay.
- Use saved preferences to rank Outdoorsy rental cards after the rental provider PR is merged.
- Add Playwright/Expo visual snapshots for the welcome gate on iPhone and Android sizes.
