package com.trailhead.app.car

import android.Manifest
import android.app.Application
import android.location.Location
import android.os.Looper
import androidx.car.app.HandshakeInfo
import androidx.car.app.OnDoneCallback
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.model.Action
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.SearchTemplate
import androidx.car.app.model.Template
import androidx.car.app.serialization.Bundleable
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
import org.junit.Assert.assertFalse
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
  @Test
  fun copilotActionShowsDoneOnlyWhileListening() {
    assertEquals("Done", copilotGuidanceActionLabel(TrailheadCarCopilotStatus.LISTENING))
    assertEquals("Co-Pilot", copilotGuidanceActionLabel(TrailheadCarCopilotStatus.IDLE))
    assertEquals("Co-Pilot", copilotGuidanceActionLabel(TrailheadCarCopilotStatus.PROCESSING))
    assertEquals("Co-Pilot", copilotGuidanceActionLabel(TrailheadCarCopilotStatus.RESPONSE))
  }
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
      Manifest.permission.RECORD_AUDIO,
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
  fun noTripOffersHeadUnitSearchWithoutRequiringPhoneRouteSelection() {
    val snapshot = TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.NO_TRIP,
      tripName = "No trip selected",
      tripSummary = "",
      rigSummary = "",
      stops = emptyList(),
    )

    val template = render(TrailheadCarHomeScreen(carContext, TestController(snapshot)))

    assertTrue(template is ListTemplate)
    val list = template as ListTemplate
    assertEquals("Where to?", list.title.toString())
    assertEquals(Action.TYPE_APP_ICON, requireNotNull(list.headerAction).type)
    assertEquals(
      listOf("Search destinations"),
      requireNotNull(list.singleList).items.map { (it as androidx.car.app.model.Row).title.toString() },
    )
  }

  @Test
  fun permissionPromptTellsDriverToUsePhoneOnlyWhenSafe() {
    shadowOf(application).denyPermissions(
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_COARSE_LOCATION,
      Manifest.permission.POST_NOTIFICATIONS,
    )

    val template = render(
      TrailheadCarHomeScreen(
        carContext,
        TestController(readySnapshot()),
      ),
    ) as MessageTemplate

    assertTrue(template.message.toString().startsWith("When safe, use your phone to allow"))
    assertTrue(requireNotNull(template.actions.single().onClickDelegate).isParkedOnly)
  }

  @Test
  fun destinationPermissionActionIsParkedOnlyAndUsesSafeCopy() {
    val controller = TestController(
      snapshot = TrailheadCarSnapshot(
        state = TrailheadCarSnapshotState.NO_TRIP,
        tripName = "No trip selected",
        tripSummary = "",
        rigSummary = "",
        stops = emptyList(),
      ),
      guidancePermissionsGranted = false,
    )
    val template = render(
      TrailheadCarNavigationRequestScreen(
        carContext,
        controller,
        TrailheadCarNavigationRequest(
          "Moab",
          38.5733,
          -109.5498,
          TrailheadCarNavigationMode.NAVIGATION,
        ),
        showBack = true,
      ),
    ) as PaneTemplate

    assertEquals(Action.TYPE_BACK, requireNotNull(template.headerAction).type)
    val permissionAction = template.pane.actions.single()
    assertEquals("Allow permissions", permissionAction.title.toString())
    assertTrue(requireNotNull(permissionAction.onClickDelegate).isParkedOnly)
  }

  @Test
  fun leavingDestinationRequestCancelsPendingRouteUnlessGuidanceStarted() {
    val pendingController = TestController(
      snapshot = TrailheadCarSnapshot(
        state = TrailheadCarSnapshotState.NO_TRIP,
        tripName = "No trip selected",
        tripSummary = "",
        rigSummary = "",
        stops = emptyList(),
      ),
    )
    val pendingScreen = TrailheadCarNavigationRequestScreen(
      carContext,
      pendingController,
      TrailheadCarNavigationRequest("Moab", 38.5733, -109.5498, TrailheadCarNavigationMode.NAVIGATION),
      showBack = true,
    )
    ScreenController(pendingScreen).apply {
      moveToState(Lifecycle.State.RESUMED)
      moveToState(Lifecycle.State.DESTROYED)
    }
    assertEquals(1, pendingController.cancelNavigationRequestCalls)

    val activeController = TestController(readySnapshot(), navigating = true)
    val activeScreen = TrailheadCarNavigationRequestScreen(
      carContext,
      activeController,
      TrailheadCarNavigationRequest("Moab", 38.5733, -109.5498, TrailheadCarNavigationMode.NAVIGATION),
      showBack = true,
    )
    ScreenController(activeScreen).apply {
      moveToState(Lifecycle.State.RESUMED)
      moveToState(Lifecycle.State.DESTROYED)
    }
    assertEquals(1, activeController.cancelNavigationRequestCalls)
  }

  @Test
  fun destroyedSearchScreenIgnoresLateResults() {
    var delayedResult: ((TrailheadCarDestinationSearchResponse) -> Unit)? = null
    val controller = TestController(
      snapshot = TrailheadCarSnapshot(
        state = TrailheadCarSnapshotState.NO_TRIP,
        tripName = "No trip selected",
        tripSummary = "",
        rigSummary = "",
        stops = emptyList(),
      ),
      searchHandler = { _, callback -> delayedResult = callback },
    )
    val screen = TrailheadCarSearchScreen(carContext, controller)
    val screenController = ScreenController(screen)
    screenController.moveToState(Lifecycle.State.RESUMED)
    screen.invalidate()
    shadowOf(Looper.getMainLooper()).idle()
    val initial = screenController.templatesReturned.last() as SearchTemplate
    initial.searchCallbackDelegate.sendSearchSubmitted("Moab", doneCallback)
    shadowOf(Looper.getMainLooper()).idle()
    val templateCount = screenController.templatesReturned.size

    screenController.moveToState(Lifecycle.State.DESTROYED)
    requireNotNull(delayedResult).invoke(
      TrailheadCarDestinationSearchResponse.Ready(
        listOf(TrailheadCarDestinationChoice("Moab", "Utah", 38.5733, -109.5498)),
      ),
    )
    shadowOf(Looper.getMainLooper()).idle()

    assertEquals(templateCount, screenController.templatesReturned.size)
  }

  @Test
  fun legacyMapboxDestinationHistoryIsDeleted() {
    application.getSharedPreferences("trailhead_car_destination_history", 0)
      .edit()
      .putString("entries_v1", "sensitive temporary result")
      .commit()

    clearLegacyCarDestinationHistory(application)

    assertFalse(
      application.getSharedPreferences("trailhead_car_destination_history", 0)
        .contains("entries_v1"),
    )
  }

  @Test
  fun copilotMicrophonePermissionActionIsParkedOnly() {
    val snapshot = readySnapshot()
    val progress = TrailheadCarNavigationState(snapshot).update(
      TrailheadCarPoint(38.575, -109.525),
    )
    val template = render(
      TrailheadCarGuidanceScreen(
        carContext,
        TestController(
          snapshot = snapshot,
          progress = progress,
          navigating = true,
          copilotPermissionGranted = false,
        ),
      ),
    ) as NavigationTemplate

    val copilot = requireNotNull(template.actionStrip).actions
      .first { it.title.toString() == "Co-Pilot" }
    assertTrue(requireNotNull(copilot.onClickDelegate).isParkedOnly)
  }

  @Test
  fun freshInstallCanSearchSelectAndPressStartToReachGuidance() {
    val controller = HeadUnitStartController()
    val home = TrailheadCarHomeScreen(carContext, controller)
    val homeTemplate = render(home) as ListTemplate
    val searchRow = requireNotNull(homeTemplate.singleList).items.single() as androidx.car.app.model.Row

    requireNotNull(searchRow.onClickDelegate).sendClick(doneCallback)
    shadowOf(Looper.getMainLooper()).idle()
    val searchScreen = carContext.getCarService(ScreenManager::class.java).top
    assertTrue(searchScreen is TrailheadCarSearchScreen)

    val searchController = ScreenController(searchScreen)
    searchController.moveToState(Lifecycle.State.RESUMED)
    searchScreen.invalidate()
    shadowOf(Looper.getMainLooper()).idle()
    val initialSearch = searchController.templatesReturned.last() as SearchTemplate
    initialSearch.searchCallbackDelegate.sendSearchSubmitted("Moab", doneCallback)
    shadowOf(Looper.getMainLooper()).idle()
    val results = searchController.templatesReturned.last() as SearchTemplate
    val resultRow = requireNotNull(results.itemList).items.single() as androidx.car.app.model.Row

    requireNotNull(resultRow.onClickDelegate).sendClick(doneCallback)
    shadowOf(Looper.getMainLooper()).idle()
    val requestScreen = carContext.getCarService(ScreenManager::class.java).top
    assertTrue(requestScreen is TrailheadCarNavigationRequestScreen)
    val requestTemplate = render(requestScreen) as PaneTemplate
    assertEquals(Action.TYPE_BACK, requireNotNull(requestTemplate.headerAction).type)
    requireNotNull(requestTemplate.pane.actions.single().onClickDelegate).sendClick(doneCallback)
    shadowOf(Looper.getMainLooper()).idle()

    assertEquals(1, controller.navigationStartedCalls)
    val guidanceScreen = carContext.getCarService(ScreenManager::class.java).top
    assertTrue(guidanceScreen is TrailheadCarGuidanceScreen)
    assertTrue(render(guidanceScreen) is NavigationTemplate)
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
  fun originalDriveUsesDisplayOnlyCarLabels() {
    val snapshot = readySnapshot().copy(
      tripName = "Moab: Canyons to the Sky",
      tripSummary = "11 stories · audio plays on your phone",
      stops = emptyList(),
      route = requireNotNull(readySnapshot().route).copy(
        mode = TrailheadCarRouteMode.ORIGINAL_DRIVE_ACTIVE,
        routeId = "original:moab:v1:manifest-moab-v1",
        title = "Moab: Canyons to the Sky",
        source = "trailhead_original",
      ),
    )

    val template = render(TrailheadCarHomeScreen(carContext, TestController(snapshot)))

    assertTrue(template is MapWithContentTemplate)
    val content = (template as MapWithContentTemplate).contentTemplate as PaneTemplate
    assertEquals(listOf("Show route", "Report"), content.pane.actions.map { it.title.toString() })
    assertEquals(
      listOf("Moab: Canyons to the Sky", "Trailhead Original", "Route ready offline"),
      content.pane.rows.map { it.title.toString() },
    )
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
      listOf("Co-Pilot", "Report", "Mute", "End"),
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

  @Test
  fun endingReconnectRootReplacesGuidanceWithHome() {
    val controller = TestController(readySnapshot(), navigating = true)

    assertTrue(
      shouldReplacePostGuidanceRoot(
        TrailheadCarGuidanceScreen(carContext, controller),
      ),
    )
    assertTrue(
      shouldReplacePostGuidanceRoot(
        TrailheadCarArrivalScreen(
          carContext = carContext,
          controller = controller,
          stopIndex = 1,
          finalArrival = true,
        ),
      ),
    )
    assertFalse(
      shouldReplacePostGuidanceRoot(
        TrailheadCarHomeScreen(carContext, controller),
      ),
    )
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
    override val guidancePermissionsGranted: Boolean = true,
    override val copilotPermissionGranted: Boolean = true,
    private val searchHandler: ((String, (TrailheadCarDestinationSearchResponse) -> Unit) -> Unit)? = null,
  ) : TrailheadCarSessionController {
    override val copilotState = TrailheadCarCopilotState()
    override val mapSurface: TrailheadCarMapSurface = this@TrailheadCarTemplateTest.mapSurface
    var cancelNavigationRequestCalls = 0

    override fun startGuidance() = Unit
    override fun startNavigationRequest(
      request: TrailheadCarNavigationRequest,
      onResult: (TrailheadCarNavigationStartResult) -> Unit,
    ) {
      onResult(TrailheadCarNavigationStartResult.Started)
    }
    override fun cancelNavigationRequest() {
      cancelNavigationRequestCalls += 1
    }
    override fun searchDestinations(
      query: String,
      onResult: (TrailheadCarDestinationSearchResponse) -> Unit,
    ) {
      searchHandler?.invoke(query, onResult)
        ?: onResult(TrailheadCarDestinationSearchResponse.Ready(emptyList()))
    }
    override fun requestGuidancePermissions(onResult: (Boolean) -> Unit) = onResult(true)
    override fun requestCopilotPermission(onResult: (Boolean) -> Unit) = onResult(true)
    override fun endGuidanceAndReturnHome() = Unit
    override fun continueAfterArrival(stopIndex: Int) = Unit
    override fun toggleMuted() = Unit
    override fun startCopilot() = Unit
    override fun stopCopilot() = Unit
    override fun beginReportLocation() = Unit
    override fun endReportLocation() = Unit
    override fun report(categoryId: String): CarReportEnqueueStatus = CarReportEnqueueStatus.QUEUED
    override fun latestLocation(): Location? = null
  }

  private inner class HeadUnitStartController : TrailheadCarSessionController {
    override var snapshot = TrailheadCarSnapshot(
      state = TrailheadCarSnapshotState.NO_TRIP,
      tripName = "No trip selected",
      tripSummary = "",
      rigSummary = "",
      stops = emptyList(),
    )
    override var progress: TrailheadCarProgress? = null
    override var navigating = false
    override val muted = false
    override val copilotState = TrailheadCarCopilotState()
    override val mapSurface: TrailheadCarMapSurface = this@TrailheadCarTemplateTest.mapSurface
    override val guidancePermissionsGranted = true
    override val copilotPermissionGranted = true
    var navigationStartedCalls = 0

    override fun searchDestinations(
      query: String,
      onResult: (TrailheadCarDestinationSearchResponse) -> Unit,
    ) {
      onResult(
        TrailheadCarDestinationSearchResponse.Ready(
          listOf(TrailheadCarDestinationChoice("Moab", "Utah", 38.5733, -109.5498)),
        ),
      )
    }

    override fun startNavigationRequest(
      request: TrailheadCarNavigationRequest,
      onResult: (TrailheadCarNavigationStartResult) -> Unit,
    ) {
      snapshot = readySnapshot().copy(tripName = request.label)
      progress = TrailheadCarNavigationState(snapshot).update(
        TrailheadCarPoint(38.575, -109.525),
      )
      navigating = true
      navigationStartedCalls += 1
      carContext.getCarService(ScreenManager::class.java)
        .push(TrailheadCarGuidanceScreen(carContext, this))
      onResult(TrailheadCarNavigationStartResult.Started)
    }

    override fun startGuidance() = Unit
    override fun requestGuidancePermissions(onResult: (Boolean) -> Unit) = onResult(true)
    override fun requestCopilotPermission(onResult: (Boolean) -> Unit) = onResult(true)
    override fun endGuidanceAndReturnHome() = Unit
    override fun continueAfterArrival(stopIndex: Int) = Unit
    override fun toggleMuted() = Unit
    override fun startCopilot() = Unit
    override fun stopCopilot() = Unit
    override fun beginReportLocation() = Unit
    override fun endReportLocation() = Unit
    override fun report(categoryId: String): CarReportEnqueueStatus = CarReportEnqueueStatus.QUEUED
    override fun latestLocation(): Location? = null
  }

  private val doneCallback = object : OnDoneCallback {
    override fun onSuccess(response: Bundleable?) = Unit
    override fun onFailure(response: Bundleable) = Unit
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
        copilotEnabled = true,
        reportsEnabled = true,
      ),
    )
  }
}
