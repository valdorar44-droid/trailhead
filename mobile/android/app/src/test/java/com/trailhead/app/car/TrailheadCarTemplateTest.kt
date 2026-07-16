package com.trailhead.app.car

import android.Manifest
import android.app.Application
import android.location.Location
import android.os.Looper
import androidx.car.app.HandshakeInfo
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.MapWithContentTemplate
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.testing.ScreenController
import androidx.car.app.testing.TestCarContext
import androidx.lifecycle.Lifecycle
import expo.modules.trailheadcarreports.CarReportEnqueueStatus
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class TrailheadCarTemplateTest {
  private lateinit var application: Application
  private lateinit var carContext: TestCarContext
  private lateinit var mapSurface: TrailheadCarMapSurface

  @Before
  fun setUp() {
    application = RuntimeEnvironment.getApplication()
    shadowOf(application).grantPermissions(
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_COARSE_LOCATION,
      Manifest.permission.POST_NOTIFICATIONS,
    )
    carContext = TestCarContext.createCarContext(application).apply {
      updateHandshakeInfo(HandshakeInfo("com.google.android.projection.gearhead", 7))
    }
    mapSurface = TrailheadCarMapSurface(carContext)
  }

  @After
  fun tearDown() {
    mapSurface.release()
    shadowOf(Looper.getMainLooper()).idle()
  }

  @Test
  fun noTripReturnsParkedPhoneMessage() {
    val snapshot = TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.NO_TRIP,
      tripName = "No trip selected",
      tripSummary = "",
      rigSummary = "",
      stops = emptyList(),
    )

    val template = render(TrailheadCarHomeScreen(carContext, TestController(snapshot)))

    assertTrue(template is MessageTemplate)
    val message = template as MessageTemplate
    assertEquals("No trip selected", message.title.toString())
    assertEquals("Choose a saved trip on your phone when parked.", message.message.toString())
    assertEquals(Action.TYPE_APP_ICON, requireNotNull(message.headerAction).type)
  }

  @Test
  fun readyRouteUsesMapWithContentAndPrimaryTripActions() {
    val template = render(TrailheadCarHomeScreen(carContext, TestController(readySnapshot())))

    assertTrue(template is MapWithContentTemplate)
    val preview = template as MapWithContentTemplate
    assertNotNull(preview.mapController)
    val content = preview.contentTemplate as PaneTemplate
    assertEquals("Trailhead", content.title.toString())
    assertEquals(
      listOf("Start route", "Report"),
      content.pane.actions.map { it.title.toString() },
    )
    assertEquals(
      listOf("Moab weekend", "Trip route", "Route ready offline"),
      content.pane.rows.map { it.title.toString() },
    )
  }

  @Test
  fun reportGridContainsSixIconActionsIncludingPolice() {
    val template = render(TrailheadCarReportScreen(carContext, TestController(readySnapshot())))

    assertTrue(template is GridTemplate)
    val grid = template as GridTemplate
    val items = requireNotNull(grid.singleList).items.map { it as GridItem }
    assertEquals("Report", grid.title.toString())
    assertEquals(6, items.size)
    assertEquals(
      listOf("Hazard", "Road closed", "Gate closed", "Camp full", "No fuel", "Police"),
      items.map { it.title.toString() },
    )
    assertTrue(items.all { it.image != null && it.imageType == GridItem.IMAGE_TYPE_ICON })
  }

  @Test
  fun activeGuidanceReturnsNavigationTemplateWithProgressAndControls() {
    val snapshot = readySnapshot()
    val controller = TestController(
      snapshot = snapshot,
      progress = TrailheadCarNavigationState(snapshot).update(
        TrailheadCarPoint(lat = 38.575, lng = -109.525),
      ),
      navigating = true,
    )

    val template = render(TrailheadCarGuidanceScreen(carContext, controller))

    assertTrue(template is NavigationTemplate)
    val guidance = template as NavigationTemplate
    assertTrue(guidance.navigationInfo is RoutingInfo)
    assertNotNull(guidance.destinationTravelEstimate)
    assertEquals(
      listOf("Report", "Mute", "End"),
      requireNotNull(guidance.actionStrip).actions.map { it.title.toString() },
    )
    assertEquals(4, requireNotNull(guidance.mapActionStrip).actions.size)
  }

  @Test
  fun apiOnePreviewAndGuidanceAvoidNewerMapControls() {
    carContext.updateHandshakeInfo(HandshakeInfo("com.google.android.projection.gearhead", 1))
    val snapshot = readySnapshot()

    val preview = render(TrailheadCarHomeScreen(carContext, TestController(snapshot)))
    val guidance = render(
      TrailheadCarGuidanceScreen(
        carContext,
        TestController(
          snapshot = snapshot,
          progress = TrailheadCarNavigationState(snapshot).update(
            TrailheadCarPoint(lat = 38.575, lng = -109.525),
          ),
          navigating = true,
        ),
      ),
    )

    assertTrue(preview is PlaceListNavigationTemplate)
    assertTrue((preview as PlaceListNavigationTemplate).mapActionStrip == null)
    assertTrue(guidance is NavigationTemplate)
    assertTrue((guidance as NavigationTemplate).mapActionStrip == null)
  }

  @Test
  fun finalArrivalUsesTripCompleteHeaderAndAppIcon() {
    val template = render(
      TrailheadCarArrivalScreen(
        carContext = carContext,
        controller = TestController(readySnapshot(), navigating = true),
        stopIndex = 1,
        finalArrival = true,
      ),
    )

    assertTrue(template is PaneTemplate)
    val arrival = template as PaneTemplate
    assertEquals("Trip complete", arrival.title.toString())
    assertEquals(Action.TYPE_APP_ICON, requireNotNull(arrival.headerAction).type)
    assertEquals("Moab weekend", arrival.pane.rows.single().title.toString())
    assertEquals(listOf("Done"), arrival.pane.actions.map { it.title.toString() })
  }

  private fun render(screen: Screen): Template {
    val controller = ScreenController(screen)
    controller.moveToState(Lifecycle.State.RESUMED)
    screen.invalidate()
    shadowOf(Looper.getMainLooper()).idle()
    return controller.templatesReturned.last()
  }

  private inner class TestController(
    override val snapshot: TrailheadCarSnapshot,
    override val progress: TrailheadCarProgress? = null,
    override val navigating: Boolean = false,
    override val muted: Boolean = false,
  ) : TrailheadCarSessionController {
    override val mapSurface: TrailheadCarMapSurface = this@TrailheadCarTemplateTest.mapSurface

    override fun startGuidance() = Unit
    override fun endGuidance() = Unit
    override fun continueAfterArrival(stopIndex: Int) = Unit
    override fun toggleMuted() = Unit
    override fun beginReportLocation() = Unit
    override fun endReportLocation() = Unit
    override fun report(categoryId: String): CarReportEnqueueStatus = CarReportEnqueueStatus.QUEUED
    override fun latestLocation(): Location? = null
  }

  private fun readySnapshot(): TrailheadCarSnapshot {
    val points = listOf(
      TrailheadCarPoint(lat = 38.570, lng = -109.530),
      TrailheadCarPoint(lat = 38.580, lng = -109.520),
      TrailheadCarPoint(lat = 38.590, lng = -109.510),
    )
    val distance = TrailheadCarNavigationMath.routeDistance(points)
    return TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.READY,
      tripName = "Moab weekend",
      tripSummary = "2 days, 62 miles",
      rigSummary = "",
      stops = listOf(
        TrailheadCarStop("Sand Flats", "", "Start", "start", 1, points.first().lat, points.first().lng),
        TrailheadCarStop("Devils Garden", "", "Camp", "camp", 1, points.last().lat, points.last().lng),
      ),
      route = TrailheadCarRoute(
        mode = TrailheadCarRouteMode.ROAD_PREVIEW,
        routeId = "route-moab",
        title = "Moab weekend",
        summary = "Sand Flats to Devils Garden",
        source = "trailhead",
        points = points,
        steps = listOf(
          TrailheadCarStep(
            type = "depart",
            modifier = "straight",
            name = "Sand Flats Road",
            instruction = "Continue on Sand Flats Road",
            verbalPre = "Continue on Sand Flats Road",
            verbalPost = "",
            distanceM = distance / 2,
            durationS = 900.0,
            lat = points.first().lat,
            lng = points.first().lng,
            roundaboutExit = null,
          ),
          TrailheadCarStep(
            type = "arrive",
            modifier = "straight",
            name = "Devils Garden",
            instruction = "Arrive at Devils Garden",
            verbalPre = "Arrive at Devils Garden",
            verbalPost = "",
            distanceM = distance / 2,
            durationS = 900.0,
            lat = points.last().lat,
            lng = points.last().lng,
            roundaboutExit = null,
          ),
        ),
        totalDistanceM = distance,
        totalDurationS = 1800.0,
      ),
      offline = TrailheadCarOfflineReadiness(
        status = "ready",
        mapReady = true,
        navigationReady = true,
        placesReady = true,
        topoReady = true,
        trailsReady = true,
        tripDownloadReady = true,
      ),
      account = TrailheadCarAccount(
        accountId = "account-42",
        signedIn = true,
        reportsEnabled = true,
      ),
    )
  }
}
