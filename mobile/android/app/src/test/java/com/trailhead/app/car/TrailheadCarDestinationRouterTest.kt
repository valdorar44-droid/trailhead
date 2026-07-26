package com.trailhead.app.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TrailheadCarDestinationRouterTest {
  @Test
  fun namedDestinationResolvesAndBuildsTurnByTurnRoute() {
    val requests = mutableListOf<String>()
    val responses = ArrayDeque(
      listOf(
        """{"features":[{"geometry":{"coordinates":[-109.5498,38.5733]}}]}""",
        directionsResponse(),
      ),
    )
    val router = TrailheadCarDestinationRouter("public-token") { url ->
      requests += url
      responses.removeFirst()
    }

    val result = router.resolve(
      origin = TrailheadCarPoint(38.57, -109.53),
      request = TrailheadCarNavigationRequest(
        "Sand Flats",
        null,
        null,
        TrailheadCarNavigationMode.NAVIGATION,
      ),
    )

    assertEquals(2, requests.size)
    assertTrue(requests[0].startsWith("https://api.mapbox.com/search/searchbox/v1/forward"))
    assertTrue(requests[0].contains("q=Sand+Flats"))
    assertTrue(requests[0].contains("proximity=-109.53,38.57"))
    assertTrue(requests[1].startsWith("https://api.mapbox.com/directions/v5/mapbox/driving-traffic/"))
    assertTrue(requests[1].contains("steps=true"))
    assertTrue(requests[1].contains("voice_instructions=true"))
    assertEquals("Sand Flats", result.route.title)
    assertEquals("mapbox_car_request", result.route.source)
    assertEquals(3, result.route.points.size)
    assertEquals(2, result.route.steps.size)
    assertEquals("Head east", result.route.steps.first().verbalPre)
    assertEquals(1609.344, result.route.totalDistanceM, 0.001)
  }

  @Test
  fun coordinateRequestDoesNotPerformSearch() {
    val requests = mutableListOf<String>()
    val router = TrailheadCarDestinationRouter("public-token") { url ->
      requests += url
      directionsResponse()
    }

    router.resolve(
      origin = TrailheadCarPoint(38.57, -109.53),
      request = TrailheadCarNavigationRequest(
        "Destination",
        38.5733,
        -109.5498,
        TrailheadCarNavigationMode.DIRECTIONS,
      ),
    )

    assertEquals(1, requests.size)
    assertFalse(requests.single().contains("/search/searchbox/"))
    assertTrue(requests.single().contains("-109.53,38.57;-109.5498,38.5733"))
  }

  @Test
  fun addStopKeepsThePriorDestinationInTheCalculatedRoute() {
    val requests = mutableListOf<String>()
    val router = TrailheadCarDestinationRouter("public-token") { url ->
      requests += url
      directionsResponse()
    }

    router.resolve(
      origin = TrailheadCarPoint(38.57, -109.53),
      request = TrailheadCarNavigationRequest(
        "Fuel",
        38.58,
        -109.54,
        TrailheadCarNavigationMode.ADD_A_STOP,
      ),
      finalDestinationAfterStop = TrailheadCarPoint(38.61, -109.50),
    )

    assertTrue(
      requests.single(),
      requests.single().contains("-109.53,38.57;-109.54,38.58;-109.5,38.61"),
    )
  }

  @Test
  fun emptyDirectionsResponseFailsWithoutInventingARoute() {
    val router = TrailheadCarDestinationRouter("public-token") { """{"routes":[]}""" }
    assertThrows(IllegalStateException::class.java) {
      router.resolve(
        TrailheadCarPoint(38.57, -109.53),
        TrailheadCarNavigationRequest(
          "Nowhere",
          38.58,
          -109.54,
          TrailheadCarNavigationMode.NAVIGATION,
        ),
      )
    }
  }

  private fun directionsResponse(): String {
    return """
      {
        "routes": [{
          "distance": 1609.344,
          "duration": 600,
          "geometry": {
            "coordinates": [
              [-109.53, 38.57],
              [-109.54, 38.58],
              [-109.5498, 38.5733]
            ]
          },
          "legs": [{
            "steps": [
              {
                "distance": 900,
                "duration": 320,
                "name": "Main Street",
                "maneuver": {
                  "type": "depart",
                  "modifier": "straight",
                  "instruction": "Head east",
                  "location": [-109.53, 38.57]
                },
                "voiceInstructions": [{"announcement": "Head east"}]
              },
              {
                "distance": 709.344,
                "duration": 280,
                "name": "Sand Flats Road",
                "maneuver": {
                  "type": "arrive",
                  "modifier": "right",
                  "instruction": "Arrive at Sand Flats",
                  "location": [-109.5498, 38.5733]
                },
                "voiceInstructions": [{"announcement": "Arrive at Sand Flats"}]
              }
            ]
          }]
        }]
      }
    """.trimIndent()
  }
}
