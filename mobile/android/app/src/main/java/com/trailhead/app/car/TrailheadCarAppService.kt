package com.trailhead.app.car

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.location.Location
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.car.app.CarAppService
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.ScreenManager
import androidx.car.app.Session
import androidx.car.app.SessionInfo
import androidx.car.app.model.Distance
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Trip
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.trailhead.app.BuildConfig
import expo.modules.trailheadcarreports.CarReportEnqueueStatus
import expo.modules.trailheadcarreports.CarReportManager
import java.io.File
import java.util.Locale

class TrailheadCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator {
    return if (BuildConfig.DEBUG) {
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      HostValidator.Builder(applicationContext)
        .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
        .build()
    }
  }

  override fun onCreateSession(sessionInfo: SessionInfo): Session = TrailheadCarSession()
}

internal class TrailheadCarSession : Session(), TrailheadCarSessionController {
  private val mainHandler = Handler(Looper.getMainLooper())
  private lateinit var navigationManager: NavigationManager
  private lateinit var guidanceScreen: TrailheadCarGuidanceScreen
  private var navigationState: TrailheadCarNavigationState? = null
  private var arrivalPresentedFor: Int? = null
  private var autoDriveEnabled = false
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var activeSpeechId: String? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var lastSpokenStep = -1
  private var lastSpokenCloseStep = -1
  private var lastNotificationTitle = ""
  private var lastNotificationText = ""
  private var snapshotObserver: FileObserver? = null
  private var snapshotRemovalObserved = false
  private var routeReplacementRequestedUntilElapsedMs = 0L
  private var destroyed = false
  private val locationListener: (Location) -> Unit = { location ->
    mainHandler.post { if (!destroyed) handleLocation(location) }
  }
  private val snapshotReload = Runnable { if (!destroyed) reloadSnapshotFromDisk() }
  private val optionalSessionSetup = Runnable {
    if (destroyed || !::mapSurface.isInitialized) return@Runnable
    runOptionalSetup("report queue") { CarReportManager.scheduleFlush(carContext) }
    runOptionalSetup("trip updates") { startSnapshotObserver() }
    runOptionalSetup("voice guidance") { initializeSpeech() }
  }
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      mainHandler.post {
        if (destroyed) return@post
        activeSpeechId = null
        tts?.stop()
        abandonSpeechAudioFocus()
      }
    }
  }

  override lateinit var snapshot: TrailheadCarSnapshot
    private set
  override var progress: TrailheadCarProgress? = null
    private set
  override var navigating: Boolean = false
    private set
  override var muted: Boolean = false
    private set
  override lateinit var mapSurface: TrailheadCarMapSurface
    private set

  private val navigationCallback = object : NavigationManagerCallback {
    override fun onStopNavigation() {
      mainHandler.post {
        if (destroyed) return@post
        endGuidanceAndReturnHome()
      }
    }

    override fun onAutoDriveEnabled() {
      mainHandler.post {
        if (destroyed) return@post
        autoDriveEnabled = true
        if (!navigating) startGuidance()
        mainHandler.removeCallbacks(autoDriveStep)
        mainHandler.post(autoDriveStep)
      }
    }
  }

  private val autoDriveStep = object : Runnable {
    override fun run() {
      if (!autoDriveEnabled || !navigating) return
      val next = navigationState?.simulateNext() ?: return
      applyProgress(next)
      if (!next.finalArrival && next.arrivedStopIndex == null) mainHandler.postDelayed(this, 900L)
    }
  }

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        destroyed = true
        snapshotObserver?.stopWatching()
        snapshotObserver = null
        TrailheadCarLocationService.removeListener(locationListener)
        if (shouldStopCarLocationServiceOnSessionDestroy(navigating)) {
          runCatching { TrailheadCarLocationService.stop(carContext) }
        }
        if (::navigationManager.isInitialized) {
          if (navigating) runCatching { navigationManager.navigationEnded() }
          runCatching { navigationManager.clearNavigationManagerCallback() }
        }
        if (::mapSurface.isInitialized) mapSurface.release()
        navigating = false
        autoDriveEnabled = false
        mainHandler.removeCallbacks(autoDriveStep)
        mainHandler.removeCallbacks(snapshotReload)
        mainHandler.removeCallbacks(optionalSessionSetup)
        activeSpeechId = null
        tts?.stop()
        runCatching { abandonSpeechAudioFocus() }
        tts?.shutdown()
        tts = null
      }
    })
  }

  override fun onCreateScreen(intent: Intent): Screen {
    destroyed = false
    snapshot = TrailheadCarRepository.load(carContext)
    mapSurface = TrailheadCarMapSurface(carContext)
    mapSurface.setSnapshot(snapshot)
    guidanceScreen = newGuidanceScreen()
    navigationManager = carContext.getCarService(NavigationManager::class.java)
    navigationManager.setNavigationManagerCallback(navigationCallback)
    TrailheadCarLocationService.addListener(locationListener)
    mainHandler.removeCallbacks(optionalSessionSetup)
    mainHandler.post(optionalSessionSetup)
    val navigationRequest = TrailheadCarNavigationIntent.parse(intent)
    setRouteReplacementRequest(navigationRequest)

    val route = snapshot.route
    if (TrailheadCarLocationService.active && route != null) {
      navigationState = TrailheadCarNavigationState(snapshot)
      navigating = true
      navigationManager.navigationStarted()
      TrailheadCarLocationService.freshNavigationLocation(MAX_NAVIGATION_LOCATION_AGE_MS)?.let(::handleLocation)
      return guidanceScreen
    }
    if (navigationRequest != null) {
      return TrailheadCarNavigationRequestScreen(carContext, this, navigationRequest)
    }
    return TrailheadCarHomeScreen(carContext, this)
  }

  override fun onNewIntent(intent: Intent) {
    val navigationRequest = TrailheadCarNavigationIntent.parse(intent)
    if (navigationRequest != null) {
      setRouteReplacementRequest(navigationRequest)
    }
    reloadSnapshotFromDisk()
    if (navigationRequest != null) {
      if (navigating) {
        val message = if (navigationRequest.mode == TrailheadCarNavigationMode.ADD_A_STOP) {
          "Add ${navigationRequest.label.take(60)} on your phone when parked"
        } else {
          "Finish the new route on your phone when parked"
        }
        CarToast.makeText(carContext, message, CarToast.LENGTH_LONG).show()
        val manager = carContext.getCarService(ScreenManager::class.java)
        showGuidanceScreen(manager)
        return
      }
      val manager = carContext.getCarService(ScreenManager::class.java)
      manager.popToRoot()
      manager.push(TrailheadCarNavigationRequestScreen(carContext, this, navigationRequest))
      return
    }
    val manager = carContext.getCarService(ScreenManager::class.java)
    if (navigating) {
      showGuidanceScreen(manager)
    } else {
      manager.popToRoot()
    }
  }

  override fun onCarConfigurationChanged(newConfiguration: Configuration) {
    if (::mapSurface.isInitialized) mapSurface.onCarConfigurationChanged()
    invalidateGuidanceScreen()
  }

  override fun startGuidance() {
    if (navigating) {
      val manager = carContext.getCarService(ScreenManager::class.java)
      showGuidanceScreen(manager)
      return
    }
    if (!hasGuidancePermissions()) {
      CarToast.makeText(carContext, "Allow location and notifications on your phone when parked.", CarToast.LENGTH_LONG).show()
      carContext.getCarService(ScreenManager::class.java).push(TrailheadCarHomeScreen(carContext, this))
      return
    }
    snapshot = TrailheadCarRepository.load(carContext)
    if (snapshot.route == null) {
      CarToast.makeText(carContext, "Open a route on your phone first.", CarToast.LENGTH_SHORT).show()
      return
    }
    navigationState = TrailheadCarNavigationState(snapshot)
    progress = null
    arrivalPresentedFor = null
    lastSpokenStep = -1
    lastSpokenCloseStep = -1
    navigating = true
    navigationManager.navigationStarted()
    runCatching { TrailheadCarLocationService.start(carContext) }
      .onFailure {
        navigating = false
        navigationManager.navigationEnded()
        CarToast.makeText(carContext, "Allow location and notifications on your phone when parked.", CarToast.LENGTH_LONG).show()
        return
    }
    mapSurface.setSnapshot(snapshot)
    mapSurface.setProgress(null)
    guidanceScreen = newGuidanceScreen()
    carContext.getCarService(ScreenManager::class.java).push(guidanceScreen)
    TrailheadCarLocationService.freshNavigationLocation(MAX_NAVIGATION_LOCATION_AGE_MS)?.let(::handleLocation)
  }

  override fun endGuidanceAndReturnHome() = endGuidanceAndReturnHome(refreshSnapshot = true)

  private fun endGuidanceAndReturnHome(refreshSnapshot: Boolean) {
    endGuidance(refreshSnapshot)
    val manager = carContext.getCarService(ScreenManager::class.java)
    manager.popToRoot()
    if (shouldReplacePostGuidanceRoot(manager.top)) {
      manager.push(TrailheadCarHomeScreen(carContext, this))
    }
  }

  private fun endGuidance(refreshSnapshot: Boolean) {
    if (navigating) navigationManager.navigationEnded()
    navigating = false
    autoDriveEnabled = false
    mainHandler.removeCallbacks(autoDriveStep)
    TrailheadCarLocationService.stop(carContext)
    navigationState = null
    progress = null
    arrivalPresentedFor = null
    lastSpokenStep = -1
    lastSpokenCloseStep = -1
    lastNotificationTitle = ""
    lastNotificationText = ""
    mapSurface.setProgress(null)
    activeSpeechId = null
    tts?.stop()
    abandonSpeechAudioFocus()
    if (refreshSnapshot && ::mapSurface.isInitialized) {
      snapshot = TrailheadCarRepository.load(carContext)
      mapSurface.setSnapshot(snapshot)
    }
  }

  override fun continueAfterArrival(stopIndex: Int) {
    navigationState?.acknowledgeArrival(stopIndex)
    arrivalPresentedFor = null
    invalidateGuidanceScreen()
    if (autoDriveEnabled && navigating) {
      mainHandler.removeCallbacks(autoDriveStep)
      mainHandler.postDelayed(autoDriveStep, 250L)
    }
  }

  private fun newGuidanceScreen() = TrailheadCarGuidanceScreen(carContext, this)

  private fun showGuidanceScreen(manager: ScreenManager) {
    if (manager.top is TrailheadCarGuidanceScreen || manager.top is TrailheadCarArrivalScreen) return
    guidanceScreen = newGuidanceScreen()
    manager.push(guidanceScreen)
  }

  private fun invalidateGuidanceScreen() {
    if (::guidanceScreen.isInitialized && guidanceScreenCanBeInvalidated(guidanceScreen.lifecycle.currentState)) {
      guidanceScreen.invalidate()
    }
  }

  override fun toggleMuted() {
    muted = !muted
    if (muted) {
      activeSpeechId = null
      tts?.stop()
      abandonSpeechAudioFocus()
    }
  }

  override fun beginReportLocation() {
    if (!TrailheadCarLocationService.active) {
      runCatching { TrailheadCarLocationService.start(carContext, reportOnly = true) }
    }
  }

  override fun endReportLocation() {
    if (!navigating) TrailheadCarLocationService.stop(carContext)
  }

  override fun report(categoryId: String): CarReportEnqueueStatus {
    val location = latestLocation() ?: return CarReportEnqueueStatus.ALREADY_SAVED.also {
      CarToast.makeText(carContext, "Waiting for location", CarToast.LENGTH_SHORT).show()
    }
    return CarReportManager.enqueue(
      context = carContext,
      categoryId = categoryId,
      latitude = location.latitude,
      longitude = location.longitude,
      accuracyMeters = location.accuracy.takeIf { location.hasAccuracy() }?.toDouble(),
    ).status
  }

  override fun latestLocation(): Location? = TrailheadCarLocationService.freshLocation()

  private fun handleLocation(location: Location) {
    if (!shouldApplyLiveCarLocation(navigating, autoDriveEnabled)) return
    val next = navigationState?.update(location) ?: return
    applyProgress(next)
  }

  private fun hasGuidancePermissions(): Boolean {
    val hasLocation = carContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      carContext.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val hasNotifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      carContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    return hasLocation && hasNotifications
  }

  private fun applyProgress(next: TrailheadCarProgress) {
    progress = next
    mapSurface.setProgress(next)
    updateCluster(next)
    updateGuidanceNotification(next)
    speakIfNeeded(next)
    invalidateGuidanceScreen()
    val arrival = next.arrivedStopIndex ?: if (next.finalArrival) {
      snapshot.stops.lastIndex.coerceAtLeast(0)
    } else {
      null
    }
    if (arrival != null && arrivalPresentedFor != arrival) {
      arrivalPresentedFor = arrival
      if (next.finalArrival) {
        navigationManager.navigationEnded()
        navigating = false
        autoDriveEnabled = false
        mainHandler.removeCallbacks(autoDriveStep)
        TrailheadCarLocationService.stop(carContext)
        activeSpeechId = null
        tts?.stop()
        abandonSpeechAudioFocus()
      }
      carContext.getCarService(ScreenManager::class.java).push(
        TrailheadCarArrivalScreen(carContext, this, arrival, next.finalArrival),
      )
    }
  }

  private fun updateCluster(current: TrailheadCarProgress) {
    if (!navigating) return
    val route = snapshot.route ?: return
    val currentStep = current.currentStep ?: arrivalStep(route.title)
    val destinationEstimate = carTravelEstimate(current.remainingDistanceM, current.remainingDurationS)
    val stepEstimate = carTravelEstimate(
      current.stepRemainingDistanceM,
      currentStep.durationS.coerceAtMost(current.remainingDurationS),
    )
    val trip = Trip.Builder()
      .addStep(carStep(currentStep), stepEstimate)
      .addDestination(destination(snapshot), destinationEstimate)
      .setCurrentRoad(currentStep.name.ifEmpty { route.title })
      .setLoading(false)
    current.nextStep?.let { nextStep ->
      trip.addStep(carStep(nextStep), carTravelEstimate(nextStep.distanceM, nextStep.durationS))
    }
    navigationManager.updateTrip(trip.build())
  }

  private fun speakIfNeeded(current: TrailheadCarProgress) {
    // Original narration and trigger progress remain phone-owned. The car
    // displays the authored route without inventing or speaking turn cues.
    if (snapshot.route?.isOriginalDrive == true) return
    if (muted || !ttsReady || current.offRoute) return
    val step = current.currentStep ?: return
    val isNewStep = current.stepIndex != lastSpokenStep
    val isClosePrompt = current.stepRemainingDistanceM <= 110.0 && current.stepIndex != lastSpokenCloseStep
    if (isNewStep || isClosePrompt) {
      val message = step.verbalPre.ifEmpty { step.instruction.ifEmpty { step.name } }
      if (message.isNotEmpty() && requestSpeechAudioFocus()) {
        val utteranceId = "trailhead-step-${current.stepIndex}-${if (isClosePrompt) "close" else "start"}"
        activeSpeechId = utteranceId
        val result = tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (result == TextToSpeech.ERROR) {
          activeSpeechId = null
          abandonSpeechAudioFocus()
          return
        }
        lastSpokenStep = current.stepIndex
        if (isClosePrompt) lastSpokenCloseStep = current.stepIndex
      }
    }
  }

  private fun initializeSpeech() {
    tts = TextToSpeech(carContext) { status ->
      ttsReady = status == TextToSpeech.SUCCESS
      if (ttsReady) {
        tts?.language = Locale.getDefault()
        tts?.setAudioAttributes(
          speechAudioAttributes(),
        )
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) = Unit

          override fun onDone(utteranceId: String?) {
            releaseSpeechFocusFor(utteranceId)
          }

          @Deprecated("Kept for Android versions that call the legacy callback")
          override fun onError(utteranceId: String?) {
            releaseSpeechFocusFor(utteranceId)
          }

          override fun onError(utteranceId: String?, errorCode: Int) {
            releaseSpeechFocusFor(utteranceId)
          }
        })
      }
    }
  }

  private fun releaseSpeechFocusFor(utteranceId: String?) {
    mainHandler.post {
      if (utteranceId == null || utteranceId != activeSpeechId) return@post
      activeSpeechId = null
      abandonSpeechAudioFocus()
    }
  }

  private fun requestSpeechAudioFocus(): Boolean {
    val manager = carContext.getSystemService(AudioManager::class.java)
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = audioFocusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speechAudioAttributes())
        .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
        .build()
        .also { audioFocusRequest = it }
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(
        audioFocusChangeListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      )
    }
    return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun abandonSpeechAudioFocus() {
    val manager = carContext.getSystemService(AudioManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let(manager::abandonAudioFocusRequest)
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(audioFocusChangeListener)
    }
  }

  private fun speechAudioAttributes(): AudioAttributes {
    return AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }

  private fun updateGuidanceNotification(current: TrailheadCarProgress) {
    if (!navigating) return
    val route = snapshot.route ?: return
    val step = current.currentStep
    val title = step?.instruction?.ifEmpty { step.verbalPre.ifEmpty { step.name } }
      ?.ifEmpty { route.title }
      ?: route.title
    val text = "${formatNotificationDistance(current.stepRemainingDistanceM)} · ${step?.name?.ifEmpty { route.title } ?: route.title}"
    if (title == lastNotificationTitle && text == lastNotificationText) return
    lastNotificationTitle = title
    lastNotificationText = text
    TrailheadCarLocationService.updateGuidance(carContext, title, text)
  }

  private fun startSnapshotObserver() {
    snapshotObserver?.stopWatching()
    snapshotObserver = object : FileObserver(
      carContext.filesDir.absolutePath,
      FileObserver.CREATE or FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO or
        FileObserver.DELETE or FileObserver.MOVED_FROM,
    ) {
      override fun onEvent(event: Int, path: String?) {
        if (path != TrailheadCarRepository.CAR_SNAPSHOT_FILE) return
        if (event and (FileObserver.DELETE or FileObserver.MOVED_FROM) != 0) {
          snapshotRemovalObserved = true
        }
        mainHandler.removeCallbacks(snapshotReload)
        mainHandler.postDelayed(snapshotReload, 200L)
      }
    }.also(FileObserver::startWatching)
  }

  private inline fun runOptionalSetup(name: String, block: () -> Unit) {
    try {
      block()
    } catch (error: Throwable) {
      if (error is ThreadDeath || error is VirtualMachineError) throw error
      Log.w(TAG, "Android Auto $name setup unavailable", error)
    }
  }

  private fun reloadSnapshotFromDisk() {
    if (destroyed || !::mapSurface.isInitialized) return
    val previous = snapshot
    val removalObserved = snapshotRemovalObserved
    snapshotRemovalObserved = false
    val snapshotFileExists = File(carContext.filesDir, TrailheadCarRepository.CAR_SNAPSHOT_FILE).exists()
    val next = if (removalObserved && !snapshotFileExists) emptyCarSnapshot() else TrailheadCarRepository.load(carContext)
    if (next == previous) return
    val routeChanged = previous.route != next.route || previous.stops != next.stops
    val shouldPreserveActiveRoute = !hasPendingRouteReplacementRequest() &&
      shouldPreserveActiveCarRoute(previous, next, navigating, routeChanged)
    if (shouldPreserveActiveRoute) {
      snapshot = previous.copy(
        account = next.account,
        offline = next.offline,
        mapboxAccessToken = next.mapboxAccessToken,
        updatedAt = next.updatedAt,
      )
      mapSurface.setSnapshot(snapshot)
      carContext.getCarService(ScreenManager::class.java).top.invalidate()
      return
    }
    snapshot = next
    mapSurface.setSnapshot(next)
    if (routeChanged) routeReplacementRequestedUntilElapsedMs = 0L

    if (shouldEndActiveOriginalGuidance(previous, next, navigating, routeChanged)) {
      endGuidanceAndReturnHome(refreshSnapshot = false)
      CarToast.makeText(carContext, "Original ended on phone", CarToast.LENGTH_SHORT).show()
      return
    }

    if (navigating && routeChanged) {
      val nextRoute = next.route
      if (nextRoute == null) {
        endGuidanceAndReturnHome(refreshSnapshot = false)
        CarToast.makeText(carContext, "Route closed", CarToast.LENGTH_SHORT).show()
        return
      }
      navigationState = TrailheadCarNavigationState(next)
      progress = null
      arrivalPresentedFor = null
      lastSpokenStep = -1
      lastSpokenCloseStep = -1
      mapSurface.setProgress(null)
      TrailheadCarLocationService.freshNavigationLocation(MAX_NAVIGATION_LOCATION_AGE_MS)?.let(::handleLocation)
      CarToast.makeText(carContext, "Route updated", CarToast.LENGTH_SHORT).show()
    }
    carContext.getCarService(ScreenManager::class.java).top.invalidate()
  }

  private fun setRouteReplacementRequest(request: TrailheadCarNavigationRequest?) {
    routeReplacementRequestedUntilElapsedMs = routeReplacementRequestDeadline(
      request,
      SystemClock.elapsedRealtime(),
      ROUTE_REPLACEMENT_WINDOW_MS,
    )
  }

  private fun hasPendingRouteReplacementRequest(): Boolean {
    val deadline = routeReplacementRequestedUntilElapsedMs
    if (routeReplacementRequestIsPending(deadline, SystemClock.elapsedRealtime())) return true
    routeReplacementRequestedUntilElapsedMs = 0L
    return false
  }

  private companion object {
    const val TAG = "TrailheadCarSession"
    const val MAX_NAVIGATION_LOCATION_AGE_MS = 2L * 60L * 1_000L
    const val ROUTE_REPLACEMENT_WINDOW_MS = 10L * 60L * 1_000L
  }
}

