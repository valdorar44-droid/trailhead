package com.trailhead.app.car

import android.content.Intent
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.SessionInfo
import androidx.car.app.validation.HostValidator
import com.trailhead.app.BuildConfig

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

  override fun onCreateSession(sessionInfo: SessionInfo): Session {
    return TrailheadCarSession()
  }
}

private class TrailheadCarSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen {
    return TrailheadCarHomeScreen(carContext)
  }
}
