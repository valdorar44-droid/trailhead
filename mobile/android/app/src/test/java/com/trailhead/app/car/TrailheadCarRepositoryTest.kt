package com.trailhead.app.car

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailheadCarRepositoryTest {
  @Test
  fun parsesVersionOneCarNavigationSnapshot() {
    val snapshot = TrailheadCarRepository.fromCarJson(
      JSONObject(
        """
        {
          "schemaVersion": 1,
          "updatedAt": 1800000000123,
          "mapboxAccessToken": "pk.test-map-token",
          "account": {
            "accountId": "42",
            "signedIn": true,
            "reportsEnabled": true,
            "reportsDisabledReason": ""
          },
          "navigation": {
            "mode": "trail_follow_active",
            "tripId": "trip-42",
            "routeId": "trail:fins-things",
            "title": "Fins and Things",
            "summary": "Follow the saved line.",
            "source": "trail_follow",
            "coords": [
              [-109.7100000, 38.6200000],
              [-109.7123456, 38.6234567],
              [-109.7200000, 38.6300000]
            ],
            "steps": [
              {
                "type": "depart",
                "modifier": "straight",
                "name": "Fins and Things",
                "instruction": "Continue on the trail",
                "verbalPre": "Continue on the trail",
                "verbalPost": "Stay on the saved line",
                "distanceM": 2500,
                "durationS": 1800,
                "lat": 38.6200000,
                "lng": -109.7100000
              },
              {
                "type": "roundabout",
                "modifier": "right",
                "name": "Trail junction",
                "distanceM": 2500,
                "durationS": 1800,
                "roundaboutExit": 2
              }
            ],
            "legs": [],
            "totalDistanceM": 5000,
            "totalDurationS": 3600
          },
          "stops": [
            {
              "id": "start",
              "name": "Trailhead",
              "lat": 38.6200000,
              "lng": -109.7100000,
              "type": "start",
              "day": 1,
              "description": "Air down here"
            },
            {
              "id": "camp",
              "name": "Camp",
              "lat": 38.6300000,
              "lng": -109.7200000,
              "type": "camp",
              "day": 1,
              "description": "Night one"
            },
            {
              "id": "overlook",
              "name": "Optional overlook",
              "lat": 38.6250000,
              "lng": -109.7150000,
              "type": "poi",
              "day": 1,
              "routePointType": "side_stop"
            }
          ],
          "offlineReadiness": {
            "status": "needs_download",
            "map": true,
            "navigation": true,
            "places": false,
            "topo": true,
            "trails": true,
            "tripDownload": false,
            "message": "Places still need a download."
          }
        }
        """.trimIndent(),
      ),
    )

    assertNotNull(snapshot)
    requireNotNull(snapshot)
    assertEquals(TrailheadCarSnapshotState.READY, snapshot.state)
    assertEquals(1_800_000_000_123L, snapshot.updatedAt)
    assertEquals("pk.test-map-token", snapshot.mapboxAccessToken)
    assertEquals("42", snapshot.account.accountId)
    assertTrue(snapshot.account.signedIn)
    assertTrue(snapshot.account.reportsEnabled)
    assertEquals("", snapshot.account.reportsDisabledReason)

    val route = requireNotNull(snapshot.route)
    assertEquals(TrailheadCarRouteMode.TRAIL_FOLLOW_ACTIVE, route.mode)
    assertEquals("trail:fins-things", route.routeId)
    assertEquals("trail_follow", route.source)
    assertEquals(3, route.points.size)
    assertEquals(-109.7123456, route.points[1].lng, 0.0000001)
    assertEquals(2, route.steps.size)
    assertEquals("Continue on the trail", route.steps[0].instruction)
    assertEquals(2, route.steps[1].roundaboutExit)
    assertEquals(5000.0, route.totalDistanceM, 0.0)
    assertEquals(3600.0, route.totalDurationS, 0.0)

    assertEquals(2, snapshot.stops.size)
    assertFalse(snapshot.stops.any { it.name == "Optional overlook" })
    assertEquals("Camp", snapshot.stops[1].kindLabel)
    assertEquals("needs_download", snapshot.offline.status)
    assertTrue(snapshot.offline.mapReady == true)
    assertTrue(snapshot.offline.navigationReady == true)
    assertFalse(snapshot.offline.placesReady == true)
    assertTrue(snapshot.offline.topoReady == true)
    assertTrue(snapshot.offline.trailsReady == true)
    assertFalse(snapshot.offline.tripDownloadReady == true)
    assertFalse(snapshot.offline.ready)
    assertEquals("Places still need a download.", snapshot.offline.message)
  }

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
            {"day": 1, "name": "Optional overlook", "type": "poi", "route_point_type": "side_stop", "lat": 38.60, "lng": -109.54},
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
    assertFalse(snapshot.stops.any { it.name == "Optional overlook" })
    assertEquals("Start", snapshot.stops[0].kindLabel)
    assertEquals("Camp", snapshot.stops[1].kindLabel)
  }

  @Test
  fun parsesVersionPinnedOriginalDriveWithoutStoryStops() {
    val snapshot = TrailheadCarRepository.fromCarJson(
      JSONObject(
        """
        {
          "schemaVersion": 1,
          "navigation": {
            "mode": "original_drive_active",
            "routeId": "original:moab:v1:manifest-moab-v1",
            "title": "Moab: Canyons to the Sky",
            "summary": "11 stories · audio plays on your phone",
            "source": "trailhead_original",
            "coords": [[-109.55, 38.57], [-109.72, 38.63]],
            "steps": [{
              "type": "continue",
              "modifier": "straight",
              "name": "Trailhead Original",
              "instruction": "Continue on the Original route",
              "distanceM": 104569,
              "durationS": 14400
            }],
            "totalDistanceM": 104569,
            "totalDurationS": 14400
          },
          "stops": [],
          "offlineReadiness": {
            "status": "ready",
            "map": true,
            "navigation": true,
            "tripDownload": true
          }
        }
        """.trimIndent(),
      ),
    )

    requireNotNull(snapshot)
    val route = requireNotNull(snapshot.route)
    assertEquals(TrailheadCarRouteMode.ORIGINAL_DRIVE_ACTIVE, route.mode)
    assertTrue(route.isOriginalDrive)
    assertFalse(route.isTrailFollow)
    assertEquals("trailhead_original", route.source)
    assertEquals("Continue on the Original route", route.steps.single().instruction)
    assertTrue(snapshot.stops.isEmpty())
    assertTrue(snapshot.offline.ready)
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
