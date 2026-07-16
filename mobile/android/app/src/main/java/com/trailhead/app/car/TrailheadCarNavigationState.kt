package com.trailhead.app.car

import android.location.Location
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class TrailheadCarProgress(
  val location: TrailheadCarPoint,
  val routePoint: TrailheadCarPoint,
  val segmentIndex: Int,
  val distanceFromRouteM: Double,
  val distanceAlongRouteM: Double,
  val remainingDistanceM: Double,
  val remainingDurationS: Double,
  val routeProgress: Double,
  val stepIndex: Int,
  val currentStep: TrailheadCarStep?,
  val nextStep: TrailheadCarStep?,
  val stepRemainingDistanceM: Double,
  val offRoute: Boolean,
  val arrivedStopIndex: Int?,
  val finalArrival: Boolean,
)

object TrailheadCarNavigationMath {
  private const val EARTH_RADIUS_M = 6_371_000.0

  fun routeDistance(points: List<TrailheadCarPoint>): Double {
    if (points.size < 2) return 0.0
    return points.zipWithNext().sumOf { (a, b) -> distance(a, b) }
  }

  fun distance(a: TrailheadCarPoint, b: TrailheadCarPoint): Double {
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLng = Math.toRadians(b.lng - a.lng)
    val lat1 = Math.toRadians(a.lat)
    val lat2 = Math.toRadians(b.lat)
    val h = sin(dLat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dLng / 2).pow(2)
    return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
  }

  internal data class Projection(
    val point: TrailheadCarPoint,
    val segmentIndex: Int,
    val distanceFromRouteM: Double,
    val distanceAlongRouteM: Double,
  )

  internal fun project(
    location: TrailheadCarPoint,
    points: List<TrailheadCarPoint>,
    cumulative: DoubleArray,
    startIndex: Int = 0,
    endIndex: Int = points.lastIndex,
  ): Projection? {
    if (points.size < 2 || cumulative.size != points.size) return null
    val start = startIndex.coerceIn(0, points.lastIndex - 1)
    val end = endIndex.coerceIn(start + 1, points.lastIndex)
    var best: Projection? = null
    for (index in start until end) {
      val candidate = projectSegment(location, points[index], points[index + 1], index, cumulative[index])
      if (best == null || candidate.distanceFromRouteM < best.distanceFromRouteM) best = candidate
    }
    return best
  }

  private fun projectSegment(
    location: TrailheadCarPoint,
    a: TrailheadCarPoint,
    b: TrailheadCarPoint,
    index: Int,
    distanceBefore: Double,
  ): Projection {
    val referenceLat = Math.toRadians(location.lat)
    fun x(lng: Double) = Math.toRadians(lng - location.lng) * cos(referenceLat) * EARTH_RADIUS_M
    fun y(lat: Double) = Math.toRadians(lat - location.lat) * EARTH_RADIUS_M
    val ax = x(a.lng)
    val ay = y(a.lat)
    val bx = x(b.lng)
    val by = y(b.lat)
    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy
    val t = if (lengthSquared <= 0.0001) 0.0 else (-(ax * dx + ay * dy) / lengthSquared).coerceIn(0.0, 1.0)
    val px = ax + dx * t
    val py = ay + dy * t
    val projected = TrailheadCarPoint(
      lat = a.lat + (b.lat - a.lat) * t,
      lng = a.lng + (b.lng - a.lng) * t,
    )
    return Projection(
      point = projected,
      segmentIndex = index,
      distanceFromRouteM = sqrt(px * px + py * py),
      distanceAlongRouteM = distanceBefore + distance(a, b) * t,
    )
  }
}

