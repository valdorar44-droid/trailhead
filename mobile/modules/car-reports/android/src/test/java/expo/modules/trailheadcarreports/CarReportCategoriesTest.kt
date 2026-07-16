package expo.modules.trailheadcarreports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class CarReportCategoriesTest {
    @Test
    fun exposesExactlyTheSixApprovedCategories() {
        assertEquals(
            listOf("Hazard", "Road closed", "Gate closed", "Camp full", "No fuel", "Police"),
            CarReportCategories.all.map { it.label },
        )
    }

    @Test
    fun policeUsesCanonicalWireValuesAndTwoHourLifetime() {
        val police = CarReportCategories.find("police")
        assertNotNull(police)
        assertEquals("police", police?.type)
        assertEquals("Police", police?.subtype)
        assertEquals(2L * 60L * 60L, police?.serverTtlSeconds)
        assertEquals(2L * 60L * 60L, police?.queueTtlSeconds)
    }

    @Test
    fun disconnectedReportsNeverOutliveTheServerQueuePolicy() {
        val roadClosed = CarReportCategories.find("road_closed")
        val noFuel = CarReportCategories.find("no_fuel")
        assertEquals(24L * 60L * 60L, roadClosed?.queueTtlSeconds)
        assertEquals(12L * 60L * 60L, noFuel?.queueTtlSeconds)
    }
}
