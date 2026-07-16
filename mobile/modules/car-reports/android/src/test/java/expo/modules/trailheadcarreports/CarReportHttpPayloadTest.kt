package expo.modules.trailheadcarreports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CarReportHttpPayloadTest {
    @Test
    fun sendsIdempotencyObservationAndCarSurfaceMetadata() {
        val payload = QueuedCarReport(
            clientReportId = "report-123",
            accountId = "42",
            categoryId = "police",
            type = "police",
            subtype = "Police",
            severity = "moderate",
            latitude = 49.8951,
            longitude = -97.1384,
            accuracyMeters = 8.25,
            observedAtEpochSeconds = 1_700_000_000L,
            staleAtEpochSeconds = 1_700_007_200L,
        ).toApiRequestJson()

        assertEquals("report-123", payload.getString("client_report_id"))
        assertEquals(1_700_000_000L, payload.getLong("observed_at"))
        assertEquals("android_auto", payload.getString("source_surface"))
        assertEquals(8.25, payload.getDouble("accuracy_m"), 0.0)
        assertEquals("police", payload.getString("type"))
        assertEquals("Police", payload.getString("subtype"))
        assertFalse(payload.has("account_id"))
        assertFalse(payload.has("stale_at"))
    }
}
