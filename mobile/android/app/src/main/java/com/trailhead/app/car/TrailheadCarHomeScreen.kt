package com.trailhead.app.car

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.os.Build
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.CarLocation
import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.MapController
import androidx.car.app.navigation.model.MapWithContentTemplate
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.PlaceListNavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.TravelEstimate
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.trailhead.app.R
import expo.modules.trailheadcarreports.CarReportEnqueueStatus
import java.util.TimeZone
import kotlin.math.roundToInt

internal val TRAILHEAD_ACCENT = CarColor.createCustom(
  Color.rgb(180, 83, 42),
  Color.rgb(225, 132, 82),
)

internal interface TrailheadCarSessionController {
  val snapshot: TrailheadCarSnapshot
  val progress: TrailheadCarProgress?
  val navigating: Boolean
  val muted: Boolean
  val mapSurface: TrailheadCarMapSurface

  fun startGuidance()
  fun endGuidance()
  fun continueAfterArrival(stopIndex: Int)
  fun toggleMuted()
  fun beginReportLocation()
  fun endReportLocation()
  fun report(categoryId: String): CarReportEnqueueStatus
  fun latestLocation(): Location?
}

internal class TrailheadCarHomeScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = controller.snapshot
    controller.mapSurface.setSnapshot(snapshot)
    if (snapshot.state != TrailheadCarSnapshotState.READY) return unavailableTemplate(snapshot.state)
    if (snapshot.route == null) return stopsOnlyTemplate(snapshot)
    requiredNavigationPermissions().takeIf(List<String>::isNotEmpty)?.let { missing ->
      return permissionTemplate(missing)
    }
    return if (carContext.carAppApiLevel >= 7) modernPreview(snapshot) else legacyPreview(snapshot)
  }

  private fun modernPreview(snapshot: TrailheadCarSnapshot): Template {
    val route = requireNotNull(snapshot.route)
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(route.title)
          .addText(snapshot.tripSummary.ifEmpty { route.summary.ifEmpty { "Route ready" } })
          .build(),
      )
      .addRow(
        Row.Builder()
          .setTitle(if (route.isTrailFollow) "Trail Follow" else "Trip route")
          .addText(stopCountText(snapshot))
          .build(),
      )
      .addRow(
        Row.Builder()
          .setTitle(offlineTitle(snapshot.offline))
          .addText(offlineDetail(snapshot.offline))
          .build(),
      )
      .addAction(
        Action.Builder()
          .setTitle(if (route.isTrailFollow) "Follow trail" else "Start route")
          .setBackgroundColor(TRAILHEAD_ACCENT)
          .setOnClickListener(controller::startGuidance)
          .build(),
      )
    if (snapshot.account.reportsEnabled) {
      pane.addAction(
        Action.Builder()
          .setTitle("Report")
          .setOnClickListener { screenManager.push(TrailheadCarReportScreen(carContext, controller)) }
          .build(),
      )
    }
    val content = PaneTemplate.Builder(pane.build())
      .setTitle("Trailhead")
      .setHeaderAction(Action.APP_ICON)
      .build()
    return MapWithContentTemplate.Builder()
      .setContentTemplate(content)
      .setMapController(mapController(carContext, controller.mapSurface))
      .build()
  }

  private fun legacyPreview(snapshot: TrailheadCarSnapshot): Template {
    val list = ItemList.Builder()
    visibleStops(snapshot).forEachIndexed { index, stop ->
      list.addItem(stopRow(stop, index, snapshot.stops.size))
    }
    if (snapshot.stops.isEmpty()) {
      val route = requireNotNull(snapshot.route)
      val destination = route.points.last()
      val place = Place.Builder(CarLocation.create(destination.lat, destination.lng)).build()
      list.addItem(
        Row.Builder()
          .setTitle(if (route.isTrailFollow) "Follow trail" else "Start route")
          .addText(snapshot.tripSummary)
          .setBrowsable(true)
          .setMetadata(Metadata.Builder().setPlace(place).build())
          .setOnClickListener(controller::startGuidance)
          .build(),
      )
    }
    val builder = PlaceListNavigationTemplate.Builder()
      .setTitle(snapshot.tripName)
      .setHeaderAction(Action.APP_ICON)
      .setItemList(list.build())
    if (carContext.carAppApiLevel >= 4) {
      builder.setMapActionStrip(mapActionStrip(carContext, controller.mapSurface))
    }
    return builder.build()
  }

  private fun stopsOnlyTemplate(snapshot: TrailheadCarSnapshot): Template {
    if (snapshot.stops.isEmpty()) {
      return androidx.car.app.model.MessageTemplate.Builder("Open a saved trip on your phone before driving.")
        .setTitle("No route selected")
        .setHeaderAction(Action.APP_ICON)
        .build()
    }
    val list = ItemList.Builder()
    visibleStops(snapshot).forEachIndexed { index, stop ->
      list.addItem(stopRow(stop, index, snapshot.stops.size))
    }
    return ListTemplate.Builder()
      .setTitle(snapshot.tripName)
      .setHeaderAction(Action.APP_ICON)
      .setSingleList(list.build())
      .build()
  }

  private fun visibleStops(snapshot: TrailheadCarSnapshot): List<TrailheadCarStop> {
    val limit = carContext.getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST)
      .coerceAtLeast(1)
    return snapshot.stops.take(limit)
  }

  private fun stopRow(stop: TrailheadCarStop, index: Int, totalStops: Int): Row {
    val place = Place.Builder(CarLocation.create(stop.lat, stop.lng))
      .setMarker(
        PlaceMarker.Builder()
          .setLabel((index + 1).toString())
          .setColor(markerColor(stop))
          .build(),
      )
      .build()
    return Row.Builder()
      .setTitle(stop.name)
      .addText(if (stop.day > 0) "Day ${stop.day} · ${stop.kindLabel}" else stop.kindLabel)
      .setBrowsable(true)
      .setMetadata(Metadata.Builder().setPlace(place).build())
      .setOnClickListener {
        screenManager.push(
          TrailheadCarStopScreen(carContext, controller, stop, index + 1, totalStops),
        )
      }
      .build()
  }

  private fun markerColor(stop: TrailheadCarStop): CarColor = when (stop.kindLabel) {
    "Camp" -> CarColor.GREEN
    "Fuel" -> CarColor.YELLOW
    else -> TRAILHEAD_ACCENT
  }

  private fun requiredNavigationPermissions(): List<String> {
    val missing = mutableListOf<String>()
    val hasLocation = carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!hasLocation) {
      missing += Manifest.permission.ACCESS_FINE_LOCATION
      missing += Manifest.permission.ACCESS_COARSE_LOCATION
    }
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      carContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      missing += Manifest.permission.POST_NOTIFICATIONS
    }
    return missing
  }

  private fun permissionTemplate(missing: List<String>): Template {
    val notificationMissing = missing.contains(Manifest.permission.POST_NOTIFICATIONS)
    val message = if (notificationMissing && missing.size == 1) {
      "Allow navigation notifications on your phone when parked."
    } else if (notificationMissing) {
      "Allow location and navigation notifications on your phone when parked."
    } else {
      "Allow location on your phone when parked to show your position and begin guidance."
    }
    return androidx.car.app.model.MessageTemplate.Builder(
      message,
    )
      .setTitle(if (notificationMissing) "Permission needed" else "Location needed")
      .setHeaderAction(Action.APP_ICON)
      .addAction(
        Action.Builder()
          .setTitle("Open permissions")
          .setOnClickListener {
            carContext.requestPermissions(missing) { _, _ -> invalidate() }
          }
          .build(),
      )
      .build()
  }

  private fun unavailableTemplate(state: TrailheadCarSnapshotState): Template {
    val title = if (state == TrailheadCarSnapshotState.UNAVAILABLE) "Trip unavailable" else "No trip selected"
    val message = if (state == TrailheadCarSnapshotState.UNAVAILABLE) {
      "Open this trip again on your phone when parked."
    } else {
      "Choose a saved trip on your phone when parked."
    }
    return androidx.car.app.model.MessageTemplate.Builder(message)
      .setTitle(title)
      .setHeaderAction(Action.APP_ICON)
      .build()
  }
}

internal class TrailheadCarNavigationRequestScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
  private val request: TrailheadCarNavigationRequest,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val matchesSavedRoute = requestMatchesCurrentRoute(request, controller.snapshot)
    val detail = when {
      request.mode == TrailheadCarNavigationMode.ADD_A_STOP -> "Finish adding this stop on your phone when parked."
      matchesSavedRoute -> "This destination matches ${controller.snapshot.tripName}."
      request.mode == TrailheadCarNavigationMode.DIRECTIONS -> "Choose a route on your phone when parked."
      else -> "Finish this route on your phone when parked."
    }
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(request.label)
          .addText(detail)
          .build(),
      )
    if (matchesSavedRoute && request.mode != TrailheadCarNavigationMode.ADD_A_STOP) {
      pane.addAction(
        Action.Builder()
          .setTitle(if (controller.snapshot.route?.isTrailFollow == true) "Follow trail" else "Start route")
          .setBackgroundColor(TRAILHEAD_ACCENT)
          .setOnClickListener(controller::startGuidance)
          .build(),
      )
    }
    return PaneTemplate.Builder(pane.build())
      .setTitle(if (request.mode == TrailheadCarNavigationMode.ADD_A_STOP) "Add stop" else "Destination")
      .setHeaderAction(Action.APP_ICON)
      .build()
  }
}

