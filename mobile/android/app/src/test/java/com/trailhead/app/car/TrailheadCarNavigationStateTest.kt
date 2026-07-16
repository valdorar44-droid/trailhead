package com.trailhead.app.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailheadCarNavigationStateTest {
  @Test
  fun computesProgressAndUsesModeSpecificOffRouteThresholds() {
    val roadSnapshot = snapshot(mode = TrailheadCarRouteMode.ROAD_PREVIEW)
    val trailSnapshot = snapshot(mode = TrailheadCarRouteMode.TRAIL_FOLLOW_ACTIVE)
    val moderatelyOffset = TrailheadCarPoint(lat = 38.50065, lng = -109.49000)

    val roadProgress = TrailheadCarNavigationState(roadSnapshot).update(moderatelyOffset)
    val trailProgress = TrailheadCarNavigationState(trailSnapshot).update(moderatelyOffset)

    assertTrue(roadProgress.routeProgress in 0.45..0.55)
    assertTrue(roadProgress.remainingDistanceM in 800.0..950.0)
    assertTrue(roadProgress.distanceFromRouteM in 60.0..85.0)
    assertFalse(roadProgress.offRoute)
    assertTrue(trailProgress.offRoute)

    val clearlyOffRoad = TrailheadCarNavigationState(roadSnapshot).update(
      TrailheadCarPoint(lat = 38.50100, lng = -109.49000),
    )
    assertTrue(clearlyOffRoad.distanceFromRouteM > 90.0)
    assertTrue(clearlyOffRoad.offRoute)
  }

  @Test
  fun recognizesIntermediateFinalAndStoplessArrivals() {
    val withStops = TrailheadCarNavigationState(
      snapshot(
        stops = listOf(
          stop("Start", -109.50000, "start"),
          stop("Water", -109.49000, "water"),
          stop("Camp", -109.48000, "camp"),
        ),
      ),
    )

    val intermediate = withStops.update(TrailheadCarPoint(lat = 38.50000, lng = -109.49000))
    assertEquals(1, intermediate.arrivedStopIndex)
    assertFalse(intermediate.finalArrival)

    withStops.acknowledgeArrival(requireNotNull(intermediate.arrivedStopIndex))
    val destination = withStops.update(TrailheadCarPoint(lat = 38.50000, lng = -109.48000))
    assertEquals(2, destination.arrivedStopIndex)
    assertTrue(destination.finalArrival)

    val withoutStops = TrailheadCarNavigationState(snapshot(stops = emptyList())).update(
      TrailheadCarPoint(lat = 38.50000, lng = -109.48000),
    )
    assertNull(withoutStops.arrivedStopIndex)
    assertTrue(withoutStops.finalArrival)
    assertEquals(0.0, withoutStops.remainingDistanceM, 0.001)
  }

  @Test
  fun autoDriveSimulationAdvancesToRouteCompletion() {
    val points = (0..12).map { index ->
      TrailheadCarPoint(lat = 38.50000, lng = -109.50000 + index * 0.001)
    }
    val navigation = TrailheadCarNavigationState(snapshot(points = points, stops = emptyList()))
    var progress = navigation.simulateNext()
    var advances = 1

    while (!progress.finalArrival && advances <= points.size + 1) {
      progress = navigation.simulateNext()
      advances += 1
    }

    assertTrue("simulation should complete before exhausting its route points", advances <= points.size)
    assertTrue(progress.finalArrival)
    assertEquals(1.0, progress.routeProgress, 0.000001)
    assertEquals(points.last(), progress.routePoint)
    assertEquals(progress, navigation.currentProgress())
  }

  @Test
  fun roundTripArrivalsStayOrderedAndFinishAfterReturningToOrigin() {
    val origin = TrailheadCarPoint(lat = 38.50000, lng = -109.50000)
    val outbound = TrailheadCarPoint(lat = 38.50000, lng = -109.49000)
    val turnaround = TrailheadCarPoint(lat = 38.50000, lng = -109.48000)
    val navigation = TrailheadCarNavigationState(
      snapshot(
        points = listOf(origin, outbound, turnaround, outbound, origin),
        stops = listOf(
          stop("Start", origin.lng, "start"),
          stop("Turnaround", turnaround.lng, "poi"),
          stop("Finish", origin.lng, "finish"),
        ),
      ),
    )

    val atStart = navigation.update(origin)
    assertNull("the colocated final stop must not be selected at launch", atStart.arrivedStopIndex)
    assertFalse(atStart.finalArrival)

    navigation.update(outbound)
    val atTurnaround = navigation.update(turnaround)
    assertEquals(1, atTurnaround.arrivedStopIndex)
    assertFalse(atTurnaround.finalArrival)

    navigation.acknowledgeArrival(requireNotNull(atTurnaround.arrivedStopIndex))
    navigation.update(outbound)
    val backAtOrigin = navigation.update(origin)
    assertEquals(2, backAtOrigin.arrivedStopIndex)
    assertTrue(backAtOrigin.finalArrival)

    val directReturn = TrailheadCarNavigationState(
      snapshot(
        points = listOf(origin, outbound, turnaround, outbound, origin),
        stops = listOf(
          stop("Start", origin.lng, "start"),
          stop("Finish", origin.lng, "finish"),
        ),
      ),
    )
    assertNull(directReturn.update(origin).arrivedStopIndex)
    directReturn.update(turnaround)
    val directFinish = directReturn.update(origin)
    assertEquals(1, directFinish.arrivedStopIndex)
    assertTrue(directFinish.finalArrival)
  }

  private fun snapshot(
    mode: TrailheadCarRouteMode = TrailheadCarRouteMode.ROAD_PREVIEW,
    points: List<TrailheadCarPoint> = listOf(
      TrailheadCarPoint(lat = 38.50000, lng = -109.50000),
      TrailheadCarPoint(lat = 38.50000, lng = -109.49000),
      TrailheadCarPoint(lat = 38.50000, lng = -109.48000),
    ),
    stops: List<TrailheadCarStop> = emptyList(),
  ): TrailheadCarSnapshot {
    val distance = TrailheadCarNavigationMath.routeDistance(points)
    return TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.READY,
      tripName = "Moab route",
      tripSummary = "",
      rigSummary = "",
      stops = stops,
      route = TrailheadCarRoute(
        mode = mode,
        routeId = "route-42",
        title = "Moab route",
        summary = "",
        source = "trailhead",
        points = points,
        steps = listOf(
          TrailheadCarStep(
            type = "continue",
            modifier = "straight",
            name = "Trail road",
            instruction = "Continue",
            verbalPre = "Continue",
            verbalPost = "",
            distanceM = distance / 2.0,
            durationS = 300.0,
            lat = points.first().lat,
            lng = points.first().lng,
            roundaboutExit = null,
          ),
          TrailheadCarStep(
            type = "arrive",
            modifier = "straight",
            name = "Destination",
            instruction = "Arrive",
            verbalPre = "Arrive",
            verbalPost = "",
            distanceM = distance / 2.0,
            durationS = 300.0,
            lat = points.last().lat,
            lng = points.last().lng,
            roundaboutExit = null,
          ),
        ),
        totalDistanceM = distance,
        totalDurationS = 600.0,
      ),
    )
  }

  private fun stop(name: String, lng: Double, type: String): TrailheadCarStop {
    return TrailheadCarStop(
      name = name,
      description = "",
      kindLabel = name,
      kind = type,
      day = 1,
      lat = 38.50000,
      lng = lng,
    )
  }
}
