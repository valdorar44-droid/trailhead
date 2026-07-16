package expo.modules.trailheadcarreports

import org.junit.Assert.assertEquals
import org.junit.Test

class ReportRetryClassifierTest {
    @Test
    fun acceptsSuccessfulAndIdempotentDuplicateResponses() {
        assertEquals(ReportSubmitDisposition.ACCEPTED, ReportRetryClassifier.classify(201))
        assertEquals(ReportSubmitDisposition.ACCEPTED, ReportRetryClassifier.classify(409))
    }

    @Test
    fun retriesOnlyTemporaryFailures() {
        listOf(408, 425, 429, 500, 503).forEach { status ->
            assertEquals(ReportSubmitDisposition.RETRY, ReportRetryClassifier.classify(status))
        }
    }

    @Test
    fun holdsReportsForARefreshedSessionOnUnauthorized() {
        assertEquals(ReportSubmitDisposition.AUTH_REQUIRED, ReportRetryClassifier.classify(401))
    }

    @Test
    fun dropsRequestsRejectedAsInvalidOrRestricted() {
        listOf(400, 403, 404, 413, 422, 451).forEach { status ->
            assertEquals(ReportSubmitDisposition.DROP, ReportRetryClassifier.classify(status))
        }
    }
}
