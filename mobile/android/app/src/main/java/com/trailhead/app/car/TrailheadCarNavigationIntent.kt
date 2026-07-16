package com.trailhead.app.car

import android.content.Intent
import java.net.URLDecoder
import java.util.Locale

internal enum class TrailheadCarNavigationMode {
  NAVIGATION,
  DIRECTIONS,
  ADD_A_STOP,
}

internal data class TrailheadCarNavigationRequest(
  val label: String,
  val lat: Double?,
  val lng: Double?,
  val mode: TrailheadCarNavigationMode,
)

internal object TrailheadCarNavigationIntent {
  const val ACTION = "androidx.car.app.action.NAVIGATE"

  private val coordinatePattern = Regex(
    """^\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)(?:\s*\((.*)\))?\s*$""",
  )

  fun parse(intent: Intent?): TrailheadCarNavigationRequest? = parse(
    action = intent?.action,
    data = intent?.dataString,
  )

  internal fun parse(action: String?, data: String?): TrailheadCarNavigationRequest? {
    if (action != ACTION || data == null || !data.startsWith("geo:", ignoreCase = true)) return null

    val schemeSpecific = data.substring(4)
    val encodedTarget = schemeSpecific.substringBefore('?').removePrefix("//")
    val encodedQuery = schemeSpecific.substringAfter('?', missingDelimiterValue = "")
    val parameters = parseQuery(encodedQuery)
    val query = parameters["q"]?.trim().orEmpty()
    val queryCoordinate = parseCoordinate(query)
    val directCoordinate = parseCoordinate(decode(encodedTarget))
    val directIsPlaceholder = query.isNotEmpty()
      && directCoordinate?.lat == 0.0
      && directCoordinate.lng == 0.0
    val coordinate = queryCoordinate ?: directCoordinate?.takeUnless { directIsPlaceholder }
    val label = queryCoordinate?.label?.takeIf { it.isNotBlank() }
      ?: query.takeUnless { it.isBlank() || queryCoordinate != null }
      ?: coordinate?.label?.takeIf { it.isNotBlank() }
      ?: coordinate?.let { formatCoordinate(it.lat, it.lng) }
      ?: return null

    return TrailheadCarNavigationRequest(
      label = label.take(240),
      lat = coordinate?.lat,
      lng = coordinate?.lng,
      mode = parseMode(parameters["intent"]),
    )
  }

  private fun parseMode(value: String?): TrailheadCarNavigationMode = when (
    value?.trim()?.lowercase(Locale.US)
  ) {
    "directions" -> TrailheadCarNavigationMode.DIRECTIONS
    "add_a_stop" -> TrailheadCarNavigationMode.ADD_A_STOP
    else -> TrailheadCarNavigationMode.NAVIGATION
  }

  private fun parseQuery(encodedQuery: String): Map<String, String> {
    if (encodedQuery.isBlank()) return emptyMap()
    return encodedQuery.split('&').mapNotNull { item ->
      val encodedKey = item.substringBefore('=', missingDelimiterValue = item)
      val encodedValue = item.substringAfter('=', missingDelimiterValue = "")
      val key = decode(encodedKey).trim().lowercase(Locale.US)
      if (key.isBlank()) null else key to decode(encodedValue)
    }.toMap()
  }

  private fun decode(value: String): String = try {
    URLDecoder.decode(value, Charsets.UTF_8.name())
  } catch (_: IllegalArgumentException) {
    value
  }

  private fun parseCoordinate(value: String): Coordinate? {
    val match = coordinatePattern.matchEntire(value) ?: return null
    val lat = match.groupValues[1].toDoubleOrNull() ?: return null
    val lng = match.groupValues[2].toDoubleOrNull() ?: return null
    if (!lat.isFinite() || !lng.isFinite() || lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
    return Coordinate(
      lat = lat,
      lng = lng,
      label = match.groupValues[3].trim(),
    )
  }

  private fun formatCoordinate(lat: Double, lng: Double) = "$lat, $lng"

  private data class Coordinate(
    val lat: Double,
    val lng: Double,
    val label: String,
  )
}

internal fun requestMatchesCurrentRoute(
  request: TrailheadCarNavigationRequest,
  snapshot: TrailheadCarSnapshot,
): Boolean {
  val route = snapshot.route ?: return false
  val requestedPoint = if (request.lat != null && request.lng != null) {
    TrailheadCarPoint(request.lat, request.lng)
  } else {
    null
  }
  if (requestedPoint != null && TrailheadCarNavigationMath.distance(requestedPoint, route.points.last()) <= 750.0) {
    return true
  }
  val requestedLabel = normalizedDestinationLabel(request.label)
  if (requestedLabel.length < 4) return false
  return listOf(route.title, snapshot.stops.lastOrNull()?.name.orEmpty())
    .map(::normalizedDestinationLabel)
    .filter { it.length >= 4 }
    .any { candidate -> candidate == requestedLabel || candidate.contains(requestedLabel) || requestedLabel.contains(candidate) }
}

private fun normalizedDestinationLabel(value: String): String {
  return value.lowercase(Locale.US)
    .replace(Regex("[^a-z0-9]+"), " ")
    .trim()
}
