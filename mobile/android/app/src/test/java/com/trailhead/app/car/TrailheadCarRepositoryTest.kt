package com.trailhead.app.car

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailheadCarRepositoryTest {
  @Test
  fun parsesUsefulRouteStopsAndIgnoresInvalidCoordinates() {
    val trip = JSONObject(
      """
      {
        "plan": {
          "trip_name": "Moab weekend",
          "duration_days": 2,
          "total_est_miles": 126.4,
          "waypoints": [
            {"day": 1, "name": "Sand Flats", "type": "start", "description": "Trail entrance", "lat": 38.57, "lng": -109.50},
            {"day": 1, "name": "Devils Garden", "type": "overnight", "land_type": "Campground", "lat": 38.78, "lng": -109.59},
            {"day": 2, "name": "Broken coordinate", "type": "poi", "lat": 190, "lng": -109.59}
          ]
        }
      }
      """.trimIndent(),
    )

    val snapshot = TrailheadCarRepository.fromJson(
      trip,
      rig = null,
      requestedState = TrailheadCarSnapshotState.READY,
    )

    assertEquals(TrailheadCarSnapshotState.READY, snapshot.state)
    assertEquals("Moab weekend", snapshot.tripName)
    assertEquals("2d · 126 mi", snapshot.tripSummary)
    assertEquals(2, snapshot.stops.size)
    assertEquals("Start", snapshot.stops[0].kindLabel)
    assertEquals("Camp", snapshot.stops[1].kindLabel)
  }

  @Test
  fun marksAReadableButInvalidTripUnavailable() {
    val snapshot = TrailheadCarRepository.fromJson(
      trip = JSONObject("{\"trip_id\":\"missing-plan\"}"),
      rig = null,
      requestedState = TrailheadCarSnapshotState.READY,
    )

    assertEquals(TrailheadCarSnapshotState.UNAVAILABLE, snapshot.state)
    assertEquals("Trip unavailable", snapshot.tripName)
    assertTrue(snapshot.stops.isEmpty())
  }

  @Test
  fun keepsMissingTripDistinctFromUnreadableTrip() {
    val snapshot = TrailheadCarRepository.fromJson(
      trip = null,
      rig = null,
      requestedState = TrailheadCarSnapshotState.NO_TRIP,
    )

    assertEquals(TrailheadCarSnapshotState.NO_TRIP, snapshot.state)
    assertEquals("No trip selected", snapshot.tripName)
  }
}
