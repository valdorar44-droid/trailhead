package expo.modules.trailheadcarreports

data class CarReportCategory(
    val id: String,
    val label: String,
    val type: String,
    val subtype: String,
    val severity: String,
    val serverTtlSeconds: Long,
) {
    val queueTtlSeconds: Long
        get() = minOf(serverTtlSeconds, MAX_QUEUE_AGE_SECONDS)

    private companion object {
        const val MAX_QUEUE_AGE_SECONDS = 24L * 60L * 60L
    }
}

object CarReportCategories {
    val all: List<CarReportCategory> = listOf(
        CarReportCategory("hazard", "Hazard", "hazard", "Hazard", "high", 7L * 24L * 60L * 60L),
        CarReportCategory("road_closed", "Road closed", "road_closure", "Road closed", "critical", 30L * 24L * 60L * 60L),
        CarReportCategory("gate_closed", "Gate closed", "road_closure", "Gate closed", "high", 30L * 24L * 60L * 60L),
        CarReportCategory("camp_full", "Camp full", "campsite", "Camp full", "moderate", 14L * 24L * 60L * 60L),
        CarReportCategory("no_fuel", "No fuel", "fuel", "Fuel unavailable", "high", 12L * 60L * 60L),
        CarReportCategory("police", "Police", "police", "Police", "moderate", 2L * 60L * 60L),
    )

    private val byId = all.associateBy(CarReportCategory::id)

    fun find(id: String): CarReportCategory? = byId[id]
}
