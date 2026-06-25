# Design Decision: Welcome Gate

**Date:** 2026-06-25  
**Checkpoint:** 2 - Welcome Gate + Launch Cleanup

## Current Problems

- First-run onboarding appears as an automatic bottom-sheet modal, which blocks
  the first app session after a delay.
- The current flow asks users to consume feature education before they can
  simply create an account, log in, or continue.
- The app already supports signed-out use, so the first screen should not imply
  that account creation is mandatory.

## Research Reviewed

- PR #12 master live-app upgrade plan.
- Mobbin travel onboarding:
  - Airalo uses a brand splash followed by concise benefits and two clear paths:
    account or explore.
  - Booking.com uses a strong brand splash but a longer forced education and
    permissions path, which is too heavy for Trailhead.
- Figma references:
  - Untitled UI for button hierarchy, input discipline, and spacing.
  - Nucleus Lite for mobile rhythm only; do not copy its visuals.

## Patterns Extracted

- Use one confident brand moment, not a multi-step forced tour.
- Place account actions near the bottom for one-handed use.
- Provide a non-account path with equal clarity.
- Keep detailed feature walkthrough accessible later from Profile.

## New Component Tree

```txt
RootLayout
  TrailheadLaunchLoader
  WelcomeGate
    brand/topo background
    headline + supporting copy
    Create account
    Log in
    Continue for now
  WelcomeOnboardingModal
    Profile-triggered walkthrough only
```

## Why This Is Better

- Users can reach the app immediately.
- Account creation is clear without being forced.
- Existing walkthrough content is preserved where it belongs: Profile help.
- The flow matches the live-app rule against temporary or dead-end screens.

## Future Improvements

- Add dedicated auth routes after Profile auth state is stable.
- Use a Figma-authored Trailhead welcome frame once the 2026 refresh file exists.
