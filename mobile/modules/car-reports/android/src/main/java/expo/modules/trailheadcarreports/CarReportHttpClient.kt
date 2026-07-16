package expo.modules.trailheadcarreports

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

enum class ReportSubmitDisposition {
    ACCEPTED,
    RETRY,
    AUTH_REQUIRED,
    DROP,
}

object ReportRetryClassifier {
    fun classify(statusCode: Int): ReportSubmitDisposition = when {
        statusCode in 200..299 || statusCode == 409 -> ReportSubmitDisposition.ACCEPTED
        statusCode == 401 -> ReportSubmitDisposition.AUTH_REQUIRED
        statusCode in setOf(408, 425, 429) || statusCode >= 500 -> ReportSubmitDisposition.RETRY
        else -> ReportSubmitDisposition.DROP
    }
}

data class ReportSubmitResult(
    val disposition: ReportSubmitDisposition,
    val statusCode: Int? = null,
)

class CarReportHttpClient(
    private val connectTimeoutMillis: Int = 10_000,
    private val readTimeoutMillis: Int = 15_000,
) {
    fun submit(report: QueuedCarReport, session: CarReportSession): ReportSubmitResult {
        val connection = try {
            URL("${session.apiBaseUrl}/api/reports").openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return ReportSubmitResult(ReportSubmitDisposition.RETRY)
        }

        return try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer ${session.bearerToken}")
            connection.outputStream.use { output ->
                output.write(report.toApiRequestJson().toString().toByteArray(Charsets.UTF_8))
            }
            val statusCode = connection.responseCode
            (if (statusCode >= 400) connection.errorStream else connection.inputStream)?.use { it.readBytes() }
            ReportSubmitResult(ReportRetryClassifier.classify(statusCode), statusCode)
        } catch (_: IOException) {
            ReportSubmitResult(ReportSubmitDisposition.RETRY)
        } finally {
            connection.disconnect()
        }
    }

}

internal fun QueuedCarReport.toApiRequestJson() = JSONObject()
    .put("client_report_id", clientReportId)
    .put("observed_at", observedAtEpochSeconds)
    .put("source_surface", sourceSurface)
    .put("accuracy_m", accuracyMeters ?: JSONObject.NULL)
    .put("lat", latitude)
    .put("lng", longitude)
    .put("type", type)
    .put("subtype", subtype)
    .put("severity", severity)
