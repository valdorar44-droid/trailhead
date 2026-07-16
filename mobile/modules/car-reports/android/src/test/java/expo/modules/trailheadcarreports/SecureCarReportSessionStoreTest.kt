package expo.modules.trailheadcarreports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Base64

class SecureCarReportSessionStoreTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun persistsOnlyCiphertextAndRestoresTheSession() {
        val directory = temporaryFolder.newFolder()
        val store = SecureCarReportSessionStore(directory, TestCipher())
        val token = "secret-bearer-token"

        store.save("42", token, "https://api.gettrailhead.app/")

        val persisted = directory.resolve("car_report_session.json").readText()
        assertFalse(persisted.contains(token))
        assertEquals(
            CarReportSession("42", token, "https://api.gettrailhead.app"),
            store.read(),
        )
    }

    @Test
    fun refusesAnUnencryptedReportEndpoint() {
        val store = SecureCarReportSessionStore(temporaryFolder.newFolder(), TestCipher())
        assertThrows(IllegalArgumentException::class.java) {
            store.save("42", "token", "http://api.gettrailhead.app")
        }
    }

    @Test
    fun clearReturnsThePriorAccountAndRemovesTheCredential() {
        val directory = temporaryFolder.newFolder()
        val store = SecureCarReportSessionStore(directory, TestCipher())
        store.save("42", "token", "https://api.gettrailhead.app")
        directory.resolve("car_report_session.json.bak").writeText("stale encrypted session")

        assertEquals("42", store.clear()?.accountId)
        assertNull(store.read())
        assertFalse(directory.resolve("car_report_session.json.bak").exists())
    }

    private class TestCipher : SessionCipher {
        override fun encrypt(plaintext: String, associatedData: String): String = Base64.getEncoder()
            .encodeToString("$associatedData\u0000${plaintext.reversed()}".toByteArray())

        override fun decrypt(ciphertext: String, associatedData: String): String {
            val decoded = String(Base64.getDecoder().decode(ciphertext))
            val prefix = "$associatedData\u0000"
            require(decoded.startsWith(prefix))
            return decoded.removePrefix(prefix).reversed()
        }
    }
}
