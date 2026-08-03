package com.trailhead.app.car

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.UUID
import kotlin.math.roundToInt

internal data class TrailheadCarRouteResolution(
  val route: TrailheadCarRoute,
  val destination: TrailheadCarPoint,
  val destinationLabel: String,
)

internal data class TrailheadCarDestinationChoice(
  val label: String,
  val detail: String,
  val lat: Double,
  val lng: Double,
)

internal sealed interface TrailheadCarDestinationSearchResponse {
  data class Ready(val destinations: List<TrailheadCarDestinationChoice>) : TrailheadCarDestinationSearchResponse
  data class Failed(val message: String) : TrailheadCarDestinationSearchResponse
}

internal sealed interface TrailheadCarNavigationStartResult {
  data object Started : TrailheadCarNavigationStartResult
  data class Failed(val message: String) : TrailheadCarNavigationStartResult
}

internal fun interface TrailheadCarHttpClient {
  fun get(url: String): String
}

internal class TrailheadCarHttpException(val statusCode: Int) :
  IllegalStateException("Trailhead service unavailable")

internal class TrailheadCarUrlConnectionClient : TrailheadCarHttpClient {
  override fun get(url: String): String {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    return try {
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      connection.requestMethod = "GET"
      connection.setRequestProperty("Accept", "application/json")
      val status = connection.responseCode
      if (status !in 200..299) throw TrailheadCarHttpException(status)
      connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
      connection.disconnect()
    }
  }
}

