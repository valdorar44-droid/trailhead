package expo.modules.missionanimator

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Phase B stub — enable when native animator ships in a new binary. */
class TrailheadMissionAnimatorModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("TrailheadMissionAnimator")

        AsyncFunction("isAvailable") {
            false
        }

        AsyncFunction("startMissionAnimation") { _: Map<String, Any?> ->
            false
        }

        AsyncFunction("pauseMissionAnimation") {
            false
        }

        AsyncFunction("resumeMissionAnimation") {
            false
        }

        AsyncFunction("stopMissionAnimation") {
            false
        }

        AsyncFunction("setMissionAnimationSpeed") { _: Double ->
            false
        }
    }
}