private class TrailheadCarStopScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
  private val stop: TrailheadCarStop,
  private val stopNumber: Int,
  private val totalStops: Int,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(stop.kindLabel)
          .addText("Stop $stopNumber of $totalStops")
          .build(),
      )
    if (stop.description.isNotEmpty()) {
      pane.addRow(Row.Builder().setTitle(stop.description).build())
    }
    if (controller.snapshot.route != null) {
      pane.addAction(
        Action.Builder()
          .setTitle(if (controller.snapshot.route?.isTrailFollow == true) "Follow trail" else "Start route")
          .setBackgroundColor(TRAILHEAD_ACCENT)
          .setOnClickListener(controller::startGuidance)
          .build(),
      )
    }
    return PaneTemplate.Builder(pane.build())
      .setTitle(stop.name)
      .setHeaderAction(Action.BACK)
      .build()
  }
}

internal class TrailheadCarGuidanceScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val builder = NavigationTemplate.Builder()
      .setBackgroundColor(CarColor.SECONDARY)
      .setActionStrip(guidanceActions())
    if (carContext.carAppApiLevel >= 2) {
      builder
        .setMapActionStrip(mapActionStrip(carContext, controller.mapSurface))
        .setPanModeListener { }
    }
    val current = controller.progress
    if (current == null) {
      builder.setNavigationInfo(RoutingInfo.Builder().setLoading(true).build())
      return builder.build()
    }
    if (current.offRoute) {
      builder.setNavigationInfo(
        MessageInfo.Builder(if (controller.snapshot.route?.isTrailFollow == true) "Return to the saved line" else "Off route")
          .setText(if (controller.snapshot.route?.isTrailFollow == true) "Trail Follow keeps the original line." else "Open Trailhead on your phone when parked to rebuild the route.")
          .build(),
      )
    } else {
      val currentStep = current.currentStep ?: arrivalStep(controller.snapshot.route?.title.orEmpty())
      val routing = RoutingInfo.Builder()
        .setCurrentStep(carStep(currentStep), carDistance(current.stepRemainingDistanceM))
      current.nextStep?.let { routing.setNextStep(carStep(it)) }
      builder.setNavigationInfo(routing.build())
    }
    builder.setDestinationTravelEstimate(travelEstimate(current.remainingDistanceM, current.remainingDurationS))
    return builder.build()
  }

  private fun guidanceActions(): ActionStrip {
    val actions = ActionStrip.Builder()
    if (controller.snapshot.account.reportsEnabled) {
      actions.addAction(
        Action.Builder()
          .setTitle("Report")
          .setIcon(carIcon(carContext, R.drawable.ic_car_report))
          .setOnClickListener { screenManager.push(TrailheadCarReportScreen(carContext, controller)) }
          .build(),
      )
    }
    actions.addAction(
      Action.Builder()
        .setTitle(if (controller.muted) "Unmute" else "Mute")
        .setOnClickListener {
          controller.toggleMuted()
          invalidate()
        }
        .build(),
    )
    actions.addAction(
      Action.Builder()
        .setTitle("End")
        .setOnClickListener {
          controller.endGuidance()
          screenManager.popToRoot()
        }
        .build(),
    )
    return actions.build()
  }
}

