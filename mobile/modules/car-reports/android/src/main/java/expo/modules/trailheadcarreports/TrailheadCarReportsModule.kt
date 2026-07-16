package expo.modules.trailheadcarreports

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TrailheadCarReportsModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("TrailheadCarReports")

        AsyncFunction("setSession") { accountId: String, bearerToken: String, apiBaseUrl: String ->
            CarReportManager.setSession(context(), accountId, bearerToken, apiBaseUrl)
            true
        }

        AsyncFunction("clearSession") { discardQueuedReports: Boolean ->
            CarReportManager.clearSession(context(), discardQueuedReports)
            true
        }

        AsyncFunction("requestFlush") {
            CarReportManager.scheduleFlush(context())
            true
        }

        AsyncFunction("getQueueStatus") {
            val status = CarReportManager.status(context())
            mapOf(
                "signedIn" to status.signedIn,
                "queued" to status.queued,
                "totalQueued" to status.totalQueued,
                "oldestObservedAt" to status.oldestObservedAtEpochSeconds,
            )
        }
    }

    private fun context(): Context = appContext.reactContext?.applicationContext
        ?: throw Exceptions.ReactContextLost()
}
