# Profile / Explore / Campflare Follow-Up Audit

Date: 2026-06-13

## Scope

Follow-up cleanup after the main production improvement phases:

- strip redundant Profile section chrome
- remove the Explore copilot shortcut card
- add a non-production Campflare evaluation harness

## Shipped

Updated:

- `mobile/app/(tabs)/profile.tsx`
- `mobile/app/(tabs)/guide.tsx`
- `scripts/evaluate_campflare.py`
- `docs/campflare-provider-evaluation.md`

## What Changed

### 1. Profile now starts with actual section content

What changed:

- Removed the section intro card that repeated:
  - `PROFILE`
  - section title
  - section subtitle
- Removed the persistent top stats rows that showed:
  - credits
  - day streak
  - trips
  - miles planned
  - states explored
  - regions

Why this matters:

- The content cards no longer get pushed down awkwardly, especially in `Trips`.
- The section chips now do the job of orientation without duplicating obvious labels.

### 2. Explore no longer has the copilot shortcut card

What changed:

- Removed the Explore callout card that linked into copilot / map voice entry.

Why this matters:

- It freed vertical space on a screen that is supposed to start with discovery content.
- It avoids advertising a shortcut many users cannot meaningfully use yet.

### 3. Campflare now has a repeatable evaluation harness

What changed:

- Added `scripts/evaluate_campflare.py`
- Added `docs/campflare-provider-evaluation.md`

What the script does:

- probes likely Campflare campground search paths
- tries likely auth header shapes
- fetches campground detail and campsites when reads succeed
- prints a compact summary for named areas

Current result:

- the provided read token still returns `invalid-api-key` on direct raw read calls
- the docs host is flaky enough that the evaluator falls back cleanly to known endpoint paths
- the webhook key remains out of scope for search/detail evaluation

## What Improved

- Profile is lighter and easier to scan.
- Explore starts closer to the actual product surface.
- Campflare evaluation is no longer dependent on ad hoc curl attempts.

## What Still Feels Weak

- Profile still contains a lot of section-specific content in one file.
- Campflare live payload comparison is still blocked until a valid read key is available.
- The Campflare docs endpoint is not reliable enough to treat as the only source of endpoint discovery in tooling.

## Metrics or Spot Checks

- `cd mobile && npx tsc --noEmit`
- `python3 -m py_compile scripts/evaluate_campflare.py`
- `git diff --check`
- direct Campflare probe result:
  - `{"error":{"kind":"invalid-api-key","message":"Invalid API Key."}}`

## Decision

- complete

Reason:

The UI cleanup shipped cleanly and the Campflare evaluation path is now ready. The remaining blocker is external: a valid read API key.