internal class TrailheadCarArrivalScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
  private val stopIndex: Int,
  private val finalArrival: Boolean,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val stop = controller.snapshot.stops.getOrNull(stopIndex)
    val title = if (finalArrival) "Trip complete" else "Arrived at ${stop?.name ?: "stop"}"
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(if (finalArrival) controller.snapshot.tripName else stop?.kindLabel ?: "Route stop")
          .addText(if (finalArrival) "Route finished" else "Stop ${stopIndex + 1} of ${controller.snapshot.stops.size}")
          .build(),
      )
    if (finalArrival) {
      pane.addAction(
        Action.Builder()
          .setTitle("Done")
          .setBackgroundColor(TRAILHEAD_ACCENT)
          .setOnClickListener {
            controller.endGuidance()
            screenManager.popToRoot()
          }
          .build(),
      )
    } else {
      pane.addAction(
        Action.Builder()
          .setTitle("Continue")
          .setBackgroundColor(TRAILHEAD_ACCENT)
          .setOnClickListener {
            controller.continueAfterArrival(stopIndex)
            finish()
          }
          .build(),
      )
      pane.addAction(
        Action.Builder()
          .setTitle("End")
          .setOnClickListener {
            controller.endGuidance()
            screenManager.popToRoot()
          }
          .build(),
      )
    }
    return PaneTemplate.Builder(pane.build())
      .setTitle(title)
      .setHeaderAction(if (finalArrival) Action.APP_ICON else Action.BACK)
      .build()
  }
}

private class TrailheadCarOfflineScreen(
  carContext: CarContext,
  private val offline: TrailheadCarOfflineReadiness,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
      .addRow(readinessRow("Route line", true))
      .addRow(readinessRow("Navigation", offline.navigationReady))
      .addRow(readinessRow("Places", offline.placesReady))
      .addRow(readinessRow("Trails", offline.trailsReady))
    if (offline.message.isNotEmpty()) pane.addRow(Row.Builder().setTitle(offline.message).build())
    return PaneTemplate.Builder(pane.build())
      .setTitle(offlineTitle(offline))
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun readinessRow(label: String, ready: Boolean?): Row {
    val status = when (ready) {
      true -> "Ready"
      false -> "Download needed"
      null -> "Not checked"
    }
    return Row.Builder().setTitle(label).addText(status).build()
  }
}

