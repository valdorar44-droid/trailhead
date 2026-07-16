package expo.modules.trailheadcarreports

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class QueuedCarReport(
    val clientReportId: String,
    val accountId: String,
    val categoryId: String,
    val type: String,
    val subtype: String,
    val severity: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double?,
    val observedAtEpochSeconds: Long,
    val staleAtEpochSeconds: Long,
    val sourceSurface: String = CarReportQueueStore.SOURCE_SURFACE,
    val attemptCount: Int = 0,
    val lastAttemptAtEpochSeconds: Long? = null,
)

enum class QueueEnqueueState {
    QUEUED,
    DEDUPLICATED,
}

data class QueueEnqueueResult(
    val state: QueueEnqueueState,
    val report: QueuedCarReport,
)

data class CarReportQueueSnapshot(
    val reports: List<QueuedCarReport>,
    val discardedStale: Int,
)

class CarReportQueueStore(
    directory: File,
    private val clockMillis: () -> Long = System::currentTimeMillis,
    private val idFactory: () -> String = { UUID.randomUUID().toString() },
) {
    private val queueFile = File(directory, QUEUE_FILE_NAME)
    private val lockFile = File(directory, "$QUEUE_FILE_NAME.lock")

    fun enqueue(
        accountId: String,
        categoryId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Double?,
    ): QueueEnqueueResult {
        val normalizedAccountId = accountId.trim()
        require(normalizedAccountId.isNotEmpty()) { "A signed-in account is required" }
        require(normalizedAccountId.length <= MAX_ACCOUNT_ID_LENGTH) { "Invalid account" }
        require(latitude.isFinite() && latitude in -90.0..90.0) { "Invalid latitude" }
        require(longitude.isFinite() && longitude in -180.0..180.0) { "Invalid longitude" }
        require(accuracyMeters == null || (accuracyMeters.isFinite() && accuracyMeters in 0.0..MAX_ACCURACY_METERS)) {
            "Invalid location accuracy"
        }
        val category = requireNotNull(CarReportCategories.find(categoryId)) { "Unknown report category" }
        val observedAt = clockMillis() / 1_000L

        return mutate { stored ->
            val active = stored.filterNot { it.staleAtEpochSeconds <= observedAt }.toMutableList()
            val duplicate = active.asReversed().firstOrNull { candidate ->
                candidate.accountId == normalizedAccountId &&
                    candidate.categoryId == category.id &&
                    observedAt - candidate.observedAtEpochSeconds in 0L..DOUBLE_TAP_WINDOW_SECONDS &&
                    distanceMeters(candidate.latitude, candidate.longitude, latitude, longitude) <= DOUBLE_TAP_DISTANCE_METERS
            }
            if (duplicate != null) {
                Mutation(active, QueueEnqueueResult(QueueEnqueueState.DEDUPLICATED, duplicate))
            } else {
                val report = QueuedCarReport(
                    clientReportId = idFactory(),
                    accountId = normalizedAccountId,
                    categoryId = category.id,
                    type = category.type,
                    subtype = category.subtype,
                    severity = category.severity,
                    latitude = latitude,
                    longitude = longitude,
                    accuracyMeters = accuracyMeters,
                    observedAtEpochSeconds = observedAt,
                    staleAtEpochSeconds = observedAt + category.queueTtlSeconds,
                )
                active += report
                while (active.size > MAX_QUEUE_SIZE) active.removeAt(0)
                Mutation(active, QueueEnqueueResult(QueueEnqueueState.QUEUED, report))
            }
        }
    }

    fun snapshot(accountId: String? = null): CarReportQueueSnapshot {
        val now = clockMillis() / 1_000L
        return mutate { stored ->
            val active = stored.filterNot { it.staleAtEpochSeconds <= now }
            val reports = if (accountId == null) active else active.filter { it.accountId == accountId }
            Mutation(active, CarReportQueueSnapshot(reports, stored.size - active.size))
        }
    }

    fun remove(clientReportId: String) {
        mutate { stored -> Mutation(stored.filterNot { it.clientReportId == clientReportId }, Unit) }
    }

    fun recordAttempt(clientReportId: String) {
        val now = clockMillis() / 1_000L
        mutate { stored ->
            Mutation(
                stored.map { report ->
                    if (report.clientReportId == clientReportId) {
                        report.copy(
                            attemptCount = report.attemptCount + 1,
                            lastAttemptAtEpochSeconds = now,
                        )
                    } else {
                        report
                    }
                },
                Unit,
            )
        }
    }

    fun discardAccount(accountId: String) {
        mutate { stored -> Mutation(stored.filterNot { it.accountId == accountId }, Unit) }
    }

    fun discardAll() {
        LockedFileAccess.withLock(lockFile) {
            LockedFileAccess.deleteArtifacts(queueFile)
            queueFile.parentFile?.listFiles()
                ?.filter { file -> file.name.startsWith("$QUEUE_FILE_NAME.corrupt.") }
                ?.forEach(File::delete)
        }
    }

    private data class Mutation<T>(val reports: List<QueuedCarReport>, val result: T)

    private fun <T> mutate(block: (List<QueuedCarReport>) -> Mutation<T>): T =
        LockedFileAccess.withLock(lockFile) {
            val mutation = block(readUnlocked())
            writeUnlocked(mutation.reports)
            mutation.result
        }

    private fun readUnlocked(): List<QueuedCarReport> {
        val contents = LockedFileAccess.readTextRecovering(queueFile) ?: return emptyList()
        return try {
            val root = JSONObject(contents)
            val reports = root.optJSONArray("reports") ?: JSONArray()
            buildList {
                for (index in 0 until reports.length()) {
                    parseReport(reports.optJSONObject(index))?.let(::add)
                }
            }
        } catch (_: Exception) {
            val corrupt = File(queueFile.parentFile, "$QUEUE_FILE_NAME.corrupt.${clockMillis()}")
            queueFile.renameTo(corrupt)
            emptyList()
        }
    }

    private fun writeUnlocked(reports: List<QueuedCarReport>) {
        val array = JSONArray()
        reports.forEach { array.put(it.toJson()) }
        val root = JSONObject().put("version", QUEUE_VERSION).put("reports", array)
        LockedFileAccess.writeAtomically(queueFile, root.toString())
    }

    private fun parseReport(value: JSONObject?): QueuedCarReport? {
        if (value == null) return null
        return try {
            val accuracy = if (value.isNull("accuracy_m")) null else value.getDouble("accuracy_m")
            val lastAttempt = if (value.isNull("last_attempt_at")) null else value.getLong("last_attempt_at")
            QueuedCarReport(
                clientReportId = value.getString("client_report_id"),
                accountId = value.getString("account_id"),
                categoryId = value.getString("category_id"),
                type = value.getString("type"),
                subtype = value.getString("subtype"),
                severity = value.optString("severity", "moderate"),
                latitude = value.getDouble("lat"),
                longitude = value.getDouble("lng"),
                accuracyMeters = accuracy,
                observedAtEpochSeconds = value.getLong("observed_at"),
                staleAtEpochSeconds = value.getLong("stale_at"),
                sourceSurface = value.optString("source_surface", SOURCE_SURFACE),
                attemptCount = value.optInt("attempt_count", 0),
                lastAttemptAtEpochSeconds = lastAttempt,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun QueuedCarReport.toJson() = JSONObject()
        .put("client_report_id", clientReportId)
        .put("account_id", accountId)
        .put("category_id", categoryId)
        .put("type", type)
        .put("subtype", subtype)
        .put("severity", severity)
        .put("lat", latitude)
        .put("lng", longitude)
        .put("accuracy_m", accuracyMeters ?: JSONObject.NULL)
        .put("observed_at", observedAtEpochSeconds)
        .put("stale_at", staleAtEpochSeconds)
        .put("source_surface", sourceSurface)
        .put("attempt_count", attemptCount)
        .put("last_attempt_at", lastAttemptAtEpochSeconds ?: JSONObject.NULL)

    companion object {
        const val SOURCE_SURFACE = "android_auto"
        private const val QUEUE_FILE_NAME = "car_report_queue.json"
        private const val QUEUE_VERSION = 1
        private const val MAX_QUEUE_SIZE = 100
        private const val MAX_ACCOUNT_ID_LENGTH = 128
        private const val MAX_ACCURACY_METERS = 10_000.0
        private const val DOUBLE_TAP_WINDOW_SECONDS = 10L
        private const val DOUBLE_TAP_DISTANCE_METERS = 100.0
        private const val EARTH_RADIUS_METERS = 6_371_000.0

        private fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val dLat = Math.toRadians(lat2 - lat1)
            val dLng = Math.toRadians(lng2 - lng1)
            val firstLat = Math.toRadians(lat1)
            val secondLat = Math.toRadians(lat2)
            val haversine = sin(dLat / 2.0) * sin(dLat / 2.0) +
                cos(firstLat) * cos(secondLat) * sin(dLng / 2.0) * sin(dLng / 2.0)
            return EARTH_RADIUS_METERS * 2.0 * asin(sqrt(haversine.coerceIn(0.0, 1.0)))
        }
    }
}
