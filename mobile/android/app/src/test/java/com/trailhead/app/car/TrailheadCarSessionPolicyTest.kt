package com.trailhead.app.car

import androidx.lifecycle.Lifecycle
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailheadCarSessionPolicyTest {
  @Test
  fun phonePreviewDoesNotReplaceRouteDuringGuidance() {
    val current = snapshot("route-a", TrailheadCarRouteMode.ROAD_PREVIEW)
    val incoming = snapshot("route-b", TrailheadCarRouteMode.ROAD_PREVIEW)

    assertTrue(shouldPreserveActiveCarRoute(current, incoming, navigating = true, routeChanged = true))
  }

  @Test
  fun activeTrailAndAccountChangesAreApplied() {
    val current = snapshot("route-a", TrailheadCarRouteMode.ROAD_PREVIEW)
    val activeTrail = snapshot("trail-b", TrailheadCarRouteMode.TRAIL_FOLLOW_ACTIVE)
    val signedOut = snapshot("route-b", TrailheadCarRouteMode.ROAD_PREVIEW).copy(
      account = TrailheadCarAccount(),
    )

    assertFalse(shouldPreserveActiveCarRoute(current, activeTrail, navigating = true, routeChanged = true))
    assertFalse(shouldPreserveActiveCarRoute(current, signedOut, navigating = true, routeChanged = true))
  }

  @Test
  fun routeUpdatesRemainAvailableWhenGuidanceIsInactive() {
    val current = snapshot("route-a", TrailheadCarRouteMode.ROAD_PREVIEW)
    val incoming = snapshot("route-b", TrailheadCarRouteMode.ROAD_PREVIEW)

    assertFalse(shouldPreserveActiveCarRoute(current, incoming, navigating = false, routeChanged = true))
  }

  @Test
  fun endingAnOriginalOnPhoneEndsItsCarGuidance() {
    val original = snapshot("original:moab:v1", TrailheadCarRouteMode.ORIGINAL_DRIVE_ACTIVE)
    val restoredTrip = snapshot("route-a", TrailheadCarRouteMode.ROAD_PREVIEW)

    assertFalse(shouldPreserveActiveCarRoute(original, restoredTrip, navigating = true, routeChanged = true))
    assertTrue(shouldEndActiveOriginalGuidance(original, restoredTrip, navigating = true, routeChanged = true))
    assertFalse(shouldEndActiveOriginalGuidance(original, original, navigating = true, routeChanged = false))
  }

  @Test
  fun navigationRequestsMatchCoordinatesAndDestinationNames() {
    val saved = snapshot("Moab weekend", TrailheadCarRouteMode.ROAD_PREVIEW).copy(
      stops = listOf(
        TrailheadCarStop("Sand Flats", "", "Start", "start", 1, 38.57, -109.53),
        TrailheadCarStop("Devils Garden Campground", "", "Camp", "camp", 1, 38.58, -109.52),
      ),
    )

    assertTrue(
      requestMatchesCurrentRoute(
        TrailheadCarNavigationRequest("Nearby coordinate", 38.5805, -109.5205, TrailheadCarNavigationMode.NAVIGATION),
        saved,
      ),
    )
    assertTrue(
      requestMatchesCurrentRoute(
        TrailheadCarNavigationRequest("Devils Garden", null, null, TrailheadCarNavigationMode.DIRECTIONS),
        saved,
      ),
    )
    assertFalse(
      requestMatchesCurrentRoute(
        TrailheadCarNavigationRequest("Yosemite", null, null, TrailheadCarNavigationMode.NAVIGATION),
        saved,
      ),
    )
  }

  @Test
  fun routeReplacementPermissionExpiresAndDirectionsNeverGrantIt() {
    val now = 25_000L
    val window = 10_000L
    val navigation = TrailheadCarNavigationRequest(
      "Moab",
      38.57,
      -109.53,
      TrailheadCarNavigationMode.NAVIGATION,
    )
    val directions = navigation.copy(mode = TrailheadCarNavigationMode.DIRECTIONS)
    val deadline = routeReplacementRequestDeadline(navigation, now, window)

    assertTrue(routeReplacementRequestIsPending(deadline, now + window))
    assertFalse(routeReplacementRequestIsPending(deadline, now + window + 1L))
    assertFalse(
      routeReplacementRequestIsPending(
        routeReplacementRequestDeadline(directions, now, window),
        now,
      ),
    )
  }

  @Test
  fun destroyedGuidanceScreensAreNeverInvalidated() {
    assertFalse(guidanceScreenCanBeInvalidated(Lifecycle.State.DESTROYED))
    assertTrue(guidanceScreenCanBeInvalidated(Lifecycle.State.CREATED))
    assertTrue(guidanceScreenCanBeInvalidated(Lifecycle.State.STARTED))
    assertTrue(guidanceScreenCanBeInvalidated(Lifecycle.State.RESUMED))
  }

  private fun snapshot(routeId: String, mode: TrailheadCarRouteMode): TrailheadCarSnapshot {
    val points = listOf(
      TrailheadCarPoint(38.57, -109.53),
      TrailheadCarPoint(38.58, -109.52),
    )
    return TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.READY,
      tripName = routeId,
      tripSummary = "",
      rigSummary = "",
      stops = emptyList(),
      route = TrailheadCarRoute(
        mode = mode,
        routeId = routeId,
        title = routeId,
        summary = "",
        source = "test",
        points = points,
        steps = emptyList(),
        totalDistanceM = 1_000.0,
        totalDurationS = 120.0,
      ),
      account = TrailheadCarAccount(
        accountId = "account-42",
        signedIn = true,
        reportsEnabled = true,
      ),
    )
  }
}
