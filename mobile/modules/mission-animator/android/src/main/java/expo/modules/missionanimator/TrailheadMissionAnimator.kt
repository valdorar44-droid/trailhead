package expo.modules.missionanimator

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import com.mapbox.geojson.Feature
import com.mapbox.geojson.FeatureCollection
import com.mapbox.geojson.LineString
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.Style
import com.mapbox.maps.extension.style.layers.addLayer
import com.mapbox.maps.extension.style.layers.generated.CircleLayer
import com.mapbox.maps.extension.style.layers.generated.LineLayer
import com.mapbox.maps.extension.style.layers.properties.generated.LineCap
import com.mapbox.maps.extension.style.layers.properties.generated.LineJoin
import com.mapbox.maps.extension.style.sources.addSource
import com.mapbox.maps.extension.style.sources.generated.GeoJsonSource
import com.mapbox.maps.extension.style.sources.getSourceAs
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.animation.easeTo
import kotlin.math.*

internal data class MissionPoint(val lat: Double, val lng: Double)

internal data class MissionSceneModel(
  val id: String,
  val type: String,
  val durationMs: Double,
  val routeSliceStart: Double,
  val routeSliceEnd: Double,
  val focusLat: Double?,
  val focusLng: Double?,
  val cameraMode: String,
  val cameraZoom: Double?,
  val cameraPitch: Double?,
  val cameraBearing: Double?,
  val warning: Boolean,
)