internal fun routeReplacementRequestDeadline(
  request: TrailheadCarNavigationRequest?,
  nowElapsedMs: Long,
  windowMs: Long,
): Long {
  return if (request != null && request.mode != TrailheadCarNavigationMode.DIRECTIONS) {
    nowElapsedMs + windowMs
  } else {
    0L
  }
}

internal fun routeReplacementRequestIsPending(deadlineElapsedMs: Long, nowElapsedMs: Long): Boolean {
  return deadlineElapsedMs > 0L && nowElapsedMs <= deadlineElapsedMs
}

internal fun guidanceScreenCanBeInvalidated(state: Lifecycle.State): Boolean {
  return state != Lifecycle.State.DESTROYED
}

internal fun shouldApplyLiveCarLocation(navigating: Boolean, autoDriveEnabled: Boolean): Boolean {
  return navigating && !autoDriveEnabled
}

internal fun shouldStopCarLocationServiceOnSessionDestroy(navigating: Boolean): Boolean {
  return !navigating
}

internal fun shouldReplacePostGuidanceRoot(screen: Screen): Boolean {
  return screen is TrailheadCarGuidanceScreen || screen is TrailheadCarArrivalScreen
}

private fun emptyCarSnapshot(): TrailheadCarSnapshot {
  return TrailheadCarSnapshot(
    state = TrailheadCarSnapshotState.NO_TRIP,
    tripName = "No trip selected",
    tripSummary = "",
    rigSummary = "",
    stops = emptyList(),
  )
}

