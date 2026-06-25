# Design Decision: Splash / Launch

**Date:** 2026-06-25  
**Checkpoint:** 2 - Welcome Gate + Launch Cleanup

## Current Problems

- Native splash and React launch loader responsibilities need to stay distinct.
- The current launch loader copy is narrow: "Loading maps and places".

## Research Reviewed

- PR #12 launch guidance.
- Existing `TrailheadLaunchLoader` implementation.
- Mobbin travel onboarding examples that use short brand splash moments.
- Expo/Android splash guidance from the PR reference board.

## Patterns Extracted

- Native splash should stay short and simple.
- The React loader can carry the branded route/topo transition.
- Launch copy should describe the whole trip space, not one technical subsystem.

## New Component Tree

```txt
Native Splash
  static Trailhead mark/background

RootLayout
  TrailheadLaunchLoader
    brand mark
    contour/route motion
    short rotating readiness copy later
```

## Why This Is Better

- It avoids overloading native splash with app logic.
- It preserves the strongest existing visual work.
- The loader feels broader than map loading without adding fragile startup work.

## Future Improvements

- Add release-build splash timing checks.
- Add a small set of non-technical loader phrases once the welcome gate is live.