internal class TrailheadCarReportScreen(
  carContext: CarContext,
  private val controller: TrailheadCarSessionController,
) : Screen(carContext) {
  init {
    controller.beginReportLocation()
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        controller.endReportLocation()
      }
    })
  }

  override fun onGetTemplate(): Template {
    if (!controller.snapshot.account.reportsEnabled) {
      return androidx.car.app.model.MessageTemplate.Builder(reportUnavailableMessage())
        .setTitle("Reports unavailable")
        .setHeaderAction(Action.BACK)
        .build()
    }
    val items = ItemList.Builder()
    reportCategories.forEach { category ->
      items.addItem(
        GridItem.Builder()
          .setTitle(category.label)
          .setImage(carIcon(carContext, category.icon), GridItem.IMAGE_TYPE_ICON)
          .setOnClickListener { saveReport(category) }
          .build(),
      )
    }
    return GridTemplate.Builder()
      .setTitle("Report")
      .setHeaderAction(Action.BACK)
      .setSingleList(items.build())
      .build()
  }

  private fun saveReport(category: CarReportCategoryUi) {
    if (controller.latestLocation() == null) {
      CarToast.makeText(carContext, "Waiting for location", CarToast.LENGTH_SHORT).show()
      return
    }
    val status = controller.report(category.id)
    val message = when (status) {
      CarReportEnqueueStatus.QUEUED -> "${category.label} saved"
      CarReportEnqueueStatus.ALREADY_SAVED -> "Already saved"
      CarReportEnqueueStatus.SIGN_IN_REQUIRED -> "Sign in on your phone to report"
    }
    CarToast.makeText(carContext, message, CarToast.LENGTH_SHORT).show()
    if (status != CarReportEnqueueStatus.SIGN_IN_REQUIRED) finish()
  }

  private fun reportUnavailableMessage(): String {
    return if (controller.snapshot.account.signedIn) {
      "Reporting is temporarily unavailable for this account."
    } else {
      "Sign in on your phone to send road reports."
    }
  }
}

private data class CarReportCategoryUi(val id: String, val label: String, val icon: Int)

private val reportCategories = listOf(
  CarReportCategoryUi("hazard", "Hazard", R.drawable.ic_car_hazard),
  CarReportCategoryUi("road_closed", "Road closed", R.drawable.ic_car_road_closed),
  CarReportCategoryUi("gate_closed", "Gate closed", R.drawable.ic_car_gate),
  CarReportCategoryUi("camp_full", "Camp full", R.drawable.ic_car_camp),
  CarReportCategoryUi("no_fuel", "No fuel", R.drawable.ic_car_fuel),
  CarReportCategoryUi("police", "Police", R.drawable.ic_car_police),
)

private fun mapController(carContext: CarContext, surface: TrailheadCarMapSurface): MapController {
  return MapController.Builder()
    .setMapActionStrip(mapActionStrip(carContext, surface))
    .build()
}

private fun mapActionStrip(carContext: CarContext, surface: TrailheadCarMapSurface): ActionStrip {
  return ActionStrip.Builder()
    .addAction(Action.PAN)
    .addAction(
      Action.Builder()
        .setIcon(carIcon(carContext, R.drawable.ic_car_recenter))
        .setOnClickListener(surface::recenter)
        .build(),
    )
    .addAction(
      Action.Builder()
        .setIcon(carIcon(carContext, R.drawable.ic_car_zoom_out))
        .setOnClickListener { surface.zoomBy(0.72) }
        .build(),
    )
    .addAction(
      Action.Builder()
        .setIcon(carIcon(carContext, R.drawable.ic_car_zoom_in))
        .setOnClickListener { surface.zoomBy(1.38) }
        .build(),
    )
    .build()
}

private fun carIcon(carContext: CarContext, resourceId: Int): CarIcon {
  return CarIcon.Builder(IconCompat.createWithResource(carContext, resourceId)).build()
}

private fun carDistance(meters: Double): Distance {
  return when {
    meters >= 1_609.344 -> Distance.create(meters / 1_609.344, Distance.UNIT_MILES_P1)
    meters >= 160.0 -> Distance.create(meters / 0.3048, Distance.UNIT_FEET)
    else -> Distance.create(meters.coerceAtLeast(0.0), Distance.UNIT_METERS)
  }
}

private fun travelEstimate(distanceM: Double, durationS: Double): TravelEstimate {
  val seconds = durationS.coerceAtLeast(0.0).roundToInt().toLong()
  val arrival = DateTimeWithZone.create(System.currentTimeMillis() + seconds * 1000L, TimeZone.getDefault())
  return TravelEstimate.Builder(carDistance(distanceM), arrival)
    .setRemainingTimeSeconds(seconds)
    .build()
}

