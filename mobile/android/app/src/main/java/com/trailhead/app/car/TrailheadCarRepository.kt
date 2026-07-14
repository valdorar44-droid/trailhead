package com.trailhead.app.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

enum class TrailheadCarSnapshotState {
  READY,
  NO_TRIP,
  UNAVAILABLE,
}

data class TrailheadCarStop(
  val name: String,
  val description: String,
  val kindLabel: String,
  val kind: String,
  val day: Int,
  val lat: Double,
  val lng: Double,
)

data class TrailheadCarSnapshot(
  val state: TrailheadCarSnapshotState,
  val tripName: String,
  val tripSummary: String,
  val rigSummary: String,
  val stops: List<TrailheadCarStop>,
)

object TrailheadCarRepository {
  fun load(context: Context): TrailheadCarSnapshot {
    val tripRead = readJson(context, "active_trip.json")
    val rigRead = readJson(context, "rig_profile.json")
    val state = when {
      !tripRead.exists -> TrailheadCarSnapshotState.NO_TRIP
      tripRead.value == null -> TrailheadCarSnapshotState.UNAVAILABLE
      else -> TrailheadCarSnapshotState.READY
    }
    return fromJson(tripRead.value, rigRead.value, state)
  }

  internal fun fromJson(
    trip: JSONObject?,
    rig: JSONObject?,
    requestedState: TrailheadCarSnapshotState,
  ): TrailheadCarSnapshot {
    val plan = trip?.optJSONObject("plan")
    val state = if (requestedState == TrailheadCarSnapshotState.READY && plan == null) {
      TrailheadCarSnapshotState.UNAVAILABLE
    } else {
      requestedState
    }
    val tripName = clean(plan?.optString("trip_name")).ifEmpty {
      when (state) {
        TrailheadCarSnapshotState.NO_TRIP -> "No trip selected"
        TrailheadCarSnapshotState.UNAVAILABLE -> "Trip unavailable"
        TrailheadCarSnapshotState.READY -> "Saved trip"
      }
    }
    val days = plan?.optInt("duration_days", 0) ?: 0
    val miles = plan?.optDouble("total_est_miles", 0.0) ?: 0.0
    val tripSummary = when {
      state != TrailheadCarSnapshotState.READY -> ""
      days > 0 && miles > 0.0 -> "${days}d · ${miles.roundToInt()} mi"
      days > 0 -> "${days}d"
      miles > 0.0 -> "${miles.roundToInt()} mi"
      else -> "Ready on this phone"
    }

    return TrailheadCarSnapshot(
      state = state,
      tripName = tripName,
      tripSummary = tripSummary,
      rigSummary = rigSummary(rig),
      stops = parseStops(plan?.optJSONArray("waypoints") ?: JSONArray()),
    )
  }

  private data class JsonRead(val value: JSONObject?, val exists: Boolean)

  private fun readJson(context: Context, fileName: String): JsonRead {
    val file = File(context.filesDir, fileName)
    if (!file.exists()) return JsonRead(value = null, exists = false)
    return try {
      JsonRead(value = JSONObject(file.readText()), exists = true)
    } catch (_: Exception) {
      JsonRead(value = null, exists = true)
    }
  }

  private fun parseStops(waypoints: JSONArray): List<TrailheadCarStop> {
    val stops = mutableListOf<TrailheadCarStop>()
    for (index in 0 until waypoints.length()) {
      val waypoint = waypoints.optJSONObject(index) ?: continue
      val lat = waypoint.optDouble("lat", Double.NaN)
      val lng = waypoint.optDouble("lng", Double.NaN)
      if (!validCoordinates(lat, lng)) continue

      val rawType = clean(waypoint.optString("type")).lowercase()
      val rawLandType = clean(waypoint.optString("land_type"))
      val kindLabel = kindLabel(rawType, rawLandType)
      val description = listOf(
        clean(waypoint.optString("notes")),
        clean(waypoint.optString("description")),
        rawLandType.takeUnless { it.equals(kindLabel, ignoreCase = true) }.orEmpty(),
      ).firstOrNull { it.isNotEmpty() }.orEmpty()

      stops.add(
        TrailheadCarStop(
          name = clean(waypoint.optString("name")).ifEmpty { "Route stop ${index + 1}" },
          description = shorten(description, 140),
          kindLabel = kindLabel,
          kind = rawType,
          day = waypoint.optInt("day", 0).coerceAtLeast(0),
          lat = lat,
          lng = lng,
        ),
      )
    }
    return stops
  }

  private fun validCoordinates(lat: Double, lng: Double): Boolean {
    return lat.isFinite() && lng.isFinite() && lat in -90.0..90.0 && lng in -180.0..180.0
  }

  private fun kindLabel(type: String, landType: String): String {
    val value = "$type ${landType.lowercase()}"
    return when {
      value.contains("camp") || value.contains("overnight") -> "Camp"
      value.contains("fuel") || value.contains("gas") -> "Fuel"
      value.contains("water") -> "Water"
      value.contains("start") || value.contains("origin") -> "Start"
      value.contains("destination") || value.contains("finish") || value.contains("end") -> "Destination"
      value.contains("trail") -> "Trail"
      value.contains("tour") || value.contains("activity") || value.contains("attraction") -> "Activity"
      else -> landType.ifEmpty { "Route stop" }
    }
  }

  private fun rigSummary(rig: JSONObject?): String {
    if (rig == null) return ""
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
    return listOf(title, details).filter { it.isNotEmpty() }.joinToString(" · ")
  }

  private fun shorten(value: String, limit: Int): String {
    if (value.length <= limit) return value
    return value.take(limit - 1).trimEnd() + "…"
  }

  private fun clean(value: String?): String {
    return value.orEmpty().replace(Regex("\\s+"), " ").trim()
  }
}
