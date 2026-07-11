package com.trailhead.app.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

data class TrailheadCarSnapshot(
  val tripName: String,
  val tripSummary: String,
  val rigSummary: String,
  val stopSummary: String,
)

object TrailheadCarRepository {
  fun load(context: Context): TrailheadCarSnapshot {
    val trip = readJson(context, "active_trip.json")
    val rig = readJson(context, "rig_profile.json")

    val plan = trip?.optJSONObject("plan")
    val tripName = clean(plan?.optString("trip_name")).ifEmpty { "No active trip" }
    val days = plan?.optInt("duration_days", 0) ?: 0
    val miles = plan?.optDouble("total_est_miles", 0.0) ?: 0.0
    val waypoints = plan?.optJSONArray("waypoints") ?: JSONArray()
    val tripSummary = when {
      trip == null -> "Build or open a trip on your phone."
      days > 0 && miles > 0.0 -> "${days}d · ${miles.roundToInt()} mi"
      days > 0 -> "${days}d"
      miles > 0.0 -> "${miles.roundToInt()} mi"
      else -> "Trip loaded"
    }

    return TrailheadCarSnapshot(
      tripName = tripName,
      tripSummary = tripSummary,
      rigSummary = rigSummary(rig),
      stopSummary = stopSummary(waypoints),
    )
  }

  private fun readJson(context: Context, fileName: String): JSONObject? {
    return try {
      val file = File(context.filesDir, fileName)
      if (!file.exists()) return null
      JSONObject(file.readText())
    } catch (_: Exception) {
      null
    }
  }

  private fun rigSummary(rig: JSONObject?): String {
    if (rig == null) return "No rig saved"
    val title = listOf(
      clean(rig.optString("year")),
      clean(rig.optString("make")),
      clean(rig.optString("model")),
    ).filter { it.isNotEmpty() }.joinToString(" ")
    val clearance = rig.optDouble("ground_clearance_in", 0.0)
    val range = rig.optDouble("fuel_range_miles", 0.0)
    val details = listOf(
      if (clearance > 0.0) "${clearance.roundToInt()} in clearance" else "",
      if (range > 0.0) "${range.roundToInt()} mi range" else "",
    ).filter { it.isNotEmpty() }.joinToString(" · ")
    return listOf(title.ifEmpty { "Saved rig" }, details).filter { it.isNotEmpty() }.joinToString(" · ")
  }

  private fun stopSummary(waypoints: JSONArray): String {
    if (waypoints.length() <= 0) return "No route stops saved"
    val names = mutableListOf<String>()
    for (i in 0 until minOf(waypoints.length(), 3)) {
      val name = clean(waypoints.optJSONObject(i)?.optString("name"))
      if (name.isNotEmpty()) names.add(name)
    }
    return if (names.isEmpty()) {
      "${waypoints.length()} stops"
    } else {
      "${waypoints.length()} stops · ${names.joinToString(" · ")}"
    }
  }

  private fun clean(value: String?): String {
    return value.orEmpty().replace(Regex("\\s+"), " ").trim()
  }
}
