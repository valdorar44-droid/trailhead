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

enum class TrailheadCarRouteMode {
  ROAD_PREVIEW,
  TRAIL_FOLLOW_PREVIEW,
  TRAIL_FOLLOW_ACTIVE,
}

data class TrailheadCarPoint(
  val lat: Double,
  val lng: Double,
)

data class TrailheadCarStep(
  val type: String,
  val modifier: String,
  val name: String,
  val instruction: String,
  val verbalPre: String,
  val verbalPost: String,
  val distanceM: Double,
  val durationS: Double,
  val lat: Double?,
  val lng: Double?,
  val roundaboutExit: Int?,
)

data class TrailheadCarRoute(
  val mode: TrailheadCarRouteMode,
  val routeId: String,
  val title: String,
  val summary: String,
  val source: String,
  val points: List<TrailheadCarPoint>,
  val steps: List<TrailheadCarStep>,
  val totalDistanceM: Double,
  val totalDurationS: Double,
) {
  val isTrailFollow: Boolean
    get() = mode != TrailheadCarRouteMode.ROAD_PREVIEW
}

data class TrailheadCarOfflineReadiness(
  val status: String = "unknown",
  val mapReady: Boolean? = null,
  val navigationReady: Boolean? = null,
  val placesReady: Boolean? = null,
  val topoReady: Boolean? = null,
  val trailsReady: Boolean? = null,
  val tripDownloadReady: Boolean? = null,
  val message: String = "",
) {
  val ready: Boolean
    get() = status == "ready" && navigationReady == true && mapReady == true
}

data class TrailheadCarAccount(
  val accountId: String? = null,
  val signedIn: Boolean = false,
  val reportsEnabled: Boolean = false,
  val reportsDisabledReason: String = "",
)

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
  val route: TrailheadCarRoute? = null,
  val offline: TrailheadCarOfflineReadiness = TrailheadCarOfflineReadiness(),
  val account: TrailheadCarAccount = TrailheadCarAccount(),
  val mapboxAccessToken: String = "",
  val updatedAt: Long = 0L,
)

object TrailheadCarRepository {
  internal const val CAR_SNAPSHOT_FILE = "car_navigation_snapshot.json"

  fun load(context: Context): TrailheadCarSnapshot {
    val carRead = readJson(context, CAR_SNAPSHOT_FILE)
    if (carRead.value != null) {
      fromCarJson(carRead.value)?.let { return it }
    }

    val tripRead = readJson(context, "active_trip.json")
    val rigRead = readJson(context, "rig_profile.json")
    val state = when {
      !tripRead.exists && !carRead.exists -> TrailheadCarSnapshotState.NO_TRIP
      tripRead.value == null -> TrailheadCarSnapshotState.UNAVAILABLE
      else -> TrailheadCarSnapshotState.READY
    }
    return fromJson(tripRead.value, rigRead.value, state)
  }

