import ExpoModulesCore

/**
 * Phase B stub — returns false until the native distance-based animator ships.
 * JS player (missionBriefNativePlayer) remains the OTA fallback.
 */
public class TrailheadMissionAnimatorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("TrailheadMissionAnimator")

        AsyncFunction("isAvailable") { () -> Bool in
            false
        }

        AsyncFunction("startMissionAnimation") { (_: [String: Any]) -> Bool in
            false
        }

        AsyncFunction("pauseMissionAnimation") { () -> Bool in
            false
        }

        AsyncFunction("resumeMissionAnimation") { () -> Bool in
            false
        }

        AsyncFunction("stopMissionAnimation") { () -> Bool in
            false
        }

        AsyncFunction("setMissionAnimationSpeed") { (_: Double) -> Bool in
            false
        }
    }
}
