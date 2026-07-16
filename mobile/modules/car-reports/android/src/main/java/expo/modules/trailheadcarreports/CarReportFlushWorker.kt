package expo.modules.trailheadcarreports

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class CarReportFlushWorker(
    appContext: Context,
    workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
    override fun doWork(): Result {
        val sessionStore = CarReportManager.sessionStore(applicationContext)
        val queueStore = CarReportManager.queueStore(applicationContext)
        val initialSession = sessionStore.read() ?: return Result.failure()
        val pending = queueStore.snapshot(initialSession.accountId).reports
        if (pending.isEmpty()) return Result.success()

        val httpClient = CarReportHttpClient()
        for (report in pending) {
            val currentSession = sessionStore.read()
            if (currentSession == null || currentSession.accountId != report.accountId) {
                return Result.failure()
            }

            when (httpClient.submit(report, currentSession).disposition) {
                ReportSubmitDisposition.ACCEPTED,
                ReportSubmitDisposition.DROP,
                -> queueStore.remove(report.clientReportId)

                ReportSubmitDisposition.AUTH_REQUIRED -> {
                    queueStore.recordAttempt(report.clientReportId)
                    return Result.failure()
                }

                ReportSubmitDisposition.RETRY -> {
                    queueStore.recordAttempt(report.clientReportId)
                    return Result.retry()
                }
            }
        }
        return Result.success()
    }
}