internal fun carStep(step: TrailheadCarStep): Step {
  val cue = step.instruction.ifEmpty { step.verbalPre.ifEmpty { step.name.ifEmpty { "Continue" } } }
  val builder = Step.Builder(cue)
    .setRoad(step.name)
  val maneuverType = maneuverType(step)
  val maneuver = Maneuver.Builder(maneuverType)
  if (step.roundaboutExit != null && maneuverType in setOf(
      Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CW,
      Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW,
    )
  ) {
    maneuver.setRoundaboutExitNumber(step.roundaboutExit)
  }
  return builder.setManeuver(maneuver.build()).build()
}

private fun maneuverType(step: TrailheadCarStep): Int {
  val type = step.type.lowercase()
  val modifier = step.modifier.lowercase()
  if (type.contains("arrive") || type.contains("destination")) return Maneuver.TYPE_DESTINATION
  if (type.contains("depart")) return Maneuver.TYPE_DEPART
  if (type.contains("roundabout")) return Maneuver.TYPE_ROUNDABOUT_ENTER_AND_EXIT_CCW
  if (type.contains("merge")) return if (modifier.contains("left")) Maneuver.TYPE_MERGE_LEFT else Maneuver.TYPE_MERGE_RIGHT
  if (type.contains("fork")) return if (modifier.contains("left")) Maneuver.TYPE_FORK_LEFT else Maneuver.TYPE_FORK_RIGHT
  if (modifier.contains("uturn") || modifier.contains("u-turn")) {
    return if (modifier.contains("right")) Maneuver.TYPE_U_TURN_RIGHT else Maneuver.TYPE_U_TURN_LEFT
  }
  if (modifier.contains("sharp left")) return Maneuver.TYPE_TURN_SHARP_LEFT
  if (modifier.contains("sharp right")) return Maneuver.TYPE_TURN_SHARP_RIGHT
  if (modifier.contains("slight left")) return Maneuver.TYPE_TURN_SLIGHT_LEFT
  if (modifier.contains("slight right")) return Maneuver.TYPE_TURN_SLIGHT_RIGHT
  if (modifier.contains("left")) return Maneuver.TYPE_TURN_NORMAL_LEFT
  if (modifier.contains("right")) return Maneuver.TYPE_TURN_NORMAL_RIGHT
  return Maneuver.TYPE_STRAIGHT
}

internal fun arrivalStep(title: String): TrailheadCarStep {
  return TrailheadCarStep(
    type = "destination",
    modifier = "straight",
    name = title,
    instruction = "Continue to destination",
    verbalPre = "",
    verbalPost = "",
    distanceM = 0.0,
    durationS = 0.0,
    lat = null,
    lng = null,
    roundaboutExit = null,
  )
}

internal fun destination(snapshot: TrailheadCarSnapshot): Destination {
  val last = snapshot.stops.lastOrNull()
  return Destination.Builder()
    .setName(last?.name ?: snapshot.tripName)
    .setAddress(last?.kindLabel ?: if (snapshot.route?.isTrailFollow == true) "Trail Follow" else "Trip destination")
    .build()
}

private fun stopCountText(snapshot: TrailheadCarSnapshot): String {
  val count = snapshot.stops.size
  return when (count) {
    0 -> snapshot.tripSummary.ifEmpty { "Saved line" }
    1 -> "1 stop"
    else -> "$count stops"
  }
}

private fun offlineTitle(offline: TrailheadCarOfflineReadiness): String = when {
  offline.navigationReady == true -> "Route ready offline"
  offline.status == "needs_download" -> "Route download needed"
  else -> "Route download status"
}

private fun offlineDetail(offline: TrailheadCarOfflineReadiness): String {
  return when {
    offline.navigationReady == true -> "Route line and guidance are on this phone"
    offline.status == "needs_download" -> "Finish route downloads on your phone when parked"
    else -> "Check route downloads on your phone when parked"
  }
}