  internal fun fromCarJson(root: JSONObject): TrailheadCarSnapshot? {
    if (root.optInt("schemaVersion", 0) != 1) return null
    val navigation = root.optJSONObject("navigation")
    val route = navigation?.let(::parseRoute)
    val stops = parseCarStops(root.optJSONArray("stops") ?: JSONArray())
    val account = parseAccount(root.optJSONObject("account"))
    val offline = parseOffline(root.optJSONObject("offlineReadiness"))
    val title = route?.title.orEmpty().ifEmpty { "Saved trip" }
    val summary = route?.let { routeSummary(it) }.orEmpty()
    return TrailheadCarSnapshot(
      state = if (route != null || stops.isNotEmpty()) {
        TrailheadCarSnapshotState.READY
      } else {
        TrailheadCarSnapshotState.NO_TRIP
      },
      tripName = title,
      tripSummary = summary,
      rigSummary = "",
      stops = stops,
      route = route,
      offline = offline,
      account = account,
      mapboxAccessToken = clean(root.optString("mapboxAccessToken")),
      updatedAt = root.optLong("updatedAt", 0L).coerceAtLeast(0L),
    )
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
      stops = parseLegacyStops(plan?.optJSONArray("waypoints") ?: JSONArray()),
      route = parseLegacyRoute(trip, tripName),
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

  private fun parseRoute(value: JSONObject): TrailheadCarRoute? {
    val points = parsePoints(value.optJSONArray("coords") ?: JSONArray())
    if (points.size < 2) return null
    val steps = parseSteps(value.optJSONArray("steps") ?: JSONArray())
    val mode = when (clean(value.optString("mode"))) {
      "trail_follow_active" -> TrailheadCarRouteMode.TRAIL_FOLLOW_ACTIVE
      "trail_follow_preview" -> TrailheadCarRouteMode.TRAIL_FOLLOW_PREVIEW
      else -> TrailheadCarRouteMode.ROAD_PREVIEW
    }
    val geometricDistance = TrailheadCarNavigationMath.routeDistance(points)
    return TrailheadCarRoute(
      mode = mode,
      routeId = clean(value.optString("routeId")).ifEmpty { "saved-route" },
      title = clean(value.optString("title")).ifEmpty {
        if (mode == TrailheadCarRouteMode.ROAD_PREVIEW) "Saved trip" else "Trail Follow"
      },
      summary = shorten(clean(value.optString("summary")), 300),
      source = clean(value.optString("source")).ifEmpty { "saved_trip" },
      points = points,
      steps = steps,
      totalDistanceM = positive(value.optDouble("totalDistanceM", 0.0))
        .takeIf { it > 0.0 } ?: geometricDistance,
      totalDurationS = positive(value.optDouble("totalDurationS", 0.0))
        .takeIf { it > 0.0 } ?: steps.sumOf { it.durationS },
    )
  }

  private fun parseLegacyRoute(trip: JSONObject?, title: String): TrailheadCarRoute? {
    val geometry = trip?.optJSONObject("route_geometry") ?: return null
    val wrapped = JSONObject()
      .put("mode", "road_preview")
      .put("routeId", clean(trip.optString("trip_id")))
      .put("title", title)
      .put("summary", trip.optJSONObject("plan")?.optString("overview").orEmpty())
      .put("source", geometry.optString("source"))
      .put("coords", geometry.optJSONArray("coords"))
      .put("steps", geometry.optJSONArray("steps"))
      .put("totalDistanceM", geometry.optDouble("totalDistance", geometry.optDouble("total_distance", 0.0)))
      .put("totalDurationS", geometry.optDouble("totalDuration", geometry.optDouble("total_duration", 0.0)))
    return parseRoute(wrapped)
  }

  private fun parsePoints(values: JSONArray): List<TrailheadCarPoint> {
    val points = mutableListOf<TrailheadCarPoint>()
    for (index in 0 until values.length()) {
      val pair = values.optJSONArray(index) ?: continue
      val lng = pair.optDouble(0, Double.NaN)
      val lat = pair.optDouble(1, Double.NaN)
      if (validCoordinates(lat, lng)) points += TrailheadCarPoint(lat, lng)
    }
    return points
  }

  private fun parseSteps(values: JSONArray): List<TrailheadCarStep> {
    val steps = mutableListOf<TrailheadCarStep>()
    for (index in 0 until values.length()) {
      val source = values.optJSONObject(index) ?: continue
      val lat = source.optionalCoordinate("lat", -90.0, 90.0)
      val lng = source.optionalCoordinate("lng", -180.0, 180.0)
      steps += TrailheadCarStep(
        type = clean(source.optString("type")).ifEmpty { "continue" },
        modifier = clean(source.optString("modifier")).ifEmpty { "straight" },
        name = clean(source.optString("name")),
        instruction = clean(source.optString("instruction")),
        verbalPre = clean(source.optString("verbalPre")),
        verbalPost = clean(source.optString("verbalPost")),
        distanceM = positive(source.optDouble("distanceM", source.optDouble("distance", 0.0))),
        durationS = positive(source.optDouble("durationS", source.optDouble("duration", 0.0))),
        lat = lat,
        lng = lng,
        roundaboutExit = source.optInt("roundaboutExit", 0).takeIf { it > 0 },
      )
    }
    return steps
  }

  private fun parseCarStops(waypoints: JSONArray): List<TrailheadCarStop> {
    val stops = mutableListOf<TrailheadCarStop>()
    for (index in 0 until waypoints.length()) {
      val waypoint = waypoints.optJSONObject(index) ?: continue
      if (clean(waypoint.optString("routePointType")) == "side_stop") continue
      val lat = waypoint.optDouble("lat", Double.NaN)
      val lng = waypoint.optDouble("lng", Double.NaN)
      if (!validCoordinates(lat, lng)) continue
      val rawType = clean(waypoint.optString("type")).lowercase()
      stops += TrailheadCarStop(
        name = clean(waypoint.optString("name")).ifEmpty { "Stop ${index + 1}" },
        description = shorten(clean(waypoint.optString("description")), 140),
        kindLabel = kindLabel(rawType, ""),
        kind = rawType,
        day = waypoint.optInt("day", 0).coerceAtLeast(0),
        lat = lat,
        lng = lng,
      )
    }
    return stops
  }

  private fun parseLegacyStops(waypoints: JSONArray): List<TrailheadCarStop> {
    val stops = mutableListOf<TrailheadCarStop>()
    for (index in 0 until waypoints.length()) {
      val waypoint = waypoints.optJSONObject(index) ?: continue
      if (clean(waypoint.optString("route_point_type")) == "side_stop") continue
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

      stops += TrailheadCarStop(
        name = clean(waypoint.optString("name")).ifEmpty { "Route stop ${index + 1}" },
        description = shorten(description, 140),
        kindLabel = kindLabel,
        kind = rawType,
        day = waypoint.optInt("day", 0).coerceAtLeast(0),
        lat = lat,
        lng = lng,
      )
    }
    return stops
  }

  private fun parseAccount(value: JSONObject?): TrailheadCarAccount {
    if (value == null) return TrailheadCarAccount()
    return TrailheadCarAccount(
      accountId = clean(value.optString("accountId")).ifEmpty { null },
      signedIn = value.optBoolean("signedIn", false),
      reportsEnabled = value.optBoolean("reportsEnabled", false),
      reportsDisabledReason = clean(value.optString("reportsDisabledReason")),
    )
  }

  private fun parseOffline(value: JSONObject?): TrailheadCarOfflineReadiness {
    if (value == null) return TrailheadCarOfflineReadiness()
    return TrailheadCarOfflineReadiness(
      status = clean(value.optString("status")).ifEmpty { "unknown" },
      mapReady = value.optionalBoolean("map"),
      navigationReady = value.optionalBoolean("navigation"),
      placesReady = value.optionalBoolean("places"),
      topoReady = value.optionalBoolean("topo"),
      trailsReady = value.optionalBoolean("trails"),
      tripDownloadReady = value.optionalBoolean("tripDownload"),
      message = shorten(clean(value.optString("message")), 220),
    )
  }

  private fun routeSummary(route: TrailheadCarRoute): String {
    val miles = route.totalDistanceM / 1609.344
    val minutes = (route.totalDurationS / 60.0).roundToInt()
    return listOfNotNull(
      if (miles > 0.05) "${miles.roundToInt()} mi" else null,
      if (minutes > 0) if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes} min" else null,
    ).joinToString(" · ")
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

  private fun JSONObject.optionalCoordinate(key: String, min: Double, max: Double): Double? {
    if (!has(key) || isNull(key)) return null
    return optDouble(key, Double.NaN).takeIf { it.isFinite() && it in min..max }
  }

  private fun JSONObject.optionalBoolean(key: String): Boolean? {
    if (!has(key) || isNull(key)) return null
    return optBoolean(key)
  }

  private fun positive(value: Double): Double = value.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0

  private fun shorten(value: String, limit: Int): String {
    if (value.length <= limit) return value
    return value.take(limit - 1).trimEnd() + "…"
  }

  private fun clean(value: String?): String {
    return value.orEmpty().replace(Regex("\\s+"), " ").trim()
  }
}
