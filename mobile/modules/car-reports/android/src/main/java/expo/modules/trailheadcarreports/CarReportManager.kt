package expo.modules.trailheadcarreports

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

enum class CarReportEnqueueStatus {
    QUEUED,
    ALREADY_SAVED,
    SIGN_IN_REQUIRED,
}

data class CarReportEnqueueOutcome(
    val status: CarReportEnqueueStatus,
    val clientReportId: String? = null,
    val category: CarReportCategory? = null,
)

data class CarReportQueueStatus(
    val signedIn: Boolean,
    val queued: Int,
    val totalQueued: Int,
    val oldestObservedAtEpochSeconds: Long?,
)

object CarReportManager {
    fun setSession(context: Context, accountId: String, bearerToken: String, apiBaseUrl: String) {
        sessionStore(context).save(accountId, bearerToken, apiBaseUrl)
        scheduleFlush(context)
    }

    fun clearSession(context: Context, discardQueuedReports: Boolean) {
        clearCarReportSessionData(
            sessionStore = sessionStore(context),
            queueStore = queueStore(context),
            discardQueuedReports = discardQueuedReports,
        )
    }

    fun enqueue(
        context: Context,
        categoryId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Double?,
    ): CarReportEnqueueOutcome {
        val session = sessionStore(context).read()
            ?: return CarReportEnqueueOutcome(CarReportEnqueueStatus.SIGN_IN_REQUIRED)
        val result = queueStore(context).enqueue(
            accountId = session.accountId,
            categoryId = categoryId,
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = accuracyMeters,
        )
        scheduleFlush(context)
        return CarReportEnqueueOutcome(
            status = if (result.state == QueueEnqueueState.QUEUED) {
                CarReportEnqueueStatus.QUEUED
            } else {
                CarReportEnqueueStatus.ALREADY_SAVED
            },
            clientReportId = result.report.clientReportId,
            category = CarReportCategories.find(result.report.categoryId),
        )
    }

    fun status(context: Context): CarReportQueueStatus {
        val session = sessionStore(context).read()
        val all = queueStore(context).snapshot()
        val accountReports = if (session == null) {
            emptyList()
        } else {
            all.reports.filter { it.accountId == session.accountId }
        }
        return CarReportQueueStatus(
            signedIn = session != null,
            queued = accountReports.size,
            totalQueued = all.reports.size,
            oldestObservedAtEpochSeconds = accountReports.minOfOrNull { it.observedAtEpochSeconds },
        )
    }

    fun scheduleFlush(context: Context) {
        val request = OneTimeWorkRequestBuilder<CarReportFlushWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30L, TimeUnit.SECONDS)
            .addTag(FLUSH_WORK_NAME)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            FLUSH_WORK_NAME,
            FLUSH_WORK_POLICY,
            request,
        )
    }

    internal fun queueStore(context: Context) = CarReportQueueStore(context.applicationContext.filesDir)

    internal fun sessionStore(context: Context) = SecureCarReportSessionStore(
        context.applicationContext.filesDir,
        AndroidKeystoreSessionCipher(),
    )

    // A request queued while a flush is running must get a successor. KEEP can
    // lose that wake-up after the active worker has already read its snapshot.
    internal val FLUSH_WORK_POLICY = ExistingWorkPolicy.APPEND_OR_REPLACE

    private const val FLUSH_WORK_NAME = "trailhead-car-report-flush"
}

internal fun clearCarReportSessionData(
    sessionStore: SecureCarReportSessionStore,
    queueStore: CarReportQueueStore,
    discardQueuedReports: Boolean,
) {
    try {
        sessionStore.clear()
    } finally {
        if (discardQueuedReports) queueStore.discardAll()
    }
}