internal class TrailheadMissionAnimator(
  private val emit: (event: String, payload: Map<String, Any?>) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var mapView: MapView? = null
  private var route: List<Pair<Double, Double>> = emptyList()
  private var routeCum: DoubleArray = doubleArrayOf()
  private var routeTotal: Double = 0.0
  private var scenes: List<MissionSceneModel> = emptyList()
  private var cameraPitch = 64.0
  private var minZoom = 8.5
  private var maxZoom = 14.2
  private var lookaheadM = 600.0
  private var speed = 1.0

  private var playing = false
  private var paused = false
  private var stopped = false
  private var sceneIndex = -1
  private var sceneStartNs = 0L
  private var pausedAtNs = 0L
  private var pausedTotalNs = 0L
  private var sceneDurationSec = 7.0
  private var sceneEstablishSec = 0.0
  private var smoothedBearing: Double? = null
  private var lastCamDist: Double? = null
  private var lastCamPoint: MissionPoint? = null
  private var lastCamBearing: Double? = null
  private var lastProgressEmitNs = 0L
  private var warningActive = false
  private var layersInstalled = false

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      if (!playing || paused || stopped) return
      tick(frameTimeNanos)
      if (playing && !paused && !stopped) {
        Choreographer.getInstance().postFrameCallback(this)
      }
    }
  }

  fun findMapView(): MapView? {
    val activity = currentActivity() ?: return null
    return findMapView(activity.window?.decorView)
  }

  private fun currentActivity(): Activity? {
    return try {
      val app = Class.forName("android.app.ActivityThread")
      val method = app.getMethod("currentActivityThread")
      val thread = method.invoke(null)
      val activitiesField = app.getDeclaredField("mActivities")
      activitiesField.isAccessible = true
      @Suppress("UNCHECKED_CAST")
      val activities = activitiesField.get(thread) as? Map<*, *> ?: return null
      activities.values.firstOrNull()?.let { record ->
        val activityField = record.javaClass.getDeclaredField("activity")
        activityField.isAccessible = true
        activityField.get(record) as? Activity
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun findMapView(view: View?): MapView? {
    if (view == null) return null
    if (view is MapView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        findMapView(view.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  fun prepare(payload: Map<String, Any?>): Boolean {
    if (!parsePayload(payload)) return false
    attachMapIfNeeded()
    mapView?.getMapboxMap()?.getStyle { style ->
      mainHandler.post { installMissionLayers(style) }
    }
    return mapView != null
  }

  fun start(payload: Map<String, Any?>?): Boolean {
    if (payload != null && !parsePayload(payload)) {
      emit("onMissionError", mapOf("message" to "Invalid mission payload", "code" to "invalid_payload"))
      return false
    }
    attachMapIfNeeded()
    val map = mapView ?: run {
      emit("onMissionError", mapOf("message" to "MapView not found", "code" to "no_map"))
      return false
    }
    map.getMapboxMap().getStyle { style ->
      mainHandler.post {
        installMissionLayers(style)
        updateFullRoute()
      }
    }
    stopped = false
    paused = false
    playing = true
    sceneIndex = -1
    pausedTotalNs = 0L
    Choreographer.getInstance().postFrameCallback(frameCallback)
    advanceScene(map)
    return true
  }

  fun pause(): Boolean {
    if (!playing || paused) return false
    paused = true
    pausedAtNs = System.nanoTime()
    return true
  }

  fun resume(): Boolean {
    if (!playing || !paused) return false
    paused = false
    pausedTotalNs += System.nanoTime() - pausedAtNs
    Choreographer.getInstance().postFrameCallback(frameCallback)
    return true
  }

  fun stop(): Boolean {
    playing = false
    paused = false
    stopped = true
    Choreographer.getInstance().removeFrameCallback(frameCallback)
    clearOverlaySources()
    return true
  }

  fun clear(): Boolean {
    stop()
    route = emptyList()
    routeCum = doubleArrayOf()
    scenes = emptyList()
    return true
  }

  fun setSpeed(next: Double): Boolean {
    speed = next.coerceIn(0.25, 3.0)
    return true
  }

  private fun attachMapIfNeeded() {
    if (mapView != null) return
    mapView = findMapView()
    mapView?.getMapboxMap()?.getStyle { style ->
      mainHandler.post {
        installMissionLayers(style)
        updateFullRoute()
      }
    }
  }

  private fun parsePayload(payload: Map<String, Any?>): Boolean {
    @Suppress("UNCHECKED_CAST")
    val rawRoute = payload["route"] as? List<List<Any>> ?: return false
    route = rawRoute.mapNotNull { pair ->
      if (pair.size < 2) return@mapNotNull null
      val lng = doubleValue(pair[0]) ?: return@mapNotNull null
      val lat = doubleValue(pair[1]) ?: return@mapNotNull null
      lng to lat
    }
    if (route.size < 2) return false
    routeCum = cumulativeDistances(route)
    routeTotal = routeCum.lastOrNull() ?: 0.0

    @Suppress("UNCHECKED_CAST")
    val cam = payload["camera"] as? Map<String, Any?>
    if (cam != null) {
      cameraPitch = doubleValue(cam["pitch"]) ?: 64.0
      minZoom = doubleValue(cam["minZoom"]) ?: 8.5
      maxZoom = doubleValue(cam["maxZoom"]) ?: 14.2
      lookaheadM = doubleValue(cam["lookaheadM"]) ?: 600.0
    }
    speed = (doubleValue(payload["speed"]) ?: 1.0).coerceIn(0.25, 3.0)

    @Suppress("UNCHECKED_CAST")
    val rawScenes = payload["scenes"] as? List<Map<String, Any?>> ?: return false
    scenes = rawScenes.mapNotNull { parseScene(it) }
    return scenes.isNotEmpty()
  }

  private fun parseScene(raw: Map<String, Any?>): MissionSceneModel? {
    val id = raw["id"] as? String ?: return null
    val type = raw["type"] as? String ?: return null
    @Suppress("UNCHECKED_CAST")
    val slice = raw["routeSlice"] as? List<Any>
    val sliceStart = if (slice != null && slice.isNotEmpty()) doubleValue(slice[0]) ?: 0.0 else 0.0
    val sliceEnd = if (slice != null && slice.size > 1) doubleValue(slice[1]) ?: 1.0 else 1.0
    @Suppress("UNCHECKED_CAST")
    val focus = raw["focus"] as? Map<String, Any?>
    @Suppress("UNCHECKED_CAST")
    val camRaw = raw["camera"] as? Map<String, Any?> ?: emptyMap()
    @Suppress("UNCHECKED_CAST")
    val layers = raw["layers"] as? Map<String, Any?> ?: emptyMap()
    val warning = layers["warning"] == true ||
      type in listOf("risk_focus", "weather_focus", "offline_readiness")
    return MissionSceneModel(
      id = id,
      type = type,
      durationMs = doubleValue(raw["durationMs"]) ?: 12000.0,
      routeSliceStart = sliceStart.coerceIn(0.0, 1.0),
      routeSliceEnd = sliceEnd.coerceIn(sliceStart, 1.0),
      focusLat = doubleValue(focus?.get("lat")),
      focusLng = doubleValue(focus?.get("lng")),
      cameraMode = camRaw["mode"] as? String ?: "follow",
      cameraZoom = doubleValue(camRaw["zoom"]),
      cameraPitch = doubleValue(camRaw["pitch"]),
      cameraBearing = doubleValue(camRaw["bearing"]),
      warning = warning,
    )
  }

  private fun installMissionLayers(style: Style) {
    if (layersInstalled) return
    if (style.getSource("mission-full-route-source") == null) {
      style.addSource(GeoJsonSource.Builder("mission-full-route-source").build())
    }
    if (style.getSource("mission-progress-route-source") == null) {
      style.addSource(GeoJsonSource.Builder("mission-progress-route-source").build())
    }
    if (style.getSource("mission-marker-source") == null) {
      style.addSource(GeoJsonSource.Builder("mission-marker-source").build())
    }
    if (!style.styleLayerExists("th-mission-full-casing")) {
      style.addLayer(
        LineLayer("th-mission-full-casing", "mission-full-route-source")
          .lineColor("#020617")
          .lineWidth(9.0)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (!style.styleLayerExists("th-mission-full-line")) {
      style.addLayer(
        LineLayer("th-mission-full-line", "mission-full-route-source")
          .lineColor("#e2e8f0")
          .lineWidth(4.5)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (!style.styleLayerExists("th-mission-progress-line")) {
      style.addLayer(
        LineLayer("th-mission-progress-line", "mission-progress-route-source")
          .lineColor("#38e1ff")
          .lineWidth(6.5)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (!style.styleLayerExists("th-mission-marker-dot")) {
      style.addLayer(
        CircleLayer("th-mission-marker-dot", "mission-marker-source")
          .circleRadius(7.0)
          .circleColor("#00a7ff")
          .circleStrokeColor("#ffffff")
          .circleStrokeWidth(2.5),
      )
    }
    layersInstalled = true
  }

  private fun updateFullRoute() {
    if (route.size < 2) return
    val points = route.map { Point.fromLngLat(it.first, it.second) }
    val json = FeatureCollection.fromFeature(Feature.fromGeometry(LineString.fromLngLats(points))).toJson()
    mapView?.getMapboxMap()?.getStyle { style ->
      style.getSourceAs<GeoJsonSource>("mission-full-route-source")?.data(json)
    }
  }

  private fun clearOverlaySources() {
    val empty = FeatureCollection.fromFeatures(emptyList()).toJson()
    mapView?.getMapboxMap()?.getStyle { style ->
      style.getSourceAs<GeoJsonSource>("mission-progress-route-source")?.data(empty)
      style.getSourceAs<GeoJsonSource>("mission-marker-source")?.data(empty)
    }
  }

  private fun tick(nowNs: Long) {
    if (sceneIndex < 0 || sceneIndex >= scenes.size) return
    val scene = scenes[sceneIndex]
    val elapsedSec = (nowNs - sceneStartNs - pausedTotalNs) / 1_000_000_000.0
    val glideSec = max(0.001, sceneDurationSec - sceneEstablishSec)
    val t = ((elapsedSec - sceneEstablishSec) / glideSec).coerceIn(0.0, 1.0)

    if (elapsedSec >= sceneDurationSec) {
      finishScene(scene)
      return
    }

    when (scene.cameraMode) {
      "follow" -> tickFollow(scene, t)
      else -> if (scene.type == "whole_route" || scene.cameraMode == "fit") {
        emitProgress(scene, t, routeTotal * (scene.routeSliceStart + (scene.routeSliceEnd - scene.routeSliceStart) * t))
      }
    }

    if (nowNs - lastProgressEmitNs >= 500_000_000L) {
      lastProgressEmitNs = nowNs
      emit("onMissionSceneProgress", mapOf("sceneId" to scene.id, "index" to sceneIndex, "progress" to t))
    }
  }

  private fun advanceScene(map: MapView) {
    sceneIndex += 1
    if (sceneIndex >= scenes.size) {
      playing = false
      Choreographer.getInstance().removeFrameCallback(frameCallback)
      emit("onMissionComplete", emptyMap())
      return
    }
    val scene = scenes[sceneIndex]
    sceneStartNs = System.nanoTime()
    pausedTotalNs = 0L
    lastProgressEmitNs = 0L
    sceneDurationSec = max(7.0, (scene.durationMs / 1000.0) / max(0.25, speed))
    warningActive = scene.warning
    sceneEstablishSec = applyEstablishingCamera(scene, map) / 1000.0
    emit("onMissionSceneStart", mapOf("sceneId" to scene.id, "index" to sceneIndex, "type" to scene.type))
    emit("onMissionDebug", mapOf("kind" to "scene_start", "details" to mapOf("scene_id" to scene.id, "index" to sceneIndex)))
  }

  private fun finishScene(scene: MissionSceneModel) {
    emit("onMissionSceneEnd", mapOf("sceneId" to scene.id, "index" to sceneIndex))
    mapView?.let { advanceScene(it) }
  }

  private fun tickFollow(scene: MissionSceneModel, t: Double) {
    if (routeTotal <= 0) return
    val startDist = routeTotal * scene.routeSliceStart
    val endDist = routeTotal * scene.routeSliceEnd
    val lookahead = lookaheadForSlice(startDist, endDist)
    val d = startDist + (endDist - startDist) * t
    val nominal = min(routeTotal, d + lookahead)
    val camDist = lastCamDist?.let { max(it, nominal) } ?: nominal
    lastCamDist = camDist
    val camPt = pointAtDistance(camDist)
    val aheadPt = pointAtDistance(min(routeTotal, camDist + lookahead))
    val targetBearing = bearing(camPt, aheadPt)
    smoothedBearing = smoothAngle(smoothedBearing, targetBearing, 0.16)
    val zoom = zoomForSliceLengthKm(max(0.0, endDist - startDist) / 1000.0, scene.cameraZoom)
    setCamera(camPt, zoom, clampPitch(scene.cameraPitch), smoothedBearing ?: targetBearing, animated = false)
    emitProgress(scene, t, d)
    emit("onMissionDebug", mapOf("kind" to "camera", "details" to mapOf("scene_id" to scene.id)))
  }

  private fun applyEstablishingCamera(scene: MissionSceneModel, map: MapView): Double {
    smoothedBearing = null
    if (scene.cameraMode == "fit" || scene.type in listOf("intro", "whole_route", "mission_recap")) {
      val coords = sliceRoute(scene.routeSliceStart, scene.routeSliceEnd)
      val bounds = boundsFromCoords(coords) ?: return 0.0
      val spanDeg = max(bounds.second, 0.02)
      val zoom = max(4.5, min(12.5, log2(190.0 / spanDeg)))
      setCamera(bounds.first, zoom, scene.cameraPitch ?: 54.0, null, animated = true, durationMs = 2600)
      lastCamPoint = bounds.first
      lastCamDist = null
      return 2600.0
    }
    if (scene.cameraMode == "follow" && routeTotal > 0) {
      val startDist = routeTotal * scene.routeSliceStart
      val endDist = routeTotal * scene.routeSliceEnd
      val lookahead = lookaheadForSlice(startDist, endDist)
      val leadDist = min(routeTotal, startDist + lookahead)
      if (lastCamDist != null && abs(leadDist - lastCamDist!!) < max(400.0, lookahead)) {
        smoothedBearing = lastCamBearing
        return 0.0
      }
      val start = pointAtDistance(leadDist)
      val ahead = pointAtDistance(min(routeTotal, leadDist + lookahead))
      val br = bearing(start, ahead)
      smoothedBearing = br
      val zoom = zoomForSliceLengthKm(max(0.0, endDist - startDist) / 1000.0, scene.cameraZoom)
      setCamera(start, zoom, clampPitch(scene.cameraPitch), br, animated = true, durationMs = 1800)
      lastCamDist = leadDist
      lastCamPoint = start
      lastCamBearing = br
      return 1800.0
    }
    val lat = scene.focusLat
    val lng = scene.focusLng
    if (lat != null && lng != null) {
      val pt = MissionPoint(lat, lng)
      val zoom = min(scene.cameraZoom ?: 12.5, maxZoom)
      setCamera(pt, zoom, clampPitch(scene.cameraPitch ?: 62.0), scene.cameraBearing, animated = true, durationMs = 2000)
      lastCamPoint = pt
      lastCamDist = null
      return 2000.0
    }
    return 0.0
  }

  private fun emitProgress(scene: MissionSceneModel, ratio: Double, markerDist: Double) {
    val progressCoords = downsample(progressRoute(ratio), 140)
    if (progressCoords.size >= 2) {
      val points = progressCoords.map { Point.fromLngLat(it.first, it.second) }
      val progressJson = FeatureCollection.fromFeature(
        Feature.fromGeometry(LineString.fromLngLats(points)),
      ).toJson()
      mapView?.getMapboxMap()?.getStyle { style ->
        style.getSourceAs<GeoJsonSource>("mission-progress-route-source")?.data(progressJson)
      }
    }
    val marker = pointAtDistance(markerDist)
    val markerJson = FeatureCollection.fromFeature(
      Feature.fromGeometry(Point.fromLngLat(marker.lng, marker.lat)),
    ).toJson()
    mapView?.getMapboxMap()?.getStyle { style ->
      style.getSourceAs<GeoJsonSource>("mission-marker-source")?.data(markerJson)
    }
    emit("onMissionDebug", mapOf("kind" to "overlay", "details" to mapOf("scene_id" to scene.id)))
  }

  private fun setCamera(
    center: MissionPoint,
    zoom: Double,
    pitch: Double,
    bearing: Double?,
    animated: Boolean,
    durationMs: Long = 50,
  ) {
    val map = mapView ?: return
    val options = CameraOptions.Builder()
      .center(Point.fromLngLat(center.lng, center.lat))
      .zoom(zoom.coerceIn(minZoom, maxZoom))
      .pitch(pitch)
      .apply { if (bearing != null) bearing(bearing) }
      .build()
    if (animated) {
      val animationOptions = MapAnimationOptions.Builder().duration(durationMs).build()
      map.getMapboxMap().easeTo(options, animationOptions)
    } else {
      map.getMapboxMap().setCamera(options)
    }
    lastCamPoint = center
    if (bearing != null) lastCamBearing = bearing
  }

  private fun cumulativeDistances(route: List<Pair<Double, Double>>): DoubleArray {
    val cum = DoubleArray(route.size)
    for (i in 1 until route.size) {
      cum[i] = cum[i - 1] + haversine(route[i - 1], route[i])
    }
    return cum
  }

  private fun haversine(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
    val r = 6371000.0
    val dLat = Math.toRadians(b.second - a.second)
    val dLng = Math.toRadians(b.first - a.first)
    val lat1 = Math.toRadians(a.second)
    val lat2 = Math.toRadians(b.second)
    val h = sin(dLat / 2).pow(2) + cos(lat1) * cos(lat2) * sin(dLng / 2).pow(2)
    return 2 * r * asin(min(1.0, sqrt(h)))
  }

  private fun pointAtDistance(dist: Double): MissionPoint {
    if (route.size < 2 || routeTotal <= 0) {
      return MissionPoint(route.firstOrNull()?.second ?: 0.0, route.firstOrNull()?.first ?: 0.0)
    }
    val d = dist.coerceIn(0.0, routeTotal)
    var i = 1
    while (i < routeCum.size && routeCum[i] < d) i++
    val i0 = max(0, i - 1)
    val i1 = min(route.size - 1, i)
    val seg = routeCum[i1] - routeCum[i0]
    val f = if (seg > 0) (d - routeCum[i0]) / seg else 0.0
    val a = route[i0]
    val b = route[i1]
    return MissionPoint(a.second + (b.second - a.second) * f, a.first + (b.first - a.first) * f)
  }

  private fun bearing(from: MissionPoint, to: MissionPoint): Double {
    val lat1 = Math.toRadians(from.lat)
    val lat2 = Math.toRadians(to.lat)
    val dLng = Math.toRadians(to.lng - from.lng)
    val y = sin(dLng) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
    return Math.toDegrees(atan2(y, x))
  }

  private fun smoothAngle(prev: Double?, target: Double, factor: Double): Double {
    if (prev == null) return target
    val diff = ((target - prev + 540) % 360) - 180
    return prev + diff * factor
  }

  private fun sliceRoute(start: Double, end: Double): List<Pair<Double, Double>> {
    if (route.size < 2) return route
    val s = start.coerceIn(0.0, 1.0)
    val e = end.coerceIn(s, 1.0)
    val si = floor(s * (route.size - 1)).toInt()
    val ei = max(si + 1, ceil(e * (route.size - 1)).toInt())
    return route.subList(si, min(route.size - 1, ei) + 1)
  }

  private fun progressRoute(ratio: Double): List<Pair<Double, Double>> {
    if (route.size < 2) return route
    val r = ratio.coerceIn(0.0, 1.0)
    val endIdx = max(1, ceil(r * (route.size - 1)).toInt())
    return route.subList(0, min(route.size - 1, endIdx) + 1)
  }

  private fun downsample(coords: List<Pair<Double, Double>>, max: Int): List<Pair<Double, Double>> {
    if (coords.size <= max) return coords
    val step = ceil(coords.size.toDouble() / max).toInt()
    val out = mutableListOf<Pair<Double, Double>>()
    var i = 0
    while (i < coords.size) {
      out.add(coords[i])
      i += step
    }
    if (out.last() != coords.last()) out.add(coords.last())
    return out
  }

  private fun boundsFromCoords(coords: List<Pair<Double, Double>>): Pair<MissionPoint, Double>? {
    if (coords.isEmpty()) return null
    val lats = coords.map { it.second }
    val lngs = coords.map { it.first }
    return MissionPoint((lats.max() + lats.min()) / 2, (lngs.max() + lngs.min()) / 2) to
      max(lats.max() - lats.min(), lngs.max() - lngs.min())
  }

  private fun lookaheadForSlice(start: Double, end: Double): Double {
    return max(180.0, min(lookaheadM, (end - start) * 0.05))
  }

  private fun zoomForSliceLengthKm(km: Double, requested: Double?): Double {
    val base = when {
      km > 140 -> 11.4
      km > 70 -> 12.2
      km > 35 -> 12.9
      km > 15 -> 13.4
      else -> 14.0
    }
    val zoom = requested ?: base
    return max(12.8, min(zoom, maxZoom))
  }

  private fun clampPitch(pitch: Double?): Double = max(58.0, min(68.0, pitch ?: cameraPitch))

  private fun doubleValue(value: Any?): Double? = when (value) {
    is Double -> value
    is Float -> value.toDouble()
    is Int -> value.toDouble()
    is Long -> value.toDouble()
    is String -> value.toDoubleOrNull()
    else -> null
  }
}
