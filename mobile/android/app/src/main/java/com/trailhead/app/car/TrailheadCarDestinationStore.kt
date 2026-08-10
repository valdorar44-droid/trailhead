package com.trailhead.app.car

import android.content.Context
import com.trailhead.app.BuildConfig
import org.json.JSONObject
import java.net.URI

internal interface TrailheadCarCredentialCache {
  fun read(): TrailheadCarCachedCredential?
  fun write(value: TrailheadCarCachedCredential)
}

internal data class TrailheadCarCachedCredential(
  val accessToken: String,
  val fetchedAtMillis: Long,
)

internal fun clearLegacyCarDestinationHistory(context: Context) {
  context.deleteSharedPreferences("trailhead_car_destination_history")
}

private class TrailheadCarSharedCredentialCache(context: Context) : TrailheadCarCredentialCache {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  override fun read(): TrailheadCarCachedCredential? {
    val token = preferences.getString(TOKEN, null)?.trim().orEmpty()
    if (!validPublicMapboxToken(token)) return null
    return TrailheadCarCachedCredential(
      accessToken = token,
      fetchedAtMillis = preferences.getLong(FETCHED_AT, 0L).coerceAtLeast(0L),
    )
  }

  override fun write(value: TrailheadCarCachedCredential) {
    if (!validPublicMapboxToken(value.accessToken)) return
    preferences.edit()
      .putString(TOKEN, value.accessToken)
      .putLong(FETCHED_AT, value.fetchedAtMillis)
      .apply()
  }

  private companion object {
    const val PREFERENCES = "trailhead_car_public_config"
    const val TOKEN = "mapbox_public_access_token"
    const val FETCHED_AT = "mapbox_public_access_token_fetched_at"
  }
}

internal class TrailheadCarRoutingCredentialProvider(
  private val apiBaseUrl: String,
  private val cache: TrailheadCarCredentialCache,
  private val httpClient: TrailheadCarHttpClient = TrailheadCarUrlConnectionClient(),
  private val nowMillis: () -> Long = System::currentTimeMillis,
) {
  constructor(context: Context) : this(
    apiBaseUrl = BuildConfig.TRAILHEAD_API_BASE_URL,
    cache = TrailheadCarSharedCredentialCache(context),
  )

  fun resolve(snapshotToken: String, forceRefresh: Boolean = false): String {
    val cached = cache.read()
    if (!forceRefresh && cached != null && nowMillis() - cached.fetchedAtMillis <= FRESH_FOR_MILLIS) {
      return cached.accessToken
    }

    return try {
      val token = JSONObject(httpClient.get(configUrl(apiBaseUrl)))
        .optString("mapbox_token")
        .trim()
      require(validPublicMapboxToken(token)) { "Online routing is unavailable" }
      cache.write(TrailheadCarCachedCredential(token, nowMillis()))
      token
    } catch (error: Exception) {
      cached?.accessToken
        ?: snapshotToken.trim().takeIf(::validPublicMapboxToken)
        ?: throw IllegalStateException("Online routing is unavailable", error)
    }
  }

  fun <T> executeWithCredential(
    snapshotToken: String,
    operation: (String) -> T,
  ): Pair<String, T> {
    val token = resolve(snapshotToken)
    return try {
      token to operation(token)
    } catch (error: TrailheadCarHttpException) {
      if (error.statusCode != 401 && error.statusCode != 403) throw error
      val refreshed = resolve(snapshotToken, forceRefresh = true)
      refreshed to operation(refreshed)
    }
  }

  internal fun configUrl(value: String): String {
    val base = URI(value.trim().trimEnd('/'))
    require(base.scheme.equals("https", ignoreCase = true) && !base.host.isNullOrBlank()) {
      "Online routing is unavailable"
    }
    require(base.userInfo == null && base.query == null && base.fragment == null) {
      "Online routing is unavailable"
    }
    return "${base.scheme}://${base.authority}/api/config"
  }

  private companion object {
    const val FRESH_FOR_MILLIS = 7L * 24L * 60L * 60L * 1_000L
  }
}

private fun validPublicMapboxToken(value: String): Boolean =
  value.startsWith("pk.") && value.length in 8..4_096 && value.none(Char::isWhitespace)
