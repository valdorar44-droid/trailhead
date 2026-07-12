# Connected Explorer, Trips, Community, and Revenue

**Approved:** July 12, 2026
**Delivery window:** 12-16 weeks
**Release model:** dependency-ordered, feature-flagged, preview first

## Product Decision

Trailhead's primary loop is:

```text
Explore -> Save -> Build Trip -> Reserve -> Prepare Offline
        -> Travel -> Take Notes -> Publish Useful Updates
```

Explorer is the discovery and catalog surface. `TripDocumentV2` and
`SavedEntityV1` are the shared records behind Explorer, Plan, Route Builder,
Map, Trips, Co-Pilot, notes, bookings, alerts, and offline packs. Trips is the
durable recovery and management surface.

## Locked Decisions

- Use a phased canonical graph instead of UI-only bridges or a full rewrite.
- Keep one Explorer tier at the founder price during the reliability stage.
- Use five visible destinations: Explore, Plan, Map, Trips, and Profile.
- Keep Route Builder and Report as hidden deep workflows for compatibility.
- Keep notes private until the user explicitly reviews and publishes them.
- Build field profiles and place-linked participation, not a general forum,
  activity feed, direct messages, or engagement-oriented likes.
- Send an opt-in weekly digest plus trip-window briefs, never a generic daily
  blast.
- Keep Viator checkout external. Full Access is pending partner approval; all
  behavior must retain a Basic-compatible fallback.
- Launch availability monitoring before creator commerce.
- Publish Trailhead-authored trip packs before accepting creator submissions.
- Sell packs separately, give Explorer members a 20 percent discount, and let
  members permanently claim one featured pack each month.
- Offer one seven-day monitor trial, five concurrent Explorer monitors, and
  50-credit 30-day overflow monitors.
- Price authored packs at 250, 500, or 900 credits.
- Launch pack coverage at roughly 70 percent North America and 30 percent
  carefully validated global routes.
- Offer an explicit anonymous-data merge at sign-in. Erase account-local data
  by default at sign-out, with encrypted same-account retention as an option.
- Never sell personal routes, precise origins, saved-location history, notes,
  prompts, or individual location behavior.

## Canonical Contracts

### TripDocumentV2

A versioned trip contains owner scope, revision, status, dates, rig snapshot,
ordered days and trip items, private notes, readiness, booking and monitor
references, offline state, visibility, and timestamps. Existing v1 trips are
read through a compatibility projection for two mobile releases.

### SavedEntityV1

A saved entity represents a place, camp, trail, activity, water location, or
trip pack. It keeps a canonical source reference, offline display snapshot,
private note, visibility, timestamps, and trip references. Saving once must be
visible consistently in Explorer, Map, Trips, and Profile counts.

### Repository Rules

- Device writes are atomic and account-scoped.
- Offline edits enter a persistent sync outbox.
- Server writes are revision-aware and idempotent.
- Non-overlapping item changes merge by stable item ID.
- Concurrent edits to the same item create a visible conflict copy.
- Migration produces a receipt and quarantines corrupt records instead of
  silently dropping them.
- No trip or saved-item list has a silent cap.

## Delivery Stages

1. **Foundation:** required CI, feature flags, privacy-safe metrics, migration
   fixtures, and production backup procedure.
2. **Canonical ownership:** backend trip/library APIs, account-scoped mobile
   repository, legacy migration, and the Trips destination.
3. **Connected Explorer:** destination hubs, working filters, comparison, and
   repository-backed Save, Add to trip, and Start trip.
4. **Commerce:** contextual Viator placement, availability monitoring, native
   credit purchases, refund behavior, and entitlement restore.
5. **Community:** private notes, explicit publication, field profiles,
   structured place Q&A, moderation, and communication preferences.
6. **Content revenue:** 10-20 authored trip packs, internal publishing review,
   member benefits, purchase cloning, and completion measurement.

## Experience Requirements

- Light mode remains the default; every surface has an equivalent dark mode.
- Public copy uses trip, route, place, camp, guide, note, and booking language.
  It does not expose developer, provider-debug, model, or AI implementation
  language.
- Avoid random status pills, nested cards, marketing-first empty states, and
  shortcut controls that hide core workflows.
- A visible Explore filter must return matching content. Sparse local coverage
  expands to the nearest valid matches without inserting unrelated results.
- Commercial inventory is clearly separated and cannot alter organic ranking.
- Safety, legal access, closure, wildfire, weather risk, owned-trip recovery,
  export, and ordinary navigation are never charged.

## Release Gates

- Internal -> preview -> 5 percent -> 25 percent -> 100 percent production.
- Hold each production cohort for at least 48 hours.
- Gate promotion on migration recovery, account isolation, save/add-to-trip,
  offline reopen, conflict preservation, purchase restore, monitor completion
  and refunds, unsubscribe behavior, crash-free sessions, and support volume.
- Explorer useful content targets under four seconds p95 cold; tab changes
  target under 300 ms p95.
- Analytics may contain surface, category, coarse region, release, and outcome.
  They may not contain raw coordinates, routes, notes, searches, or prompts.
- Schema-bearing releases require a verified backup and recorded SHA-256 hash
  using `docs/production-database-backup-runbook.md`.

## Decision Log

The phased graph was chosen to preserve current route and map behavior while
removing duplicated state incrementally. One Explorer tier keeps entitlement
and purchase recovery understandable. Field profiles keep community output
useful to the catalog without assuming the moderation cost of a social network.
External Viator checkout captures affiliate value without adding payment and
cancellation operations. Availability monitors use existing reservation-alert
work and create measurable revenue before the more operationally expensive
creator marketplace.
