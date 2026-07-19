package com.trailhead.app.car

import android.app.Presentation
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import android.view.ViewGroup
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Feature
import com.mapbox.geojson.FeatureCollection
import com.mapbox.geojson.LineString
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapLoadingErrorType
import com.mapbox.maps.MapView
import com.mapbox.maps.Style
import com.mapbox.maps.extension.style.layers.addLayer
import com.mapbox.maps.extension.style.layers.generated.CircleLayer
import com.mapbox.maps.extension.style.layers.generated.LineLayer
import com.mapbox.maps.extension.style.layers.getLayer
import com.mapbox.maps.extension.style.layers.properties.generated.LineCap
import com.mapbox.maps.extension.style.layers.properties.generated.LineJoin
import com.mapbox.maps.extension.style.sources.addSource
import com.mapbox.maps.extension.style.sources.generated.GeoJsonSource
import com.mapbox.maps.extension.style.sources.getSource
import com.mapbox.maps.plugin.animation.MapAnimationOptions
import com.mapbox.maps.plugin.animation.easeTo
import java.util.Collections
import java.util.IdentityHashMap
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

class TrailheadCarMapSurface(
  private val carContext: CarContext,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var snapshot: TrailheadCarSnapshot = TrailheadCarSnapshot(
    state = TrailheadCarSnapshotState.NO_TRIP,
    tripName = "",
    tripSummary = "",
    rigSummary = "",
    stops = emptyList(),
  )
  private var progress: TrailheadCarProgress? = null
  private var surface: Surface? = null
  private var surfaceWidth = 0
  private var surfaceHeight = 0
  private var surfaceDpi = 160
  private var visibleArea: Rect? = null
  private var stableArea: Rect? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var presentation: Presentation? = null
  private var mapView: MapView? = null
  private var mapLifecycleOwner: CarMapLifecycleOwner? = null
  private var cancelStyleErrorSubscription: (() -> Unit)? = null
  private var styleLoaded = false
  private var followLocation = true
  private var fallbackActive = false
  private var fallbackScale = 1.0
  private var fallbackPanX = 0f
  private var fallbackPanY = 0f
  private var surfaceGeneration = 0L
  @Volatile private var released = false
  private var pendingMapboxAttach: Runnable? = null
  @Volatile private var latestSurfaceCandidate: Surface? = null
  private val releasedSurfaces = Collections.newSetFromMap(IdentityHashMap<Surface, Boolean>())

  val callback = object : SurfaceCallback {
    override fun onSurfaceAvailable(surfaceContainer: SurfaceContainer) {
      val nextSurface = surfaceContainer.surface ?: return
      if (released) {
        mainHandler.post { releaseSurfaceInstance(nextSurface) }
        return
      }
      val nextWidth = surfaceContainer.width.coerceAtLeast(1)
      val nextHeight = surfaceContainer.height.coerceAtLeast(1)
      val nextDpi = surfaceContainer.dpi.coerceAtLeast(1)
      visibleArea = null
      stableArea = null
      latestSurfaceCandidate = nextSurface
      val generation = ++surfaceGeneration
      mainHandler.post {
        if (released || generation != surfaceGeneration) {
          if (nextSurface !== latestSurfaceCandidate && nextSurface !== surface) {
            releaseSurfaceInstance(nextSurface)
          }
          return@post
        }
        attachSurface(nextSurface, nextWidth, nextHeight, nextDpi, generation)
      }
    }

    override fun onVisibleAreaChanged(visibleArea: Rect) {
      this@TrailheadCarMapSurface.visibleArea = Rect(visibleArea)
      refreshCameraForInsets()
    }

    override fun onStableAreaChanged(stableArea: Rect) {
      this@TrailheadCarMapSurface.stableArea = Rect(stableArea)
      refreshCameraForInsets()
    }

    override fun onSurfaceDestroyed(surfaceContainer: SurfaceContainer) {
      val destroyedSurface = surfaceContainer.surface
      surfaceGeneration += 1L
      val candidateSurface = latestSurfaceCandidate
      latestSurfaceCandidate = null
      val currentSurface = surface
      releaseSurface()
      if (candidateSurface !== currentSurface) candidateSurface?.let(::releaseSurfaceInstance)
      if (destroyedSurface !== currentSurface && destroyedSurface !== candidateSurface) {
        destroyedSurface?.let(::releaseSurfaceInstance)
      }
    }

    override fun onScroll(distanceX: Float, distanceY: Float) {
      followLocation = false
      if (mapView == null) {
        fallbackPanX -= distanceX
        fallbackPanY -= distanceY
        renderFallback()
      } else {
        panMap(distanceX, distanceY)
      }
    }

    override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
      followLocation = false
      scaleMap(scaleFactor.toDouble())
    }
  }

  init {
    try {
      carContext.getCarService(AppManager::class.java).setSurfaceCallback(callback)
    } catch (error: RuntimeException) {
      Log.e(TAG, "Unable to register the car map surface", error)
    }
  }

  fun setSnapshot(next: TrailheadCarSnapshot) {
    if (snapshot.route?.routeId != next.route?.routeId) resetFallbackViewport()
    snapshot = next
    mainHandler.post {
      if (mapView == null && surface != null && pendingMapboxAttach == null) {
        scheduleMapboxAttach(surfaceGeneration)
      }
      renderRoute()
      renderProgress()
      if (progress == null) frameRoute()
      renderFallback()
    }
  }

  fun setProgress(next: TrailheadCarProgress?) {
    progress = next
    mainHandler.post {
      renderProgress()
      if (next != null && followLocation) follow(next)
      renderFallback()
    }
  }

  fun recenter() {
    followLocation = true
    resetFallbackViewport()
    mainHandler.post {
      progress?.let(::follow) ?: frameRoute()
      renderFallback()
    }
  }

  fun zoomBy(factor: Double) {
    followLocation = false
    mainHandler.post { scaleMap(factor) }
  }

  fun onCarConfigurationChanged() {
    mainHandler.post {
      mapView?.let(::loadMapStyle) ?: renderFallback()
    }
  }

  fun release() {
    released = true
    surfaceGeneration += 1L
    val pendingSurface = latestSurfaceCandidate
    latestSurfaceCandidate = null
    pendingMapboxAttach?.let(mainHandler::removeCallbacks)
    pendingMapboxAttach = null
    val cleanup = Runnable {
      val currentSurface = surface
      releaseSurface()
      if (pendingSurface !== currentSurface) pendingSurface?.let(::releaseSurfaceInstance)
    }
    if (Looper.myLooper() == Looper.getMainLooper()) cleanup.run() else mainHandler.post(cleanup)
  }

  private fun attachSurface(
    nextSurface: Surface,
    nextWidth: Int,
    nextHeight: Int,
    nextDpi: Int,
    generation: Long,
  ) {
    if (surface === nextSurface) {
      val sizeChanged = surfaceWidth != nextWidth || surfaceHeight != nextHeight || surfaceDpi != nextDpi
      surfaceWidth = nextWidth
      surfaceHeight = nextHeight
      surfaceDpi = nextDpi
      if (
        sizeChanged && virtualDisplay?.let { display ->
          runCatching { display.resize(nextWidth, nextHeight, nextDpi) }.isFailure
        } == true
      ) {
        releaseMapbox()
        fallbackActive = true
        renderFallback()
        scheduleMapboxAttach(generation)
        return
      }
      if (mapView == null) scheduleMapboxAttach(generation)
      refreshCameraForInsets()
      return
    }
    releaseSurface()
    surface = nextSurface
    surfaceWidth = nextWidth
    surfaceHeight = nextHeight
    surfaceDpi = nextDpi
    fallbackActive = true
    renderFallback()
    scheduleMapboxAttach(generation)
  }

  private fun scheduleMapboxAttach(generation: Long) {
    pendingMapboxAttach?.let(mainHandler::removeCallbacks)
    val task = Runnable {
      pendingMapboxAttach = null
      if (released || generation != surfaceGeneration || surface == null) return@Runnable
      attachMapboxOrFallback()
    }
    pendingMapboxAttach = task
    mainHandler.postDelayed(task, MAPBOX_ATTACH_DELAY_MS)
  }

  private fun attachMapboxOrFallback() {
    val token = snapshot.mapboxAccessToken
    if (surface == null || token.isBlank()) {
      fallbackActive = true
      renderFallback()
      return
    }
    try {
      if (!MapView.isRenderingSupported()) {
        fallbackActive = true
        renderFallback()
        return
      }
      MapboxOptions.accessToken = token
      val displayManager = carContext.getSystemService(DisplayManager::class.java)
      val nextVirtualDisplay = displayManager.createVirtualDisplay(
        "TrailheadCarMap",
        surfaceWidth.coerceAtLeast(1),
        surfaceHeight.coerceAtLeast(1),
        surfaceDpi,
        surface,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY,
      )
      virtualDisplay = nextVirtualDisplay
      val display = nextVirtualDisplay?.display ?: error("Car display unavailable")
      val nextPresentation = Presentation(carContext, display)
      presentation = nextPresentation
      val nextMap = MapView(nextPresentation.context).apply {
        layoutParams = ViewGroup.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        )
        setMaximumFps(30)
      }
      val nextLifecycleOwner = CarMapLifecycleOwner().apply { create() }
      nextMap.setViewTreeLifecycleOwner(nextLifecycleOwner)
      mapLifecycleOwner = nextLifecycleOwner
      mapView = nextMap
      nextPresentation.setContentView(nextMap)
      nextPresentation.show()
      nextLifecycleOwner.startAndResume()
      fallbackActive = false
      loadMapStyle(nextMap)
    } catch (error: Throwable) {
      if (error is ThreadDeath || error is VirtualMachineError) throw error
      Log.e(TAG, "Mapbox car renderer unavailable; using the route fallback", error)
      activateFallback()
    }
  }

  private fun releaseSurface() {
    pendingMapboxAttach?.let(mainHandler::removeCallbacks)
    pendingMapboxAttach = null
    releaseMapbox()
    val currentSurface = surface
    currentSurface?.let(::releaseSurfaceInstance)
    if (latestSurfaceCandidate === currentSurface) latestSurfaceCandidate = null
    surface = null
    surfaceWidth = 0
    surfaceHeight = 0
    surfaceDpi = 160
    fallbackActive = false
  }

  @Synchronized
  private fun releaseSurfaceInstance(target: Surface) {
    if (releasedSurfaces.add(target)) runCatching { target.release() }
  }

  private fun releaseMapbox() {
    clearStyleErrorSubscription()
    styleLoaded = false
    val currentMap = mapView
    mapView = null
    val currentLifecycleOwner = mapLifecycleOwner
    mapLifecycleOwner = null
    runCatching { currentLifecycleOwner?.stopAndDestroy() }
    currentMap?.setViewTreeLifecycleOwner(null)
    val currentPresentation = presentation
    presentation = null
    runCatching { currentPresentation?.dismiss() }
    val currentDisplay = virtualDisplay
    virtualDisplay = null
    runCatching { currentDisplay?.release() }
  }

  private fun styleUri(): String = if (carContext.isDarkMode) Style.DARK else Style.OUTDOORS

  private fun loadMapStyle(target: MapView) {
    clearStyleErrorSubscription()
    styleLoaded = false
    val errorSubscription = target.mapboxMap.subscribeMapLoadingError { error ->
      if (error.type == MapLoadingErrorType.STYLE && mapView === target && !styleLoaded) {
        mainHandler.post {
          if (mapView === target && !styleLoaded) {
            clearStyleErrorSubscription()
            activateFallback()
          }
        }
      }
    }
    cancelStyleErrorSubscription = { errorSubscription.cancel() }
    target.mapboxMap.loadStyle(
      styleUri(),
      object : Style.OnStyleLoaded {
        override fun onStyleLoaded(style: Style) {
          if (mapView === target) {
            try {
              clearStyleErrorSubscription()
              styleLoaded = true
              installLayers(style)
              renderRoute()
              renderProgress()
              if (progress == null) frameRoute() else progress?.let(::follow)
            } catch (error: Throwable) {
              if (error is ThreadDeath || error is VirtualMachineError) throw error
              Log.e(TAG, "Mapbox car style unavailable; using the route fallback", error)
              mainHandler.post {
                if (mapView === target) activateFallback()
              }
            }
          }
        }
      },
    )
  }

  private fun clearStyleErrorSubscription() {
    val cancel = cancelStyleErrorSubscription
    cancelStyleErrorSubscription = null
    runCatching { cancel?.invoke() }
  }

  private fun activateFallback() {
    releaseMapbox()
    fallbackActive = true
    renderFallback()
  }

  private fun installLayers(style: Style) {
    addSource(style, ROUTE_SOURCE)
    addSource(style, PROGRESS_SOURCE)
    addSource(style, LOCATION_SOURCE)
    if (style.getLayer(ROUTE_CASING_LAYER) == null) {
      style.addLayer(
        LineLayer(ROUTE_CASING_LAYER, ROUTE_SOURCE)
          .lineColor(if (carContext.isDarkMode) "#071018" else "#ffffff")
          .lineWidth(10.0)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (style.getLayer(ROUTE_LAYER) == null) {
      style.addLayer(
        LineLayer(ROUTE_LAYER, ROUTE_SOURCE)
          .lineColor(if (snapshot.route?.isTrailFollow == true) "#d97706" else "#b4532a")
          .lineWidth(6.5)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (style.getLayer(PROGRESS_LAYER) == null) {
      style.addLayer(
        LineLayer(PROGRESS_LAYER, PROGRESS_SOURCE)
          .lineColor("#167d66")
          .lineWidth(7.0)
          .lineCap(LineCap.ROUND)
          .lineJoin(LineJoin.ROUND),
      )
    }
    if (style.getLayer(LOCATION_LAYER) == null) {
      style.addLayer(
        CircleLayer(LOCATION_LAYER, LOCATION_SOURCE)
          .circleRadius(8.0)
          .circleColor("#0f766e")
          .circleStrokeColor("#ffffff")
          .circleStrokeWidth(3.0),
      )
    }
  }

  private fun addSource(style: Style, id: String) {
    if (style.getSource(id) == null) style.addSource(GeoJsonSource.Builder(id).build())
  }

  private fun renderRoute() {
    if (!styleLoaded) return
    val points = snapshot.route?.points.orEmpty()
    if (points.size < 2) {
      clearSource(ROUTE_SOURCE)
      clearSource(PROGRESS_SOURCE)
      clearSource(LOCATION_SOURCE)
      return
    }
    mapView?.mapboxMap?.getStyle { style ->
      (style.getLayer(ROUTE_LAYER) as? LineLayer)
        ?.lineColor(if (snapshot.route?.isTrailFollow == true) "#d97706" else "#b4532a")
    }
    setLine(ROUTE_SOURCE, points)
  }

  private fun renderProgress() {
    if (!styleLoaded) return
    val current = progress
    val route = snapshot.route
    if (current == null || route == null) {
      clearSource(PROGRESS_SOURCE)
      clearSource(LOCATION_SOURCE)
      return
    }
    val endExclusive = (current.segmentIndex + 1).coerceIn(1, route.points.size)
    val traveled = route.points.subList(0, endExclusive).toMutableList().apply {
      if (lastOrNull() != current.routePoint) add(current.routePoint)
    }
    setLine(PROGRESS_SOURCE, traveled)
    val locationJson = FeatureCollection.fromFeature(
      Feature.fromGeometry(Point.fromLngLat(current.location.lng, current.location.lat)),
    ).toJson()
    setFeatures(LOCATION_SOURCE, locationJson)
  }

  private fun setLine(sourceId: String, points: List<TrailheadCarPoint>) {
    val sampled = downsample(points, 1_500)
    val line = LineString.fromLngLats(sampled.map { Point.fromLngLat(it.lng, it.lat) })
    setFeatures(sourceId, FeatureCollection.fromFeature(Feature.fromGeometry(line)).toJson())
  }

  private fun setFeatures(sourceId: String, json: String) {
    mapView?.mapboxMap?.getStyle { style ->
      (style.getSource(sourceId) as? GeoJsonSource)?.data(json)
    }
  }

  private fun clearSource(sourceId: String) {
    setFeatures(sourceId, FeatureCollection.fromFeatures(emptyList()).toJson())
  }

  private fun frameRoute() {
    val points = snapshot.route?.points.orEmpty()
    if (points.isEmpty()) return
    val minLat = points.minOf { it.lat }
    val maxLat = points.maxOf { it.lat }
    val minLng = points.minOf { it.lng }
    val maxLng = points.maxOf { it.lng }
    val center = TrailheadCarPoint((minLat + maxLat) / 2.0, (minLng + maxLng) / 2.0)
    val span = max(maxLat - minLat, (maxLng - minLng) * cos(Math.toRadians(center.lat))).coerceAtLeast(0.0002)
    val zoom = (ln(300.0 / span) / ln(2.0)).coerceIn(3.5, 15.5)
    setCamera(center, zoom, 0.0, null, 500L)
  }

  private fun follow(current: TrailheadCarProgress) {
    val route = snapshot.route ?: return
    val next = route.points.getOrNull((current.segmentIndex + 8).coerceAtMost(route.points.lastIndex))
      ?: current.routePoint
    val bearing = bearing(current.routePoint, next)
    setCamera(current.location, if (route.isTrailFollow) 15.2 else 14.8, 52.0, bearing, 450L)
  }

  private fun setCamera(
    center: TrailheadCarPoint,
    zoom: Double,
    pitch: Double,
    bearing: Double?,
    durationMs: Long,
  ) {
    val map = mapView?.mapboxMap ?: return
    val options = CameraOptions.Builder()
      .center(Point.fromLngLat(center.lng, center.lat))
      .zoom(zoom)
      .pitch(pitch)
      .padding(cameraPadding())
      .apply { if (bearing != null) bearing(bearing) }
      .build()
    val animation = MapAnimationOptions.Builder().duration(durationMs).build()
    map.easeTo(options, animation)
  }

  private fun panMap(distanceX: Float, distanceY: Float) {
    val map = mapView?.mapboxMap ?: return
    val state = map.cameraState
    val scale = 360.0 / (256.0 * 2.0.pow(state.zoom))
    val center = state.center
    setCamera(
      TrailheadCarPoint(
        lat = (center.latitude() + distanceY * scale).coerceIn(-85.0, 85.0),
        lng = center.longitude() + distanceX * scale,
      ),
      state.zoom,
      state.pitch,
      state.bearing,
      0L,
    )
  }

  private fun scaleMap(factor: Double) {
    val map = mapView?.mapboxMap
    if (map == null) {
      fallbackScale = (fallbackScale * factor).coerceIn(0.65, 5.0)
      renderFallback()
      return
    }
    val state = map.cameraState
    val delta = ln(factor.coerceIn(0.5, 2.0)) / ln(2.0)
    setCamera(
      TrailheadCarPoint(state.center.latitude(), state.center.longitude()),
      (state.zoom + delta).coerceIn(3.0, 18.0),
      state.pitch,
      state.bearing,
      180L,
    )
  }

  private fun refreshCameraForInsets() {
    val current = progress
    if (current != null && followLocation) follow(current) else if (current == null) frameRoute()
    renderFallback()
  }

  private fun cameraPadding(): EdgeInsets {
    val area = contentArea()
      ?: return EdgeInsets(0.0, 0.0, 0.0, 0.0)
    val left = area.left.coerceIn(0, surfaceWidth)
    val top = area.top.coerceIn(0, surfaceHeight)
    val right = area.right.coerceIn(left, surfaceWidth)
    val bottom = area.bottom.coerceIn(top, surfaceHeight)
    return EdgeInsets(
      top.toDouble(),
      left.toDouble(),
      (surfaceHeight - bottom).toDouble(),
      (surfaceWidth - right).toDouble(),
    )
  }

  private fun contentArea(): Rect? {
    return stableArea?.takeUnless(Rect::isEmpty) ?: visibleArea?.takeUnless(Rect::isEmpty)
  }

  private fun renderFallback() {
    if (!fallbackActive) return
    val target = surface ?: return
    if (!target.isValid) return
    val canvas = runCatching { target.lockCanvas(null) }.getOrNull() ?: return
    try {
      drawFallback(canvas)
    } finally {
      runCatching { target.unlockCanvasAndPost(canvas) }
    }
  }

  private fun drawFallback(canvas: Canvas) {
    val dark = carContext.isDarkMode
    canvas.drawColor(if (dark) Color.rgb(17, 24, 27) else Color.rgb(239, 241, 236))
    val route = snapshot.route?.points.orEmpty()
    if (route.size < 2) return
    val area = contentArea() ?: Rect(0, 0, canvas.width, canvas.height)
    val left = area.left.coerceIn(0, canvas.width)
    val top = area.top.coerceIn(0, canvas.height)
    val right = area.right.coerceIn(left, canvas.width)
    val bottom = area.bottom.coerceIn(top, canvas.height)
    val inset = RectF(left.toFloat(), top.toFloat(), right.toFloat(), bottom.toFloat())
    val horizontalInset = min(42f, (inset.width() / 4f).coerceAtLeast(0f))
    val verticalInset = min(42f, (inset.height() / 4f).coerceAtLeast(0f))
    inset.inset(horizontalInset, verticalInset)
    val minLat = route.minOf { it.lat }
    val maxLat = route.maxOf { it.lat }
    val minLng = route.minOf { it.lng }
    val maxLng = route.maxOf { it.lng }
    val latSpan = (maxLat - minLat).coerceAtLeast(0.0001)
    val lngSpan = (maxLng - minLng).coerceAtLeast(0.0001)
    val centerX = inset.centerX()
    val centerY = inset.centerY()
    fun x(point: TrailheadCarPoint): Float {
      val fitted = inset.left + ((point.lng - minLng) / lngSpan * inset.width()).toFloat()
      return centerX + (fitted - centerX) * fallbackScale.toFloat() + fallbackPanX
    }
    fun y(point: TrailheadCarPoint): Float {
      val fitted = inset.bottom - ((point.lat - minLat) / latSpan * inset.height()).toFloat()
      return centerY + (fitted - centerY) * fallbackScale.toFloat() + fallbackPanY
    }
    val sampled = downsample(route, 700)
    val casing = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = if (dark) Color.rgb(5, 12, 15) else Color.WHITE
      style = Paint.Style.STROKE
      strokeWidth = 11f
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    val line = Paint(casing).apply {
      color = if (snapshot.route?.isTrailFollow == true) Color.rgb(217, 119, 6) else Color.rgb(180, 83, 42)
      strokeWidth = 6f
    }
    for (index in 1 until sampled.size) {
      canvas.drawLine(x(sampled[index - 1]), y(sampled[index - 1]), x(sampled[index]), y(sampled[index]), casing)
      canvas.drawLine(x(sampled[index - 1]), y(sampled[index - 1]), x(sampled[index]), y(sampled[index]), line)
    }
    progress?.let { current ->
      val marker = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(15, 118, 110) }
      canvas.drawCircle(x(current.location), y(current.location), 11f, marker)
      marker.style = Paint.Style.STROKE
      marker.strokeWidth = 4f
      marker.color = Color.WHITE
      canvas.drawCircle(x(current.location), y(current.location), 11f, marker)
    }
  }

  private fun downsample(points: List<TrailheadCarPoint>, limit: Int): List<TrailheadCarPoint> {
    if (points.size <= limit) return points
    val step = ceil(points.size.toDouble() / limit).toInt().coerceAtLeast(1)
    val sampled = points.filterIndexed { index, _ -> index % step == 0 }.toMutableList()
    if (sampled.lastOrNull() != points.last()) sampled += points.last()
    return sampled
  }

  private fun resetFallbackViewport() {
    fallbackScale = 1.0
    fallbackPanX = 0f
    fallbackPanY = 0f
  }

  private fun bearing(a: TrailheadCarPoint, b: TrailheadCarPoint): Double {
    val lat1 = Math.toRadians(a.lat)
    val lat2 = Math.toRadians(b.lat)
    val dLng = Math.toRadians(b.lng - a.lng)
    val y = kotlin.math.sin(dLng) * kotlin.math.cos(lat2)
    val x = kotlin.math.cos(lat1) * kotlin.math.sin(lat2) -
      kotlin.math.sin(lat1) * kotlin.math.cos(lat2) * kotlin.math.cos(dLng)
    return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0
  }

  private companion object {
    const val TAG = "TrailheadCarMap"
    const val MAPBOX_ATTACH_DELAY_MS = 350L
    const val ROUTE_SOURCE = "trailhead-car-route-source"
    const val PROGRESS_SOURCE = "trailhead-car-progress-source"
    const val LOCATION_SOURCE = "trailhead-car-location-source"
    const val ROUTE_CASING_LAYER = "trailhead-car-route-casing"
    const val ROUTE_LAYER = "trailhead-car-route-line"
    const val PROGRESS_LAYER = "trailhead-car-progress-line"
    const val LOCATION_LAYER = "trailhead-car-location"
  }

  private class CarMapLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)

    override val lifecycle: Lifecycle
      get() = registry

    fun create() {
      registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
    }

    fun startAndResume() {
      registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
      registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
    }

    fun stopAndDestroy() {
      if (registry.currentState == Lifecycle.State.RESUMED) {
        registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
      }
      if (registry.currentState.isAtLeast(Lifecycle.State.STARTED)) {
        registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
      }
      if (registry.currentState != Lifecycle.State.DESTROYED) {
        registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
      }
    }
  }
}
