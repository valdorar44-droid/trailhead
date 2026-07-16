package com.trailhead.app.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrailheadCarNavigationIntentTest {
  @Test
  fun rejectsUnrelatedActionsAndSchemes() {
    assertNull(TrailheadCarNavigationIntent.parse("android.intent.action.VIEW", "geo:38.5,-109.5"))
    assertNull(TrailheadCarNavigationIntent.parse(TrailheadCarNavigationIntent.ACTION, "https://example.com"))
  }

  @Test
  fun parsesNamedDestinationWithoutTreatingPlaceholderAsCoordinates() {
    val request = TrailheadCarNavigationIntent.parse(
      TrailheadCarNavigationIntent.ACTION,
      "geo:0,0?q=Yosemite+National+Park&mode=d&intent=directions",
    )

    requireNotNull(request)
    assertEquals("Yosemite National Park", request.label)
    assertNull(request.lat)
    assertNull(request.lng)
    assertEquals(TrailheadCarNavigationMode.DIRECTIONS, request.mode)
  }

  @Test
  fun parsesLabeledQueryCoordinatesAndStopMode() {
    val request = TrailheadCarNavigationIntent.parse(
      TrailheadCarNavigationIntent.ACTION,
      "geo:0,0?q=38.5733%2C-109.5498%28Sand+Flats%29&mode=d&intent=add_a_stop",
    )

    requireNotNull(request)
    assertEquals("Sand Flats", request.label)
    assertEquals(38.5733, request.lat!!, 0.000001)
    assertEquals(-109.5498, request.lng!!, 0.000001)
    assertEquals(TrailheadCarNavigationMode.ADD_A_STOP, request.mode)
  }

  @Test
  fun parsesDirectCoordinatesWithNavigationAsDefault() {
    val request = TrailheadCarNavigationIntent.parse(
      TrailheadCarNavigationIntent.ACTION,
      "geo:38.5733,-109.5498",
    )

    requireNotNull(request)
    assertEquals("38.5733, -109.5498", request.label)
    assertEquals(38.5733, request.lat!!, 0.000001)
    assertEquals(-109.5498, request.lng!!, 0.000001)
    assertEquals(TrailheadCarNavigationMode.NAVIGATION, request.mode)
  }

  @Test
  fun rejectsGeoIntentWithoutAUsableDestination() {
    assertNull(TrailheadCarNavigationIntent.parse(TrailheadCarNavigationIntent.ACTION, "geo:not-a-place"))
  }
}
