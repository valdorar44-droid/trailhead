package com.trailhead.app.car

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.car.app.notification.CarAppExtender
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.trailhead.app.R
import java.util.concurrent.CopyOnWriteArraySet

class TrailheadCarLocationService : Service(), LocationListener {
  private lateinit var locationManager: LocationManager
  private var reportOnly = false
  private var navigationTitle = "Trailhead navigation"
  private var navigationText = "Route guidance is active"

  override fun onCreate() {
    super.onCreate()
    locationManager = getSystemService(LocationManager::class.java)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopGuidance()
      return START_NOT_STICKY
    }
    reportOnly = intent?.getBooleanExtra(EXTRA_REPORT_ONLY, false) == true
    if (intent?.action == ACTION_UPDATE) {
      navigationTitle = intent.getStringExtra(EXTRA_TITLE)?.trim().orEmpty().ifEmpty { navigationTitle }
      navigationText = intent.getStringExtra(EXTRA_TEXT)?.trim().orEmpty().ifEmpty { navigationText }
    } else if (!reportOnly) {
      navigationTitle = "Trailhead navigation"
      navigationText = "Route guidance is active"
    }
    startForeground(NOTIFICATION_ID, locationNotification())
    if (!active) {
      if (!requestUpdates()) return START_NOT_STICKY
      active = true
    }
    return START_NOT_STICKY
  }

  override fun onLocationChanged(location: Location) {
    if (!validLocation(location)) return
    lastLocation = location
    listeners.forEach { it(location) }
  }

  override fun onDestroy() {
    locationManager.removeUpdates(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    active = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun requestUpdates(): Boolean {
    val fine = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    val coarse = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) {
      stopGuidance()
      return false
    }
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
      .filter { provider -> runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false) }
    providers.forEach { provider ->
      runCatching { locationManager.requestLocationUpdates(provider, 1_000L, 1f, this) }
    }
    val recent = providers.mapNotNull { provider ->
      runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull()
    }.filter(::validLocation)
      .filter { locationAgeMillis(it) <= MAX_INITIAL_LOCATION_AGE_MS }
      .maxByOrNull { it.elapsedRealtimeNanos.takeIf { value -> value > 0L } ?: it.time * 1_000_000L }
    lastLocation = recent ?: lastLocation?.takeIf { locationAgeMillis(it) <= MAX_INITIAL_LOCATION_AGE_MS }
    lastLocation?.let { location -> listeners.forEach { it(location) } }
    return true
  }

  private fun stopGuidance() {
    locationManager.removeUpdates(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun locationNotification(): android.app.Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Trailhead navigation",
          NotificationManager.IMPORTANCE_LOW,
        ).apply { description = "Location for navigation and road reports" },
      )
    }
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val title = if (reportOnly) "Finding your location" else navigationTitle
    val text = if (reportOnly) "Location is needed for a road report" else navigationText
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setContentTitle(title)
      .setContentText(text)
      .setCategory(
        if (reportOnly) NotificationCompat.CATEGORY_SERVICE else NotificationCompat.CATEGORY_NAVIGATION,
      )
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
    if (!reportOnly) {
      val carExtension = CarAppExtender.Builder()
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(R.drawable.notification_icon)
        .setImportance(NotificationManagerCompat.IMPORTANCE_LOW)
        .apply { if (contentIntent != null) setContentIntent(contentIntent) }
        .build()
      builder.extend(carExtension)
    }
    return builder.build()
  }

  companion object {
    private const val ACTION_START = "com.trailhead.app.car.START_GUIDANCE"
    private const val ACTION_UPDATE = "com.trailhead.app.car.UPDATE_GUIDANCE"
    private const val ACTION_STOP = "com.trailhead.app.car.STOP_GUIDANCE"
    private const val EXTRA_REPORT_ONLY = "report_only"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "trailhead_navigation"
    private const val NOTIFICATION_ID = 4071
    private val listeners = CopyOnWriteArraySet<(Location) -> Unit>()

    @Volatile
    var lastLocation: Location? = null
      private set

    @Volatile
    var active: Boolean = false
      private set

    fun start(context: Context, reportOnly: Boolean = false) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, TrailheadCarLocationService::class.java)
          .setAction(ACTION_START)
          .putExtra(EXTRA_REPORT_ONLY, reportOnly),
      )
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, TrailheadCarLocationService::class.java))
    }

    fun updateGuidance(context: Context, title: String, text: String) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, TrailheadCarLocationService::class.java)
          .setAction(ACTION_UPDATE)
          .putExtra(EXTRA_TITLE, title)
          .putExtra(EXTRA_TEXT, text),
      )
    }

    fun addListener(listener: (Location) -> Unit) {
      listeners += listener
      freshNavigationLocation(MAX_INITIAL_LOCATION_AGE_MS)?.let(listener)
    }

    fun removeListener(listener: (Location) -> Unit) {
      listeners -= listener
    }

    fun freshLocation(maxAgeMillis: Long = MAX_REPORT_LOCATION_AGE_MS): Location? {
      return lastLocation?.takeIf { location ->
        validLocation(location) &&
          locationAgeMillis(location) <= maxAgeMillis &&
          location.hasAccuracy() &&
          location.accuracy <= MAX_REPORT_ACCURACY_METERS
      }
    }

    fun freshNavigationLocation(maxAgeMillis: Long = MAX_INITIAL_LOCATION_AGE_MS): Location? {
      return lastLocation?.takeIf { location ->
        validLocation(location) && locationAgeMillis(location) <= maxAgeMillis
      }
    }

    private fun validLocation(location: Location): Boolean {
      return location.latitude.isFinite() && location.longitude.isFinite() &&
        location.latitude in -90.0..90.0 && location.longitude in -180.0..180.0
    }

    private fun locationAgeMillis(location: Location): Long {
      val elapsedNanos = location.elapsedRealtimeNanos
      if (elapsedNanos > 0L) {
        return ((SystemClock.elapsedRealtimeNanos() - elapsedNanos) / 1_000_000L).coerceAtLeast(0L)
      }
      return (System.currentTimeMillis() - location.time).coerceAtLeast(0L)
    }

    private const val MAX_INITIAL_LOCATION_AGE_MS = 2L * 60L * 1_000L
    private const val MAX_REPORT_LOCATION_AGE_MS = 45_000L
    private const val MAX_REPORT_ACCURACY_METERS = 150f
  }
}
