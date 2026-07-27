package expo.modules.trailheadcarreports

import android.content.Context
import org.json.JSONObject

object CarCopilotManager {
    fun turn(
        context: Context,
        audioL16: ByteArray,
        sessionId: String?,
        tripId: String?,
        routeContext: JSONObject,
    ): CarCopilotTurnResult {
        val session = CarReportManager.sessionStore(context).read()
            ?: return CarCopilotTurnResult(
                CarCopilotDisposition.SIGN_IN_REQUIRED,
                "Sign in on your phone to use Co-Pilot.",
            )
        return CarCopilotHttpClient().turn(session, audioL16, sessionId, tripId, routeContext)
    }

    fun confirm(context: Context, actionId: Long, confirmed: Boolean): Boolean {
        val session = CarReportManager.sessionStore(context).read() ?: return false
        return CarCopilotHttpClient().confirm(session, actionId, confirmed)
    }
}
