package com.trailhead.app.car

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Header
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

class TrailheadCarHomeScreen(carContext: CarContext) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val snapshot = TrailheadCarRepository.load(carContext)
    val pane = Pane.Builder()
      .addRow(summaryRow(snapshot))
      .addRow(rigRow(snapshot))
      .addRow(stopsRow(snapshot))
      .build()

    val header = Header.Builder()
      .setTitle("Trailhead")
      .setStartHeaderAction(Action.APP_ICON)
      .build()

    return PaneTemplate.Builder(pane)
      .setHeader(header)
      .build()
  }

  private fun summaryRow(snapshot: TrailheadCarSnapshot): Row {
    return Row.Builder()
      .setTitle(snapshot.tripName)
      .addText(snapshot.tripSummary)
      .build()
  }

  private fun rigRow(snapshot: TrailheadCarSnapshot): Row {
    return Row.Builder()
      .setTitle("Rig")
      .addText(snapshot.rigSummary)
      .build()
  }

  private fun stopsRow(snapshot: TrailheadCarSnapshot): Row {
    return Row.Builder()
      .setTitle("Stops")
      .addText(snapshot.stopSummary)
      .build()
  }
}
