package expo.modules.trailheadcarreports

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class CarReportSession(
    val accountId: String,
    val bearerToken: String,
    val apiBaseUrl: String,
)

interface SessionCipher {
    fun encrypt(plaintext: String, associatedData: String): String
    fun decrypt(ciphertext: String, associatedData: String): String
}

class AndroidKeystoreSessionCipher(
    private val keyAlias: String = KEY_ALIAS,
) : SessionCipher {
    override fun encrypt(plaintext: String, associatedData: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        cipher.updateAAD(associatedData.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val payload = Base64.encodeToString(encrypted, Base64.NO_WRAP)
        return "$FORMAT_VERSION:$iv:$payload"
    }

    override fun decrypt(ciphertext: String, associatedData: String): String {
        val parts = ciphertext.split(':', limit = 3)
        require(parts.size == 3 && parts[0] == FORMAT_VERSION) { "Invalid encrypted session" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(associatedData.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)).toString(Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "trailhead.car.reports.session.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val FORMAT_VERSION = "v1"
        const val GCM_TAG_BITS = 128
    }
}

class SecureCarReportSessionStore(
    directory: File,
    private val cipher: SessionCipher,
) {
    private val sessionFile = File(directory, SESSION_FILE_NAME)
    private val lockFile = File(directory, "$SESSION_FILE_NAME.lock")

    fun save(accountId: String, bearerToken: String, apiBaseUrl: String) {
        val normalizedAccountId = accountId.trim()
        val normalizedToken = bearerToken.trim()
        require(normalizedAccountId.isNotEmpty() && normalizedAccountId.length <= MAX_ACCOUNT_ID_LENGTH) {
            "Invalid account"
        }
        require(normalizedToken.isNotEmpty()) { "A bearer token is required" }
        val normalizedUrl = normalizeApiBaseUrl(apiBaseUrl)
        val associatedData = associatedData(normalizedAccountId, normalizedUrl)
        val encryptedToken = cipher.encrypt(normalizedToken, associatedData)
        val root = JSONObject()
            .put("version", SESSION_VERSION)
            .put("account_id", normalizedAccountId)
            .put("api_base_url", normalizedUrl)
            .put("encrypted_token", encryptedToken)

        LockedFileAccess.withLock(lockFile) {
            LockedFileAccess.writeAtomically(sessionFile, root.toString())
        }
    }

    fun read(): CarReportSession? = LockedFileAccess.withLock(lockFile) {
        val contents = LockedFileAccess.readTextRecovering(sessionFile) ?: return@withLock null
        try {
            val root = JSONObject(contents)
            if (root.optInt("version") != SESSION_VERSION) return@withLock null
            val accountId = root.getString("account_id")
            val apiBaseUrl = normalizeApiBaseUrl(root.getString("api_base_url"))
            val token = cipher.decrypt(
                root.getString("encrypted_token"),
                associatedData(accountId, apiBaseUrl),
            )
            if (token.isBlank()) null else CarReportSession(accountId, token, apiBaseUrl)
        } catch (_: Exception) {
            null
        }
    }

    fun clear(): CarReportSession? = LockedFileAccess.withLock(lockFile) {
        val prior = readUnlocked()
        LockedFileAccess.deleteArtifacts(sessionFile)
        prior
    }

    private fun readUnlocked(): CarReportSession? {
        val contents = LockedFileAccess.readTextRecovering(sessionFile) ?: return null
        return try {
            val root = JSONObject(contents)
            val accountId = root.getString("account_id")
            val apiBaseUrl = normalizeApiBaseUrl(root.getString("api_base_url"))
            val token = cipher.decrypt(root.getString("encrypted_token"), associatedData(accountId, apiBaseUrl))
            CarReportSession(accountId, token, apiBaseUrl)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val SESSION_FILE_NAME = "car_report_session.json"
        private const val SESSION_VERSION = 1
        private const val MAX_ACCOUNT_ID_LENGTH = 128

        fun normalizeApiBaseUrl(value: String): String {
            val normalized = value.trim().trimEnd('/')
            val uri = URI(normalized)
            require(uri.scheme.equals("https", ignoreCase = true)) { "The report service must use HTTPS" }
            require(!uri.host.isNullOrBlank() && uri.userInfo == null) { "Invalid report service" }
            require(uri.query == null && uri.fragment == null) { "Invalid report service" }
            return normalized
        }

        private fun associatedData(accountId: String, apiBaseUrl: String) = "$accountId\n$apiBaseUrl"
    }
}
