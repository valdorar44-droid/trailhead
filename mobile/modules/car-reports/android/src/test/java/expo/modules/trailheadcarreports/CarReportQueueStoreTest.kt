package expo.modules.trailheadcarreports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class CarReportQueueStoreTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun queuesAccountScopedMetadataWithoutLosingAccuracy() {
        var now = 1_700_000_000_000L
        val store = store { now }

        val result = store.enqueue("42", "police", 49.8951, -97.1384, 7.5)

        assertEquals(QueueEnqueueState.QUEUED, result.state)
        val report = store.snapshot("42").reports.single()
        assertEquals("id-1", report.clientReportId)
        assertEquals("police", report.type)
        assertEquals("Police", report.subtype)
        assertEquals("android_auto", report.sourceSurface)
        assertEquals(7.5, report.accuracyMeters ?: -1.0, 0.0)
        assertEquals(1_700_000_000L, report.observedAtEpochSeconds)
        assertEquals(1_700_007_200L, report.staleAtEpochSeconds)
        assertTrue(store.snapshot("other-account").reports.isEmpty())
        now += 1_000L
    }

    @Test
    fun ignoresASecondTapAtTheSamePlaceButKeepsASeparateObservation() {
        var now = 1_700_000_000_000L
        val store = store { now }
        val first = store.enqueue("42", "hazard", 49.0, -97.0, null)
        now += 5_000L
        val second = store.enqueue("42", "hazard", 49.0001, -97.0001, null)
        now += 1_000L
        val separate = store.enqueue("42", "hazard", 49.01, -97.01, null)

        assertEquals(QueueEnqueueState.DEDUPLICATED, second.state)
        assertEquals(first.report.clientReportId, second.report.clientReportId)
        assertEquals(QueueEnqueueState.QUEUED, separate.state)
        assertNotEquals(first.report.clientReportId, separate.report.clientReportId)
        assertEquals(2, store.snapshot("42").reports.size)
    }

    @Test
    fun discardsAStalePoliceObservationBeforeUpload() {
        var now = 1_700_000_000_000L
        val store = store { now }
        store.enqueue("42", "police", 49.0, -97.0, null)
        now += 2L * 60L * 60L * 1_000L

        val snapshot = store.snapshot("42")

        assertTrue(snapshot.reports.isEmpty())
        assertEquals(1, snapshot.discardedStale)
        assertTrue(store.snapshot().reports.isEmpty())
    }

    @Test
    fun serializesConcurrentWritersWithoutCorruptingTheQueue() {
        val ids = AtomicInteger()
        val store = CarReportQueueStore(
            temporaryFolder.newFolder("concurrent"),
            clockMillis = { 1_700_000_000_000L },
            idFactory = { "id-${ids.incrementAndGet()}" },
        )
        val executor = Executors.newFixedThreadPool(8)
        repeat(40) { index ->
            executor.submit {
                store.enqueue(
                    accountId = "42",
                    categoryId = "hazard",
                    latitude = 40.0 + index * 0.002,
                    longitude = -100.0,
                    accuracyMeters = 5.0,
                )
            }
        }
        executor.shutdown()
        assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS))

        val reports = store.snapshot("42").reports
        assertEquals(40, reports.size)
        assertEquals(40, reports.map { it.clientReportId }.toSet().size)
    }

    @Test
    fun discardAllPurgesEveryAccountAndQueueRecoveryArtifact() {
        val directory = temporaryFolder.newFolder("discard-all")
        val ids = AtomicInteger()
        val store = CarReportQueueStore(
            directory,
            clockMillis = { 1_700_000_000_000L },
            idFactory = { "id-${ids.incrementAndGet()}" },
        )
        store.enqueue("42", "police", 49.8951, -97.1384, 7.5)
        store.enqueue("84", "hazard", 40.7128, -74.0060, 12.0)
        val queueFile = directory.resolve("car_report_queue.json")
        val backup = directory.resolve("car_report_queue.json.bak")
        val temporary = directory.resolve("car_report_queue.json.tmp")
        val corrupt = directory.resolve("car_report_queue.json.corrupt.1700000000000")
        backup.writeText(queueFile.readText())
        temporary.writeText(queueFile.readText())
        corrupt.writeText(queueFile.readText())

        store.discardAll()

        assertFalse(queueFile.exists())
        assertFalse(backup.exists())
        assertFalse(temporary.exists())
        assertFalse(corrupt.exists())
        assertTrue(store.snapshot().reports.isEmpty())
    }

    private fun store(clock: () -> Long): CarReportQueueStore {
        val ids = AtomicInteger()
        return CarReportQueueStore(
            temporaryFolder.newFolder(),
            clockMillis = clock,
            idFactory = { "id-${ids.incrementAndGet()}" },
        )
    }
}