internal class TrailheadCarDestinationRouter(
  private val accessToken: String,
  private val httpClient: TrailheadCarHttpClient = TrailheadCarUrlConnectionClient(),
) {
  fun search(
    query: String,
    origin: TrailheadCarPoint? = null,
    limit: Int = 6,
  ): List<TrailheadCarDestinationChoice> {
    require(accessToken.isNotBlank()) { "Online search is unavailable" }
    val cleanQuery = query.trim().take(160)
    require(cleanQuery.length >= 2) { "Enter at least two characters" }
    val root = JSONObject(httpClient.get(searchUrl(origin, cleanQuery, limit.coerceIn(1, 8))))
    val features = root.optJSONArray("features") ?: return emptyList()
    return buildList<TrailheadCarDestinationChoice> {
      for (index in 0 until features.length()) {
        val feature = features.optJSONObject(index) ?: continue
        val properties = feature.optJSONObject("properties") ?: JSONObject()
        val coordinates = feature.optJSONObject("geometry")?.optJSONArray("coordinates")
          ?: properties.optJSONObject("coordinates")?.let { value ->
            org.json.JSONArray()
              .put(value.optDouble("longitude", Double.NaN))
              .put(value.optDouble("latitude", Double.NaN))
          }
          ?: continue
        val lng = coordinates.optDouble(0, Double.NaN)
        val lat = coordinates.optDouble(1, Double.NaN)
        if (!validCoordinate(lat, lng)) continue
        val label = properties.optString("name").trim()
          .ifEmpty { feature.optString("text").trim() }
          .ifEmpty { cleanQuery }
          .take(120)
        val detail = properties.optString("full_address").trim()
          .ifEmpty { properties.optString("place_formatted").trim() }
          .ifEmpty { properties.optString("address").trim() }
          .take(160)
        val choice = TrailheadCarDestinationChoice(label, detail, lat, lng)
        if (none { existing ->
            normalizedSearchLabel(existing.label) == normalizedSearchLabel(choice.label) &&
              TrailheadCarNavigationMath.distance(
                TrailheadCarPoint(existing.lat, existing.lng),
                TrailheadCarPoint(choice.lat, choice.lng),
              ) < 50.0
          }) {
          add(choice)
        }
      }
    }.take(limit)
  }

  fun resolve(
    origin: TrailheadCarPoint,
    request: TrailheadCarNavigationRequest,
    finalDestinationAfterStop: TrailheadCarPoint? = null,
  ): TrailheadCarRouteResolution {
    require(accessToken.isNotBlank()) { "Online routing is unavailable" }
    val requested = request.lat?.let { lat ->
      request.lng?.let { lng -> TrailheadCarPoint(lat, lng) }
    }
    val destination = requested ?: resolveNamedDestination(origin, request.label)
    val points = buildList {
      add(origin)
      add(destination)
      if (
        request.mode == TrailheadCarNavigationMode.ADD_A_STOP &&
        finalDestinationAfterStop != null &&
        TrailheadCarNavigationMath.distance(destination, finalDestinationAfterStop) > 25.0
      ) {
        add(finalDestinationAfterStop)
      }
    }
    return parseDirections(
      httpClient.get(directionsUrl(points)),
      request.label,
      destination,
    )
  }

  private fun resolveNamedDestination(
    origin: TrailheadCarPoint,
    label: String,
  ): TrailheadCarPoint {
    val choice = search(label, origin, limit = 1).firstOrNull()
      ?: throw IllegalStateException("Destination not found")
    return TrailheadCarPoint(choice.lat, choice.lng)
  }

  internal fun searchUrl(origin: TrailheadCarPoint, label: String): String {
    return searchUrl(origin as TrailheadCarPoint?, label, 1)
  }

  internal fun searchUrl(origin: TrailheadCarPoint?, label: String, limit: Int): String {
    val encodedQuery = URLEncoder.encode(label.trim(), StandardCharsets.UTF_8.name())
    return "https://api.mapbox.com/search/searchbox/v1/forward" +
      "?q=$encodedQuery" +
      "&limit=${limit.coerceIn(1, 8)}" +
      "&types=poi,address,place,locality,neighborhood" +
      (origin?.let { "&proximity=${it.lng},${it.lat}" } ?: "") +
      "&access_token=${encodedToken()}"
  }

  internal fun directionsUrl(points: List<TrailheadCarPoint>): String {
    require(points.size >= 2) { "At least two route points are required" }
    val coordinates = points.joinToString(";") { "${it.lng},${it.lat}" }
    return "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/$coordinates" +
      "?alternatives=false" +
      "&banner_instructions=true" +
      "&geometries=geojson" +
      "&language=en" +
      "&overview=full" +
      "&roundabout_exits=true" +
      "&steps=true" +
      "&voice_instructions=true" +
      "&access_token=${encodedToken()}"
  }

  internal fun parseDirections(
    body: String,
    destinationLabel: String,
    requestedDestination: TrailheadCarPoint,
  ): TrailheadCarRouteResolution {
    val routeJson = JSONObject(body).optJSONArray("routes")?.optJSONObject(0)
      ?: throw IllegalStateException("No drivable route found")
    val coordinates = routeJson.optJSONObject("geometry")
      ?.optJSONArray("coordinates")
      ?: throw IllegalStateException("Route geometry unavailable")
    val points = buildList {
      for (index in 0 until coordinates.length()) {
        val pair = coordinates.optJSONArray(index) ?: continue
        val lng = pair.optDouble(0, Double.NaN)
        val lat = pair.optDouble(1, Double.NaN)
        if (validCoordinate(lat, lng)) add(TrailheadCarPoint(lat, lng))
      }
    }
    if (points.size < 2) throw IllegalStateException("Route geometry unavailable")

    val steps = buildList {
      val legs = routeJson.optJSONArray("legs")
      if (legs != null) {
        for (legIndex in 0 until legs.length()) {
          val sourceSteps = legs.optJSONObject(legIndex)?.optJSONArray("steps") ?: continue
          for (stepIndex in 0 until sourceSteps.length()) {
            val source = sourceSteps.optJSONObject(stepIndex) ?: continue
            val maneuver = source.optJSONObject("maneuver") ?: JSONObject()
            val location = maneuver.optJSONArray("location")
            val lng = location?.optDouble(0, Double.NaN) ?: Double.NaN
            val lat = location?.optDouble(1, Double.NaN) ?: Double.NaN
            val voice = source.optJSONArray("voiceInstructions")
            val verbalPre = voice?.optJSONObject(0)?.optString("announcement").orEmpty().trim()
            val verbalPost = voice?.optJSONObject((voice.length() - 1).coerceAtLeast(0))
              ?.optString("announcement").orEmpty().trim()
            add(
              TrailheadCarStep(
                type = maneuver.optString("type").trim().ifEmpty { "continue" },
                modifier = maneuver.optString("modifier").trim().ifEmpty { "straight" },
                name = source.optString("name").trim(),
                instruction = maneuver.optString("instruction").trim(),
                verbalPre = verbalPre,
                verbalPost = verbalPost,
                distanceM = source.optDouble("distance", 0.0).coerceAtLeast(0.0),
                durationS = source.optDouble("duration", 0.0).coerceAtLeast(0.0),
                lat = lat.takeIf { value -> value.isFinite() && value in -90.0..90.0 },
                lng = lng.takeIf { value -> value.isFinite() && value in -180.0..180.0 },
                roundaboutExit = maneuver.optInt("exit", 0).takeIf { it > 0 },
              ),
            )
          }
        }
      }
    }
    val distance = routeJson.optDouble("distance", 0.0).coerceAtLeast(0.0)
    val duration = routeJson.optDouble("duration", 0.0).coerceAtLeast(0.0)
    val summary = "${(distance / 1_609.344).coerceAtLeast(0.0).let { String.format(Locale.US, "%.1f", it) }} mi - ${(duration / 60.0).roundToInt()} min"
    val safeLabel = destinationLabel.trim().take(120).ifEmpty { "Destination" }
    val routeId = UUID.nameUUIDFromBytes(
      "$safeLabel:${points.first()}:${points.last()}:$distance".toByteArray(),
    ).toString()
    return TrailheadCarRouteResolution(
      route = TrailheadCarRoute(
        mode = TrailheadCarRouteMode.ROAD_PREVIEW,
        routeId = "car-request:$routeId",
        title = safeLabel,
        summary = summary,
        source = "mapbox_car_request",
        points = points,
        steps = steps,
        totalDistanceM = distance,
        totalDurationS = duration,
      ),
      destination = requestedDestination,
      destinationLabel = safeLabel,
    )
  }

  private fun encodedToken(): String = URLEncoder.encode(
    accessToken,
    StandardCharsets.UTF_8.name(),
  )

  private fun validCoordinate(lat: Double, lng: Double): Boolean {
    return lat.isFinite() && lng.isFinite() && lat in -90.0..90.0 && lng in -180.0..180.0
  }

  private fun normalizedSearchLabel(value: String): String = value
    .lowercase(Locale.US)
    .replace(Regex("[^a-z0-9]+"), " ")
    .trim()
}
