package expo.modules.trailheadcarreports

import androidx.work.ExistingWorkPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CarReportManagerTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun schedulesAFlushBehindRunningWorkInsteadOfDroppingTheWakeUp() {
        assertEquals(ExistingWorkPolicy.APPEND_OR_REPLACE, CarReportManager.FLUSH_WORK_POLICY)
    }

    @Test
    fun explicitDiscardPurgesReportsWhenEncryptedSessionCannotBeRecovered() {
        val directory = temporaryFolder.newFolder("corrupt-session")
        val sessions = SecureCarReportSessionStore(directory, RejectingCipher())
        val queue = CarReportQueueStore(directory, clockMillis = { 1_700_000_000_000L })
        directory.resolve("car_report_session.json").writeText(
            """{"version":1,"account_id":"42","api_base_url":"https://api.gettrailhead.app","encrypted_token":"unreadable"}""",
        )
        queue.enqueue("42", "police", 49.8951, -97.1384, 8.0)

        clearCarReportSessionData(sessions, queue, discardQueuedReports = true)

        assertNull(sessions.read())
        assertTrue(queue.snapshot().reports.isEmpty())
        assertFalse(directory.resolve("car_report_session.json").exists())
    }

    @Test
    fun sessionRefreshCanPreserveQueuedReports() {
        val directory = temporaryFolder.newFolder("preserve-queue")
        val sessions = SecureCarReportSessionStore(directory, PassthroughCipher())
        val queue = CarReportQueueStore(directory, clockMillis = { 1_700_000_000_000L })
        sessions.save("42", "token", "https://api.gettrailhead.app")
        queue.enqueue("42", "hazard", 49.8951, -97.1384, 8.0)

        clearCarReportSessionData(sessions, queue, discardQueuedReports = false)

        assertNull(sessions.read())
        assertEquals(1, queue.snapshot("42").reports.size)
    }

    private class RejectingCipher : SessionCipher {
        override fun encrypt(plaintext: String, associatedData: String): String = error("not used")
        override fun decrypt(ciphertext: String, associatedData: String): String = error("invalid key")
    }

    private class PassthroughCipher : SessionCipher {
        override fun encrypt(plaintext: String, associatedData: String): String = plaintext
        override fun decrypt(ciphertext: String, associatedData: String): String = ciphertext
    }
}