class TrailheadCarNavigationState(
  val snapshot: TrailheadCarSnapshot,
) {
  val route: TrailheadCarRoute = requireNotNull(snapshot.route)
  private val geometryCumulative = DoubleArray(route.points.size)
  private val stepCumulative = DoubleArray(route.steps.size + 1)
  private val originPoint = snapshot.stops.firstOrNull()?.let { TrailheadCarPoint(it.lat, it.lng) }
    ?: route.points.first()
  private val finalReturnsToOrigin = snapshot.stops.lastOrNull()?.let { finalStop ->
    TrailheadCarNavigationMath.distance(originPoint, TrailheadCarPoint(finalStop.lat, finalStop.lng)) <= ARRIVAL_RADIUS_M
  } ?: false
  private var lastSegmentIndex = 0
  private var nextStopIndex = if (snapshot.stops.size > 1) 1 else snapshot.stops.lastIndex
  private val acknowledgedStops = mutableSetOf<Int>()
  private var lastProgress: TrailheadCarProgress? = null
  private var simulationIndex = 0
  private var hasDepartedOrigin = false

  init {
    for (index in 1 until route.points.size) {
      geometryCumulative[index] = geometryCumulative[index - 1] +
        TrailheadCarNavigationMath.distance(route.points[index - 1], route.points[index])
    }
    route.steps.forEachIndexed { index, step ->
      stepCumulative[index + 1] = stepCumulative[index] + step.distanceM
    }
  }

  fun update(location: Location): TrailheadCarProgress {
    return update(TrailheadCarPoint(location.latitude, location.longitude))
  }

  fun update(location: TrailheadCarPoint): TrailheadCarProgress {
    val localStart = max(0, lastSegmentIndex - 20)
    val localEnd = min(route.points.lastIndex, lastSegmentIndex + 300)
    var projection = TrailheadCarNavigationMath.project(
      location,
      route.points,
      geometryCumulative,
      localStart,
      localEnd,
    )
    if (projection == null || projection.distanceFromRouteM > 450.0) {
      projection = TrailheadCarNavigationMath.project(location, route.points, geometryCumulative)
    }
    requireNotNull(projection)

    val previousAlong = lastProgress?.distanceAlongRouteM ?: 0.0
    val along = if (projection.distanceFromRouteM < 180.0) {
      max(previousAlong - 40.0, projection.distanceAlongRouteM)
    } else {
      projection.distanceAlongRouteM
    }
    lastSegmentIndex = projection.segmentIndex
    val geometryTotal = geometryCumulative.last().coerceAtLeast(1.0)
    val ratio = (along / geometryTotal).coerceIn(0.0, 1.0)
    if (!hasDepartedOrigin) {
      hasDepartedOrigin = ratio > MINIMUM_DEPARTURE_PROGRESS ||
        TrailheadCarNavigationMath.distance(location, originPoint) > ORIGIN_DEPARTURE_RADIUS_M
    }
    val declaredTotal = route.totalDistanceM.takeIf { it > 0.0 } ?: geometryTotal
    val remainingDistance = (declaredTotal * (1.0 - ratio)).coerceAtLeast(0.0)
    val remainingDuration = (route.totalDurationS * (1.0 - ratio)).coerceAtLeast(0.0)
    val stepIndex = stepIndex(ratio, declaredTotal)
    val currentStep = route.steps.getOrNull(stepIndex)
    val nextStep = route.steps.getOrNull(stepIndex + 1)
    val stepRemaining = currentStep?.let {
      val stepStart = stepCumulative.getOrElse(stepIndex) { 0.0 }
      val routeAlong = ratio * declaredTotal
      (it.distanceM - max(0.0, routeAlong - stepStart)).coerceIn(0.0, it.distanceM.coerceAtLeast(0.0))
    } ?: remainingDistance
    val arrival = arrivalIndex(location, ratio)
    val finalArrival = (arrival != null && arrival == snapshot.stops.lastIndex) ||
      (snapshot.stops.isEmpty() && remainingDistance <= 45.0)
    return TrailheadCarProgress(
      location = location,
      routePoint = projection.point,
      segmentIndex = projection.segmentIndex,
      distanceFromRouteM = projection.distanceFromRouteM,
      distanceAlongRouteM = along,
      remainingDistanceM = remainingDistance,
      remainingDurationS = remainingDuration,
      routeProgress = ratio,
      stepIndex = stepIndex,
      currentStep = currentStep,
      nextStep = nextStep,
      stepRemainingDistanceM = stepRemaining,
      offRoute = projection.distanceFromRouteM > if (route.isTrailFollow) 55.0 else 90.0,
      arrivedStopIndex = arrival,
      finalArrival = finalArrival,
    ).also { lastProgress = it }
  }

  fun acknowledgeArrival(stopIndex: Int) {
    if (stopIndex != nextStopIndex || stopIndex !in snapshot.stops.indices) return
    acknowledgedStops += stopIndex
    nextStopIndex = (stopIndex + 1).coerceAtMost(snapshot.stops.lastIndex)
  }

  fun simulateNext(): TrailheadCarProgress {
    simulationIndex = (simulationIndex + max(1, route.points.size / 120)).coerceAtMost(route.points.lastIndex)
    return update(route.points[simulationIndex])
  }

  fun currentProgress(): TrailheadCarProgress? = lastProgress

  private fun stepIndex(routeRatio: Double, declaredTotal: Double): Int {
    if (route.steps.isEmpty()) return 0
    val stepTotal = stepCumulative.last()
    val routeAlong = if (stepTotal > 0.0) routeRatio * stepTotal else routeRatio * declaredTotal
    for (index in route.steps.indices) {
      if (routeAlong <= stepCumulative[index + 1]) return index
    }
    return route.steps.lastIndex
  }

  private fun arrivalIndex(location: TrailheadCarPoint, routeRatio: Double): Int? {
    if (snapshot.stops.isEmpty()) return null
    val index = nextStopIndex
    if (index !in snapshot.stops.indices || index in acknowledgedStops) return null
    val stop = snapshot.stops[index]
    val distance = TrailheadCarNavigationMath.distance(location, TrailheadCarPoint(stop.lat, stop.lng))
    if (distance > ARRIVAL_RADIUS_M) return null
    if (index == 0 && routeRatio <= MINIMUM_START_PROGRESS) return null
    if (index == snapshot.stops.lastIndex && finalReturnsToOrigin && !hasDepartedOrigin) return null
    return index
  }

  private companion object {
    const val ARRIVAL_RADIUS_M = 55.0
    const val ORIGIN_DEPARTURE_RADIUS_M = 80.0
    const val MINIMUM_DEPARTURE_PROGRESS = 0.01
    const val MINIMUM_START_PROGRESS = 0.002
  }
}
