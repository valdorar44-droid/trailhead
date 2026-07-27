package expo.modules.trailheadcarreports

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

enum class CarCopilotDisposition {
    OK,
    SIGN_IN_REQUIRED,
    CONNECTION_REQUIRED,
    NOT_AVAILABLE,
}

data class CarCopilotCandidate(
    val id: String,
    val name: String,
    val latitude: Double?,
    val longitude: Double?,
    val distanceMeters: Double?,
)

data class CarCopilotAction(
    val id: Long,
    val type: String,
    val label: String,
    val args: JSONObject,
)

data class CarCopilotTurnResult(
    val disposition: CarCopilotDisposition,
    val message: String,
    val sessionId: String? = null,
    val requiresConfirmation: Boolean = false,
    val action: CarCopilotAction? = null,
    val candidates: List<CarCopilotCandidate> = emptyList(),
)

class CarCopilotHttpClient(
    private val connectTimeoutMillis: Int = 10_000,
    private val readTimeoutMillis: Int = 22_000,
) {
    fun turn(
        session: CarReportSession,
        audioL16: ByteArray,
        sessionId: String?,
        tripId: String?,
        context: JSONObject,
    ): CarCopilotTurnResult {
        val body = JSONObject()
            .put("audio_l16_base64", Base64.encodeToString(audioL16, Base64.NO_WRAP))
            .put("sample_rate", 16_000)
            .put("session_id", sessionId ?: JSONObject.NULL)
            .put("trip_id", tripId ?: JSONObject.NULL)
            .put("context", context)
        val response = request(
            url = "${session.apiBaseUrl}/api/explorer/copilot/car/turn",
            method = "POST",
            bearerToken = session.bearerToken,
            body = body,
        )
        if (response.statusCode == 401) {
            return CarCopilotTurnResult(CarCopilotDisposition.SIGN_IN_REQUIRED, "Sign in on your phone to use Co-Pilot.")
        }
        if (response.statusCode == null || response.statusCode in setOf(408, 425, 429) || response.statusCode >= 500) {
            return CarCopilotTurnResult(CarCopilotDisposition.CONNECTION_REQUIRED, "Co-Pilot needs a connection right now.")
        }
        if (response.statusCode !in 200..299 || response.body == null) {
            return CarCopilotTurnResult(CarCopilotDisposition.NOT_AVAILABLE, response.errorMessage())
        }
        return parseTurnResponse(response.body)
    }

    fun confirm(session: CarReportSession, actionId: Long, confirmed: Boolean): Boolean {
        val response = request(
            url = "${session.apiBaseUrl}/api/explorer/copilot/action/confirm",
            method = "POST",
            bearerToken = session.bearerToken,
            body = JSONObject()
                .put("action_id", actionId)
                .put("confirmed", confirmed)
                .put("client_result", JSONObject().put("surface", "android_auto")),
        )
        return response.statusCode in 200..299 && response.body?.optBoolean("ok") == true
    }

    private fun parseTurnResponse(root: JSONObject): CarCopilotTurnResult {
        val actionJson = root.optJSONObject("action")
        val action = actionJson?.optLong("id", -1L)?.takeIf { it > 0 }?.let { id ->
            CarCopilotAction(
                id = id,
                type = actionJson.optString("action_type").take(80),
                label = actionJson.optString("label").take(80),
                args = actionJson.optJSONObject("args") ?: JSONObject(),
            )
        }
        val candidatesJson = root.optJSONArray("candidates") ?: JSONArray()
        val candidates = buildList {
            for (index in 0 until minOf(candidatesJson.length(), 3)) {
                val item = candidatesJson.optJSONObject(index) ?: continue
                val name = item.optString("name").trim().take(120)
                if (name.isEmpty()) continue
                add(
                    CarCopilotCandidate(
                        id = item.optString("id").take(180),
                        name = name,
                        latitude = item.optionalDouble("lat"),
                        longitude = item.optionalDouble("lng"),
                        distanceMeters = item.optionalDouble("distance_m"),
                    ),
                )
            }
        }
        return CarCopilotTurnResult(
            disposition = CarCopilotDisposition.OK,
            message = root.optString("spoken_summary", root.optString("message", "Co-Pilot is ready.")).trim().take(320),
            sessionId = root.optString("session_id").trim().takeIf(String::isNotEmpty)?.take(120),
            requiresConfirmation = root.optBoolean("requires_confirmation"),
            action = action,
            candidates = candidates,
        )
    }

    private fun request(
        url: String,
        method: String,
        bearerToken: String,
        body: JSONObject,
    ): HttpResult {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (_: IOException) {
            return HttpResult(null, null)
        }
        return try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer $bearerToken")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val statusCode = connection.responseCode
            val bytes = (if (statusCode >= 400) connection.errorStream else connection.inputStream)
                ?.use { it.readBytes() }
            val root = bytes?.toString(Charsets.UTF_8)?.let {
                runCatching { JSONObject(it) }.getOrNull()
            }
            HttpResult(statusCode, root)
        } catch (_: IOException) {
            HttpResult(null, null)
        } finally {
            connection.disconnect()
        }
    }

    private data class HttpResult(
        val statusCode: Int?,
        val body: JSONObject?,
    ) {
        fun errorMessage(): String {
            val detail = body?.opt("detail")
            val objectDetail = detail as? JSONObject
            return (
                objectDetail?.optString("message")
                    ?: (detail as? String)
                    ?: "Co-Pilot could not answer right now."
                ).trim().take(240)
        }
    }
}

private fun JSONObject.optionalDouble(name: String): Double? {
    if (!has(name) || isNull(name)) return null
    return optDouble(name, Double.NaN).takeIf(Double::isFinite)
}