internal fun shouldPreserveActiveCarRoute(
  current: TrailheadCarSnapshot,
  incoming: TrailheadCarSnapshot,
  navigating: Boolean,
  routeChanged: Boolean,
): Boolean {
  return navigating &&
    routeChanged &&
    current.account.accountId == incoming.account.accountId &&
    current.account.signedIn == incoming.account.signedIn &&
    current.route != null &&
    !current.route.isOriginalDrive &&
    incoming.route != null &&
    !incoming.route.isOriginalDrive &&
    current.route.routeId != incoming.route.routeId &&
    incoming.route.mode != TrailheadCarRouteMode.TRAIL_FOLLOW_ACTIVE
}

internal fun shouldEndActiveOriginalGuidance(
  current: TrailheadCarSnapshot,
  incoming: TrailheadCarSnapshot,
  navigating: Boolean,
  routeChanged: Boolean,
): Boolean {
  return navigating &&
    routeChanged &&
    current.route?.isOriginalDrive == true &&
    incoming.route?.isOriginalDrive != true
}

private fun formatNotificationDistance(meters: Double): String {
  return when {
    meters >= 1_609.344 -> String.format(Locale.US, "%.1f mi", meters / 1_609.344)
    meters >= 160.0 -> "${(meters / 0.3048).toInt()} ft"
    else -> "${meters.coerceAtLeast(0.0).toInt()} m"
  }
}

private fun carTravelEstimate(distanceM: Double, durationS: Double): androidx.car.app.navigation.model.TravelEstimate {
  return androidx.car.app.navigation.model.TravelEstimate.Builder(
    carDistanceForHost(distanceM),
    androidx.car.app.model.DateTimeWithZone.create(
      System.currentTimeMillis() + durationS.coerceAtLeast(0.0).toLong() * 1000L,
      java.util.TimeZone.getDefault(),
    ),
  )
    .setRemainingTimeSeconds(durationS.coerceAtLeast(0.0).toLong())
    .build()
}

private fun carDistanceForHost(meters: Double): Distance {
  return when {
    meters >= 1_609.344 -> Distance.create(meters / 1_609.344, Distance.UNIT_MILES_P1)
    meters >= 160.0 -> Distance.create(meters / 0.3048, Distance.UNIT_FEET)
    else -> Distance.create(meters.coerceAtLeast(0.0), Distance.UNIT_METERS)
  }
}
