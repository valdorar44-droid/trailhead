package com.trailhead.app.car

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarLocation
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template

private val TRAILHEAD_ACCENT = CarColor.createCustom(
  Color.rgb(173, 90, 51),
  Color.rgb(217, 119, 69),
)

class TrailheadCarHomeScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = TrailheadCarRepository.load(carContext)
    if (snapshot.state != TrailheadCarSnapshotState.READY) {
      return unavailableTemplate(snapshot.state)
    }
    if (snapshot.stops.isEmpty()) {
      return MessageTemplate.Builder("Add a stop in Trailhead on your phone when parked.")
        .setTitle("No route stops")
        .setHeaderAction(Action.APP_ICON)
        .build()
    }

    val contentLimit = carContext
      .getCarService(ConstraintManager::class.java)
      .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST)
      .coerceAtLeast(1)
    val visibleStops = snapshot.stops.take(contentLimit)
    val list = ItemList.Builder()
    visibleStops.forEachIndexed { index, stop ->
      list.addItem(stopRow(stop, index, snapshot.stops.size))
    }

    val template = PlaceListMapTemplate.Builder()
      .setTitle(snapshot.tripName)
      .setHeaderAction(Action.APP_ICON)
      .setCurrentLocationEnabled(hasLocationPermission())
      .setItemList(list.build())

    if (carContext.carAppApiLevel >= 5) {
      template.setOnContentRefreshListener { invalidate() }
    }
    return template.build()
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
    val row = Row.Builder()
      .setTitle(stop.name)
      .addText(stopMeta(stop))
      .setBrowsable(true)
      .setMetadata(Metadata.Builder().setPlace(place).build())
      .setOnClickListener {
        screenManager.push(
          TrailheadCarStopScreen(carContext, stop, index + 1, totalStops),
        )
      }
    if (stop.description.isNotEmpty()) row.addText(stop.description)
    return row.build()
  }

  private fun stopMeta(stop: TrailheadCarStop): String {
    return if (stop.day > 0) "Day ${stop.day} · ${stop.kindLabel}" else stop.kindLabel
  }

  private fun markerColor(stop: TrailheadCarStop): CarColor {
    return when (stop.kindLabel) {
      "Camp" -> CarColor.GREEN
      "Fuel" -> CarColor.YELLOW
      else -> TRAILHEAD_ACCENT
    }
  }

  private fun hasLocationPermission(): Boolean {
    return carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
  }

  private fun unavailableTemplate(state: TrailheadCarSnapshotState): Template {
    val title = if (state == TrailheadCarSnapshotState.UNAVAILABLE) "Trip unavailable" else "No trip selected"
    val message = if (state == TrailheadCarSnapshotState.UNAVAILABLE) {
      "Open this trip again on your phone when parked."
    } else {
      "Choose a saved trip on your phone when parked."
    }
    return MessageTemplate.Builder(message)
      .setTitle(title)
      .setHeaderAction(Action.APP_ICON)
      .build()
  }
}

private class TrailheadCarStopScreen(
  carContext: CarContext,
  private val stop: TrailheadCarStop,
  private val stopNumber: Int,
  private val totalStops: Int,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(stop.kindLabel)
          .addText(tripPosition())
          .build(),
      )

    if (stop.description.isNotEmpty()) {
      pane.addRow(
        Row.Builder()
          .setTitle("About")
          .addText(stop.description)
          .build(),
      )
    }

    pane.addAction(
      Action.Builder()
        .setTitle("Navigate")
        .setBackgroundColor(TRAILHEAD_ACCENT)
        .setOnClickListener { openNavigation() }
        .build(),
    )

    return PaneTemplate.Builder(pane.build())
      .setTitle(stop.name)
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun tripPosition(): String {
    val day = if (stop.day > 0) "Day ${stop.day} · " else ""
    return "${day}Stop $stopNumber of $totalStops"
  }

  private fun openNavigation() {
    val coordinates = "${stop.lat},${stop.lng}"
    val query = Uri.encode("$coordinates(${stop.name})")
    val intent = Intent(CarContext.ACTION_NAVIGATE, Uri.parse("geo:$coordinates?q=$query"))
    try {
      carContext.startCarApp(intent)
    } catch (_: RuntimeException) {
      screenManager.push(
        TrailheadCarMessageScreen(
          carContext,
          title = "Navigation unavailable",
          message = "Choose another stop or try again when connected.",
        ),
      )
    }
  }
}

private class TrailheadCarMessageScreen(
  carContext: CarContext,
  private val title: String,
  private val message: String,
) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    return MessageTemplate.Builder(message)
      .setTitle(title)
      .setHeaderAction(Action.BACK)
      .build()
  }
}
